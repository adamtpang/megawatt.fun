## Pitch {#pitch}

Page: `/pitch`. Swaps Base's public claims and this page's assumptions for your own offer terms, and marks the utilities on your own target list.

**File:** one CSV or JSON file holds either part, or both. In a CSV, a row with a `key` is an offer term and a row with a `utility` is a target; a row with both, or neither, is an error. Column names are matched in any case, with spaces trimmed (`Utility` and ` STATUS ` work); a column written twice (`key` and `Key`) is an error, reported once. A spreadsheet, zip or image renamed `.csv` is refused as a binary file; a CSV saved as cp1252 or Latin-1 (Excel's plain "CSV" on Windows) is refused with a message to save it as "CSV UTF-8"; UTF-16 with a byte order mark is read. Template columns such as `unit`, `label` and `public_basis` are ignored; any other column is ignored with a warning. Each file you load replaces the last one, so keep terms and targets in the same file to use both. Download the templates from the page: the offer terms template lists every key with its public value and already has the target columns, and the target list template starts with the public top 5 to call in the selected state.

JSON shapes: `{ "key": value }` (terms only), `{ "terms": { "key": value }, "targets": [{ "utility", "status", "owner", "note" }] }`, or a list of row objects shaped like the CSV.

**Offer terms** (`key,value`):

| Key | Meaning | Unit | Public value |
| --- | --- | --- | --- |
| `programMw` | starting program size | MW | 100 (assumption) |
| `kwPerHome` | power per home battery | kW | 20 (Base claim) |
| `kwhPerHome` | energy per home battery | kWh | 39.2 (Base claim) |
| `costLowPerKwh`, `costHighPerKwh` | landed cost range | $/kWh | 300 to 400 (Base claim) |
| `deployMonthsLow`, `deployMonthsHigh` | time to deploy 100 MW | months | 3 to 6 (Base claim) |
| `cyclesPerYear` | dispatch cycles offered | cycles per year | 500 (Base claim) |
| `availabilityPct` | fleet availability | % | 96 (Base claim) |
| `forcedOutagePct` | forced outage rate, at most | % | 5 (Base claim) |
| `reliabilityCutoffPct` | outage percentile that picks distribution grid support | % | 75 (assumption) |
| `wholesaleCutoffPct` | share of homes in an ISO or RTO that picks accredited capacity | % | 50 (assumption) |
| `tollPerKwYear` | your toll price to the utility | $ per kW-year | none |
| `termYears` | your contract term, a whole number | years | none |
| `memberReservePct` | share of each battery held back for the home | % | none |

**Target list** (`utility,status,owner,note`, optional `state`): `utility` is the EIA id used in the data (for example `5078-TX`), the name as listed, `Name, ST`, a public alias such as `CoServ Electric`, a common short name such as `Oncor` or `ComEd`, or the name without Co, Inc or LLC, in any case. The same matcher runs in the page's utility box and the API. `status` is free text, for example `in talks`, `signed` or `not contacted`. Every text cell must be text: in a JSON file, a list or object is an error naming the row. A list holds at most 500 targets, and a utility name at most 200 characters.

**Rules:** blank term values keep the public number. Unknown keys (the message names the closest key), a key on two rows, one utility on two target rows (by any of its names), non-numbers, values outside each key's range (shown in the template's `min` and `max` columns), a `termYears` that is not a whole number, and a low end above its high end stop the load and are listed by row. Target names follow the same rule as keys: a name that matches no utility, several utilities, or a utility in another state (for example `5078-TX` with state `IL`) stops the load, named by row. The "Did you mean" comes from the row's own state, else the state of the pitch on screen, and from another state only for a near-exact name, so a Texas pitch never suggests a far-off Michigan utility. Number cells take plain decimals only (`$` and `%` are dropped, and a comma only as a thousands separator: `3,5` is an error that says to use a dot); hex such as `0x10` is not a number. Fullwidth letters and digits read as plain ones, in the utility box and the API alike. Keys match in any case (`tollperkwyear` is `tollPerKwYear`); `constructor` or `__proto__` is an unknown key. Changed numbers are tagged **Yours** on the pitch and in print, and the public claim stays shown beside them. Matched utilities show their status on the pitch and go first in "Who to call first", still in public rank order; targets in other states are listed under the table. A target that is a wires-only utility (it delivers power but does not buy it, such as Oncor or PECO) still shows, labeled Wires only and unranked. ComEd and Ameren Illinois are not wires-only: Illinois law requires each to file a virtual power plant tariff, so they are ranked. `memberReservePct` also sets the reserve in the capacity illustration (otherwise 20% is assumed). That illustration fits the utility's market: an accredited MW at NYISO's 2-hour factor only in a capacity market (PJM, MISO, ISO-NE, NYISO); in ERCOT, which has no capacity accreditation, the MW the fleet could hold through a 2-hour peak (4CP and price spikes are what count there); elsewhere the same 2-hour MW, with accreditation left as a question. A target that is already a Base partner (for example CoServ, Austin Energy or GVEC) also shows first, labeled Already a Base partner (El Paso Electric: Runs a pilot with Base, as its own release describes it) and unranked, and its pitch is framed as expanding the existing program. The target list template starts from the public top 5 cold prospects, so it never includes a partner or a wires-only utility.

**Example:**

```csv
key,value,utility,status,owner,note
kwPerHome,25,,,,
tollPerKwYear,85,,,,
termYears,10,,,,
,,5078-TX,signed,Ana,Pilot live
,,Austin Energy,in talks,Ben,
```
