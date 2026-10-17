module github.com/lesfleursdelanuitdev/ligneous-validate/bench

go 1.24.0

toolchain go1.24.4

require (
	github.com/cacack/gedcom-go v1.2.0
	github.com/lesfleursdelanuitdev/ligneous-gedcom-lib v0.2.1
	github.com/lesfleursdelanuitdev/ligneous-validate v0.0.0
)

require (
	github.com/google/uuid v1.6.0 // indirect
	golang.org/x/text v0.28.0 // indirect
)

replace github.com/lesfleursdelanuitdev/ligneous-validate => ../
