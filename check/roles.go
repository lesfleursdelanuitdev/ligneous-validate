package check

import (
	"strings"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/gedcom"
	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/validator"
)

// index classifies xrefs as people or families.
type index struct{ kind map[string]string }

func newIndex(doc *gedcom.GedcomDocument) index {
	k := map[string]string{}
	for i := range doc.Individuals {
		k[doc.Individuals[i].Xref] = "INDI"
	}
	for i := range doc.Families {
		k[doc.Families[i].Xref] = "FAM"
	}
	return index{k}
}

func (x index) isPerson(s string) bool { return s != "" && x.kind[s] == "INDI" }
func (x index) isFamily(s string) bool { return s != "" && x.kind[s] == "FAM" }

// rolesFor says which xref plays which part in a finding, so the page can
// fill placeholders such as {child} and {mother} with names.
//
// Where the library stores them (checked in validator/date_checks.go and
// validator/validator.go):
//   - parent/child findings: Xref = family, RelatedXref = child,
//     Details parent (father or mother), child (sometimes), family;
//   - ORPHANED_*: Xref = the record holding the pointer, Details pointer
//     (RelatedXref repeats it); HUSB/WIFE/CHIL also carry Details family;
//   - INVALID_ASSOCIATE_TARGET: Xref = the person, Details target, target_tag.
func rolesFor(e *validator.ValidationError, x index) map[string]string {
	roles := map[string]string{}
	d := e.Details
	code := e.Code
	isParentChild := strings.HasPrefix(code, "CHILD_") || strings.Contains(code, "FATHER") || strings.Contains(code, "MOTHER")

	if isParentChild {
		child := d["child"]
		if child == "" && x.isPerson(e.RelatedXref) {
			child = e.RelatedXref
		}
		if child != "" {
			roles["child"] = child
		}
		if p := d["parent"]; p != "" {
			if strings.Contains(code, "FATHER") {
				roles["father"] = p
			}
			if strings.Contains(code, "MOTHER") {
				roles["mother"] = p
			}
		}
	} else {
		for _, s := range []string{e.Xref, e.RelatedXref} {
			if x.isPerson(s) {
				roles["person"] = s
				break
			}
		}
	}

	if f := d["family"]; f != "" {
		roles["family"] = f
	} else {
		for _, s := range []string{e.Xref, e.RelatedXref} {
			if x.isFamily(s) {
				roles["family"] = s
				break
			}
		}
	}

	// "{person}'s {event} date reads …" on a family event (MARR, DIV, …):
	// the couple is the person, so the page fills in the family's name.
	if code == "EVENT_DATE_UNPARSEABLE" && roles["person"] == "" && x.isFamily(e.Xref) {
		roles["person"] = e.Xref
	}

	if t := d["target"]; t != "" {
		roles["target"] = t
	} else if t := d["pointer"]; t != "" {
		roles["target"] = t
	}
	return roles
}
