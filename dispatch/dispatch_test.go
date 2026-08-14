package dispatch

import (
	"math"
	"testing"
)

func hours(prices ...float64) []PricePoint {
	pts := make([]PricePoint, len(prices))
	for i, p := range prices {
		pts[i] = PricePoint{Interval: itoa2(i), USDPerMWh: p}
	}
	return pts
}

func itoa2(h int) string {
	return string(rune('0'+h/10)) + string(rune('0'+h%10)) + ":00"
}

func approx(t *testing.T, got, want, tol float64, label string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Fatalf("%s: got %.4f, want %.4f", label, got, want)
	}
}

var unit = Battery{CapacityKWh: 5, PowerKW: 5, RoundTripEff: 1.0}

func TestFlatPricesNoDispatch(t *testing.T) {
	b := Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: 0.88}
	plan, err := PlanDay(b, hours(30, 30, 30, 30, 30, 30))
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Actions) != 0 {
		t.Fatalf("flat prices must produce no cycle, got %d actions", len(plan.Actions))
	}
}

func TestSimpleSpreadCapturesIt(t *testing.T) {
	// Cheap at hour 0 ($10), expensive at hour 1 ($100). 5 kWh at 5 kW, lossless.
	plan, err := PlanDay(unit, hours(10, 100))
	if err != nil {
		t.Fatal(err)
	}
	// Buy 5 kWh at $10/MWh = $0.05; sell 5 kWh at $100/MWh = $0.50.
	approx(t, plan.CostUSD, 0.05, 1e-9, "cost")
	approx(t, plan.RevenueUSD, 0.50, 1e-9, "revenue")
	approx(t, plan.ProfitUSD(), 0.45, 1e-9, "profit")
}

func TestEfficiencyGateBlocksThinSpread(t *testing.T) {
	// $50 -> $55 spread: profitable lossless, a loss at 80% round-trip
	// (sellable energy is only 0.8x what was bought: 0.8*55 < 50).
	lossy := Battery{CapacityKWh: 5, PowerKW: 5, RoundTripEff: 0.80}
	plan, err := PlanDay(lossy, hours(50, 55))
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Actions) != 0 {
		t.Fatalf("spread below efficiency threshold must not dispatch, got %+v", plan.Actions)
	}

	lossless, err := PlanDay(unit, hours(50, 55))
	if err != nil {
		t.Fatal(err)
	}
	if len(lossless.Actions) == 0 {
		t.Fatal("same spread lossless should dispatch")
	}
}

func TestPowerCapSpreadsChargeAcrossHours(t *testing.T) {
	// 10 kWh at 2 kW: needs 5 charge hours. 6 cheap hours then 6 pricey ones.
	b := Battery{CapacityKWh: 10, PowerKW: 2, RoundTripEff: 1.0}
	plan, err := PlanDay(b, hours(10, 10, 10, 10, 10, 10, 100, 100, 100, 100, 100, 100))
	if err != nil {
		t.Fatal(err)
	}
	var chargeHours int
	for _, a := range plan.Actions {
		if a.Kind == "charge" {
			chargeHours++
			approx(t, a.KWh, 2, 1e-9, "per-hour charge at power cap")
		}
	}
	if chargeHours != 5 {
		t.Fatalf("10 kWh at 2 kW needs 5 charge hours, got %d", chargeHours)
	}
	approx(t, plan.DischargeKWh, 10, 1e-9, "full discharge")
}

func TestNoDischargeBeforeCharge(t *testing.T) {
	// Prices strictly falling all day: every expensive hour precedes every
	// cheap one, so no valid charge-then-discharge cycle exists.
	plan, err := PlanDay(unit, hours(100, 80, 60, 40, 20, 10))
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Actions) != 0 {
		t.Fatalf("cannot discharge before charging, got %+v", plan.Actions)
	}
}

func TestFractionalLastHour(t *testing.T) {
	// 3 kWh at 2 kW: charge hours get 2 then 1.
	b := Battery{CapacityKWh: 3, PowerKW: 2, RoundTripEff: 1.0}
	plan, err := PlanDay(b, hours(10, 12, 100, 100))
	if err != nil {
		t.Fatal(err)
	}
	var charges []float64
	for _, a := range plan.Actions {
		if a.Kind == "charge" {
			charges = append(charges, a.KWh)
		}
	}
	if len(charges) != 2 {
		t.Fatalf("expected 2 charge hours, got %d", len(charges))
	}
	approx(t, charges[0]+charges[1], 3, 1e-9, "total charged")
}

func TestLossyDischargeSellsLessThanCharged(t *testing.T) {
	b := Battery{CapacityKWh: 10, PowerKW: 10, RoundTripEff: 0.88}
	plan, err := PlanDay(b, hours(10, 200))
	if err != nil {
		t.Fatal(err)
	}
	approx(t, plan.ChargeKWh, 10, 1e-9, "charged")
	approx(t, plan.DischargeKWh, 8.8, 1e-9, "discharged after losses")
}

func TestInvalidBattery(t *testing.T) {
	if _, err := PlanDay(Battery{CapacityKWh: 0, PowerKW: 5, RoundTripEff: 0.9}, hours(1, 2)); err == nil {
		t.Fatal("zero capacity must error")
	}
	if _, err := PlanDay(Battery{CapacityKWh: 5, PowerKW: 5, RoundTripEff: 1.3}, hours(1, 2)); err == nil {
		t.Fatal("efficiency above 1 must error")
	}
}
