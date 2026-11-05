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
  -d '{"weights": {"homes": 0}, "metrics": {"factors": [{"key": "install_cost_usd", "higherIsBetter": false}], "states": {"TX": {"install_cost_usd": 11500}, "FL": {"install_cost_usd": 13200}, "GA": {"install_cost_usd": 12800}, "AZ": {"install_cost_usd": 12100}, "NC": {"install_cost_usd": 13900}}}}'

# Pitch: the pitch for CoServ Electric, with your toll price and one target
curl -X POST https://megawatt.fun/api/v1/pitch \
  -H 'Content-Type: application/json' \
  -d '{"utility": "CoServ Electric", "terms": {"tollPerKwYear": 85, "termYears": 10}, "targets": [{"utility": "Austin Energy", "status": "in talks"}]}'
```

Every POST body needs `Content-Type: application/json` or `Content-Type: text/csv`. Any other type is a 415, including the `application/x-www-form-urlencoded` that `curl -d` sends when you leave out `-H`, so a body is never silently ignored. A body with no Content-Type at all is read as JSON when it starts with `{` or `[`, and is a 415 otherwise. Any file you can load on a page's "Use your own data" panel can be sent as the body with `Content-Type: text/csv`. Options that are not in the file (state, path, utility and so on) then go in the query string, for example `/api/v1/launch?state=TX&path=retail`.

## Endpoints

| Endpoint | GET | POST |
| --- | --- | --- |
| `/api/v1/health` | status, build, data dates | none |
| `/api/v1/finance` | usage | size the debt on one battery |
| `/api/v1/launch` | usage | launch timeline for one state |
| `/api/v1/supply` | usage | shortage check on your bill of materials |
| `/api/v1/market` | usage | states and Texas zones ranked |
| `/api/v1/pitch` | usage | pitch for one utility |
| `/api/v1/zip` | usage | utility, permit office, and days for one ZIP |

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
- `result`: the tool's answer (below). Money is US dollars, time is weeks unless a field says months. Numbers are rounded for reading at the API boundary, never inside the math: whole numbers stay whole, numbers of 1 or more have at most 2 decimal places (dollars and cents, MW, weeks, DSCR), and numbers under 1 keep 4 significant digits (shares, percentile ranks, rates), so a small share never reads as 0. `inputs_used` is not rounded.
- `warnings`: things that did not stop the run, such as a blank value that kept the public number, an unknown column, or a field the endpoint does not read (with the closest known field when one is near: `"stat"` suggests `"state"`).

Files follow one set of rules on every tool and page: a key or id on two rows is a row error; a column written twice (the same name, or two names that match in any case such as `Key` and `key`) is an error, never a silent pick of one value; a column the tool does not know is ignored with a warning that names it; text values and file keys match in any case, and an unknown key names the closest known key. Text echoed back in an error is cut to about 40 characters.
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

Input keys, their public values and their `min`, `max` and `integer` limits are listed by `GET /api/v1/finance` and in [the file format](https://megawatt.fun/plug-and-play#finance). Percent inputs are percents (`ratePct: 8.5`), as on the page. Numbers must be plain decimals: `0x10`, `Infinity`, out-of-range values, unknown keys (including `__proto__` and `constructor`) and non-integer `fleetCount` are 422 errors. A number too large to store (`1e400`) is reported as out of range, not as "not a number". `arbPerYear` replaces the zone's arbitrage value (0 to 100,000); sending both gives a warning that the zone is not used. `zone` takes any case (`lz_north`). `revenueCase`, `zone`, `arbPerYear` and `fleetCount` may sit at the top level or inside `inputs`; sent in both places with different values is a 422, never a silent pick. `revenueCase` takes any case (`TOLL`). `kw` must be at least 0.1: the 100 MW roll-up divides by it, so 0 would mean no batteries. CSV: the page's `key,value` file, headers in any case (`Key,Value` works), keys in any case (`ratepct` is `ratePct`); an unknown key is a 422 that names the closest key (`ratPct`: did you mean ratePct?). A key on two rows is a 422 naming both rows. A file without the `key,value` header row is a 422 that shows the first line it found, and a binary file (such as an `.xlsx`) is a 400 that says to save it as CSV. Columns other than `key`, `value`, `unit`, `label` and `public_basis` are ignored with a warning. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`.

`itcPct` is the IRC 48E storage credit as a percent of installed cost (public default 30). It is treated as sold for cash when the battery goes into service (IRC 6418 transfer) at `itcPriceCents` cents per dollar of credit (public default 89.5, Crux's 2026-vintage ITC average), so `itc` = `itc_face` x `itc_price`, and it lowers `net_capex`. Not modeled: timing, recapture, basis reduction, bonus adders and the prohibited foreign entity test (set `itcPct` to 0 if the battery fails it).

The model nets the credit cash out of cost on day one. Real lenders usually fund the credit with a separate bridge loan repaid when it sells, and size the term loan on cash flow and an advance rate on the full cost. `advance_cap` already uses the full cost, so the credit changes `debt` only when `binding` is `cost`; then `equity` is 0 and both `binding_text` and `explain` say so.

`retailMarginMonthly` (public default 22, a labeled assumption) is derived: (7.7 cents/kWh energy charge on Base's Oncor battery-plan Electricity Facts Label dated 10/07/2026 - 3.70 cents/kWh LZ_NORTH real-time price weighted by ERCOT North Central load, 2025-10-01 to 2026-09-30 - 2.0 cents/kWh other supply cost, an assumption) x 1,096 kWh a month (EIA 2024 Texas residential average) = $21.92. It belongs only to an owner that is also the home's retail provider; send 0 for a third-party owner. With 0, `explain` says the answer leaves out retail margin.

`export_settlement` says who keeps the arbitrage value. Under the ERCOT Nodal Protocols (Section 2 definitions, 11.4.4.3 and 6.6.3.2), outflow from an unregistered battery of 1 MW or less is settled as a cut to the settlement load of the home's retail provider at the real-time load-zone price. An owner that is that provider keeps the arbitrage line with no ADER aggregation; a third-party owner needs a contract with the provider or an ERCOT registration; ADER is the route to ancillary services.

`ancPerKwYear` is ERCOT ancillary services (Non-Spin, ECRS) that a home battery reaches only through an aggregation in ERCOT's ADER pilot, in $ per kW-year. Public default 0, a labeled assumption. Enter the value left after the arbitrage it displaces, since a kW held as reserve cannot also discharge that hour. It counts in the `merchant` and `stacked` cases, not `toll`, with availability and fade applied, and shows as `anc` in `year1_revenue_lines` and `cfads_by_year`.

`capexPerKwh` (public default 350) is a cost basis from the midpoint of Base's public "landed cost of storage" range, a figure shown to utilities that may include Base's margin. The member payment defaults ($695 and $19/month) are Base's published offer, which Base says varies by address and by state.

Result: `debt`, `equity`, `itc_face`, `itc_price`, `itc` (cash from the sale), `net_capex`, `export_settlement`, `debt_service`, `year1_cfads`, `min_cfads_in_tenor`, `min_dscr`, `binding` (`dscr`, `advance`, `cost` or `none`) with `binding_text`, `explain` (plain-English lines; the first names the biggest revenue line and whether it is public or an assumption), `cfads_by_year`, `fleet.input` and `fleet.mw_100` roll-ups, and a `sensitivity` grid of debt by toll and rate.

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

Types are checked: in JSON, `state`, `path` and `case` are text and `rounds` is a number (`"rounds": true` or `"state": ["TX"]` is a 422). An option may be sent in the body or the query string; if both carry it with different values (`{"state":"TX"}` with `?state=CA`), or the query string repeats it, the request is a 422 rather than silently picking one. Step ids reserved on every JavaScript object (`__proto__`, `constructor`, `prototype`, `toString` and the like) are 422 errors naming the row. Durations are plain decimals: `0x10` and `Infinity` are not numbers. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`. Column names match without regard to case, surrounding spaces, or spaces and hyphens for underscores (`Depends On` works); unknown columns are named in `warnings`, and a column written twice is a 422. A path may hold at most 300 steps; more is a 422 (`retail: 2000 steps is over the limit of 300 steps per path`) checked before any row is read, and a 300-step plan answers in well under a second. A `state` echoed in an error is cut to 40 characters. A plan where every step is 0 weeks, or a 0-week step whose name or note does not say "milestone", gives a warning.

In the public data, Texas market testing (`edi`) starts when the license application is filed (`license_filed`, a 0-week milestone), not when the license is granted, because ERCOT's test-flight page asks a new retailer only to have applied for PUCT REP certification by the flight deadline. The license review and the testing run side by side, and enrollment (`sales`) waits for both. Other states keep testing after the license.

Result: `first_install_weeks` and `total_weeks` (fast and slow, also in months), `critical_path`, `best_step_to_shorten` (the step whose halving saves most), `email_tennis` (weeks added before the first install, the `worst_loop`, every loop), `steps` with start, finish and slack, `snags`, and the `suggested` path with its reason.

### Supply

Which parts will run short. Same rules as [/supply](https://megawatt.fun/supply).

```json
{ "parts": [{ "part": "LFP cell", "category": "cells", "supplier": "Example Supplier C", "country": "China", "lead_time_weeks": 16, "on_hand_weeks": 8, "second_source": "yes", "tariff_pct": 55, "unit_cost_usd": 40, "qty_per_unit": 12 }] }
```

`part`, `category` and `lead_time_weeks` are required. Categories: `power_electronics`, `bms_memory`, `cells`, `cellular`, `grid_equipment`, `labor`, `metals`, `other`. A bare list of parts also works. CSV: the page's bill-of-materials file. Column names match without regard to case or surrounding spaces (`Lead_Time_Weeks` works); unknown columns are named in `warnings`. A column written twice (`lead_time_weeks` twice, or `Lead_Time_Weeks` and `Lead time weeks`) is a 422. A BOM checker file (`part_number`, `description`, `qty`, `lead_time_days`) is a 422 that says so and points to the BOM checker on /supply.

Limits, each a 422 naming the row: `lead_time_weeks` and `on_hand_weeks` at most 520 (10 years), `tariff_pct` at most 500, `unit_cost_usd` at most 1,000,000, `qty_per_unit` at most 10,000, nothing negative. Numbers are plain decimals (`$` `,` `%` are dropped; `0x10` and `Infinity` are not numbers). Text fields take text (a number such as a part number is read as text); an object or a list is a 422. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`.

Result: `summary` (the page's summary, word for word: a gap above 0 but under 0.1 weeks reads "under 0.1 wk", and when no part has a tariff cost it names only the missing columns), `totals` (`parts`, `at_risk`, `single_source`, `tariff_per_battery`, `longest_gap`), and `rows` sorted by gap, biggest first, each with `gap_weeks`, `flags` and a link to the public research for its category.

### Market

States ranked for home batteries, and Texas load zones ranked by what one battery earned from energy arbitrage on a fixed daily clock (charge 10 AM to 2 PM, discharge 7 to 9 PM Central). Trading hubs are not ranked. Same scoring as [/market](https://megawatt.fun/market): at the default weights, which include the retail-choice path (a sourced per-state legal flag for open residential retail choice, checked 2026-11-04), the top three are Texas 73, Michigan 73 and Maryland 71. Each state's `footprint` (Base's public marks: `operating`, `announced`, or `equipment` for Colorado and Connecticut, where Base's site footer says it offers home battery equipment and installation, not retail) is returned as data and is not part of the score.

```json
{
  "weights": { "homes": 0, "yours_install_cost_usd": 2 },
  "metrics": { "factors": [{ "key": "install_cost_usd", "higherIsBetter": false }], "states": { "TX": { "install_cost_usd": 11500 }, "FL": { "install_cost_usd": 13200 }, "GA": { "install_cost_usd": 12800 }, "AZ": { "install_cost_usd": 12100 }, "NC": { "install_cost_usd": 13900 } } },
  "zones": [{ "zone": "LZ_NORTH", "usd_per_year": 150 }]
}
```

All optional. Factor ids are listed by `GET /api/v1/market`; your own metrics become factors named `yours_` plus the column name, weight 1 unless you set one. `metrics` and `zones` also take the page's CSV text as a string. A CSV body is one file, a state metrics file or a zone file, told apart by its columns. Unlike the page, one JSON request can carry both. A metric needs values for at least 5 states to count in the score: a percentile rank among fewer is not meaningful (one state alone would get full marks), so a thinner metric is left out with a warning, and a file where no metric reaches 5 states is a 422. Factor ids in `weights` take any case (`HOMES`); an unknown one names the closest id. `metrics.factors`, when sent, must be a list (`"x"` or an object is a 422). `higherIsBetter` must be `true` or `false` (or the text `"true"` or `"false"`, any case); left out, it is true. Anything else (`"no"`, `0`, `null`) is a 422, because a silent "higher is better" would reverse the ranking. A zone file's columns other than `zone` and `usd_per_year` are ignored with a warning. Zone ids take any case (`lz_north`); each zone value is 0 to 100,000 $ per battery per year, the same cap as `arbPerYear` on finance.

Result: `states` best first, each with `rank` (null when the state has no score, for example with every weight at 0), `score` (0 to 1), `points` (0 to 100), `tier` (S, A, B, C, Later), `why` (plain English) and every factor's value and percentile rank; `tiers`; `texas_zones.zones` (load zones only) ranked by `usd_per_battery_year`, and `texas_zones.schedule`, the charge and discharge hours.

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

`utility` is required: an EIA id as in the data (`5078-TX`), the name, `Name, ST`, a public alias (`CoServ Electric`), a common short name (`Oncor`, `ComEd`, `PG&E`), or the name without Co, Inc or LLC, in any case. It may be at most 200 characters; longer is a 422 before any matching. A name that matches nothing is a 422 with the closest utility when one is near; a short name that fits two rows (`AEP Texas`) is a 422 asking for the id or a state. A `state` that disagrees with the utility is a 422, not ignored. `utility`, `state`, `mw` and `largeLoads` may come from the body or the query string; sent in both places they must agree (the same utility by another name counts as agreeing), or the request is a 422. `mw` and `terms.programMw` are the same number: both sent and different is a 422, and `inputs_used.terms.programMw` always reports the size the pitch was built on. `largeLoads` must be `true` or `false` (or `"yes"`, `"no"`, `1`, `0`); anything else is a 422. `terms` must be an object; a list is a 422. Term keys are listed by `GET /api/v1/pitch` and match in any case; an unknown key (including `constructor` or `__proto__`) is a 422 that names the closest key. A key on two rows is a 422, and so is one utility on two target rows (by any of its names). `targets` holds at most 500 items; each item's `utility`, `state`, `status`, `owner` and `note` must be text (a list or object is a 422 naming the item). CSV: the page's terms and targets file, with `utility` in the query string; column names are matched in any case, unknown columns are a warning, and a column written twice is a 422. A JSON body sent as `text/csv` is a 422 that says to use `Content-Type: application/json`.

Result: `headline` and `headline_signal` (value and national percentile), `offer` (which of Base's three offers fits, the rule that picked it, and why; `capacity_offer` is false for a wires-only utility), `wires_only` (null, or why the utility delivers power but does not buy it, with source numbers), `program` (batteries, MWh, share of customers; batteries come whole, so a size below one battery is rounded up, with `nameplate_mw`, `rounded_up: true` and a sentence in `note`), `landed_cost` rows, `your_offer` when you send a toll price, `problem` signals, `deal_structure`, `questions` to ask, and `who_to_call_first` in the utility's state, your targets first. Wires-only utilities (Oncor, CenterPoint, AEP Texas, TNMP, PECO, PPL and the like) are not ranked: their rows have `rank: null` and `wires_only: true`, and they are listed in `wires_only_in_state`. ComEd and Ameren Illinois are not wires-only: Illinois Public Act 104-0458 (220 ILCS 5/16-107.9) requires each to file a virtual power plant tariff by 31 December 2027, so they are ranked and `state_program` describes that route, with source numbers (null elsewhere). `program.accredited_example` is an illustration labeled `basis: "assumption"`: nameplate derated for a 20% home reserve (or your `memberReservePct`) to what each battery can hold for 2 hours, times NYISO's 2026-2027 factor for 2-hour storage, 64.65%. `who_to_call_first.method` also explains why this site lists 7 Base partners while Base's page says 6.

Existing Base partners are never ranked as cold prospects. For a partner, `base_partner` holds `status` ("Already a Base partner"), `program`, `since`, `framing` (expand the existing program, not a cold pitch) and its `source`, and the first `questions` are about the existing program. In `who_to_call_first`, partner rows come after the cold top 10 with `rank: null`, `base_partner: true` and `status`, and are listed in `base_partners_in_state`. Ranking is market first: when one ISO or RTO holds at least 80% of the state's residential customers, `preferred_market` names it (ERCOT in Texas) and its utilities are ranked first; other rows have `outside_preferred_market: true` and a `market_note` such as "Outside ERCOT (MISO): different market rules". `market_reason` says why. Every row carries its `market` (the EIA balancing authority).

### ZIP

Utility, permit office, interconnection path, and days to a first install for one US ZIP. Same lookup as the ZIP card on [/launch](https://megawatt.fun/launch).

```bash
curl -X POST https://megawatt.fun/api/v1/zip \
  -H 'Content-Type: application/json' \
  -d '{"zip": "78704"}'
```

`zip` is required: a 5-digit US ZIP, or ZIP+4 written `78704-1234` or `787041234` (the first five digits are used), sent as text (`"06103"`). No zip at all (an empty body, `null`, `""`) is a 422 that says zip is required. A number is a 422, because a number drops leading zeros (`6103`); a list or an object is a 422 too. It can sit in the query string instead (`?zip=78704`). If the body and the query string both carry a ZIP and they differ, the request is a 422. The body is JSON, not CSV.

Coverage is Texas, Illinois, Georgia, and Connecticut ZCTAs from the 2020 Census, joined to the NREL/OpenEI 2024 ZIP file. OpenEI does not list Oncor, CenterPoint, AEP Texas, or TNMP, so for Texas the wires companies inside retail choice come from Power to Choose, the PUCT plan site, queried ZIP by ZIP. A ZIP split between a retail-choice wires company and a city utility or co-op (Denton 76201) lists both and warns. A city utility or co-op that Power to Choose lists, such as Lubbock Power & Light (in retail choice since March 2024), gets the path `retail_choice_public`: a retail provider sells the power and the utility owns the wires. A ZIP outside the file returns `covered: false` and `unknown` for the figures. It is not an error.

Result: `utility` when exactly one wires utility is listed, `utilities` always (one per EIA number, each with `source` `openei-2024` or `ptc`, and `ptc_listed` when Power to Choose lists it), `gaps` (the caveats for all states plus the ZIP's own state), `ahj` (city or county), `solarapp` (`yes`, `no`, or `unknown`), `interconnection_path`, and `days_to_first_install`. The total uses `permit_review_days + interconnection_days + crew_days` and is `unknown` unless every input is a calendar-day number. Published clocks that are outside limits or business-day windows are listed and are not added. Retail power marketer rows are not the wires utility.

### BOM checker

The BOM checker on [/supply](https://megawatt.fun/supply) runs in the browser. It does not have an API, and the file is not uploaded. Columns are `part_number`, `description`, `qty`, `supplier`, and optional `alt_suppliers`, `alt_qualified`, `lead_time_days`, `on_hand_days`, `unit_cost_usd` (times in days). Numbers are plain decimals with limits (`qty` up to 10,000, days up to 3,650, `unit_cost_usd` up to 1,000,000), so `0x10` or `1e308` is a row error. Missing required columns are listed in one message. That is a different file from `POST /api/v1/supply` (`part`, `category`, `lead_time_weeks`, times in weeks), which is also the file for "Use your own data" at the top of /supply; each box recognizes the other's file and says which box to use.

Every CSV the site writes (templates, the BOM checker's flagged download, the dispatch bench trace) puts an apostrophe in front of a text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return, as OWASP recommends against CSV formula injection. Numbers, and text that is a plain number such as `-5`, are written as they are.

## Errors

```json
{ "ok": false, "errors": ["Row 2: capexPerKwh is not a number: \"abc\".", "Row 3: unknown key \"bogus\". Download the template for the full list."] }
```

| Status | When |
| --- | --- |
| 400 | the body is not valid JSON, is JSON but not an object, or is not text (a binary file) |
| 405 | a method other than GET, POST or OPTIONS |
| 413 | the body is over 1 MB |
| 415 | the body's Content-Type is not JSON or CSV (for example form-urlencoded or text/plain), or there is none and the body does not start with `{` or `[` |
| 422 | the input does not pass the tool's checks; every problem is listed, named by row (CSV) or item (JSON), with the same wording as the page |

## Limits

- Bodies up to 1 MB, as `application/json` or `text/csv`.
- Your own launch steps: at most 300 per path.
- CORS is open: any origin, methods GET, POST and OPTIONS, header Content-Type. OPTIONS answers 204.
- No keys, no accounts, no state. POST responses are `Cache-Control: no-store`; GET usage is cached for an hour.
- The numbers are an outside view from public data and stated assumptions, not Base Power's own figures. Every `sources` list says which is which.
