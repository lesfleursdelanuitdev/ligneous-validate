package check

import (
	"bytes"
	"fmt"
	"strings"

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
	// Famc[i] is the FAMC pointers of the record behind Tables.Individuals[i],
	// in that record's order, as written (trimmed; not checked against the
	// families). The engine's birth-family rule needs the order (T20), and
	// the enricher's tables keep only each family's CHIL order.
	Famc [][]string   `json:"famc"`
	Home HomePointers `json:"home"`
	// Error is set when the library itself failed (a recovered panic).
	Error string `json:"error,omitempty"`
}

// Tables are whole tables of enricher.EnrichedDocument, under its own field
// names, their rows never reshaped; as JSON each names its fields once (see
// Table). To leave a table out, delete its field. Spouses is left out (spec
// T25): Families says the same. The life-events timeline (T40) reads
// IndividualEvents and FamilyEvents, and Attributes (OCCU, EDUC and the
// rest) and Residences (RESI), which the enricher keeps apart from Events;
// those two carry their owner, so their link tables aren't needed. Never the
// Document: the parsed tree is many times the size.
type Tables struct {
	Individuals      Table[enricher.EnrichedIndividual]
	Families         Table[enricher.EnrichedFamily]
	Dates            Table[enricher.ParsedDate]
	Places           Table[enricher.ParsedPlace]
	Events           Table[enricher.Event]
	IndividualEvents Table[enricher.IndividualEventLink]
	FamilyEvents     Table[enricher.FamilyEventLink]
	Attributes       Table[enricher.Attribute]
	Residences       Table[enricher.Residence]
	ParentChild      Table[enricher.ParentChildEdge]
	FamilyChildren   Table[enricher.FamilyChildEdge]
	// The names: NameForms says whose each form is; its given names and
	// surnames are in the link tables, their text in GivenNames and Surnames.
	NameForms          Table[enricher.NameForm]
	NameFormGivenNames Table[enricher.NameFormGivenNameLink]
	NameFormSurnames   Table[enricher.NameFormSurnameLink]
	GivenNames         Table[enricher.GivenName]
	Surnames           Table[enricher.Surname]
}

// HomePointers are the header's pointers to the file's home person (spec
// T26), as written, trimmed; "" when there is none. Which to use, and whether
// it names a person, is the page's choice (web/src/tree/start.ts).
type HomePointers struct {
	// Home is HEAD's own _HOME line.
	Home string `json:"home"`
	// Root is HEAD's own _ROOT line.
	Root string `json:"root"`
	// Submitter is the first pointer to an INDI record on the submitter
	// record that HEAD's SUBM names, whatever its tag (programs differ).
	Submitter string `json:"submitter"`
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
		Individuals:        ed.Individuals,
		Families:           ed.Families,
		Dates:              ed.Dates,
		Places:             ed.Places,
		Events:             ed.Events,
		IndividualEvents:   ed.IndividualEvents,
		FamilyEvents:       ed.FamilyEvents,
		Attributes:         ed.Attributes,
		Residences:         ed.Residences,
		ParentChild:        ed.ParentChild,
		FamilyChildren:     ed.FamilyChildren,
		NameForms:          ed.NameForms,
		NameFormGivenNames: ed.NameFormGivenNames,
		NameFormSurnames:   ed.NameFormSurnames,
		GivenNames:         ed.GivenNames,
		Surnames:           ed.Surnames,
	}

	step(StageFinish)
	out.Home = homePointers(doc)
	people := recordsOf(doc.Individuals, len(ed.Individuals), func(i int) string { return ed.Individuals[i].Xref })
	families := recordsOf(doc.Families, len(ed.Families), func(i int) string { return ed.Families[i].Xref })
	out.Lines.Individuals = make([]int, len(people))
	out.Famc = make([][]string, len(people))
	for i, r := range people {
		out.Famc[i] = []string{}
		if r < 0 {
			continue
		}
		out.Lines.Individuals[i] = doc.Individuals[r].Line
		for _, c := range doc.Individuals[r].Children {
			if c.Tag == "FAMC" {
				if p := pointer(c.Value); p != "" {
					out.Famc[i] = append(out.Famc[i], p)
				}
			}
		}
	}
	out.Lines.Families = make([]int, len(families))
	for i, r := range families {
		if r >= 0 {
			out.Lines.Families[i] = doc.Families[r].Line
		}
	}
	return out
}

// emptyEnriched is the answer for a file with nothing in it. An empty Table
// is written as {"columns":[],"rows":[]}, never null.
func emptyEnriched() Enriched {
	return Enriched{Lines: Lines{Individuals: []int{}, Families: []int{}}, Famc: [][]string{}}
}

// pointer is a value that is a pointer (@X1@), trimmed, or "".
func pointer(v string) string {
	v = strings.TrimSpace(v)
	if len(v) > 2 && v[0] == '@' && v[len(v)-1] == '@' && v != "@@" && !strings.HasPrefix(v, "@#") {
		return v
	}
	return ""
}

// homePointers reads the header's home-person pointers (see HomePointers).
func homePointers(doc *gedcom.GedcomDocument) HomePointers {
	var h HomePointers
	if c := doc.Header.FirstChildByTag("_HOME"); c != nil {
		h.Home = pointer(c.Value)
	}
	if c := doc.Header.FirstChildByTag("_ROOT"); c != nil {
		h.Root = pointer(c.Value)
	}
	subm := pointer(doc.Header.ChildValue("SUBM"))
	if subm == "" {
		return h
	}
	people := make(map[string]bool, len(doc.Individuals))
	for i := range doc.Individuals {
		people[doc.Individuals[i].Xref] = true
	}
	for i := range doc.Submitters {
		if doc.Submitters[i].Xref != subm {
			continue
		}
		for _, c := range doc.Submitters[i].Children {
			if p := pointer(c.Value); p != "" && people[p] {
				h.Submitter = p
				return h
			}
		}
		return h // the first record with that xref only
	}
	return h
}

// recordsOf gives each of the n enriched rows the index of its record. The
// enricher keeps the records' order and skips some (those with no xref), so
// rows and records are walked together, matching xrefs: records that share
// an xref each keep their own. A row with no record left gets -1.
func recordsOf(recs []gedcom.GedcomRecord, n int, xref func(int) string) []int {
	out := make([]int, n)
	j := 0
	for i := 0; i < n; i++ {
		for j < len(recs) && recs[j].Xref != xref(i) {
			j++
		}
		out[i] = -1
		if j < len(recs) {
			out[i] = j
			j++
		}
	}
	return out
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
