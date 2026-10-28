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

## Expansion map

`/notes/expansion-map` ranks states, and utilities with at least 10,000 residential customers, for a home-battery program. The score is a weighted average of percentile ranks. A missing factor is left out of that row's denominator. It is not stored as zero. The map colors those scores as tiers: S is a rounded score of 68 or higher, A is 58–67, B is 48–57, C is 38–47, and Later is under 38. Each state line names its two strongest weighted factors and, when one sits below the midpoint, the factor that constrains it. The bands move with the sliders. They are a reading of the public score.

```sh
python3 -m pip install openpyxl pyshp
python3 analysis/build_expansion.py
```

The script downloads into `analysis/cache/` (gitignored) and writes `data/expansion-map.json`. Sliders in `notes/expansion-map.js` use the same percentile function as `analysis/score.py`. Shared numeric cases live in `tests/fixtures/expansion-score-cases.json`.

Sources and vintages are on the page. In short: Census ACS 2024 5-year table B25032 for owner-occupied one-unit homes; EIA-861 2025 final (released 7 Oct 2026) for SAIDI, SAIFI, retail delivery share, RTO tags, net-metered batteries, demand response, and dynamic pricing; FEMA National Risk Index counties for storm and heat. The Texas section is ERCOT day-ahead node prices minus the settlement load zone (report NP4-190-CD), over the files on the public list at build time.

SolarAPP+ permitting was not scored: the jurisdiction CSV returned HTTP 403, and the HTML table was only an alphabetical fragment. No national home-battery interconnection timeline was retrieved. Price volatility outside ERCOT was not filled in with a zero.

The map marks are public footprint, not score bonuses. Texas is the operating retail market. Illinois is Base Retail's ComEd offer (ARES 26-0121). Georgia is a reported Central Georgia EMC plan for 2027, from a secondary article. Connecticut is a hiring post. This site is not affiliated with Base Power.

## Where batteries earn the most

`/notes/where-batteries-earn-most` ranks ERCOT resource nodes in load zones Houston, North, and South by day-ahead basis: node settlement price minus the load-zone price, same hour. The public nodal list is about a month. This snapshot is delivery dates 2026-09-27 through 2026-10-28, report NP4-190-CD. It is not a year, and it is not interpolated.

```sh
python3 analysis/build_congestion.py
```

Optional: `python3 -m pip install pyshp` if you want the script to be able to draw a Texas outline. The current HIFLD name join matched too few of the top nodes, so the page is a ranked chart and the map is omitted on purpose. The script writes `data/congestion.json` and refreshes the findings in `notes/where-batteries-earn-most.html`. Cached downloads stay in `analysis/cache/`.

LZ_LCRA and LZ_AEN were checked. The Base post and the 11 August 2026 DSWG deck name Houston, North, and South. The settlement-point file tags resource nodes to those three zones plus West. Phase 4, in the 7 October 2026 WMS deck, dispatches nodally and still settles at the load zone. The basis is a proxy for that gap. It is not a 100 MW revenue forecast. The note is independent of Base Power.

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

## Your battery today (`/base`)

A concept member screen: what a Texas home battery did in the last 24 hours, in plain words.
Built after the Base Power x AITX Talent Hackathon (Austin, 25 to 27 September 2026). Not
affiliated with Base Power.

**What it shows**

1. Today in one sentence, generated from the day's data.
2. The day's power price, with the hours the battery charged, powered the home (and sent extra to
   the grid), or held its backup, labeled directly on the chart.
3. Backup right now, in hours at the home's usual use, with a home-size picker.
4. Outage mode: what stays on, for how long, and what to turn off to stretch it.
5. How it works, in three lines.

**Data**

- Real: ERCOT day-ahead settlement point prices for Houston Hub (`HB_HOUSTON`), fetched live through
  `/api/prices` and cached in `data/ercot-dam-houston.json` with its source URL and download time.
- Real: battery size 39.2 kWh (smaller Base Core, pv magazine USA, 2026-08-04); average Texas home
  1,096 kWh a month (EIA 2024, Table 5A).
- Assumed, and labeled on the page: 5 kW charge rate, 88% round trip, half the battery kept as
  backup, the shape of a day's home use, and appliance running power.
- Simulated: what the battery did. Not Base's control logic, fleet behavior, or revenue.

**Failure behavior**

- Live prices missing or older than 2 days: shows the last good cached day and says so.
- Battery report missing: shows "We can't reach your battery right now" and no numbers.
- Try it: `/base?prices=offline`, `/base?battery=offline`.
- Tests: `node --test tests/base.test.cjs` (includes the planner's marginal-matching regression from
  `demo/dispatch-study/AUDIT.md`).

**What I'd build next**

- Read the member's real battery telemetry and meter data instead of a simulated day.
- Real-time (15-minute) prices, and a "what happened while you slept" push notification.
- A monthly view: backup readiness, outages covered, and bill impact, stated only where measured.
- Outage mode driven by live circuit data, so "what to turn off" is specific to the home.
