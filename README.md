# Megawatt

A working plan for humanity to climb the Kardashev scale: measured energy, physical milestones, infrastructure workstreams, and concrete contributions. The homepage is the roadmap; battery dispatch is one supporting experiment.

## Run the website locally

```sh
python scripts/serve.py
```

Open http://127.0.0.1:8765. Plain HTML, CSS and JavaScript; no build step or dependencies. `index.html`, `climb.css` and `climb.js` implement the roadmap. `tools.html` preserves the energy tools; `kardashev.html` preserves the earlier analysis with a supersession notice. The local server supports clean HTML routes but does not emulate the live-prices serverless API.

Run `node --test tests/climb.test.cjs` for milestone arithmetic and baseline consistency. The source snapshot is `data/kardashev-baseline.json`; changing the baseline requires updating both static copy and calculator constants. The baseline is primary energy, not an interchangeable measure of useful electricity.

## Maintain the progress scorecard

`data/progress-scorecard.json` is the reviewed source of truth for six indicators. Every entry records geography, observation period, definition, comparison type, source evidence and limitations. Update the snapshot only after reviewing the cited release; do not subtract values across revised report editions without a consistent comparison. The review deadline is a maintenance target, not an automation.

```sh
python scripts/render-scorecard.py
python scripts/render-scorecard.py --check
python -m unittest discover -s tests -p "test_*.py"
```

The renderer updates static HTML in `index.html` and the public CSV so all indicators remain readable without JavaScript. `climb.js` adds geography filters. There are no live metric API calls. US examples are explicitly regional; price is a cost proxy, not household affordability.

For deployment, run `python scripts/package-site.py` and deploy only the printed staging directory. Its allowlist excludes private drafts and session history.

## Supporting dispatch work

An independent Go demonstration, not affiliated with Base Power and using no proprietary Base data.

**Start here: [five-minute dispatch study](demo/dispatch-study/README.md).** It improves the existing planner and compares idle, fixed-clock, forecast-committed, and hindsight schedules under synthetic price error, battery losses, and a backup reserve.

```sh
go test ./...
go run ./cmd/dispatch-study
```

Go 1.22+; standard library only, no network needed. Results are written to `demo/dispatch-study/results/`. These are stress scenarios, not a historical backtest or validated customer economics.

## Existing day planner

```sh
go run .
go run . -csv data/ercot-dam-hubavg-2026-08-13.csv -kwh 25 -kw 5 -eff .88
go run . -live
```

`dispatch.PlanDay` finds the best closed, single charge-then-discharge cycle on the supplied hourly price vector. All charging precedes all discharging; profitable marginal energy is selected, including partial cycles. Prices must have unique nonempty interval labels in chronological order. The API assumes one hour per row; it does not infer duration from labels. The legacy CLI has no backup reserve; the study adds one.

Loss convention: grid energy enters storage without loss; discharge delivers stored energy times round-trip efficiency. Capacity uses this simplified charge-side storage convention. This is not a calibrated physical battery model.

The vendored CSV is labeled by prior repository work as an ERCOT day-ahead hub-average capture from 2026-08-13; a trimmed three-row parser fixture includes a claimed capture timestamp, but no complete raw response was found, so the full CSV provenance was not independently revalidated in this audit. The experiment uses separately generated, clearly synthetic data. `ercot.FetchDayAhead` reads the public dashboard feed; network access may be blocked.

## Corrections to the earlier framing

The original README and page called energy-only arbitrage a "floor." That was unsupported: perfect realized-price knowledge can overstate achievable dispatch proceeds, while excluding other services can understate total value. Neither direction dominates in general. Known day-ahead prices are not inherently a look-ahead error if they are genuinely executable before delivery; the old model did not establish that trading/settlement path and cannot represent real-time profitability.

One favorable day does not establish annual revenue, fleet profitability, or the share of value from ancillary services, retail hedging, or resilience. Annualized CLI output has been removed. Identical-battery scaling is arithmetic only and ignores market impact and fleet heterogeneity.

The old planner also forced excessive energy through each candidate boundary. A regression with prices `[0,50,0,50,0,50]`, capacity 3 kWh, power 1 kW and efficiency 1 returned $0.05; selecting two profitable kWh returns $0.10. The implementation now matches marginal buy/sell quantities, with independent exhaustive-oracle and physical-accounting tests.

`dispatch/capex.go` remains illustrative amortization arithmetic with assumed presets, not verified Base costs. Neither a single day's proceeds nor these presets establish investment viability. See the [audit](demo/dispatch-study/AUDIT.md).

Other static energy-history pages remain in the repository.
