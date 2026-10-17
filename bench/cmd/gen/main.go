// Command gen writes the benchmark's generated inputs into a directory:
//
//	indented2.ged  5.5 MB, 70,000 people, indented lines (same bytes as the
//	               earlier hand-made test file of that name)
//	synth20.ged    about 20 MB of linked people, families, events, notes, sources
//	synth50.ged    about 50 MB, same shape
//
// It also writes expected.json with the true record counts for each file.
// Output is deterministic: the same seed gives the same bytes.
//
// Usage: go run ./cmd/gen -out DIR
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"
)

type person struct {
	sex       byte // 'M' or 'F'
	given     string
	surname   string
	birthYear int
	famc      int // 1-based family index, 0 = none
	fams      []int
}

type family struct {
	husb, wife int // 1-based person index
	children   []int
	marrYear   int
}

var (
	givenM   = []string{"John", "William", "James", "George", "Charles", "Thomas", "Henry", "Joseph", "Edward", "Robert", "José", "François", "Jürgen", "Łukasz", "Søren", "Ödön", "Mikhail", "Giovanni", "Patrick", "Samuel", "Daniel", "Peter", "Andrew", "Hugh"}
	givenF   = []string{"Mary", "Elizabeth", "Sarah", "Margaret", "Anne", "Catherine", "Jane", "Ellen", "Alice", "Emma", "Zoë", "Hélène", "Małgorzata", "Ingrid", "Dorothée", "Bríd", "Agnieszka", "Maria", "Rose", "Martha", "Susanna", "Hannah", "Grace", "Esther"}
	surnames = []string{"Smith", "Jones", "Brown", "Taylor", "Wilson", "Davies", "Evans", "Thomas", "Müller", "Schröder", "Dubois", "Lefèvre", "García", "Núñez", "Kowalski", "Wiśniewski", "Ødegaard", "Åberg", "O'Brien", "MacDonald", "Rossi", "Novák", "Horváth", "Gonsalves", "Pereira", "Lindqvist", "Andersen", "Murphy", "Walsh", "Kelly"}
	places   = []string{"London, Middlesex, England", "Cork, County Cork, Ireland", "Kraków, Małopolskie, Poland", "Lyon, Rhône, France", "Hamburg, Hamburg, Germany", "Göteborg, Västra Götaland, Sweden", "Boston, Suffolk, Massachusetts, USA", "Montréal, Québec, Canada", "Porto, Porto, Portugal", "Sevilla, Andalucía, Spain", "Bergen, Vestland, Norway", "Brno, Jihomoravský, Czechia", "Edinburgh, Midlothian, Scotland", "Napoli, Campania, Italy", "Debrecen, Hajdú-Bihar, Hungary"}
	occus    = []string{"Farmer", "Labourer", "Blacksmith", "Weaver", "Schoolteacher", "Merchant", "Carpenter", "Seamstress", "Clerk", "Miner", "Baker", "Mariner", "Domestic servant", "Shoemaker"}
	months   = []string{"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"}
	words    = []string{"the", "family", "lived", "near", "parish", "church", "records", "show", "that", "they", "moved", "after", "harvest", "letters", "mention", "a", "brother", "in", "service", "census", "lists", "household", "with", "two", "lodgers", "and", "servant", "baptism", "register", "spelling", "varies", "between", "entries", "notes", "from", "an", "aunt", "say"}
)

func date(r *rand.Rand, year int) string {
	switch r.Intn(10) {
	case 0:
		return fmt.Sprintf("ABT %d", year)
	case 1:
		return fmt.Sprintf("%s %d", months[r.Intn(12)], year)
	case 2:
		return fmt.Sprintf("BEF %d", year)
	default:
		return fmt.Sprintf("%d %s %d", 1+r.Intn(28), months[r.Intn(12)], year)
	}
}

func sentence(r *rand.Rand, n int) string {
	var b bytes.Buffer
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(words[r.Intn(len(words))])
	}
	return b.String()
}

// pickNear takes an unmarried person born within 8 years of year, or 0.
var pickNear func(q *[]int, ps []person, year int) int

// surnamePool is the base surnames plus about 2,000 made-up ones, so a file
// has many surname groups of very different sizes, as real trees do. build
// picks from it with a skew towards the start (the common names).
func surnamePool() []string {
	pre := []string{"Ash", "Brad", "Cal", "Dun", "Ell", "Fair", "Gold", "Hart", "Ing", "Kirk", "Lang", "Mor", "Nor", "Old", "Pen", "Rad", "Stan", "Thorn", "Wood", "Win", "Brom", "Cros", "Dal", "Hol", "Lind", "Mar", "Ros", "Sel", "Wal", "Ber", "Fal", "Gar", "Hal", "Kel", "Mac", "Ot", "Pol", "Ren", "Sand", "Ves", "Bel", "Dor", "Fen", "Gil", "Har", "Jen", "Lam", "Mel", "Ned", "Ral"}
	suf := []string{"ford", "ton", "ley", "wood", "man", "er", "son", "by", "field", "well", "ham", "stone", "ridge", "worth", "mann", "berg", "ström", "ová", "escu", "ini", "ez", "ard", "ow", "ock", "en", "ier", "ell", "aker", "ing", "holm", "dahl", "kowski", "vich", "ides", "ac", "ès", "ão", "ert", "ius", "ey"}
	out := append([]string(nil), surnames...)
	for _, a := range pre {
		for _, b := range suf {
			out = append(out, a+b)
		}
	}
	return out
}

var pool = surnamePool()

// build makes a linked population of about n people.
func build(r *rand.Rand, n int) ([]person, []family) {
	ps := make([]person, 0, n+16)
	fs := make([]family, 0, n/3)
	var singleM, singleF []int // 1-based indexes of unmarried children
	newPerson := func(sex byte, year int, surname string) int {
		g := givenM
		if sex == 'F' {
			g = givenF
		}
		if surname == "" {
			surname = pool[int(float64(len(pool))*math.Pow(r.Float64(), 2))]
		}
		ps = append(ps, person{sex: sex, given: g[r.Intn(len(g))], surname: surname, birthYear: year})
		return len(ps)
	}
	pick := func(q *[]int) int {
		if len(*q) == 0 || r.Intn(4) == 0 {
			return 0
		}
		i := r.Intn(len(*q))
		v := (*q)[i]
		(*q)[i] = (*q)[len(*q)-1]
		*q = (*q)[:len(*q)-1]
		return v
	}
	pickNear = func(q *[]int, ps []person, year int) int {
		if len(*q) == 0 || r.Intn(4) == 0 {
			return 0
		}
		for try := 0; try < 20; try++ {
			i := r.Intn(len(*q))
			v := (*q)[i]
			if d := ps[v-1].birthYear - year; d >= -8 && d <= 8 {
				(*q)[i] = (*q)[len(*q)-1]
				*q = (*q)[:len(*q)-1]
				return v
			}
		}
		return 0
	}
	for len(ps) < n {
		h := pick(&singleM)
		if h == 0 {
			h = newPerson('M', 1650+r.Intn(300), "")
		}
		w := pickNear(&singleF, ps, ps[h-1].birthYear)
		if w == 0 {
			w = newPerson('F', ps[h-1].birthYear-5+r.Intn(10), "")
		}
		fi := len(fs) + 1
		marr := max(ps[h-1].birthYear, ps[w-1].birthYear) + 18 + r.Intn(12)
		f := family{husb: h, wife: w, marrYear: marr}
		ps[h-1].fams = append(ps[h-1].fams, fi)
		ps[w-1].fams = append(ps[w-1].fams, fi)
		kids := r.Intn(7)
		for k := 0; k < kids; k++ {
			sex := byte('M')
			if r.Intn(2) == 0 {
				sex = 'F'
			}
			c := newPerson(sex, marr+1+r.Intn(15), ps[h-1].surname)
			ps[c-1].famc = fi
			f.children = append(f.children, c)
			if sex == 'M' {
				singleM = append(singleM, c)
			} else {
				singleF = append(singleF, c)
			}
		}
		fs = append(fs, f)
	}
	return ps, fs
}

func write(w io.Writer, r *rand.Rand, ps []person, fs []family) {
	bw := bufio.NewWriterSize(w, 1<<20)
	defer bw.Flush()
	p := func(format string, a ...any) { fmt.Fprintf(bw, format, a...); bw.WriteString("\r\n") }
	nSour := max(1, len(ps)/50)
	nNote := max(1, len(ps)/40)
	p("0 HEAD")
	p("1 SOUR LIGNEOUS-BENCH")
	p("2 NAME Ligneous benchmark generator")
	p("1 GEDC")
	p("2 VERS 5.5.1")
	p("2 FORM LINEAGE-LINKED")
	p("1 CHAR UTF-8")
	p("1 SUBM @U1@")
	p("0 @U1@ SUBM")
	p("1 NAME Benchmark")
	event := func(tag string, date string) {
		p("1 %s", tag)
		p("2 DATE %s", date)
		p("2 PLAC %s", places[r.Intn(len(places))])
		if r.Intn(3) == 0 {
			p("2 SOUR @S%d@", 1+r.Intn(nSour))
			p("3 PAGE Folio %d, entry %d", 1+r.Intn(400), 1+r.Intn(60))
		}
	}
	for i, x := range ps {
		p("0 @I%d@ INDI", i+1)
		p("1 NAME %s /%s/", x.given, x.surname)
		p("2 GIVN %s", x.given)
		p("2 SURN %s", x.surname)
		p("1 SEX %c", x.sex)
		bd, bm := 1+r.Intn(25), months[r.Intn(12)]
		if r.Intn(6) == 0 {
			event("BIRT", fmt.Sprintf("ABT %d", x.birthYear))
		} else {
			event("BIRT", fmt.Sprintf("%d %s %d", bd, bm, x.birthYear))
			if r.Intn(2) == 0 {
				event("CHR", fmt.Sprintf("%d %s %d", bd+3, bm, x.birthYear))
			}
		}
		if x.birthYear < 1930 || r.Intn(3) == 0 {
			// Old enough to have married and had the family's children.
			dy := x.birthYear + 1 + r.Intn(85)
			if len(x.fams) > 0 {
				dy = x.birthYear + 55 + r.Intn(35)
			}
			dd, dm := 1+r.Intn(25), months[r.Intn(12)]
			event("DEAT", fmt.Sprintf("%d %s %d", dd, dm, dy))
			if r.Intn(2) == 0 {
				by := dy
				if r.Intn(150) == 0 {
					by-- // a typo, as in real files: burial a year before death
				}
				event("BURI", fmt.Sprintf("%d %s %d", dd+3, dm, by))
			}
		}
		if r.Intn(2) == 0 {
			p("1 OCCU %s", occus[r.Intn(len(occus))])
		}
		if r.Intn(4) == 0 {
			p("1 RESI")
			p("2 DATE %d", x.birthYear+20+r.Intn(30))
			p("2 PLAC %s", places[r.Intn(len(places))])
		}
		if r.Intn(5) == 0 {
			p("1 NOTE %s", sentence(r, 12))
			for k := r.Intn(3); k > 0; k-- {
				p("2 CONT %s", sentence(r, 10))
			}
			if r.Intn(2) == 0 {
				p("2 CONC %s", sentence(r, 6))
			}
		}
		if r.Intn(8) == 0 {
			p("1 NOTE @N%d@", 1+r.Intn(nNote))
		}
		if r.Intn(3) == 0 {
			p("1 SOUR @S%d@", 1+r.Intn(nSour))
			p("2 PAGE p. %d", 1+r.Intn(900))
			p("2 QUAY %d", r.Intn(4))
		}
		if x.famc > 0 {
			p("1 FAMC @F%d@", x.famc)
		}
		for _, f := range x.fams {
			p("1 FAMS @F%d@", f)
		}
	}
	for i, f := range fs {
		p("0 @F%d@ FAM", i+1)
		p("1 HUSB @I%d@", f.husb)
		p("1 WIFE @I%d@", f.wife)
		event("MARR", date(r, f.marrYear))
		for _, c := range f.children {
			p("1 CHIL @I%d@", c)
		}
	}
	for i := 0; i < nSour; i++ {
		p("0 @S%d@ SOUR", i+1)
		p("1 TITL Parish registers of %s, %d-%d", places[r.Intn(len(places))], 1600+r.Intn(200), 1850+r.Intn(100))
		p("1 AUTH %s %s", givenM[r.Intn(len(givenM))], surnames[r.Intn(len(surnames))])
		p("1 PUBL Archive copy, film %d", 100000+r.Intn(900000))
	}
	for i := 0; i < nNote; i++ {
		p("0 @N%d@ NOTE %s", i+1, sentence(r, 14))
		p("1 CONT %s", sentence(r, 12))
	}
	p("0 TRLR")
}

type counter struct{ n int64 }

func (c *counter) Write(b []byte) (int, error) { c.n += int64(len(b)); return len(b), nil }

// synth writes a file of about target bytes and returns its counts.
func synth(path string, target int64, seed int64) (int, int, error) {
	// Size a trial population, then scale to the target.
	trial := 20000
	r := rand.New(rand.NewSource(seed))
	ps, fs := build(r, trial)
	var c counter
	write(&c, r, ps, fs)
	n := int(float64(trial) * float64(target) / float64(c.n))
	r = rand.New(rand.NewSource(seed))
	ps, fs = build(r, n)
	f, err := os.Create(path)
	if err != nil {
		return 0, 0, err
	}
	write(f, r, ps, fs)
	return len(ps), len(fs), f.Close()
}

// indented writes the 70,000-person file with indented levels.
func indented(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(f, 1<<20)
	bw.WriteString("0 HEAD\n  1 SOUR X\n  1 GEDC\n    2 VERS 5.5.1\n    2 FORM LINEAGE-LINKED\n  1 CHAR UTF-8\n  1 SUBM @U1@\n0 @U1@ SUBM\n  1 NAME T\n")
	for i := 1; i <= 70000; i++ {
		fmt.Fprintf(bw, "0 @I%d@ INDI\n  1 NAME P%d /Lee/\n  1 SEX F\n  1 BIRT\n    2 DATE 1 JAN 1900\n", i, i)
	}
	bw.WriteString("0 TRLR\n")
	if err := bw.Flush(); err != nil {
		return err
	}
	return f.Close()
}

type counts struct {
	Individuals int `json:"individuals"`
	Families    int `json:"families"`
}

func main() {
	out := flag.String("out", "", "output directory")
	flag.Parse()
	if *out == "" {
		log.Fatal("usage: gen -out DIR")
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	exp := map[string]counts{"indented2.ged": {70000, 0}}
	if err := indented(filepath.Join(*out, "indented2.ged")); err != nil {
		log.Fatal(err)
	}
	for _, s := range []struct {
		name   string
		target int64
		seed   int64
	}{{"synth20.ged", 20 << 20, 20}, {"synth50.ged", 50 << 20, 50}} {
		i, f, err := synth(filepath.Join(*out, s.name), s.target, s.seed)
		if err != nil {
			log.Fatal(err)
		}
		exp[s.name] = counts{i, f}
	}
	b, _ := json.MarshalIndent(exp, "", "  ")
	if err := os.WriteFile(filepath.Join(*out, "expected.json"), b, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(b))
}
