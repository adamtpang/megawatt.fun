# megawatt.fun API

A stateless JSON API for the five tools on megawatt.fun: **finance**, **launch**, **supply**, **market** and **pitch**. Each endpoint runs the same code as its page, on the same public data, and takes the same "Use your own data" file the page takes. Call it from a script, a spreadsheet or your own systems.

**Public data only. Nothing you send is stored.** Request bodies are never logged or written anywhere. Each call is computed and forgotten.

## Try it out

```bash
curl https://megawatt.fun/api/v1/health
```

Every tool answers `GET` with its own usage: what it does, the request shape, an example body and a link to the file format.

```bash
curl https://megawatt.fun/api/v1/finance
```

One `POST` per tool:

```bash
# Finance: debt on one home battery with your own cost, toll and rate
curl -X POST https://megawatt.fun/api/v1/finance \
  -H 'Content-Type: application/json' \
  -d '{"inputs": {"capexPerKwh": 280, "tollPerKwYear": 90, "ratePct": 8.5}, "revenueCase": "toll", "zone": "LZ_NORTH"}'

# Launch: weeks to a first install in Texas, slow case, two extra email rounds
curl -X POST https://megawatt.fun/api/v1/launch \
  -H 'Content-Type: application/json' \
  -d '{"state": "TX", "case": "high", "rounds": 2}'

# Supply: your bill of materials as the page's CSV file
curl -X POST https://megawatt.fun/api/v1/supply \
  -H 'Content-Type: text/csv' \
  --data-binary $'part,category,lead_time_weeks,on_hand_weeks,second_source,tariff_pct,unit_cost_usd,qty_per_unit\nInverter module,power_electronics,30,12,no,25,900,1\nLFP cell,cells,16,8,yes,55,40,12\n'

# Market: states ranked with home count weighted 0, plus your own install cost
curl -X POST https://megawatt.fun/api/v1/market \
  -H 'Content-Type: application/json' \
  -d '{"weights": {"homes": 0}, "metrics": {"factors": [{"key": "install_cost_usd", "higherIsBetter": false}], "states": {"TX": {"install_cost_usd": 11500}, "FL": {"install_cost_usd": 13200}}}}'

# Pitch: the pitch for CoServ Electric, with your toll price and one target
curl -X POST https://megawatt.fun/api/v1/pitch \
  -H 'Content-Type: application/json' \
  -d '{"utility": "CoServ Electric", "terms": {"tollPerKwYear": 85, "termYears": 10}, "targets": [{"utility": "Austin Energy", "status": "in talks"}]}'
```

Any file you can load on a page's "Use your own data" panel can be sent as the body with `Content-Type: text/csv`. Options that are not in the file (state, path, utility and so on) then go in the query string, for example `/api/v1/launch?state=TX&path=retail`.

## Endpoints

| Endpoint | GET | POST |
| --- | --- | --- |
| `/api/v1/health` | status, build, data dates | none |
| `/api/v1/finance` | usage | size the debt on one battery |
| `/api/v1/launch` | usage | launch timeline for one state |
| `/api/v1/supply` | usage | shortage check on your bill of materials |
| `/api/v1/market` | usage | states and Texas zones ranked |
| `/api/v1/pitch` | usage | pitch for one utility |

### Health

```json
{
  "status": "ok",
  "version": "23181e5",
  "endpoints": [{ "path": "/api/v1/finance", "methods": ["GET", "POST"], "what": "...", "docs": "https://megawatt.fun/plug-and-play#finance" }],
  "data_as_of": { "finance_defaults": "2026-10-30", "zone_value": { "built": "...", "period_start": "2025-10-01", "period_end_exclusive": "2026-10-01" }, "launch_steps": "...", "supply": "...", "expansion_map": "...", "market_states": "..." },
  "note": "Public data only. Nothing you send is stored."
}
```

`version` is the short git commit of the deploy, or `local`.

### Every POST response

```json
{ "ok": true, "inputs_used": { }, "result": { }, "warnings": [ ], "sources": [ ] }
```

- `inputs_used`: what the tool actually ran on, after defaults were filled in. `yours` lists what came from you.
- `result`: the tool's answer (below). Money is US dollars, time is weeks unless a field says months.
- `warnings`: things that did not stop the run, such as a blank value that kept the public number, or a field the endpoint does not read.
- `sources`: where the public numbers came from.

### Finance

Sizes the loan on one leased home battery the way a lender does: level debt service, sized so the weakest year still covers it by the target DSCR, then capped by the advance rate on cost and by the net cost (installed cost minus the member payment and the investment tax credit). Same math and the same input checks as [/finance](https://megawatt.fun/finance). A generic model, not any company's books.

Request (every field optional; an empty body is the public case, revenue case `merchant`):

```json
{
  "inputs": { "capexPerKwh": 280, "itcPct": 30, "tollPerKwYear": 90, "ratePct": 8.5 },
  "revenueCase": "toll | merchant | stacked",
  "zone": "LZ_NORTH",
  "arbPerYear": 150,
  "fleetCount": 1000
}
```

Input keys, their public values and their `min`, `max` and `integer` limits are listed by `GET /api/v1/finance` and in [the file format](https://megawatt.fun/plug-and-play#finance). Percent inputs are percents (`ratePct: 8.5`), as on the page. Numbers must be plain decimals: `0x10`, `Infinity`, out-of-range values, unknown keys (including `__proto__` and `constructor`) and non-integer `fleetCount` are 422 errors. `arbPerYear` replaces the zone's arbitrage value (0 to 100,000). CSV: the page's `key,value` file.

`itcPct` is the IRC 48E storage credit as a percent of installed cost (public default 30). It is treated as sold for cash at face value when the battery goes into service (IRC 6418 transfer) and lowers `net_capex`. Not modeled: the transfer discount, timing, recapture, basis reduction, bonus adders and the prohibited foreign entity test (set `itcPct` to 0 if the battery fails it).

Result: `debt`, `equity`, `itc`, `net_capex`, `debt_service`, `year1_cfads`, `min_cfads_in_tenor`, `min_dscr`, `binding` (`dscr`, `advance`, `cost` or `none`) with `binding_text`, `explain` (plain-English lines; the first names the biggest revenue line and whether it is public or an assumption), `cfads_by_year`, `fleet.input` and `fleet.mw_100` roll-ups, and a `sensitivity` grid of debt by toll and rate.

### Launch

Critical-path plan for one state. Same math as [/launch](https://megawatt.fun/launch).

```json
{
  "state": "TX",
  "path": "retail | utility",
  "case": "low | high",
  "rounds": 1,
  "steps": [{ "path": "retail", "id": "license", "name": "Retail license", "owner": "Regulatory", "low": 10, "high": 14, "depends_on": ["entity"], "round_weeks": 3 }]
}
```

Defaults: `state` GA (the page default), `path` the one the public data suggests for the state, `case` low (fast), `rounds` 1. `rounds` takes 0 to 3; the page offers 0 to 2. `steps` is your own steps: a list of rows in the CSV shape, or `{ "paths": { "retail": { "steps": [...] } }, "tennis": [...] }`. A path in your steps replaces that path for every state. CSV: the page's step file, with options in the query string.

Types are checked: in JSON, `state`, `path` and `case` are text and `rounds` is a number (`"rounds": true` or `"state": ["TX"]` is a 422). An option may be sent in the body or the query string; if both carry it with different values (`{"state":"TX"}` with `?state=CA`), or the query string repeats it, the request is a 422 rather than silently picking one. Step ids reserved on every JavaScript object (`__proto__`, `constructor`, `prototype`, `toString` and the like) are 422 errors naming the row. Durations are plain decimals: `0x10` and `Infinity` are not numbers. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`.

Result: `first_install_weeks` and `total_weeks` (fast and slow, also in months), `critical_path`, `best_step_to_shorten` (the step whose halving saves most), `email_tennis` (weeks added before the first install, the `worst_loop`, every loop), `steps` with start, finish and slack, `snags`, and the `suggested` path with its reason.

### Supply

Which parts will run short. Same rules as [/supply](https://megawatt.fun/supply).

```json
{ "parts": [{ "part": "LFP cell", "category": "cells", "supplier": "Example Supplier C", "country": "China", "lead_time_weeks": 16, "on_hand_weeks": 8, "second_source": "yes", "tariff_pct": 55, "unit_cost_usd": 40, "qty_per_unit": 12 }] }
```

`part`, `category` and `lead_time_weeks` are required. Categories: `power_electronics`, `bms_memory`, `cells`, `cellular`, `grid_equipment`, `labor`, `metals`, `other`. A bare list of parts also works. CSV: the page's bill-of-materials file. Column names match without regard to case or surrounding spaces (`Lead_Time_Weeks` works); unknown columns are named in `warnings`.

Limits, each a 422 naming the row: `lead_time_weeks` and `on_hand_weeks` at most 520 (10 years), `tariff_pct` at most 500, `unit_cost_usd` at most 1,000,000, `qty_per_unit` at most 10,000, nothing negative. Numbers are plain decimals (`$` `,` `%` are dropped; `0x10` and `Infinity` are not numbers). Text fields take text (a number such as a part number is read as text); an object or a list is a 422. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`.

Result: `summary` (one sentence), `totals` (`parts`, `at_risk`, `single_source`, `tariff_per_battery`, `longest_gap`), and `rows` sorted by gap, biggest first, each with `gap_weeks`, `flags` and a link to the public research for its category.

### Market

States ranked for home batteries, and Texas load zones ranked by what one battery earned from energy arbitrage on a fixed daily clock (charge 10 AM to 2 PM, discharge 7 to 9 PM Central). Trading hubs are not ranked. Same scoring as [/market](https://megawatt.fun/market): at the default weights the top three are Michigan 76, Texas 71 and Maryland 69.

```json
{
  "weights": { "homes": 0, "yours_install_cost_usd": 2 },
  "metrics": { "factors": [{ "key": "install_cost_usd", "higherIsBetter": false }], "states": { "TX": { "install_cost_usd": 11500 } } },
  "zones": [{ "zone": "LZ_NORTH", "usd_per_year": 150 }]
}
```

All optional. Factor ids are listed by `GET /api/v1/market`; your own metrics become factors named `yours_` plus the column name, weight 1 unless you set one. `metrics` and `zones` also take the page's CSV text as a string. A CSV body is one file, a state metrics file or a zone file, told apart by its columns. Unlike the page, one JSON request can carry both.

Result: `states` best first, each with `rank`, `score` (0 to 1), `points` (0 to 100), `tier` (S, A, B, C, Later), `why` (plain English) and every factor's value and percentile rank; `tiers`; `texas_zones.zones` (load zones only) ranked by `usd_per_battery_year`, and `texas_zones.schedule`, the charge and discharge hours.

### Pitch

The outside-view pitch for one utility. Same rules as [/pitch](https://megawatt.fun/pitch).

```json
{
  "utility": "CoServ Electric",
  "state": "TX",
  "mw": 100,
  "largeLoads": false,
  "terms": { "tollPerKwYear": 85, "termYears": 10 },
  "targets": [{ "utility": "Austin Energy", "status": "in talks", "owner": "Ben" }]
}
```

`utility` is required: an EIA id as in the data (`5078-TX`), the name, `Name, ST`, or a public alias. A `state` that disagrees with the utility is a 422, not ignored. `largeLoads` must be `true` or `false` (or `"yes"`, `"no"`, `1`, `0`); anything else is a 422. `terms` must be an object; a list is a 422. Term keys are listed by `GET /api/v1/pitch`, and an unknown key (including `constructor` or `__proto__`) is a 422. CSV: the page's terms and targets file, with `utility` in the query string.

Result: `headline` and `headline_signal` (value and national percentile), `offer` (which of Base's three offers fits, the rule that picked it, and why; `capacity_offer` is false for a wires-only utility), `wires_only` (null, or why the utility delivers power but does not buy it, with source numbers), `program` (batteries, MWh, share of customers), `landed_cost` rows, `your_offer` when you send a toll price, `problem` signals, `deal_structure`, `questions` to ask, and `who_to_call_first` in the utility's state, your targets first. Wires-only utilities (Oncor, CenterPoint, AEP Texas, TNMP, ComEd, PECO, PPL and the like) are not ranked: their rows have `rank: null` and `wires_only: true`, and they are listed in `wires_only_in_state`.

## Errors

```json
{ "ok": false, "errors": ["Row 2: capexPerKwh is not a number: \"abc\".", "Row 3: unknown key \"bogus\". Download the template for the full list."] }
```

| Status | When |
| --- | --- |
| 400 | the body is not valid JSON, or is JSON but not an object |
| 405 | a method other than GET, POST or OPTIONS |
| 413 | the body is over 1 MB |
| 422 | the input does not pass the tool's checks; every problem is listed, named by row (CSV) or item (JSON), with the same wording as the page |

## Limits

- Bodies up to 1 MB.
- CORS is open: any origin, methods GET, POST and OPTIONS, header Content-Type. OPTIONS answers 204.
- No keys, no accounts, no state. POST responses are `Cache-Control: no-store`; GET usage is cached for an hour.
- The numbers are an outside view from public data and stated assumptions, not Base Power's own figures. Every `sources` list says which is which.
