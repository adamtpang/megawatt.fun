## Market {#market}

Page: `/market`. Adds your own per-state metrics to the expansion score, or swaps the public Texas zone values for your own. One file holds one kind; the page tells them apart by their columns.

**State metrics file:** CSV with a `state` column (two-letter code such as `TX`, or the full name such as `Texas`) plus any number of number columns, one per metric. A header ending in ` (lower is better)` ranks low values best; every other column ranks high values best. JSON: `{ "factors": [{ "key", "label", "higherIsBetter" }], "states": { "TX": { "key": value } } }`; `factors` is optional and sets labels and direction. Download the template from the page: it lists all 51 states with two example columns left blank.

| Column | Meaning | Unit |
| --- | --- | --- |
| `state` | state code or full name, once per state | text |
| any other column | one of your metrics, such as `install_cost_usd (lower is better)`, `cac (lower is better)`, `permit_days (lower is better)`, `pipeline_homes` | your own |

Each metric becomes a factor in the score, ranked as a percentile across the states that have a value, the same way as the public factors. It gets its own weight slider (default 1) under **Yours** in Score weights, and it can color the map.

**Texas zone values file:** CSV with `zone,usd_per_year`, or JSON `{ "zones": [{ "zone", "usd_per_year" }] }` (also accepted: `{ "zones": { "LZ_NORTH": 150 } }`). Zone ids must match the public list (`LZ_NORTH`, `HB_HOUSTON` and so on). Your numbers replace the public ones in "Where one battery earns most (Texas)" and are tagged **Yours**. The template lists every zone with its public value.

**Rules:** a blank cell means no value. For a metric, that state is scored on the other factors, the same as missing public data, and a warning lists the states. For a zone, the public value stays. Unknown states or zones, a state or zone listed twice, non-numbers (named by row and column), negative zone values, and a file with no number columns stop the load and are listed by row. "Back to public data" removes your file.

**Example:**

```csv
state,install_cost_usd (lower is better),permit_days (lower is better),pipeline_homes
TX,11500,9,4200
FL,13200,21,800
Georgia,12800,14,350
```
