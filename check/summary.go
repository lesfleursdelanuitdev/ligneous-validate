package check

import (
	"strings"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/enricher"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/gedcom"
)

// Summary is the "what is in this file" line.
type Summary struct {
	People         int     `json:"people"`
	Families       int     `json:"families"`
	Sources        int     `json:"sources"`
	Notes          int     `json:"notes"`
	Media          int     `json:"media"`
	Years          *[2]int `json:"years"`
	Program        string  `json:"program"`
	ProgramVersion string  `json:"programVersion"`
	GedcomVersion  string  `json:"gedcomVersion"`
	Lines          int     `json:"lines"`
}

func buildSummary(doc *gedcom.GedcomDocument, ed *enricher.EnrichedDocument) Summary {
	s := Summary{
		People:   len(doc.Individuals),
		Families: len(doc.Families),
		Sources:  len(doc.Sources),
		Notes:    len(doc.Notes),
		Media:    len(doc.Media),
		Lines:    doc.LineCount,
	}
	if sour := doc.Header.FirstChildByTag("SOUR"); sour != nil {
		s.Program = strings.TrimSpace(sour.ChildValue("NAME"))
		if s.Program == "" {
			s.Program = sour.TrimmedValue()
		}
		s.ProgramVersion = strings.TrimSpace(sour.ChildValue("VERS"))
	}
	if gedc := doc.Header.FirstChildByTag("GEDC"); gedc != nil {
		s.GedcomVersion = strings.TrimSpace(gedc.ChildValue("VERS"))
	}
	var years *[2]int
	for _, d := range ed.Dates {
		if d.Year == 0 {
			continue
		}
		if years == nil {
			years = &[2]int{d.Year, d.Year}
			continue
		}
		if d.Year < years[0] {
			years[0] = d.Year
		}
		if d.Year > years[1] {
			years[1] = d.Year
		}
	}
	s.Years = years
	return s
}

// yearOf returns the year of the date at index i, if it has one. Index 0 is a
// real date; -1 means "no date".
func yearOf(ed *enricher.EnrichedDocument, i int) (int, bool) {
	if i < 0 || i >= len(ed.Dates) || ed.Dates[i].Year == 0 {
		return 0, false
	}
	return ed.Dates[i].Year, true
}

func cleanName(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(s, "/", " ")), " ")
}

func buildNames(ed *enricher.EnrichedDocument) map[string]string {
	names := make(map[string]string, len(ed.Individuals)+len(ed.Families))
	plain := make(map[string]string, len(ed.Individuals))
	for _, p := range ed.Individuals {
		n := cleanName(p.FullName)
		plain[p.Xref] = n
		if n == "" {
			names[p.Xref] = "Unnamed person (" + p.Xref + ")"
			continue
		}
		b, hasB := yearOf(ed, p.BirthDateIndex)
		d, hasD := yearOf(ed, p.DeathDateIndex)
		switch {
		case hasB && hasD:
			n += " (" + itoa(b) + "–" + itoa(d) + ")"
		case hasB:
			n += " (b. " + itoa(b) + ")"
		case hasD:
			n += " (d. " + itoa(d) + ")"
		}
		names[p.Xref] = n
	}
	for _, f := range ed.Families {
		h, w := plain[f.HusbandXref], plain[f.WifeXref]
		switch {
		case h != "" && w != "":
			names[f.Xref] = h + " & " + w
		case h != "":
			names[f.Xref] = h
		case w != "":
			names[f.Xref] = w
		default:
			names[f.Xref] = "Family " + f.Xref
		}
	}
	return names
}
