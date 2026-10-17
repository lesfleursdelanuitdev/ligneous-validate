package check

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/repair"
)

// The page's unit tests build the checklist from these Plan answers. They
// must match the library in go.mod; UPDATE_PLANS=1 go test ./check rewrites them.
var planFixtures = []struct {
	out, in string
	opt     repair.Options
}{
	{"../web/src/testdata/plan-suggested.json", suggested, repair.Options{}},
	{"../web/src/testdata/plan-suggested-links.json", suggested,
		repair.Options{Fixes: []repair.Fix{repair.FixBlankLines, repair.FixBrokenLinks}}},
	{"../web/src/testdata/plan-suggested-named.json", suggested,
		repair.Options{Fixes: []repair.Fix{repair.FixBlankLines, repair.FixSubmitter}, SubmitterName: "Jo March"}},
	{"../web/src/testdata/plan-blank-in-fam-links.json", blankInFam,
		repair.Options{Fixes: []repair.Fix{repair.FixBlankLines, repair.FixBrokenLinks}}},
	{"../web/src/testdata/plan-ansel-long.json", "../e2e/fixtures/ansel-long.ged", repair.Options{}},
	{"../web/src/testdata/plan-utf16.json", "../e2e/fixtures/utf16le-bom.ged", repair.Options{}},
}

func TestPlanFixtures(t *testing.T) {
	for _, f := range planFixtures {
		p, err := Plan(read(t, f.in), f.opt)
		if err != nil {
			t.Fatal(err)
		}
		want, err := json.MarshalIndent(p, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		want = append(want, '\n')
		if os.Getenv("UPDATE_PLANS") == "1" {
			if err := os.WriteFile(f.out, want, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		if got, err := os.ReadFile(f.out); err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s is out of date (UPDATE_PLANS=1 go test ./check): %v", f.out, err)
		}
	}
}
