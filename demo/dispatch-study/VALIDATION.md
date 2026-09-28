# Validation record

Executed locally on 2026-09-08 with `go1.26.5 windows/amd64`.

- `go test ./...`: passed across dispatch, ERCOT parsing, capex and study packages.
- `go vet ./...`: passed after correcting an unkeyed external-package struct literal in a new test.
- `git diff --check`: passed; Git emitted line-ending notices, not whitespace errors.
- Default study evaluated 8,640 battery-days without a replay-constraint or hindsight-bound failure.
- Second run to a separate directory produced identical SHA-256 hashes for all five output files. Duplicate run files were then removed. [SHA256SUMS.txt](SHA256SUMS.txt) records the retained outputs.
- Legacy default day output remains $0.43 per battery; annualization and floor language were removed from the CLI.

No network is needed to rerun the experiment. The live careers lookup was a separate public, read-only request; its source and timestamp are saved in the sources directory. No Go race-detector, hardware, real-time-control, or real-market validation is claimed.
