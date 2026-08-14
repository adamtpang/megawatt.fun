package dispatch

import (
	"math"
	"testing"
)

func TestAmortizedUSDPerCycle(t *testing.T) {
	c := CapexModel{USDPerKWh: 100, LifeYears: 10, CyclesPerYear: 365}
	b := Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: 0.88}
	// $2,500 capex / 3,650 cycles = $0.6849.../cycle
	approx(t, c.AmortizedUSDPerCycle(b), 2500.0/3650.0, 1e-9, "amortized $/cycle")
}

func TestAmortizedUSDPerCycleZeroLifeIsInfinite(t *testing.T) {
	c := CapexModel{USDPerKWh: 100, LifeYears: 0, CyclesPerYear: 365}
	b := Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: 0.88}
	got := c.AmortizedUSDPerCycle(b)
	if !math.IsInf(got, 1) {
		t.Fatalf("zero-life capex must amortize to +Inf, got %v", got)
	}
}

func TestEvaluateClearsWhenProfitBeatsAmortized(t *testing.T) {
	c := CapexModel{USDPerKWh: 1, LifeYears: 1, CyclesPerYear: 365} // trivially cheap
	b := Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: 0.88}
	plan, err := PlanDay(b, hours(10, 100))
	if err != nil {
		t.Fatal(err)
	}
	got := c.Evaluate(b, plan)
	if !got.Clears {
		t.Fatalf("cheap capex against a profitable cycle should clear, got %+v", got)
	}
	approx(t, got.NetUSD, got.ProfitUSD-got.AmortizedUSD, 1e-9, "net")
}

func TestEvaluateDoesNotClearExpensiveCapex(t *testing.T) {
	c := CapexRetailInstalled
	b := Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: 0.88}
	plan, err := PlanDay(b, hours(10, 100)) // a generous $90 spread, still a tiny absolute profit
	if err != nil {
		t.Fatal(err)
	}
	got := c.Evaluate(b, plan)
	if got.Clears {
		t.Fatalf("retail-installed capex against one cycle's cents of profit should not clear, got %+v", got)
	}
}
