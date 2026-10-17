module github.com/lesfleursdelanuitdev/ligneous-validate

go 1.23.5

require github.com/lesfleursdelanuitdev/ligneous-gedcom-lib v0.2.1

require (
	github.com/google/uuid v1.6.0 // indirect
	golang.org/x/text v0.28.0 // indirect
)

// Until library v0.3.0 is released: RepairWithOptions (reviewed commit 58b7ef4).
replace github.com/lesfleursdelanuitdev/ligneous-gedcom-lib => /home/momolig/gedcom-lib-v030pre
