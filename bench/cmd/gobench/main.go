// Command gobench times the native Go measurements and prints one JSON object
// per (task, library, file) on stdout.
//
// Tasks:
//
//	parse     bytes in, in-memory tree out (ours and gedcom-go)
//	check     the site's full check, check.Check + json.Marshal (ours only)
//	validate  validation of an already-parsed tree (ours and gedcom-go)
//
// Usage: gobench -runs 10 -task parse,check,validate FILE...
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	gedcomgo "github.com/cacack/gedcom-go"
	ggvalidator "github.com/cacack/gedcom-go/validator"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/gedcom"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/validator"
	"github.com/lesfleursdelanuitdev/ligneous-validate/check"
)

type result struct {
	Task        string    `json:"task"`
	Library     string    `json:"library"`
	Variant     string    `json:"variant,omitempty"`
	Skipped     bool      `json:"skipped,omitempty"`
	Note        string    `json:"note,omitempty"`
	Runtime     string    `json:"runtime"`
	File        string    `json:"file"`
	Bytes       int       `json:"bytes"`
	Individuals int       `json:"individuals"`
	Families    int       `json:"families"`
	Findings    int       `json:"findings,omitempty"`
	Error       string    `json:"error,omitempty"`
	Runs        int       `json:"runs"`
	TimesMs     []float64 `json:"timesMs"`
	MedianMs    float64   `json:"medianMs"`
	MinMs       float64   `json:"minMs"`
	MaxMs       float64   `json:"maxMs"`
	Memory      any       `json:"memory"`
}

// outcome is what one run reports: the counts and an error, if any.
type outcome struct {
	ind, fam, findings int
	err                string
}

func oursParse(raw []byte) (*gedcom.GedcomDocument, outcome) {
	opts := parser.DefaultOptions()
	opts.Lenient = true
	doc, _, err := parser.ParseWithOptions(bytes.NewReader(raw), opts)
	if err != nil {
		return doc, outcome{err: err.Error()}
	}
	if doc == nil {
		return nil, outcome{err: "nil document"}
	}
	return doc, outcome{ind: len(doc.Individuals), fam: len(doc.Families)}
}

func theirsParse(raw []byte) (*gedcomgo.Document, outcome) {
	doc, err := gedcomgo.Decode(bytes.NewReader(raw))
	if err != nil {
		return doc, outcome{err: err.Error()}
	}
	return doc, outcome{ind: len(doc.Individuals()), fam: len(doc.Families())}
}

// theirsValidateNoDup is gedcom-go's ValidateAll without its duplicate-person
// detection (which compares every pair of people sharing a surname), built
// from the same public parts in the same order, with the same default
// strictness filter (errors and warnings). Our validator has no duplicate
// detection, so this is the closer match.
func theirsValidateNoDup(doc *gedcomgo.Document) int {
	var all []ggvalidator.Issue
	all = append(all, ggvalidator.NewHeaderValidator().ValidateHeader(doc)...)
	all = append(all, ggvalidator.NewDateLogicValidator(nil).Validate(doc)...)
	all = append(all, ggvalidator.NewReferenceValidator().Validate(doc)...)
	all = append(all, ggvalidator.NewXRefValidator().ValidateXRefs(doc)...)
	all = append(all, ggvalidator.NewEncodingValidator().Validate(doc)...)
	n := 0
	for _, is := range all {
		if is.Severity == ggvalidator.SeverityError || is.Severity == ggvalidator.SeverityWarning {
			n++
		}
	}
	return n
}

// probeValidateAll runs one gedcom-go ValidateAll in a child process and
// kills it after budget. It returns the run's time, or an error when it did
// not finish. The child is this program, started with -probe.
func probeValidateAll(path string, budget time.Duration) (float64, string) {
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	out, err := exec.CommandContext(ctx, os.Args[0], "-probe", path).Output()
	if ctx.Err() != nil {
		return 0, fmt.Sprintf("did not finish one run in %s (child process killed)", budget)
	}
	if err != nil {
		return 0, "probe failed: " + err.Error()
	}
	ms, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return ms, ""
}

func oursCheck(raw []byte) outcome {
	res := check.Check(raw)
	if _, err := json.Marshal(res); err != nil {
		return outcome{err: err.Error()}
	}
	if res.Error != "" {
		return outcome{err: res.Error}
	}
	return outcome{ind: res.Summary.People, fam: res.Summary.Families, findings: len(res.Findings)}
}

type memStats struct {
	TotalAllocMB    float64 `json:"totalAllocMB"`
	PeakHeapInuseMB float64 `json:"peakHeapInuseMB"`
	Note            string  `json:"note"`
}

// measureMemory runs fn once more with a sampler watching HeapInuse.
// It is a separate run from the timed ones, because ReadMemStats stops the
// world and would distort the timings.
func measureMemory(fn func()) memStats {
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	peak := before.HeapInuse
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		t := time.NewTicker(2 * time.Millisecond)
		defer t.Stop()
		var m runtime.MemStats
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				runtime.ReadMemStats(&m)
				if m.HeapInuse > peak {
					peak = m.HeapInuse
				}
			}
		}
	}()
	fn()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	close(stop)
	<-done
	if after.HeapInuse > peak {
		peak = after.HeapInuse
	}
	const mb = 1 << 20
	return memStats{
		TotalAllocMB:    round(float64(after.TotalAlloc-before.TotalAlloc) / mb),
		PeakHeapInuseMB: round(float64(peak-before.HeapInuse) / mb),
		Note:            "separate untimed run; peak HeapInuse above the pre-run baseline, sampled every 2 ms",
	}
}

func round(v float64) float64 { return float64(int64(v*100+0.5)) / 100 }

// timed runs fn once as a warm-up, then runs times with runtime.GC() before
// each run; GC time is not counted.
func timed(runs int, fn func() outcome) ([]float64, outcome) {
	last := fn()
	if last.err != "" {
		return nil, last
	}
	ts := make([]float64, 0, runs)
	for i := 0; i < runs; i++ {
		runtime.GC()
		t0 := time.Now()
		o := fn()
		ts = append(ts, float64(time.Since(t0).Microseconds())/1000)
		last = o
		if o.err != "" {
			break
		}
	}
	return ts, last
}

func emit(r result) {
	if len(r.TimesMs) > 0 {
		s := append([]float64(nil), r.TimesMs...)
		sort.Float64s(s)
		n := len(s)
		if n%2 == 1 {
			r.MedianMs = s[n/2]
		} else {
			r.MedianMs = round((s[n/2-1] + s[n/2]) / 2)
		}
		r.MinMs, r.MaxMs = s[0], s[n-1]
	}
	r.Runs = len(r.TimesMs)
	b, _ := json.Marshal(r)
	fmt.Println(string(b))
}

func main() {
	runs := flag.Int("runs", 10, "timed runs after one warm-up")
	tasks := flag.String("task", "parse,check,validate", "comma-separated tasks")
	probe := flag.String("probe", "", "internal: time one gedcom-go ValidateAll of this file")
	budget := flag.Duration("budget", 120*time.Second, "time allowed for one gedcom-go ValidateAll run before it is skipped")
	slow := flag.Duration("slow", 30*time.Second, "a gedcom-go ValidateAll run longer than this gets 3 timed runs, not -runs")
	flag.Parse()
	if *probe != "" {
		raw, err := os.ReadFile(*probe)
		if err != nil {
			os.Exit(1)
		}
		doc, o := theirsParse(raw)
		if o.err != "" {
			os.Exit(1)
		}
		t0 := time.Now()
		gedcomgo.ValidateAll(doc)
		fmt.Println(float64(time.Since(t0).Microseconds()) / 1000)
		return
	}
	want := map[string]bool{}
	for _, t := range strings.Split(*tasks, ",") {
		want[t] = true
	}
	for _, path := range flag.Args() {
		raw, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		base := result{Runtime: "go-native", File: filepath.Base(path), Bytes: len(raw)}
		fmt.Fprintf(os.Stderr, "go: %s\n", base.File)

		if want["parse"] {
			r := base
			r.Task, r.Library = "parse", "ligneous-gedcom-lib"
			ts, o := timed(*runs, func() outcome { _, o := oursParse(raw); return o })
			r.TimesMs, r.Individuals, r.Families, r.Error = ts, o.ind, o.fam, o.err
			r.Memory = measureMemory(func() { oursParse(raw) })
			emit(r)

			r = base
			r.Task, r.Library = "parse", "gedcom-go"
			ts, o = timed(*runs, func() outcome { _, o := theirsParse(raw); return o })
			r.TimesMs, r.Individuals, r.Families, r.Error = ts, o.ind, o.fam, o.err
			r.Memory = measureMemory(func() { theirsParse(raw) })
			emit(r)
		}
		if want["check"] {
			r := base
			r.Task, r.Library = "check", "ligneous-gedcom-lib"
			ts, o := timed(*runs, func() outcome { return oursCheck(raw) })
			r.TimesMs, r.Individuals, r.Families, r.Findings, r.Error = ts, o.ind, o.fam, o.findings, o.err
			r.Memory = measureMemory(func() { oursCheck(raw) })
			emit(r)
		}
		if want["validate"] {
			r := base
			r.Task, r.Library, r.Variant = "validate", "ligneous-gedcom-lib", "ValidateWithOptions DateConsistency"
			doc, po := oursParse(raw)
			if po.err != "" {
				r.Error = "parse: " + po.err
			} else {
				vopts := validator.DefaultOptions()
				vopts.DateConsistency = true
				ts, o := timed(*runs, func() outcome {
					return outcome{ind: po.ind, fam: po.fam, findings: len(validator.ValidateWithOptions(doc, vopts))}
				})
				r.TimesMs, r.Individuals, r.Families, r.Findings = ts, o.ind, o.fam, o.findings
				r.Memory = measureMemory(func() { validator.ValidateWithOptions(doc, vopts) })
			}
			emit(r)

			tdoc, to := theirsParse(raw)
			r = base
			r.Task, r.Library, r.Variant = "validate", "gedcom-go", "ValidateAll"
			if to.err != "" {
				r.Error = "parse: " + to.err
			} else if ms, perr := probeValidateAll(path, *budget); perr != "" {
				r.Individuals, r.Families, r.Error, r.Skipped = to.ind, to.fam, perr, true
			} else {
				fmt.Fprintf(os.Stderr, "go: gedcom-go ValidateAll probe %.0f ms\n", ms)
				n := *runs
				if time.Duration(ms*float64(time.Millisecond)) > *slow && n > 3 {
					// One run takes long on a shared server: 3 timed runs, flagged.
					n = 3
					r.Note = fmt.Sprintf("one run took %.0f s in the probe, so %d timed runs instead of %d", ms/1000, n, *runs)
				}
				ts, o := timed(n, func() outcome {
					return outcome{ind: to.ind, fam: to.fam, findings: len(gedcomgo.ValidateAll(tdoc))}
				})
				r.TimesMs, r.Individuals, r.Families, r.Findings = ts, o.ind, o.fam, o.findings
				r.Memory = measureMemory(func() { gedcomgo.ValidateAll(tdoc) })
			}
			emit(r)

			r = base
			r.Task, r.Library, r.Variant = "validate", "gedcom-go", "ValidateAll minus duplicates"
			if to.err != "" {
				r.Error = "parse: " + to.err
			} else {
				ts, o := timed(*runs, func() outcome {
					return outcome{ind: to.ind, fam: to.fam, findings: theirsValidateNoDup(tdoc)}
				})
				r.TimesMs, r.Individuals, r.Families, r.Findings = ts, o.ind, o.fam, o.findings
				r.Memory = measureMemory(func() { theirsValidateNoDup(tdoc) })
			}
			emit(r)
		}
	}
}
