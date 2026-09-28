package dispatch

import "fmt"

// Sample records one hourly AC grid exchange. SOC uses the legacy convention:
// ideal charging; all round-trip losses applied on discharge. Not a cell model.
type Sample struct {
	Interval                                        string
	Price, ChargeKWh, DischargeKWh, SOCKWh, CashUSD float64
}

type ReplayResult struct {
	Samples                                                 []Sample
	NetUSD, ChargeKWh, DischargeKWh, MinSOCKWh, FinalSOCKWh float64
}

// Replay settles a committed schedule at realized prices. It never replans or
// clips invalid actions silently. Initial and terminal SOC must equal reserve,
// so no strategy gets free initial energy or unpriced terminal inventory.
func Replay(b Battery, reserve float64, actual []PricePoint, plan Plan) (ReplayResult, error) {
	if err := b.validate(); err != nil {
		return ReplayResult{}, err
	}
	if !finite(reserve) || reserve < 0 || reserve > b.CapacityKWh {
		return ReplayResult{}, fmt.Errorf("invalid reserve")
	}
	known := map[string]bool{}
	for _, p := range actual {
		if p.Interval == "" || known[p.Interval] || !finite(p.USDPerMWh) {
			return ReplayResult{}, fmt.Errorf("invalid realized prices")
		}
		known[p.Interval] = true
	}
	actions := map[string]Action{}
	for _, a := range plan.Actions {
		if _, duplicate := actions[a.Interval]; duplicate || !known[a.Interval] || !finite(a.KWh) || a.KWh < 0 || a.KWh > b.PowerKW+1e-8 || (a.Kind != "charge" && a.Kind != "discharge") {
			return ReplayResult{}, fmt.Errorf("invalid action: %+v", a)
		}
		actions[a.Interval] = a
	}
	r := ReplayResult{MinSOCKWh: reserve}
	soc := reserve
	for _, p := range actual {
		s := Sample{Interval: p.Interval, Price: p.USDPerMWh}
		a := actions[p.Interval]
		if a.Kind == "charge" {
			s.ChargeKWh = a.KWh
			soc += a.KWh
		}
		if a.Kind == "discharge" {
			s.DischargeKWh = a.KWh
			soc -= a.KWh / b.RoundTripEff
		}
		if soc < reserve-1e-8 || soc > b.CapacityKWh+1e-8 {
			return ReplayResult{}, fmt.Errorf("SOC constraint at %s: %g", p.Interval, soc)
		}
		if soc < r.MinSOCKWh {
			r.MinSOCKWh = soc
		}
		s.SOCKWh = soc
		s.CashUSD = (s.DischargeKWh - s.ChargeKWh) * p.USDPerMWh / 1000
		r.NetUSD += s.CashUSD
		r.ChargeKWh += s.ChargeKWh
		r.DischargeKWh += s.DischargeKWh
		r.Samples = append(r.Samples, s)
	}
	r.FinalSOCKWh = soc
	if soc < reserve-1e-8 || soc > reserve+1e-8 {
		return ReplayResult{}, fmt.Errorf("terminal SOC differs from initial reserve: %g", soc)
	}
	return r, nil
}

// PlanWithReserve preserves a fixed quantity of stored energy for backup.
func PlanWithReserve(b Battery, reserve float64, forecast []PricePoint) (Plan, error) {
	if err := b.validate(); err != nil {
		return Plan{}, err
	}
	if !finite(reserve) || reserve < 0 || reserve > b.CapacityKWh {
		return Plan{}, fmt.Errorf("invalid reserve")
	}
	if reserve == b.CapacityKWh {
		return Plan{}, nil
	}
	b.CapacityKWh -= reserve
	return PlanDay(b, forecast)
}
