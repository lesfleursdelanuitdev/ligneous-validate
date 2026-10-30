package check

import (
	"bytes"
	"fmt"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/enricher"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/gedcom"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/parser"
)

// Enriched is what the tree viewer reads from a file (tree-viewer spec, part
// 2): the enricher's own tables, unchanged, plus where each person and family
// is in the file and how many problems the parser met. The viewer's
// JavaScript turns the tables into the chart engine's input; nothing here
// knows about charts.
type Enriched struct {
	IsGedcom bool `json:"isGedcom"`
	// ParseFindings counts the parser's findings (decoding and line-level
	// problems) by severity. The validator's own findings are not counted:
	// enrich doesn't run it.
	ParseFindings Counts `json:"parseFindings"`
	Tables        Tables `json:"tables"`
	Lines         Lines  `json:"lines"`
	// Error is set when the library itself failed (a recovered panic).
	Error string `json:"error,omitempty"`
}

// Tables are whole tables of enricher.EnrichedDocument, under its own field
// names and types, never reshaped. To leave a table out, delete its field.
// Never the Document: the parsed tree is many times the size of the tables.
type Tables struct {
	Individuals      []enricher.EnrichedIndividual
	Families         []enricher.EnrichedFamily
	Dates            []enricher.ParsedDate
	Places           []enricher.ParsedPlace
	Events           []enricher.Event
	IndividualEvents []enricher.IndividualEventLink
	FamilyEvents     []enricher.FamilyEventLink
	Spouses          []enricher.SpouseEdge
	ParentChild      []enricher.ParentChildEdge
	FamilyChildren   []enricher.FamilyChildEdge
	// The names: NameForms says whose each form is; its given names and
	// surnames are in the link tables, their text in GivenNames and Surnames.
	NameForms          []enricher.NameForm
	NameFormGivenNames []enricher.NameFormGivenNameLink
	NameFormSurnames   []enricher.NameFormSurnameLink
	GivenNames         []enricher.GivenName
	Surnames           []enricher.Surname
}

// Lines are the 1-based line numbers of the records behind the rows:
// Individuals[i] is the line of Tables.Individuals[i], Families[i] of
// Tables.Families[i]. Records that share an xref each keep their own line.
type Lines struct {
	Individuals []int `json:"individuals"`
	Families    []int `json:"families"`
}

// StageEnrich is the stage EnrichWithProgress reports while the enricher runs.
const StageEnrich = "enrich"

// Enrich parses raw as Check does (decoding included, Lenient on) and runs
// the enricher. It never panics on bad input.
func Enrich(raw []byte) Enriched { return EnrichWithProgress(raw, nil) }

// EnrichWithProgress is Enrich with progress: progress (which may be nil) is
// called at the start of each stage, in order: parse, enrich, finish. A file
// that isn't GEDCOM stops after parse. The result is the same as Enrich's.
func EnrichWithProgress(raw []byte, progress func(stage string)) (out Enriched) {
	step := stepper(progress)
	defer func() {
		if r := recover(); r != nil {
			out = emptyEnriched()
			out.Error = fmt.Sprint(r)
		}
	}()
	out = emptyEnriched()

	afterParse()
	step(StageParse)
	opts := parser.DefaultOptions()
	opts.Lenient = true
	doc, perrs, err := parser.ParseWithOptions(bytes.NewReader(raw), opts)
	for _, pe := range perrs {
		out.ParseFindings.add(pe.Severity)
	}
	if !isGedcom(doc, err) {
		return out
	}
	out.IsGedcom = true

	step(StageEnrich)
	ed := enricher.Enrich(doc)
	out.Tables = Tables{
		Individuals:        nonNil(ed.Individuals),
		Families:           nonNil(ed.Families),
		Dates:              nonNil(ed.Dates),
		Places:             nonNil(ed.Places),
		Events:             nonNil(ed.Events),
		IndividualEvents:   nonNil(ed.IndividualEvents),
		FamilyEvents:       nonNil(ed.FamilyEvents),
		Spouses:            nonNil(ed.Spouses),
		ParentChild:        nonNil(ed.ParentChild),
		FamilyChildren:     nonNil(ed.FamilyChildren),
		NameForms:          nonNil(ed.NameForms),
		NameFormGivenNames: nonNil(ed.NameFormGivenNames),
		NameFormSurnames:   nonNil(ed.NameFormSurnames),
		GivenNames:         nonNil(ed.GivenNames),
		Surnames:           nonNil(ed.Surnames),
	}

	step(StageFinish)
	out.Lines.Individuals = linesOf(doc.Individuals, len(ed.Individuals), func(i int) string { return ed.Individuals[i].Xref })
	out.Lines.Families = linesOf(doc.Families, len(ed.Families), func(i int) string { return ed.Families[i].Xref })
	return out
}

func emptyEnriched() Enriched {
	return Enriched{
		Tables: Tables{
			Individuals: []enricher.EnrichedIndividual{}, Families: []enricher.EnrichedFamily{},
			Dates: []enricher.ParsedDate{}, Places: []enricher.ParsedPlace{}, Events: []enricher.Event{},
			IndividualEvents: []enricher.IndividualEventLink{}, FamilyEvents: []enricher.FamilyEventLink{},
			Spouses: []enricher.SpouseEdge{}, ParentChild: []enricher.ParentChildEdge{},
			FamilyChildren: []enricher.FamilyChildEdge{}, NameForms: []enricher.NameForm{},
			NameFormGivenNames: []enricher.NameFormGivenNameLink{}, NameFormSurnames: []enricher.NameFormSurnameLink{},
			GivenNames: []enricher.GivenName{}, Surnames: []enricher.Surname{},
		},
		Lines: Lines{Individuals: []int{}, Families: []int{}},
	}
}

// nonNil makes an empty table an empty JSON array rather than null.
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// linesOf gives each of the n enriched rows the line of its record. The
// enricher keeps the records' order and skips some (those with no xref), so
// rows and records are walked together, matching xrefs: records that share an
// xref each give their own line. A row with no record left gets 0.
func linesOf(recs []gedcom.GedcomRecord, n int, xref func(int) string) []int {
	lines := make([]int, n)
	j := 0
	for i := 0; i < n; i++ {
		for j < len(recs) && recs[j].Xref != xref(i) {
			j++
		}
		if j < len(recs) {
			lines[i] = recs[j].Line
			j++
		}
	}
	return lines
}

func (c *Counts) add(severity string) {
	switch severity {
	case "error":
		c.Errors++
	case "warning":
		c.Warnings++
	default:
		c.Hints++
	}
}

// isGedcom is Check's rule: the parse succeeded and the file has a header or
// at least one record.
func isGedcom(doc *gedcom.GedcomDocument, err error) bool {
	if doc == nil || err != nil {
		return false
	}
	records := len(doc.Individuals) + len(doc.Families) + len(doc.Sources) + len(doc.Notes) +
		len(doc.Repositories) + len(doc.Media) + len(doc.Submitters)
	return doc.Header.Tag == "HEAD" || records > 0
}
