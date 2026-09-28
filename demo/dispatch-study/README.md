# Can a forecast dispatch schedule justify cycling?

A small extension to Megawatt's existing Go planner. **Synthetic stress experiment; no Base systems, customer data, or validated economics.**

## Five-minute review

1. Run `go test ./...` from the repository root.
2. Run `go run ./cmd/dispatch-study` (Go 1.22+, standard library, offline).
3. Read the table below, then inspect [hourly traces](results/trace.csv): day 1 is a delayed scarcity peak, day 3 is an event absent from the forecast. Filter to `forecast` and compare forecast versus actual prices and settled cash.
4. Read `dispatch/replay.go` for accounting and `dispatch/replay_test.go` for the partial-cycle regression and independent exhaustive oracle.
5. Read the limitations before interpreting a dollar value.

The decision this supports: **does a forecast-committed schedule improve on a simple clock schedule, and how much downside does it retain when reserve and losses are enforced?** This could be a small evaluation fixture for Base's Markets/Algorithms team, with market infrastructure engineering as an adjacent audience. It is not a recommendation for live dispatch.

## Reproducible result

Default seed 20260908, 120 synthetic days per condition; 25 kWh capacity, 5 kW AC power, 88% round-trip efficiency, 5 kWh stored reserve. Each error condition uses the same 120 underlying day/seed combinations. Dollars are net grid energy settlement per battery-day before all other costs.

| Error scale ($/MWh) | Strategy | Mean $/day | 5th percentile $/day | Negative days /120 |
|---:|---|---:|---:|---:|
| 0 | Clock | 1.615 | -0.096 | 30 |
| 0 | Forecast | 1.639 | 0.000 | 0 |
| 30 | Clock | 1.054 | -0.386 | 21 |
| 30 | Forecast | 1.086 | 0.000 | 0 |
| 90 | Idle | 0.000 | 0.000 | 0 |
| 90 | Clock | 0.097 | -1.329 | 56 |
| 90 | Forecast | 0.145 | -0.997 | 38 |
| 90 | Hindsight | 3.380 | 2.212 | 0 |

In the strongest stress case, forecast scheduling improves mean settlement by only $0.048/day over the clock baseline and still loses on 38 days. Its mean gap to the restricted hindsight optimum is $3.235/day. This gap is partly selection of artificial volatility with future knowledge, **not money that a better forecast is guaranteed to recover**. At the same stress level and efficiency, increasing reserve from 0 to 5 to 10 kWh changes forecast mean from $0.509 to $0.145 to -$0.018/day. These are scenario-specific sensitivities, not a general monotonic relationship or a recommended reserve.

## What runs

- **Idle:** no trades, zero incremental settlement, reserve remains available.
- **Clock:** charge at hours 09–13 and discharge at 18–22, earliest slots first, constrained by capacity/reserve and power. Implemented by passing a fixed artificial price ordering to the same planner; no realized or forecast market prices enter this baseline.
- **Forecast:** one schedule committed before the day using a predeclared price shape. Actual prices can make it lose money; there is no retrospective cancellation or reoptimization.
- **Hindsight:** same closed-cycle constraints, but planned on actual prices. A reference upper bound within this restricted policy class, never deployable as shown.

The generator defines four equally weighted regimes: evening peak, scarcity peak, negative midday prices, and flat forecast with a missed event. Forecasts exist independently of realized innovations. Error scales 0/30/90 add day-level bias, hourly uniform noise, a 0/1/3-hour peak delay, and a missed event on flat days. Scale is a stress parameter, not forecast MAE or a calibrated standard deviation; actual MAE is exported. There is no fitting or parameter tuning. These regimes and their equal weights are not estimates of ERCOT frequencies.

The experiment sweeps efficiencies 1/0.88 and stored reserves 0/5/10 kWh: 18 conditions, four strategies, 8,640 battery-days evaluated. Each day starts and ends at reserve, with no free reset energy. This is repeated daily evaluation, **not a continuous multi-day optimizer**. End-of-day inventory is constrained to avoid accounting gifts, at the cost of excluding overnight opportunities.

Physical convention: one hour per step; `SOC_next = SOC + charge - discharge/eff`; `cash = (discharge-charge)*actual_price/1000`. Charge/discharge are AC kWh. Charging is idealized; all losses occur on discharge. Capacity and reserve use internal charge-side kWh. A 5 kWh reserve at 88% can deliver 4.4 kWh in this simplified model; it does not establish hours of household backup. There is no simulated outage or household load. The reserve is held for a household, not consumed during this experiment.

## Evidence and files

- [summary.csv](results/summary.csv): mean, nearest-rank p05, worst day, losing-day count, throughput, hindsight gap, forecast MAE.
- [daily.csv](results/daily.csv): every condition/day/strategy outcome and SOC endpoints.
- [inputs.csv](results/inputs.csv): every synthetic forecast and realization, shared across physical assumptions.
- [trace.csv](results/trace.csv): four complete example days, all four strategies, scale 90/eff .88/reserve 5.
- [manifest.txt](results/manifest.txt): seed and physical settings.

Regenerate into a second directory with `go run ./cmd/dispatch-study -out demo/dispatch-study/reproduced`; the same arguments produce byte-identical CSVs. Use `-seed 7 -out demo/dispatch-study/alternate` to inspect a different innovation draw. The command fails if any replay violates capacity, reserve, power, or terminal SOC, or if hindsight underperforms a feasible baseline.

Tests cover realized-price settlement (including a losing trade), power/reserve/terminal constraints, duplicate and unknown action labels, nonfinite values, deterministic forecasts independent of realized random seeds, zero error, full reserve, 200 randomized conservation cases, and 100 independently enumerated lossless closed-cycle optima. The exhaustive oracle is deliberately independent of the sorting algorithm; it does not prove lossy optimality over all real-valued inputs.

## Limits and next validation gate

Hourly single closed cycles exclude receding-horizon decisions, cross-day inventory, 5/15-minute controls, household consumption/solar, outage prediction, variable efficiency, degradation, fees, bid/offer spreads, ancillary services, retail hedges, network limits, telemetry failures and market impact. A common wholesale buy/sell price is assumed. Idle measures incremental battery settlement, not a household bill. No annualization or fleet-profit inference is justified. Quantiles describe these synthetic samples and are not calibrated risk estimates.

Before real use: replay a timestamped, held-out public price history against forecasts genuinely available before each decision, preserve load/price dependence, validate an AC/DC battery envelope, and compare a reserve-aware rolling controller with identical terminal assumptions. The present credible contribution is the small auditable evaluator and correction of overclaims, not a profitable strategy.

See the [audit](AUDIT.md). Base's products combine backup and grid support; the relevance is an inference from its public material, not a claim that Base needs or uses this design.
