package dispatch

import "math"

// CapexModel amortizes a battery's hardware cost against the cycles it
// actually runs, not its physical cycle-life ceiling. At PlanDay's one
// cycle/day, calendar life is the real constraint: LFP cycle life
// (6,000-10,000+ cycles) outlasts any realistic install lifetime at that
// cadence, so years, not cycles, sets the denominator.
type CapexModel struct {
	USDPerKWh     float64 // hardware cost, $ per kWh of capacity
	LifeYears     float64 // calendar life of the install
	CyclesPerYear float64 // cycles actually run per year at this duty cycle
}

// Capex presets, $/kWh, all assuming a 15-year calendar life and one
// cycle/day (365 cycles/year), matching PlanDay's single-cycle model. See
// README for sourcing.
//
//   - CapexManufacturerLow / High: a vertically-integrated hardware-cost
//     range. LFP cells run $60-80/kWh; roughly 2-3x that for pack, power
//     electronics, and install at OEM scale.
//   - CapexRetailInstalled: the third-party solar-installer benchmark,
//     $800-950/kWh fully installed, the channel a vertically-integrated
//     fleet operator is built to avoid.
var (
	CapexManufacturerLow  = CapexModel{USDPerKWh: 150, LifeYears: 15, CyclesPerYear: 365}
	CapexManufacturerHigh = CapexModel{USDPerKWh: 300, LifeYears: 15, CyclesPerYear: 365}
	CapexRetailInstalled  = CapexModel{USDPerKWh: 875, LifeYears: 15, CyclesPerYear: 365}
)

// AmortizedUSDPerCycle is this battery's hardware cost charged against one
// cycle: total capex divided by total cycles run over the calendar life.
func (c CapexModel) AmortizedUSDPerCycle(b Battery) float64 {
	totalCycles := c.CyclesPerYear * c.LifeYears
	if totalCycles <= 0 {
		return math.Inf(1)
	}
	return c.USDPerKWh * b.CapacityKWh / totalCycles
}

// Breakeven compares one day's arbitrage plan to the capex it has to carry.
type Breakeven struct {
	ProfitUSD    float64 // the day's energy-arbitrage profit
	AmortizedUSD float64 // capex charged against this one cycle
	NetUSD       float64 // ProfitUSD - AmortizedUSD
	Clears       bool    // true if the cycle covers its own amortized hardware cost
}

// Evaluate reports whether p's profit clears c's amortized cost for one
// cycle of b. A false Clears is not a bug in the plan: it means energy-only
// arbitrage, alone, does not carry this battery's hardware cost at this
// duty cycle, whatever else is true about the fleet's other revenue
// (ancillary services, retail hedge, resilience).
func (c CapexModel) Evaluate(b Battery, p Plan) Breakeven {
	amortized := c.AmortizedUSDPerCycle(b)
	profit := p.ProfitUSD()
	return Breakeven{
		ProfitUSD:    profit,
		AmortizedUSD: amortized,
		NetUSD:       profit - amortized,
		Clears:       profit > amortized,
	}
}
