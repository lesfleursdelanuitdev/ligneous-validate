package check

import (
	"bytes"
	"strings"
	"testing"
	"unicode/utf8"
)

// The ANSEL fixture the e2e tests use: "René /Dupré/" and "Zürich" in ANSEL
// (a combining mark before its letter), CRLF line ends, "1 CHAR ANSEL".
var anselFixture = []byte("0 HEAD\r\n1 GEDC\r\n2 VERS 5.5.1\r\n1 CHAR ANSEL\r\n0 @I1@ INDI\r\n" +
	"1 NAME Ren\xe2e /Dupr\xe2e/\r\n1 BIRT\r\n2 PLAC Z\xe8urich\r\n0 TRLR\r\n")

func TestSaveUTF8ConvertsANSEL(t *testing.T) {
	out, err := SaveUTF8(anselFixture)
	if err != nil {
		t.Fatal(err)
	}
	if !utf8.Valid(out) {
		t.Fatalf("not UTF-8: %q", out)
	}
	s := string(out)
	for _, want := range []string{"1 CHAR UTF-8\r\n", "René /Dupré/", "Zürich"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in %q", want, s)
		}
	}
	if strings.Contains(s, "ANSEL") {
		t.Errorf("still says ANSEL: %q", s)
	}
}

func TestSaveUTF8FixesOnlyTheCharLine(t *testing.T) {
	// What the editor sends for an ANSEL file: the decoded text as UTF-8, with
	// the header it had. Only the CHAR line may change; everything else stays,
	// including a long line, a leading space and a missing trailer.
	long := "1 NOTE " + strings.Repeat("é", 200)
	in := "0 HEAD\r\n1 GEDC\r\n2 VERS 5.5.1\r\n1 CHAR ANSEL\r\n0 @I1@ INDI\r\n1 NAME René /Dupré/\r\n" +
		"  1 SEX M\r\n" + long + "\r\n1 BIRT\r\n2 PLAC Zürich\r\n"
	out, err := SaveUTF8([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(in, "1 CHAR ANSEL", "1 CHAR UTF-8", 1)
	if string(out) != want {
		t.Errorf("got\n%q\nwant\n%q", out, want)
	}
}

func TestSaveUTF8InsertsMissingChar(t *testing.T) {
	in := "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Ann /Lee/\n0 TRLR\n"
	out, err := SaveUTF8([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out, []byte("1 CHAR UTF-8\n")) {
		t.Errorf("no CHAR inserted: %q", out)
	}
	if !bytes.Contains(out, []byte("1 NAME Ann /Lee/\n0 TRLR\n")) {
		t.Errorf("rest changed: %q", out)
	}
}

func TestSaveUTF8Idempotent(t *testing.T) {
	for name, in := range map[string][]byte{
		"ansel":   anselFixture,
		"royal92": read(t, "testdata/royal92.ged"),
		"utf8":    []byte("0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Zoë /Ünal/\n0 TRLR\n"),
	} {
		once, err := SaveUTF8(in)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		twice, err := SaveUTF8(once)
		if err != nil {
			t.Fatalf("%s again: %v", name, err)
		}
		if !bytes.Equal(once, twice) {
			t.Errorf("%s: second save changed the file", name)
		}
	}
}

func TestSaveUTF8NotGedcom(t *testing.T) {
	if _, err := SaveUTF8([]byte("\x89PNG\r\n\x1a\n")); err == nil {
		t.Error("want an error for a file with no GEDCOM line")
	}
}
