package check

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/explain"
)

// The page's unit tests read every catalog entry from this file. It must match
// the library in go.mod; UPDATE_CATALOG=1 go test ./check rewrites it.
const catalogFixture = "../web/src/testdata/catalog.json"

func TestCatalogFixture(t *testing.T) {
	want, err := json.MarshalIndent(explain.All(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	if os.Getenv("UPDATE_CATALOG") == "1" {
		if err := os.WriteFile(catalogFixture, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(catalogFixture)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s is stale: run UPDATE_CATALOG=1 go test ./check", catalogFixture)
	}
}
