// dispatch-study is an offline, synthetic stress experiment, not a market backtest.
package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sort"

	"github.com/adamtpang/megawatt.fun/dispatch"
)

// Forecast is specified independently, before realized innovations are drawn.
// Regimes are deliberately equally weighted stress cases, not probabilities.
func scenario(seed int64, day int, errorScale float64) ([]dispatch.PricePoint, []dispatch.PricePoint) {
	rng := rand.New(rand.NewSource(seed + int64(day)*7919))
	forecast, actual := make([]dispatch.PricePoint, 24), make([]dispatch.PricePoint, 24)
	shape := func(h int) float64 {
		p := 45.0
		if h >= 9 && h <= 13 {
			p = 15
		}
		if h >= 18 && h <= 22 {
			p = 100
		}
		switch day % 4 {
		case 1:
			if h == 20 {
				p = 400
			}
		case 2:
			if h >= 10 && h <= 12 {
				p = -30
			}
		case 3:
			p = 40 // flat forecast; missed event can still occur
		}
		return p
	}
	shift := 0
	if errorScale > 0 {
		shift = int(math.Round(errorScale / 30))
	}
	bias := (rng.Float64()*2 - 1) * errorScale
	for h := 0; h < 24; h++ {
		label := fmt.Sprintf("%02d:00", h)
		forecast[h] = dispatch.PricePoint{Interval: label, USDPerMWh: shape(h)}
		p := shape((h-shift+24)%24) + bias + (rng.Float64()*2-1)*errorScale
		if day%4 == 3 && h == 17 {
			p += errorScale * 4
		}
		actual[h] = dispatch.PricePoint{Interval: label, USDPerMWh: p}
	}
	return forecast, actual
}

// Clock baseline commits the same midday/evening windows without price input.
func clockPlan(b dispatch.Battery, reserve float64) (dispatch.Plan, error) {
	prices := make([]dispatch.PricePoint, 24)
	for h := range prices {
		p := 100.0
		if h >= 9 && h <= 13 {
			p = 0
		}
		if h >= 18 && h <= 22 {
			p = 1000
		}
		prices[h] = dispatch.PricePoint{Interval: fmt.Sprintf("%02d:00", h), USDPerMWh: p}
	}
	return dispatch.PlanWithReserve(b, reserve, prices)
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func number(v float64) string { return fmt.Sprintf("%.6f", v) }
func writeCSV(path string, rows [][]string) {
	f, e := os.Create(path)
	must(e)
	w := csv.NewWriter(f)
	must(w.WriteAll(rows))
	must(f.Close())
}

func main() {
	out := flag.String("out", "demo/dispatch-study/results", "output directory")
	days := flag.Int("days", 120, "synthetic days per condition (minimum 20)")
	seed := flag.Int64("seed", 20260908, "deterministic random seed")
	flag.Parse()
	if *days < 20 {
		panic("days must be >=20")
	}
	must(os.MkdirAll(*out, 0755))
	summary := [][]string{{"error_scale_usd_mwh", "round_trip_eff", "reserve_kwh", "strategy", "mean_usd_day", "p05_usd_day", "worst_usd_day", "negative_days", "mean_charge_kwh", "mean_discharge_kwh", "mean_regret_usd_day", "forecast_mae_usd_mwh"}}
	daily := [][]string{{"error_scale", "eff", "reserve", "day", "regime", "strategy", "net_usd", "regret_usd", "min_soc_kwh", "final_soc_kwh"}}
	trace := [][]string{{"day", "regime", "strategy", "hour", "forecast_usd_mwh", "actual_usd_mwh", "charge_kwh", "discharge_kwh", "soc_kwh", "cash_usd"}}
	inputs := [][]string{{"error_scale", "day", "regime", "hour", "forecast_usd_mwh", "actual_usd_mwh"}}
	regimes := []string{"evening_peak", "scarcity_peak", "negative_midday", "flat_missed_event"}
	names := []string{"idle", "clock", "forecast", "hindsight"}
	for _, scale := range []float64{0, 30, 90} {
		for _, eff := range []float64{1, .88} {
			for _, reserve := range []float64{0, 5, 10} {
				b := dispatch.Battery{CapacityKWh: 25, PowerKW: 5, RoundTripEff: eff}
				values := make([][]float64, 4)
				charge := make([]float64, 4)
				discharge := make([]float64, 4)
				regret := make([]float64, 4)
				mae := 0.0
				for day := 0; day < *days; day++ {
					forecast, actual := scenario(*seed, day, scale)
					for h := range actual {
						mae += math.Abs(actual[h].USDPerMWh-forecast[h].USDPerMWh) / float64(24*(*days))
						if eff == 1 && reserve == 0 {
							inputs = append(inputs, []string{number(scale), fmt.Sprint(day), regimes[day%4], actual[h].Interval, number(forecast[h].USDPerMWh), number(actual[h].USDPerMWh)})
						}
					}
					clock, e := clockPlan(b, reserve)
					must(e)
					pred, e := dispatch.PlanWithReserve(b, reserve, forecast)
					must(e)
					oracle, e := dispatch.PlanWithReserve(b, reserve, actual)
					must(e)
					plans := []dispatch.Plan{{}, clock, pred, oracle}
					for k, plan := range plans {
						r, e := dispatch.Replay(b, reserve, actual, plan)
						must(e)
						gap := oracle.ProfitUSD() - r.NetUSD
						if gap < -1e-8 {
							panic("hindsight below feasible baseline")
						}
						values[k] = append(values[k], r.NetUSD)
						charge[k] += r.ChargeKWh
						discharge[k] += r.DischargeKWh
						regret[k] += gap
						daily = append(daily, []string{number(scale), number(eff), number(reserve), fmt.Sprint(day), regimes[day%4], names[k], number(r.NetUSD), number(gap), number(r.MinSOCKWh), number(r.FinalSOCKWh)})
						if scale == 90 && eff == .88 && reserve == 5 && day < 4 {
							for h, s := range r.Samples {
								trace = append(trace, []string{fmt.Sprint(day), regimes[day%4], names[k], s.Interval, number(forecast[h].USDPerMWh), number(s.Price), number(s.ChargeKWh), number(s.DischargeKWh), number(s.SOCKWh), number(s.CashUSD)})
							}
						}
					}
				}
				for k, v := range values {
					sort.Float64s(v)
					sum := 0.0
					negative := 0
					for _, x := range v {
						sum += x
						if x < -1e-9 {
							negative++
						}
					}
					n := float64(*days)
					row := []string{number(scale), number(eff), number(reserve), names[k], number(sum / n), number(v[int(math.Ceil(.05*n))-1]), number(v[0]), fmt.Sprint(negative), number(charge[k] / n), number(discharge[k] / n), number(regret[k] / n), number(mae)}
					summary = append(summary, row)
					if eff == .88 && reserve == 5 {
						fmt.Printf("error=%2.0f %-9s mean=$% .3f p05=$% .3f loss-days=%3d/%d regret=$%.3f\n", scale, names[k], sum/n, v[int(math.Ceil(.05*n))-1], negative, *days, regret[k]/n)
					}
				}
			}
		}
	}
	writeCSV(filepath.Join(*out, "summary.csv"), summary)
	writeCSV(filepath.Join(*out, "daily.csv"), daily)
	writeCSV(filepath.Join(*out, "trace.csv"), trace)
	writeCSV(filepath.Join(*out, "inputs.csv"), inputs)
	manifest := fmt.Sprintf("Synthetic stress experiment v1\nseed=%d\ndays_per_condition=%d\ncapacity_kwh=25\npower_kw=5\ninterval_hours=1\ninitial_soc=terminal_soc=reserve\nerror_scales=0,30,90\nefficiencies=1,0.88\nreserves_kwh=0,5,10\nNo Base data or validated economics.\n", *seed, *days)
	must(os.WriteFile(filepath.Join(*out, "manifest.txt"), []byte(manifest), 0644))
}
