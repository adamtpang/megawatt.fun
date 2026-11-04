## Finance {#finance}

Page: `/finance`. Swaps the public cost, tax credit, revenue and loan inputs for your own. The page is a generic model of one leased home battery, not any company's books.

**File:** CSV with `key,value` columns (headers in any case, so `Key,Value` works), or JSON `{ "key": value }` (also accepted: `{ "inputs": { ... } }` or `[{ "key", "value" }]`). Extra columns such as `unit` and `label` are ignored. Download the template from the page: it lists every key with its public value.

| Key | Meaning | Unit |
| --- | --- | --- |
| any input key from the template | replaces that input; must be a plain decimal number within the input's min and max (whole numbers for `lifeYears`, `tenorYears` and `fleetCount`) | as listed |
| `itcPct` | investment tax credit (IRC 48E), percent of installed cost, 0 to 70; treated as sold for cash when the battery goes into service | % |
| `itcPriceCents` | what a buyer pays per dollar of credit, 50 to 100 (public default 89.5, Crux's 2026-vintage ITC average); cash from the credit = `itcPct` x cost x this price | cents per $1 |
| `retailMarginMonthly` | retail energy margin per home, -1,000 to 1,000 (public default 22, derived: (7.7 cents energy charge on Base's Oncor battery-plan label - 3.70 cents load-weighted LZ_NORTH wholesale - 2.0 cents other supply cost, an assumption) x 1,096 kWh a month); counts only for an owner that is also the home's retail provider, so use 0 for a third-party owner | $ per month |
| `ancPerKwYear` | ancillary services (ERCOT Non-Spin, ECRS) through an ADER aggregation, net of the arbitrage it displaces; counts in `merchant` and `stacked`, not `toll` (public default 0, an assumption) | $ per kW-year |
| `revenueCase` | `toll`, `merchant` or `stacked` | text |
| `zone` | ERCOT load zone for the arbitrage value, any case (`lz_north` works) | zone id |
| `arbPerYear` | your own arbitrage value, 0 to 100,000; replaces the zone (a warning says so when you set both) | $ per battery per year |

**Who keeps the arbitrage:** in ERCOT, outflow from an unregistered battery of 1 MW or less is settled as a cut to the settlement load of the home's retail provider at the real-time load-zone price (Nodal Protocols 11.4.4.3 and 6.6.3.2). If your company is the home's retail provider, keep the zone value; if not, enter in `arbPerYear` what your contract with the provider pays, and set `retailMarginMonthly` to 0. ADER is the route to ancillary services (`ancPerKwYear`), not needed for the energy value.

**Rules:** blank values keep the public number (a warning says so). Unknown keys (including names such as `__proto__` or `constructor`), a key on two rows, non-numbers, hex such as `0x10`, and out-of-range values stop the load and are listed by row. A number too large to store, such as `1e400`, is reported as out of range, quoting what you wrote (a JSON number cannot be quoted back, so the message says the number is too large). Typing in the page's fields follows the same rules: an invalid field shows an error and the results wait until it is fixed. Changed inputs are tagged **Yours**, and their notes show the public value they replaced.

**Example:**

```csv
key,value
capexPerKwh,280
itcPct,30
tollPerKwYear,90
ratePct,8.5
revenueCase,toll
```
