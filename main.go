// megawatt.fun fleet dispatch: plan one day of energy arbitrage for a fleet of
// home batteries against real ERCOT settlement point prices.
//
//	go run . -csv data/ercot-spp.csv -batteries 1000 -kwh 25 -kw 5 -eff 0.88
//
// Prices come in as a two-column CSV (interval label, $/MWh). The planner is
// deliberately a floor model: one daily cycle, energy-only, perfect
// foresight. See README for what that leaves out and why.
package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"os"
	"strconv"

	"github.com/adamtpang/megawatt.fun/dispatch"
	"github.com/adamtpang/megawatt.fun/ercot"
)

func loadCSV(path string) ([]dispatch.PricePoint, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, err
	}
	var pts []dispatch.PricePoint
	for i, row := range rows {
		if len(row) < 2 {
			continue
		}
		price, err := strconv.ParseFloat(row[1], 64)
		if err != nil {
			if i == 0 {
				continue // header row
			}
			return nil, fmt.Errorf("row %d: bad price %q", i+1, row[1])
		}
		pts = append(pts, dispatch.PricePoint{Interval: row[0], USDPerMWh: price})
	}
	if len(pts) == 0 {
		return nil, fmt.Errorf("no price rows in %s", path)
	}
	return pts, nil
}

func main() {
	csvPath := flag.String("csv", "data/ercot-dam-hubavg-2026-08-13.csv", "CSV of interval,USD-per-MWh prices")
	live := flag.Bool("live", false, "fetch today's real day-ahead prices from ERCOT (US IPs only; geo-blocked elsewhere)")
	batteries := flag.Int("batteries", 1000, "fleet size")
	kwh := flag.Float64("kwh", 25, "battery capacity, kWh (assumption, not a Base spec)")
	kw := flag.Float64("kw", 5, "battery power, kW (assumption, not a Base spec)")
	eff := flag.Float64("eff", 0.88, "round-trip efficiency")
	capexPerKWh := flag.Float64("capex-per-kwh", dispatch.CapexManufacturerLow.USDPerKWh, "battery hardware cost, $/kWh, for the capex breakeven line")
	capexLifeYears := flag.Float64("capex-life-years", dispatch.CapexManufacturerLow.LifeYears, "calendar life used to amortize capex (LFP cycle life outlasts 1 cycle/day at any realistic install lifetime, so years is the binding constraint, not cycles)")
	flag.Parse()

	var prices []dispatch.PricePoint
	var err error
	if *live {
		var updated string
		prices, updated, err = ercot.FetchDayAhead()
		if err == nil {
			fmt.Printf("Live ERCOT day-ahead hub-average prices, last updated %s\n\n", updated)
		}
	} else {
		prices, err = loadCSV(*csvPath)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "load prices:", err)
		os.Exit(1)
	}

	b := dispatch.Battery{CapacityKWh: *kwh, PowerKW: *kw, RoundTripEff: *eff}
	plan, err := dispatch.PlanDay(b, prices)
	if err != nil {
		fmt.Fprintln(os.Stderr, "plan:", err)
		os.Exit(1)
	}

	if len(plan.Actions) == 0 {
		fmt.Println("No profitable cycle in this price day (after round-trip losses). The honest answer is sometimes: do not cycle.")
		return
	}

	fmt.Printf("Day plan, one battery (%.0f kWh / %.0f kW / %.0f%% round-trip):\n\n", *kwh, *kw, *eff*100)
	fmt.Printf("  %-8s %-10s %8s %12s\n", "interval", "action", "kWh", "$/MWh")
	for _, a := range plan.Actions {
		fmt.Printf("  %-8s %-10s %8.1f %12.2f\n", a.Interval, a.Kind, a.KWh, a.USDPerMWh)
	}

	profit := plan.ProfitUSD()
	fmt.Printf("\n  charged %.1f kWh for $%.2f, discharged %.1f kWh for $%.2f\n",
		plan.ChargeKWh, plan.CostUSD, plan.DischargeKWh, plan.RevenueUSD)
	fmt.Printf("  net per battery: $%.2f/day\n", profit)
	fmt.Printf("  fleet of %d: $%.2f/day, ~$%.0f/year at this day's spread\n",
		*batteries, profit*float64(*batteries), profit*float64(*batteries)*365)

	capex := dispatch.CapexModel{USDPerKWh: *capexPerKWh, LifeYears: *capexLifeYears, CyclesPerYear: 365}
	be := capex.Evaluate(b, plan)
	fmt.Printf("\n  capex breakeven: $%.0f/kWh over %.0f years -> $%.2f amortized per cycle-day\n",
		*capexPerKWh, *capexLifeYears, be.AmortizedUSD)
	if be.Clears {
		fmt.Printf("  this cycle clears its own hardware cost by $%.2f/day\n", be.NetUSD)
	} else {
		fmt.Printf("  this cycle does NOT clear its own hardware cost: $%.2f short/day\n", -be.NetUSD)
		fmt.Println("  energy-only arbitrage is not the investment thesis here; see below")
	}

	fmt.Println("\n  Floor model only: one cycle, energy-only, perfect foresight.")
	fmt.Println("  Real fleet value adds ancillary services, retail hedge, resilience.")
}
