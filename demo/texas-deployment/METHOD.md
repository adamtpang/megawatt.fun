# Texas deployment study: method and implementation

**Question:** where should the next 10,000 Texas batteries go, and what is one worth?

**Current answer:** this tool supports a county-level research shortlist, not an installation allocation. Three ERCOT price zones have a complete annual backtest. The address, meter, tariff and interconnection evidence needed to qualify 10,000 installations is missing. This is independent work, not Base software or validated customer economics.

## Five-minute demo

1. Run `python scripts/serve.py` and open **http://127.0.0.1:8765/deploy**. The existing Kardashev homepage is unchanged.
2. Select Harris, Dallas or Hidalgo on the map. Read energy cashflow, then expand **Inspect prices, spike hours & every month**. The CSV contains the exact hourly inputs.
3. Move the energy weighting from **70% to 30%**. Dallas and Harris swap first place. Change Homes to Businesses to inspect a separate prospecting pool.
4. Raise reserve or reduce efficiency. The physical dispatch, cashflows and rankings recalculate together. Set reserve to 100% to see zero dispatch.
5. Open the economics inputs. Missing values remain missing. **Use energy-only scenario** explicitly sets unknown add-ons, compensation and annual costs to zero; supply a cost to calculate simple payback. This is a scenario, not Base's contract.
6. Open **Franklin**. The built-in guide explains the current evidence without a model. Free text is enabled only when the optional server AI connection is configured.

## Reproduce

No Node dependencies or credentials are needed to reproduce the checked-in results:

```sh
node --test tests/deployment.test.cjs tests/franklin.test.cjs
node scripts/replay-deployment.cjs
python scripts/serve.py
```

Outputs: [results.json](results.json), [monthly.csv](monthly.csv). The Node and browser calculations use the same `deployment-core.js`. Tests cover hand-calculated cashflows, losses and conservation, reserve/power limits, negative profits, no hindsight-dependent commands, DST, missing prices, ranking sensitivity, unknown compensation, retail self-consumption and mocked AI requests. No paid model calls are made by tests.

To reconstruct the source data, install `requests` and `openpyxl` in your own Python environment, then run:

```sh
python scripts/ingest-deployment.py --fetch
node scripts/replay-deployment.cjs
```

The importer uses official public annual ZIP/XLSX files, not the credentialed ERCOT API. It caches responses with URL, retrieval time and SHA-256 under `.cache/deployment/`, excluded from publication. A subsequent run uses the cache; `--fetch` refreshes archive listings and downloads newly identified archives. It rejects duplicate/missing intervals and non-finite prices. Successful normalized outputs are under `data/deployment/`. The fixed research window is **2025-10-01 through 2026-09-30**, the latest twelve complete months as of **2026-10-19**. Change and revalidate the period before describing a later run as current.

## Method and result

Dispatch is selected **before examining prices**: charge 01:00–05:00 and discharge 17:00–21:00 Central time, subject to power, energy and reserve limits. Each hour uses a constant AC power chosen from the state of charge at its start; it is not intrahour optimization. Charge/discharge efficiencies each equal √0.88. The 20% reserve remains unavailable for market dispatch. The battery starts at reserve. Final inventory has no terminal credit.

RTM prices are the mean of four complete 15-minute SPP intervals for settlement-point type **LZ**, excluding the separately published **LZEW** series. DAM matches by delivery date, hour ending and repeated-hour flag. There are **8,760 physical hours and 35,040 RTM intervals per zone**, including the fall repeated hour and spring skipped hour. There is no imputation. Hour ending 24 belongs to its delivery date. Spike counts use the underlying 15-minute prices ≥ $100/MWh; volatility uses hourly averages. DAM − RT is diagnostic, not a revenue stream.

| Price proxy | Energy cashflow / year | Losing months | Idle baseline | Final excess inventory |
|---|---:|---:|---:|---:|
| LZ_HOUSTON | $117.42 | 0 / 12 | $0 | 0 kWh |
| LZ_NORTH | $156.62 | 0 / 12 | $0 | 0 kWh |
| LZ_SOUTH | $121.29 | 0 / 12 | $0 | 0 kWh |

These are **simulated cashflows settled against actual historical prices**, not executed P&L. No losing month was discarded; all twelve appear in the CSV and UI. This baseline can lose money on other prices, demonstrated by tests. No strategy was optimized or selected by its performance on this period. Prices alone cannot establish a revenue floor or deployment ROI.

Ranking: `100 × [w × minmax(energy cashflow) + (1−w) × minmax(county market size)]`, calculated separately for homes and businesses. An equal-valued feature contributes 0.5 to every candidate. Missing components make the score unavailable. Default w=0.7; alternative w=0.3. At the default settings, residential order is **Dallas → Harris → Hidalgo**; alternative order is **Harris → Dallas → Hidalgo**. County housing totals include renters, apartments and vacant homes; employer establishment counts span all sectors. Neither is an eligible deployment count. These broad cohorts are the explicitly incomplete first site layer, not parcel-level targets or verified commercial clusters.

## Assumptions

| Input | Initial value | Reason / boundary |
|---|---|---|
| Capacity / AC power | 25 kWh / 5 kW | Illustrative common-scale test battery, not claimed Base hardware |
| Round-trip efficiency | 88% | Editable loss sensitivity; symmetric charge/discharge losses |
| Backup reserve | 20% | Hard SOC floor; does not simulate an outage or guarantee backup hours |
| Clock windows | 01–05 / 17–21 Central | Transparent, price-independent rule; fixed in code rather than tuned to the replay |
| Wear per delivered kWh | $0 | Excluded by default, visibly editable; not evidence of zero degradation |
| Installed cost / annual costs | Missing | Require a quote and actual operating assumptions |
| Operator share | Missing | User scenario; share of energy + ancillary value, no invented Base contract |
| Ancillary / capacity-reliability | Missing, separately displayed | Cannot infer qualification, commitment or outage value from SPP |
| Retail rates / annual usage | Missing | Require the customer's tariff and consumption |
| Retail shape | Explicitly synthetic | Flat; 3× weight at 17–21; or 3× weight at 08–17, normalized to entered annual usage |
| Retail dispatch | Same clock rule, discharge capped by load | No exports or demand charges. Bill savings replace wholesale cashflow, never stack on it |
| County-zone relationship | Analyst-selected proxy | Verify each meter's real settlement point; map does not claim county-level price measurement |
| Fleet size | 10,000 requested, not allocated | Missing qualified counts; no unsupported installation capacity or market-impact assumption |

Scenario owner value = `(energy + ancillary) × (1 − operator share) + reliability − wear − other annual costs`. The owner bears losses under this illustrative formula. Any positive ancillary or reliability input needs separate proof that it can coexist with the energy schedule; no service co-optimization is modeled. Simple payback = installed cost / positive annual owner value. With missing inputs it stays missing; with a nonpositive return it reports no payback. Financing, tax, replacement, multi-year degradation and future prices are excluded.

## Sources and dates

- [ERCOT historical prices](https://www.ercot.com/mktinfo/prices): [DAM 13060 / NP4-180-ER](https://www.ercot.com/mp/data-products/data-product-details?id=NP4-180-ER) and [RTM 13061 / NP6-785-ER](https://www.ercot.com/mp/data-products/data-product-details?id=NP6-785-ER). Downloaded 2026-10-19, 2025 and 2026 archives. Exact upstream document IDs, retrieval timestamps and hashes: [manifest](../../data/deployment/manifest.json). ERCOT may subsequently correct settlements; the frozen hashes identify this replay.
- [Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer): generalized 2024 county boundaries, layer 13, retrieved 2026-10-19; 254 Texas counties. Only three have screening values.
- Census QuickFacts: [Harris](https://www.census.gov/quickfacts/harriscountytexas), [Dallas](https://www.census.gov/quickfacts/dallascountytexas), [Hidalgo](https://www.census.gov/quickfacts/hidalgocountytexas), reviewed 2026-10-19. Housing counts: July 1, 2025 (V2025). Employer establishments: 2023. The six figures were manually transcribed from the official pages and retained in [sites.json](../../data/deployment/sites.json). Census's API required a key and direct page downloads returned 403; this small manual layer is disclosed, not presented as an automated live feed.
- [EIA Texas Electricity Profile](https://www.eia.gov/electricity/state/Texas/), 2024 data, checked 2026-10-19: context only. State-average rates are not substituted for customer tariffs.

Only public data is used. No Base systems, customer records, proprietary pricing or physical battery controls are accessed.

## Franklin: optional AI, explicit guide mode

Recommendation: **OpenRouter behind the existing Vercel API route** for a public page. Keep Claude/Codex local for development, rather than exposing a laptop-backed coding agent to visitors. Franklin has no filesystem, command execution, browsing, dispatch or account tools. The server recomputes evidence from the checked-in data; model text never changes scores or calculator values.

Default: no paid AI requests. Guide buttons use deterministic explanations and identify themselves as guide mode. To enable later, configure these **server-only** environment variables:

```text
FRANKLIN_ENABLED=true
OPENROUTER_API_KEY=<dedicated, spending-capped key>
FRANKLIN_MODEL=<explicit supported model ID>
```

Do not put keys in HTML, frontend JavaScript or source control. Configure the key's spending cap and model restrictions in OpenRouter before enabling. The route limits question/history size, response tokens, timeouts and requests per IP per warm instance, with provider data collection denied and fallback disabled. The in-memory limit is **not** a distributed limit: serverless instances/cold starts reset it; a shared limiter is still required for stronger public abuse protection. No claim of production hardening. The request origin check is an extra browser check, not authentication. No keys were configured, model calls made or deployment performed for this work.

Franklin receives the question, short conversation history, selected region, ranking weights and battery assumptions. Private ROI cost/tariff fields are intentionally not sent, and the assistant is told it cannot see them. Avoid entering personal information. Displayed AI replies are plain text; an AI explanation can still be wrong, so the tables and source files remain authoritative.

## What would change the conclusion?

Obtain an eligible-address/ESIID sample, meter-zone mapping, customer interval data, actual tariffs and install/interconnection constraints. Verify dispatch compensation and ancillary commitments. Compare a causal forecast-based policy to this fixed-clock baseline on a separate period, include outages and wear, then assess fleet market impact. Until then, this page identifies research priorities and shows their evidence; it does not answer the physical allocation problem.
