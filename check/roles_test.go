package check

import (
	"reflect"
	"testing"
)

const hdr = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n"

func ged(body string) []byte { return []byte(hdr + body + "0 TRLR\n") }

func TestRoles(t *testing.T) {
	cases := []struct {
		name  string
		code  string
		body  string
		roles map[string]string
	}{
		{"mother too young", "MOTHER_TOO_YOUNG_AT_CHILD_BIRTH",
			"0 @I1@ INDI\n1 NAME A /B/\n1 SEX M\n1 BIRT\n2 DATE 1800\n1 FAMS @F1@\n" +
				"0 @I3@ INDI\n1 NAME M /B/\n1 SEX F\n1 BIRT\n2 DATE 1840\n1 FAMS @F1@\n" +
				"0 @I2@ INDI\n1 NAME C /B/\n1 BIRT\n2 DATE 1850\n1 FAMC @F1@\n" +
				"0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I3@\n1 CHIL @I2@\n",
			map[string]string{"child": "@I2@", "mother": "@I3@", "family": "@F1@"}},
		{"child before father", "CHILD_BORN_BEFORE_FATHER",
			"0 @I1@ INDI\n1 NAME A /B/\n1 SEX M\n1 BIRT\n2 DATE 1860\n1 FAMS @F1@\n" +
				"0 @I2@ INDI\n1 NAME C /B/\n1 BIRT\n2 DATE 1850\n1 FAMC @F1@\n" +
				"0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n",
			map[string]string{"child": "@I2@", "father": "@I1@", "family": "@F1@"}},
		{"orphaned famc", "ORPHANED_FAMC",
			"0 @I1@ INDI\n1 NAME A /B/\n1 FAMC @F9@\n",
			map[string]string{"person": "@I1@", "target": "@F9@"}},
		{"orphaned husb", "ORPHANED_HUSB",
			"0 @F1@ FAM\n1 HUSB @I9@\n",
			map[string]string{"family": "@F1@", "target": "@I9@"}},
		{"unparseable marriage date", "EVENT_DATE_UNPARSEABLE",
			"0 @I1@ INDI\n1 NAME A /B/\n1 FAMS @F1@\n" +
				"0 @I2@ INDI\n1 NAME C /D/\n1 FAMS @F1@\n" +
				"0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 DATE 20 JUL\n",
			map[string]string{"family": "@F1@", "person": "@F1@"}},
		{"death before birth", "DEATH_BEFORE_BIRTH",
			"0 @I1@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE 1900\n1 DEAT\n2 DATE 1800\n",
			map[string]string{"person": "@I1@"}},
		{"invalid associate target", "INVALID_ASSOCIATE_TARGET",
			"0 @I1@ INDI\n1 NAME A /B/\n1 ASSO @F1@\n2 RELA friend\n" +
				"0 @F1@ FAM\n",
			map[string]string{"person": "@I1@", "target": "@F1@"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Check(ged(c.body))
			var found *Finding
			for i := range r.Findings {
				if r.Findings[i].Code == c.code {
					found = &r.Findings[i]
					break
				}
			}
			if found == nil {
				t.Fatalf("no %s finding; got %+v", c.code, r.Findings)
			}
			if !reflect.DeepEqual(found.Roles, c.roles) {
				t.Errorf("roles = %v, want %v", found.Roles, c.roles)
			}
		})
	}
}

func TestNames(t *testing.T) {
	body := "0 @I1@ INDI\n1 NAME Mary  /Smith/\n1 BIRT\n2 DATE 1850\n1 DEAT\n2 DATE 1921\n" +
		"0 @I2@ INDI\n1 NAME Mary /Smith/\n1 BIRT\n2 DATE 1850\n" +
		"0 @I3@ INDI\n1 NAME Mary /Smith/\n1 DEAT\n2 DATE 1921\n" +
		"0 @I4@ INDI\n1 NAME Mary /Smith/\n" +
		"0 @I9@ INDI\n1 SEX F\n" +
		"0 @I5@ INDI\n1 NAME John /Smith/\n" +
		"0 @I6@ INDI\n1 NAME Ann /Lee/\n" +
		"0 @F1@ FAM\n1 HUSB @I5@\n1 WIFE @I6@\n" +
		"0 @F2@ FAM\n1 HUSB @I5@\n" +
		"0 @F3@ FAM\n"
	r := Check(ged(body))
	want := map[string]string{
		"@I1@": "Mary Smith (1850–1921)",
		"@I2@": "Mary Smith (b. 1850)",
		"@I3@": "Mary Smith (d. 1921)",
		"@I4@": "Mary Smith",
		"@I9@": "Unnamed person (@I9@)",
		"@F1@": "John Smith & Ann Lee",
		"@F2@": "John Smith",
		"@F3@": "@F3@",
	}
	for k, v := range want {
		if r.Names[k] != v {
			t.Errorf("%s = %q, want %q", k, r.Names[k], v)
		}
	}
}
