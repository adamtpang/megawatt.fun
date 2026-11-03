## Pitch {#pitch}

Page: `/pitch`. Swaps Base's public claims and this page's assumptions for your own offer terms, and marks the utilities on your own target list.

**File:** one CSV or JSON file holds either part, or both. In a CSV, a row with a `key` is an offer term and a row with a `utility` is a target; a row with both, or neither, is an error. Extra columns such as `unit`, `label` and `public_basis` are ignored. Each file you load replaces the last one, so keep terms and targets in the same file to use both. Download the templates from the page: the offer terms template lists every key with its public value and already has the target columns, and the target list template starts with the public top 5 to call in the selected state.

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
| `termYears` | your contract term | years | none |
| `memberReservePct` | share of each battery held back for the home | % | none |

**Target list** (`utility,status,owner,note`, optional `state`): `utility` is the EIA id used in the data (for example `5078-TX`), the name as listed, `Name, ST`, or a public alias such as `CoServ Electric`. `status` is free text, for example `in talks`, `signed` or `not contacted`.

**Rules:** blank term values keep the public number. Unknown keys, non-numbers, values outside each key's range (shown in the template's `min` and `max` columns) and a low end above its high end stop the load and are listed by row. Unmatched or ambiguous utility names do not stop the load: each is listed as a warning, with the closest public name when one is near. Changed numbers are tagged **Yours** on the pitch and in print, and the public claim stays shown beside them. Matched utilities show their status on the pitch and go first in "Who to call first", still in public rank order; targets in other states are listed under the table.

**Example:**

```csv
key,value,utility,status,owner,note
kwPerHome,25,,,,
tollPerKwYear,85,,,,
termYears,10,,,,
,,5078-TX,signed,Ana,Pilot live
,,Austin Energy,in talks,Ben,
```
