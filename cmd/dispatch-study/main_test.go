package main

import (
	"github.com/adamtpang/megawatt.fun/dispatch"
	"reflect"
	"testing"
)

func TestForecastHasNoRealizedInnovations(t *testing.T) {
	f1, a1 := scenario(1, 0, 90)
	f2, a2 := scenario(2, 0, 90)
	if !reflect.DeepEqual(f1, f2) {
		t.Fatal("forecast depends on realized random seed")
	}
	if reflect.DeepEqual(a1, a2) {
		t.Fatal("missing innovations")
	}
	_, again := scenario(1, 0, 90)
	if !reflect.DeepEqual(a1, again) {
		t.Fatal("not reproducible")
	}
}

func TestZeroErrorAndFullReserve(t *testing.T) {
	for day := 0; day < 4; day++ {
		f, a := scenario(1, day, 0)
		if !reflect.DeepEqual(f, a) {
			t.Fatal("zero error differs")
		}
		p, e := dispatch.PlanWithReserve(dispatch.Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: .88}, 25, f)
		if e != nil || len(p.Actions) != 0 {
			t.Fatal("full reserve must idle")
		}
	}
}
