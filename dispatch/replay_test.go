package dispatch

import (
	"math"
	"math/rand"
	"testing"
)

func TestPartialCycleRegression(t *testing.T) {
	// Old full-fill heuristic earned $0.05; two profitable kWh earn $0.10.
	p, e := PlanDay(Battery{3, 1, 1}, hours(0, 50, 0, 50, 0, 50))
	if e != nil {
		t.Fatal(e)
	}
	approx(t, p.ProfitUSD(), .10, 1e-9, "partial cycle")
	approx(t, p.ChargeKWh, 2, 1e-9, "only profitable marginal energy")
}

func TestReplayLossReserveAndSettlement(t *testing.T) {
	b := Battery{10, 5, .8}
	p, e := PlanWithReserve(b, 5, hours(10, 200))
	if e != nil {
		t.Fatal(e)
	}
	r, e := Replay(b, 5, hours(100, 20), p)
	if e != nil {
		t.Fatal(e)
	}
	approx(t, r.NetUSD, -.42, 1e-9, "settle actual, not forecast")
	approx(t, r.FinalSOCKWh, 5, 1e-9, "terminal inventory")
	approx(t, r.ChargeKWh-r.DischargeKWh, 1, 1e-9, "energy lost")
	approx(t, r.Samples[0].SOCKWh, 10, 1e-9, "capacity")
}

func TestReplayRejectsInfeasibleSchedules(t *testing.T) {
	for _, p := range []Plan{
		{Actions: []Action{{Interval: "00:00", Kind: "discharge", KWh: 1}}},
		{Actions: []Action{{Interval: "00:00", Kind: "charge", KWh: 6}}},
		{Actions: []Action{{Interval: "00:00", Kind: "charge", KWh: 1}}}, // terminal energy
		{Actions: []Action{{Interval: "unknown", Kind: "charge", KWh: 1}}},
		{Actions: []Action{{Interval: "00:00", Kind: "charge", KWh: 1}, {Interval: "00:00", Kind: "discharge", KWh: 1}}},
	} {
		if _, e := Replay(Battery{10, 5, .8}, 5, hours(10, 100), p); e == nil {
			t.Fatalf("accepted %+v", p)
		}
	}
}

func TestInvalidFiniteAndLabels(t *testing.T) {
	if _, e := PlanDay(Battery{math.NaN(), 1, 1}, hours(10, 100)); e == nil {
		t.Fatal("NaN")
	}
	if _, e := PlanDay(unit, hours(10, math.Inf(1))); e == nil {
		t.Fatal("infinite price")
	}
	if _, e := PlanDay(unit, []PricePoint{{"x", 10}, {"x", 20}}); e == nil {
		t.Fatal("duplicate")
	}
	if _, e := PlanWithReserve(unit, 6, hours(10, 20)); e == nil {
		t.Fatal("reserve exceeds capacity")
	}
}

// Independent exhaustive discrete closed-cycle oracle, lossless integer kWh.
// It enumerates hourly actions instead of sorting marginal pairs.
func TestPlanAgainstExhaustiveOracle(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for trial := 0; trial < 100; trial++ {
		pts := hours(0, 0, 0, 0, 0)
		for i := range pts {
			pts[i].USDPerMWh = float64(rng.Intn(9)-3) * 10
		}
		best := 0.0
		var walk func(int, int, bool, float64)
		walk = func(h, soc int, selling bool, cash float64) {
			if h == len(pts) {
				if soc == 0 && cash > best {
					best = cash
				}
				return
			}
			walk(h+1, soc, selling, cash)
			if !selling && soc < 2 {
				walk(h+1, soc+1, false, cash-pts[h].USDPerMWh/1000)
			}
			if soc > 0 {
				walk(h+1, soc-1, true, cash+pts[h].USDPerMWh/1000)
			}
		}
		walk(0, 0, false, 0)
		p, e := PlanDay(Battery{2, 1, 1}, pts)
		if e != nil {
			t.Fatal(e)
		}
		approx(t, p.ProfitUSD(), best, 1e-9, "exhaustive optimum")
	}
}

func TestRandomSchedulesConserveEnergy(t *testing.T) {
	rng := rand.New(rand.NewSource(17))
	for i := 0; i < 200; i++ {
		pts := hours(0, 0, 0, 0, 0, 0)
		for h := range pts {
			pts[h].USDPerMWh = rng.Float64()*300 - 100
		}
		b := Battery{10, 3, .7 + rng.Float64()*.3}
		p, e := PlanWithReserve(b, 2, pts)
		if e != nil {
			t.Fatal(e)
		}
		r, e := Replay(b, 2, pts, p)
		if e != nil {
			t.Fatal(e)
		}
		approx(t, r.NetUSD, p.ProfitUSD(), 1e-9, "accounting")
		approx(t, r.DischargeKWh, r.ChargeKWh*b.RoundTripEff, 1e-9, "closed-cycle energy")
	}
}
