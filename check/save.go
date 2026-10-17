package check

import "github.com/lesfleursdelanuitdev/ligneous-gedcom-lib/repair"

// SaveUTF8 is the editor's "Download edited file": the file as UTF-8, with
// its header saying "1 CHAR UTF-8" (inserted when missing). Only the
// encoding fix runs, so nothing else in the file changes. It fails when raw
// holds no GEDCOM line.
func SaveUTF8(raw []byte) ([]byte, error) {
	res, err := repair.RepairWithOptions(raw, repair.Options{Fixes: []repair.Fix{repair.FixEncoding}})
	if err != nil {
		return nil, err
	}
	return res.Data, nil
}
