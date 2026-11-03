## Finance {#finance}

Page: `/finance`. Swaps the public cost, tax credit, revenue and loan inputs for your own. The page is a generic model of one leased home battery, not any company's books.

**File:** CSV with `key,value` columns, or JSON `{ "key": value }` (also accepted: `{ "inputs": { ... } }` or `[{ "key", "value" }]`). Extra columns such as `unit` and `label` are ignored. Download the template from the page: it lists every key with its public value.

| Key | Meaning | Unit |
| --- | --- | --- |
| any input key from the template | replaces that input; must be a plain decimal number within the input's min and max (whole numbers for `lifeYears`, `tenorYears` and `fleetCount`) | as listed |
| `itcPct` | investment tax credit (IRC 48E), percent of installed cost, 0 to 70; treated as sold for cash at face value when the battery goes into service | % |
| `revenueCase` | `toll`, `merchant` or `stacked` | text |
| `zone` | ERCOT load zone for the arbitrage value | zone id |
| `arbPerYear` | your own arbitrage value; replaces the zone | $ per battery per year |

**Rules:** blank values keep the public number (a warning says so). Unknown keys (including names such as `__proto__` or `constructor`), non-numbers, hex such as `0x10`, and out-of-range values stop the load and are listed by row. Typing in the page's fields follows the same rules: an invalid field shows an error and the results wait until it is fixed. Changed inputs are tagged **Yours**, and their notes show the public value they replaced.

**Example:**

```csv
key,value
capexPerKwh,280
itcPct,30
tollPerKwYear,90
ratePct,8.5
revenueCase,toll
```
