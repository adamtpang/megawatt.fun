## Finance {#finance}

Page: `/finance`. Swaps the public cost, revenue and loan inputs for your own.

**File:** CSV with `key,value` columns, or JSON `{ "key": value }` (also accepted: `{ "inputs": { ... } }` or `[{ "key", "value" }]`). Extra columns such as `unit` and `label` are ignored. Download the template from the page: it lists every key with its public value.

| Key | Meaning | Unit |
| --- | --- | --- |
| any input key from the template | replaces that input; must be a number within the input's limits | as listed |
| `revenueCase` | `toll`, `merchant` or `stacked` | text |
| `zone` | ERCOT load zone for the arbitrage value | zone id |
| `arbPerYear` | your own arbitrage value; replaces the zone | $ per battery per year |

**Rules:** blank values keep the public number (a warning says so). Unknown keys, non-numbers and out-of-range values stop the load and are listed by row. Changed inputs are tagged **Yours**, and their notes show the public value they replaced.

**Example:**

```csv
key,value
capexPerKwh,280
tollPerKwYear,90
rate,8.5
revenueCase,toll
```
