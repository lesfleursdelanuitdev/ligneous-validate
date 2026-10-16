package check

import (
	"bytes"
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

// RepairOut is the repaired file plus a before/after comparison.
type RepairOut struct {
	Data    []byte          `json:"-"`
	Changes []repair.Change `json:"changes"`
	Left    []string        `json:"left"`
	Before  Counts          `json:"before"`
	After   Counts          `json:"after"`
}

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
	step := func(stage string) {
		if progress != nil {
			progress(stage)
		}
	}
	step(StageRepair)
	res, err := repair.Repair(raw)
	if err != nil {
		return RepairOut{}, err
	}
	out := RepairOut{Data: res.Data, Changes: res.Changes, Left: res.Left}
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
