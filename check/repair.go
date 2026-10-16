package check

import (
	"strconv"

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
func Repair(raw []byte) (RepairOut, error) {
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
	out.Before = countFindings(Check(raw))
	out.After = countFindings(Check(res.Data))
	return out, nil
}
