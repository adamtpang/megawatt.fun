# Where batteries go

A Texas battery deployment screen at **`/deploy`**, with Franklin as its evidence guide. The existing Kardashev front door stays intact.

**Question:** where should the next 10,000 batteries go, and what is one worth?

**Answer so far:** Dallas leads when energy value matters most; Harris leads when market size matters most. These are county research priorities, not qualified installation sites. The evidence does not yet support allocating 10,000 batteries.

## Try it in five minutes

```sh
python scripts/serve.py
```

Open **http://127.0.0.1:8765/deploy**.

1. Select a county or any of 15 settlement points. Expand the evidence to inspect prices, spike hours and all twelve months. **LZ_WEST** includes four losing months.
2. Change energy weight from **70% to 30%**. Dallas and Harris swap first place. Switch Homes to Businesses to inspect the separate commercial screen.
3. In **Property & grid score**, load the explicitly synthetic example. Set energy weight to 100 and the other three weights to 0: Candidate B overtakes A. Clear inputs to restore missing evidence. Set battery reserve to **100%**: dispatch and energy value become zero.
4. Select **Use energy-only scenario**, expand **Costs & compensation**, then enter an installed cost. Unknown compensation and revenues otherwise remain missing. Try a flat retail tariff: losses can make battery shifting cost money.
5. Ask Franklin to explain the ranking. It works in explicitly labeled guide mode; live AI is optional and disabled by default.

## What was measured

One price-independent rule: charge **01:00–05:00**, discharge **17:00–21:00**, Central time. A **25 kWh / 5 kW** illustrative battery, **88%** round-trip efficiency and **20%** backup reserve. No hindsight optimization. Idle is the $0 baseline.

| Price proxy | Annual energy cashflow | Losing months |
|---|---:|---:|
| Houston | $117.42 | 0 / 12 |
| North | $156.62 | 0 / 12 |
| South | $121.29 | 0 / 12 |
| West load zone | $79.45 | 4 / 12 |

These are simulated settlements on real prices, before wear and other costs—not executed trading profits, Base revenue or customer savings. All months are included. Final excess inventory is zero.

The score combines normalized energy cashflow and county market size. It ranks each customer segment separately. Annual owner value and payback require explicit assumptions; ancillary and capacity/reliability value remain separate.

## Reproduce and inspect

```sh
node --test tests/deployment.test.cjs tests/market-intelligence.test.cjs tests/franklin.test.cjs
python -m unittest discover -s tests -p test_ercot_prices.py
node scripts/replay-deployment.cjs
```

No Node dependencies, credentials or model calls required. [Source + cached data + tests](source.zip) · [Results](results.json) · [All 180 monthly rows](monthly.csv) · [Market diagnostics](market-summary.json) · [Method and AI setup](METHOD.md) · [Operator validation and missing-data contract](VALIDATION.md).

Install ingestion/test dependencies with `python -m pip install -r scripts/requirements-market.txt`. Refresh with `python scripts/ingest-deployment.py --fetch`: this re-downloads listings **and archives**, including ERCOT corrections under unchanged document IDs. Reproduce this snapshot with `python scripts/ingest-deployment.py --as-of 2026-10-19 --offline` when raw archives are already in `.cache/deployment/`. Without raw archives, use `--fetch --as-of 2026-10-19`; corrected upstream files may yield different results. The source archive includes normalized data for the offline Node replay, not the larger upstream workbooks. URLs, timestamps and SHA-256 hashes are recorded in the [manifest](../../data/deployment/manifest.json).

## Sources and limits

- **[ERCOT annual DAM/RTM SPP files](https://www.ercot.com/mktinfo/prices):** October 2025–September 2026, retrieved October 19, 2026. Five hubs, two hub averages, eight load zones; 8,760 matched DAM/RTM hours and 35,040 RT intervals each. Reports 13060/13061, public files without API credentials. RTM averages four 15-minute intervals. DST retained; missing/duplicate hours fail validation, with no imputation. DAM–RT spread is diagnostic, not revenue. “Last twelve months” means the latest twelve **complete Central calendar months**; the partial current month is excluded.
- **[Census](../../data/deployment/sites.json):** 2025 housing totals, 2023 employer establishments, reviewed October 19, 2026. Six manually transcribed figures from official QuickFacts pages; the API required a key. 2024 TIGERweb county boundaries. Counts describe markets, not eligible customers.
- **[EIA Texas](https://www.eia.gov/electricity/state/Texas/):** 2024 fundamentals, context only. State rates are not substituted for customer tariffs.

**Still missing:** qualified addresses/ESIIDs, confirmed zone mapping, feeder capacity, measured customer loads, demand charges, ancillary commitments and Base compensation. County-to-zone mappings are screening proxies. The retail profile is explicitly synthetic. No proprietary systems are accessed.

## Market-intelligence interface and unsourced numbers

`scripts/ercot_prices.py` exposes typed `load_prices(PublicCache(...), as_of)` and validates complete physical-hour coverage. `market-intelligence.js` exposes `loadPrices`, `valueStack` and `scoreCandidates`, with TypeScript declarations and runtime validation. The browser fetch cache coalesces calls; `{refresh:true}` retries the dataset. Call `valueStack(dataset.zones.LZ_WEST, battery)` to obtain spread, RT population standard deviation, spike-hour shares, monthly backtest and separate energy / unknown ancillary / unknown reliability values. No combined value is inferred.

The property score is a weighted sum of within-candidate min–max factors: energy cashflow (higher), installed cost (lower), usable area (higher), and feeder spare capacity (higher). Ties get 0.5. Weights normalize to 100%; every weight is editable. Unknown eligibility, unknown price series or missing active factors withhold the score; excluded candidates cannot rank. Zero-weight factors may remain missing. Feeder capacity and area are prospecting proxies, not modeled interconnection or dispatch constraints. Scores change with the comparison set and are not investment returns.

**Unsourced choices:** 25 kWh, 5 kW, 88% efficiency, 20% reserve, 0 wear cost (excluded), the fixed dispatch hours, $100/MWh spike threshold, top-three-hour concentration, 70/30 county weights and 40/20/20/20 property weights are analyst scenarios. Synthetic properties A/B/C assume respectively $6k/$12k/$9k installed cost, 12/8/10 m² usable area, 100/40/60 kW feeder capacity, and eligibility—all fictional. No dated property evidence supports those values. Operator share, ancillary/reliability revenue, installed costs, operating costs, actual degradation, tariffs, loads, export permissions and Base compensation remain unknown until independently supplied. The requested 10,000-battery scale is not a sourced pipeline. No forecast, availability, outage, financing, tax, market-impact or ancillary co-optimization model is included.

**Franklin:** optional server-side OpenRouter adapter; model output never changes calculations. No paid calls or deployment were made. Before enabling publicly, configure a spending-capped key and shared rate limiting; the current warm-instance limiter is not a production abuse boundary. See [setup and limitations](METHOD.md#franklin-optional-ai-explicit-guide-mode).
