// Package dispatch plans a single daily arbitrage cycle for a home battery
// against known interval prices.
//
// Model, stated plainly: perfect price foresight (a day-ahead plan, not
// real-time operation), one charge window followed by one discharge window
// per day, energy-only arbitrage. Real fleet value stacks more than this
// (ancillary services, retail hedging, resilience). This is a restricted
// scenario, neither a revenue floor nor a valuation.
package dispatch

import (
	"fmt"
	"math"
	"sort"
)

// Battery is one unit's physical envelope. RoundTripEff is applied once, on
// the discharge side: energy bought E can sell at most E * RoundTripEff.
type Battery struct {
	CapacityKWh  float64
	PowerKW      float64
	RoundTripEff float64
}

// PricePoint is one settlement interval.
type PricePoint struct {
	Interval  string // label, e.g. "14:00"
	USDPerMWh float64
}

// Action is what one battery does in one interval.
type Action struct {
	Interval  string
	KWh       float64 // energy moved in this interval (positive)
	USDPerMWh float64
	Kind      string // "charge" or "discharge"
}

// Plan is the day's schedule for one battery.
type Plan struct {
	Actions      []Action
	ChargeKWh    float64
	DischargeKWh float64
	CostUSD      float64 // paid to charge
	RevenueUSD   float64 // earned discharging
}

// ProfitUSD is the battery's net arbitrage value for the day.
func (p Plan) ProfitUSD() float64 { return p.RevenueUSD - p.CostUSD }

func (b Battery) validate() error {
	if !finite(b.CapacityKWh) || !finite(b.PowerKW) || !finite(b.RoundTripEff) {
		return fmt.Errorf("battery values must be finite")
	}
	if b.CapacityKWh <= 0 || b.PowerKW <= 0 {
		return fmt.Errorf("battery capacity and power must be positive, got %.1f kWh / %.1f kW", b.CapacityKWh, b.PowerKW)
	}
	if b.RoundTripEff <= 0 || b.RoundTripEff > 1 {
		return fmt.Errorf("round-trip efficiency must be in (0, 1], got %.2f", b.RoundTripEff)
	}
	return nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// fill greedily allocates `energy` kWh across the given intervals (already
// sorted by attractiveness), at most PowerKW per interval. Returns the
// allocations and the total energy actually placed.
func fill(intervals []PricePoint, energy, powerKW float64, kind string) ([]Action, float64) {
	var actions []Action
	var placed float64
	for _, pt := range intervals {
		if energy <= 1e-9 {
			break
		}
		e := powerKW
		if e > energy {
			e = energy
		}
		actions = append(actions, Action{Interval: pt.Interval, KWh: e, USDPerMWh: pt.USDPerMWh, Kind: kind})
		placed += e
		energy -= e
	}
	return actions, placed
}

func value(actions []Action) float64 {
	var usd float64
	for _, a := range actions {
		usd += a.KWh * a.USDPerMWh / 1000.0
	}
	return usd
}

// PlanDay computes the best closed single-cycle plan on hourly intervals: a boundary t is chosen so
// that all charging happens strictly before t and all discharging at or
// after t; profitable marginal energy pairs are selected in price order. Every
// boundary is tried and the most profitable non-negative plan wins. An
// unprofitable day returns an empty plan, never a forced cycle.
func PlanDay(b Battery, prices []PricePoint) (Plan, error) {
	if err := b.validate(); err != nil {
		return Plan{}, err
	}
	seen := make(map[string]bool)
	for _, p := range prices {
		if p.Interval == "" || seen[p.Interval] || !finite(p.USDPerMWh) {
			return Plan{}, fmt.Errorf("prices require unique nonempty labels and finite values")
		}
		seen[p.Interval] = true
	}
	if len(prices) < 2 {
		return Plan{}, nil
	}

	best := Plan{}
	for t := 1; t < len(prices); t++ {
		before := append([]PricePoint(nil), prices[:t]...)
		after := append([]PricePoint(nil), prices[t:]...)

		sort.SliceStable(before, func(i, j int) bool { return before[i].USDPerMWh < before[j].USDPerMWh })
		sort.SliceStable(after, func(i, j int) bool { return after[i].USDPerMWh > after[j].USDPerMWh })

		// In charge-side kWh, a marginal pair earns eta*sell - buy.
		// Margins decrease monotonically as we consume sorted intervals;
		// stop before an unprofitable pair instead of forcing a full cycle.
		var energy float64
		i, j := 0, 0
		buyLeft, sellLeft := b.PowerKW, b.PowerKW/b.RoundTripEff
		for i < len(before) && j < len(after) && energy < b.CapacityKWh-1e-9 {
			if b.RoundTripEff*after[j].USDPerMWh-before[i].USDPerMWh <= 0 {
				break
			}
			e := math.Min(b.CapacityKWh-energy, math.Min(buyLeft, sellLeft))
			energy += e
			buyLeft -= e
			sellLeft -= e
			if buyLeft < 1e-9 {
				i++
				buyLeft = b.PowerKW
			}
			if sellLeft < 1e-9 {
				j++
				sellLeft = b.PowerKW / b.RoundTripEff
			}
		}
		charges, charged := fill(before, energy, b.PowerKW, "charge")
		if charged <= 1e-9 {
			continue
		}
		discharges, discharged := fill(after, charged*b.RoundTripEff, b.PowerKW, "discharge")
		if discharged <= 1e-9 {
			continue
		}

		// If the discharge side couldn't absorb everything (few intervals
		// after t), don't pay to charge energy that can never be sold.
		if discharged < charged*b.RoundTripEff-1e-9 {
			charges, charged = fill(before, discharged/b.RoundTripEff, b.PowerKW, "charge")
		}

		plan := Plan{
			Actions:      append(charges, discharges...),
			ChargeKWh:    charged,
			DischargeKWh: discharged,
			CostUSD:      value(charges),
			RevenueUSD:   value(discharges),
		}
		if plan.ProfitUSD() > best.ProfitUSD() {
			best = plan
		}
	}

	if best.ProfitUSD() <= 0 {
		return Plan{}, nil
	}
	sortByTime(best.Actions, prices)
	return best, nil
}

func sortByTime(actions []Action, prices []PricePoint) {
	order := make(map[string]int, len(prices))
	for i, p := range prices {
		order[p.Interval] = i
	}
	sort.Slice(actions, func(i, j int) bool { return order[actions[i].Interval] < order[actions[j].Interval] })
}
