package ercot

import "testing"

// A trimmed but structurally exact sample of the real endpoint response
// captured 2026-08-13 (fields beyond those parsed are omitted).
const sample = `{"lastUpdated":"2026-08-13 19:47:00-0500",
"rtSppData":[{"intervalEnding":"00:15","hbHubAvg":22.77}],
"damSppData":[
 {"hourEnding":1,"hbHubAvg":21.30},
 {"hourEnding":2,"hbHubAvg":19.75},
 {"hourEnding":18,"hbHubAvg":38.46}
]}`

func TestParse(t *testing.T) {
	pts, updated, err := Parse([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if updated != "2026-08-13 19:47:00-0500" {
		t.Fatalf("lastUpdated: got %q", updated)
	}
	if len(pts) != 3 {
		t.Fatalf("expected 3 day-ahead points, got %d", len(pts))
	}
	if pts[0].Interval != "01:00" || pts[0].USDPerMWh != 21.30 {
		t.Fatalf("first point wrong: %+v", pts[0])
	}
	if pts[2].Interval != "18:00" || pts[2].USDPerMWh != 38.46 {
		t.Fatalf("third point wrong: %+v", pts[2])
	}
}

func TestParseRejectsEmpty(t *testing.T) {
	if _, _, err := Parse([]byte(`{"damSppData":[]}`)); err == nil {
		t.Fatal("empty day-ahead data must error")
	}
	if _, _, err := Parse([]byte(`not json`)); err == nil {
		t.Fatal("non-JSON must error")
	}
}
