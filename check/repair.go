package check

import (
	"bytes"
	"encoding/json"
	"strconv"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/validator"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/repair"
)

func itoa(i int) string { return strconv.Itoa(i) }

// Counts is the number of findings of each severity.
type Counts struct {
	Errors   int `json:"errors"`
	Warnings int `json:"warnings"`
	Hints    int `json:"hints"`
}

// RepairOut is the repaired file plus a before/after comparison, and the
// kinds of fix: those the file could use (the checklist), those that changed
// something and those that were chosen but changed nothing, with the reason.
type RepairOut struct {
	Data      []byte           `json:"-"`
	Changes   []repair.Change  `json:"changes"`
	Left      []string         `json:"left"`
	Before    Counts           `json:"before"`
	After     Counts           `json:"after"`
	Available []repair.FixInfo `json:"available"`
	Applied   []repair.FixInfo `json:"applied"`
	Skipped   []repair.FixInfo `json:"skipped"`
}

// CountsOf is the number of findings of each severity in r.
func CountsOf(r Result) Counts { return countFindings(r) }

func countFindings(r Result) Counts {
	var c Counts
	for _, f := range r.Findings {
		switch f.Severity {
		case "error":
			c.Errors++
		case "warning":
			c.Warnings++
		default:
			c.Hints++
		}
	}
	return c
}

// Repair fixes what can be fixed safely and counts findings before and after.
// It checks the original once; RepairWithBefore skips that when the page
// already has the counts.
func Repair(raw []byte) (RepairOut, error) {
	return RepairWithBefore(raw, countFindings(Check(raw)))
}

// RepairWithBefore is Repair with the Before counts given by the caller (the
// page has them from its check). The original is never checked again. After
// counts the findings of the repaired data with one parse and validation,
// the same findings Check gives, without its names and summary.
func RepairWithBefore(raw []byte, before Counts) (RepairOut, error) {
	return RepairWithProgress(raw, before, nil)
}

// Stages that RepairWithProgress reports, in order.
const (
	StageRepair = "repair"
	// then StageParse and StageValidate (the repaired copy's counts), then StageFinish.
)

// RepairWithProgress is RepairWithBefore with progress: progress (which may
// be nil) is called once at the start of each stage, in order: repair, parse,
// validate, finish. A failed repair stops after repair.
func RepairWithProgress(raw []byte, before Counts, progress func(stage string)) (RepairOut, error) {
	return RepairWithOptionsProgress(raw, before, repair.Options{}, progress)
}

// RepairWithOptions applies only the kinds of fix chosen in opt (see
// repair.Options: nil Fixes is every format kind, an empty one none). Like
// RepairWithBefore, it takes the original's counts from the caller and never
// checks the original again.
func RepairWithOptions(raw []byte, before Counts, opt repair.Options) (RepairOut, error) {
	return RepairWithOptionsProgress(raw, before, opt, nil)
}

// RepairWithOptionsProgress is RepairWithOptions with the stages of
// RepairWithProgress.
func RepairWithOptionsProgress(raw []byte, before Counts, opt repair.Options, progress func(stage string)) (RepairOut, error) {
	step := stepper(progress)
	step(StageRepair)
	res, err := repair.RepairWithOptions(raw, opt)
	if err != nil {
		return RepairOut{}, err
	}
	out := RepairOut{
		Data: res.Data, Changes: res.Changes, Left: res.Left,
		Available: orEmpty(res.Available), Applied: orEmpty(res.Applied), Skipped: orEmpty(res.Skipped),
	}
	if out.Changes == nil {
		out.Changes = []repair.Change{}
	}
	if out.Left == nil {
		out.Left = []string{}
	}
	out.Before = before
	out.After = countsOf(res.Data, step)
	step(StageFinish)
	return out, nil
}

func orEmpty(s []repair.FixInfo) []repair.FixInfo {
	if s == nil {
		return []repair.FixInfo{}
	}
	return s
}

// Plan previews the repair for the checklist (repair.Plan): the kinds of
// fix the file could use, and for each what it would change if chosen
// together with opt.Fixes. It writes nothing and checks nothing again, so it
// costs a fraction of a check and can run for files of any size.
func Plan(raw []byte, opt repair.Options) (*repair.PlanResult, error) {
	p, err := repair.Plan(raw, opt)
	if err != nil {
		return nil, err
	}
	p.Available = orEmpty(p.Available)
	if p.Units == nil {
		p.Units = map[repair.Fix][]repair.Unit{}
	}
	return p, nil
}

// ParseOptions reads the page's {fixes, submitterName} as JSON. Empty text,
// null, or "fixes" missing or null mean every format fix; "fixes": [] means
// none. Unknown fix names are left for the repair to refuse.
func ParseOptions(s string) (repair.Options, error) {
	var opt repair.Options
	if s == "" || s == "null" {
		return opt, nil
	}
	err := json.Unmarshal([]byte(s), &opt)
	return opt, err
}

// countsOf counts what Check would find in data: the parser's findings and
// the validator's.
func countsOf(data []byte, step func(string)) Counts {
	var c Counts
	add := func(sev string) {
		switch sev {
		case "error":
			c.Errors++
		case "warning":
			c.Warnings++
		default:
			c.Hints++
		}
	}
	step(StageParse)
	popts := parser.DefaultOptions()
	popts.Lenient = true
	doc, perrs, _ := parser.ParseWithOptions(bytes.NewReader(data), popts)
	for _, pe := range perrs {
		add(pe.Severity)
	}
	step(StageValidate)
	if doc == nil {
		return c
	}
	vopts := validator.DefaultOptions()
	vopts.DateConsistency = true
	for _, ve := range validator.ValidateWithOptions(doc, vopts) {
		add(severityName(int(ve.Severity)))
	}
	return c
}
