## Finance {#finance}

Page: `/finance`. Swaps the public cost, tax credit, revenue and loan inputs for your own. The page is a generic model of one leased home battery, not any company's books. The generic defaults come from public studies and labeled assumptions (installed cost from NREL's cost benchmark, retail and delivery prices from EIA-861, ERCOT prices); one company's published figures are an optional preset, labeled as that company's public claims, not its economics.

**File:** CSV with `key,value` columns (headers in any case, so `Key,Value` works), or JSON `{ "key": value }` (also accepted: `{ "inputs": { ... } }` or `[{ "key", "value" }]`). Keys match in any case (`ratepct` is `ratePct`), and so do text values (`TOLL` is `toll`, `lz_north` is `LZ_NORTH`). The template's other columns (`unit`, `label`, `public_basis`) are ignored; any other column is ignored with a warning that names it. Download the template from the page: it lists every key with its public value.

| Key | Meaning | Unit |
| --- | --- | --- |
| any input key from the template | replaces that input; must be a plain decimal number within the input's min and max (whole numbers for `lifeYears`, `tenorYears` and `fleetCount`) | as listed |
| `preset` | `base_published` loads Base Power's published figures (installed cost basis, $695 up front, $19 a month, 96% availability, a retail margin derived from its price label) before the rest of your file; they are Base's public claims, not its economics. Leave blank for the generic defaults | text |
| `capexPerKwh` | installed cost basis (public default 1,290: NREL Q1 2023 benchmark, ($4.70 - $2.68)/W x 8 kW / 12.5 kWh, likely high for a 39.2 kWh battery) | $ per kWh |
| `upfront`, `memberFeeMonthly` | what the member pays (public defaults 0 and 35, assumptions; one published Texas lease is two batteries for $35 a month with $0 installation) | $, $ per month |
| `itcPct` | investment tax credit (IRC 48E), percent of installed cost, 0 to 70; treated as sold for cash when the battery goes into service | % |
| `itcPriceCents` | what a buyer pays per dollar of credit, 50 to 100 (public default 89.5, Crux's 2026-vintage ITC average); cash from the credit = `itcPct` x cost x this price | cents per $1 |
| `retailMarginMonthly` | retail energy margin per home, -1,000 to 1,000 (public default 63, derived: (16.66 cents billed by Texas retail providers - 5.21 cents delivery - 3.70 cents load-weighted LZ_NORTH wholesale - 2.0 cents other supply cost, an assumption) x 1,097 kWh a month, EIA-861 2024); a gross margin, counts only for an owner that is also the home's retail provider and only where retail choice exists, so use 0 for a third-party owner | $ per month |
| `ancPerKwYear` | ancillary services (ERCOT Non-Spin, ECRS) through an ADER aggregation, net of the arbitrage it displaces; counts in `merchant` and `stacked`, not `toll` (public default 0, an assumption; ERCOT reported ECRS fully subscribed in September 2026) | $ per kW-year |
| `discountPct` | discount rate for the two NPVs (public default 10, a placeholder) | % per year |
| `revenueCase` | `toll`, `merchant` or `stacked` | text |
| `zone` | ERCOT load zone for the arbitrage value, any case (`lz_north` works). `LZ_AEN`, `LZ_CPS`, `LZ_LCRA` and `LZ_RAYBN` have no retail choice: the retail margin and merchant arbitrage do not count there | zone id |
| `arbPerYear` | your own arbitrage value, 0 to 100,000; replaces the zone (a warning says so when you set both) | $ per battery per year |

**Does it pay:** the page and the API show the unlevered IRR, NPV at `discountPct` and payback year (pay the net cost in year 0, get CFADS each year of life), and the same for the equity after loan payments. When the cash never covers the net cost, they say so plainly and list what is left out: price spikes outside the fixed 7 to 9 PM window, ancillary services, depreciation, the battery's value after its life, fee escalators and a toll.

**Who keeps the arbitrage:** in ERCOT, outflow from an unregistered battery of 1 MW or less is settled as a cut to the settlement load of the home's retail provider at the real-time load-zone price (Nodal Protocols 11.4.4.3 and 6.6.3.2). If your company is the home's retail provider, keep the zone value; if not, enter in `arbPerYear` what your contract with the provider pays, and set `retailMarginMonthly` to 0. In a city-utility or co-op zone (ERCOT's Non-Opt-In Entity load zones; PURA 40.051 and 41.051) there is no retail provider to keep it: the value goes to the utility, so use the `toll` case for a utility partnership. The arbitrage value is derived from public prices with assumptions (a fixed clock, 88% round trip, 20% reserve), not a published number. ADER is the route to ancillary services (`ancPerKwYear`), not needed for the energy value.

**Rules:** blank values keep the public number (a warning says so). A comma is allowed only as a thousands separator (`1,200`); `3,5` or `$2,80%` is a row error that says to use a dot for decimals, never 35 or 280. Unknown keys (including names such as `__proto__` or `constructor`; the message names the closest key, such as "Did you mean ratePct?"), a key on two rows, a column written twice (reported once), a file without the `key,value` header row (the message shows the first line it found), a binary file such as an `.xlsx` (save it as CSV), non-numbers, hex such as `0x10`, and out-of-range values stop the load and are listed by row. A number too large to store, such as `1e400`, is reported as out of range, quoting what you wrote (a JSON number cannot be quoted back, so the message says the number is too large). Typing in the page's fields follows the same rules: an invalid field shows an error and the results wait until it is fixed. Changed inputs are tagged **Yours**, and their notes show the value they replaced; preset values are tagged **Company claim**. `kw` must be at least 0.1, because the 100 MW column divides by it. Loading a file keeps the zone you picked, unless the file sets `zone`; "Back to public data" returns to the public default zone, `LZ_NORTH`, so the page and `POST /api/v1/finance` agree on the same file.

**Example:**

```csv
key,value
capexPerKwh,900
itcPct,30
tollPerKwYear,90
ratePct,8.5
revenueCase,toll
```
