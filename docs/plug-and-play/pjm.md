## PJM {#pjm}

Page: `/pjm`. One battery's yearly value in each of 20 PJM utility zones. The same code answers `POST /api/v1/pjm`.

**File:** CSV with one row per zone, or JSON `{ "zones": [ { ... } ] }` with the same fields (a bare list of rows also works). Download the template from the page: it lists every zone with the public tag rule filled in. Only `zone` is required. A blank cell keeps the public number for that zone, so you can send one column for one zone.

| Field | Meaning | Unit |
| --- | --- | --- |
| `zone` | PJM zone code, any case: `COMED`, `PPL`, `PSEG`, `BGE` and so on (required) | id |
| `home_kw` | home load the battery covers in the evening and at peaks, 0 to 8 | kW |
| `peak_coverage_pct` | share of tag-setting peak hours your dispatch actually covers, 0 to 100 | % |
| `tag_rules` | what you know about how the utility sets a home's capacity and transmission tags: `interval` (the home's own meter), `profile` (a class average) or `unknown` | text |
| `energy_usd_per_year` | your own energy value per battery, 0 to 100,000. Replaces the public backtest for that zone | $ a year |
| `capacity_scale` | zonal scaling factor times forecast pool requirement, 0 to 2 | multiplier |

**Rules:** each value replaces the page-wide setting for that zone only. `tag_rules` decides whether capacity and transmission count: `interval` counts them, `profile` makes them 0, `unknown` holds them back as "not counted" unless you tick the box that counts unconfirmed zones. Transmission stays 0 in zones where it is a nonbypassable utility charge. Zones from your file are tagged **Yours** in the list and in the zone detail. Column names match in any case; a column the tool does not know is named in a warning and ignored. An unknown zone, a zone written twice, a `tag_rules` value outside the three, a non-number (plain decimals only, with a comma only as a thousands separator: `1,200` is a number, `3,5` is an error) and a value outside its range stop the load and are listed by row. A file holds at most 200 rows. The file is read in the browser and never uploaded.

**Example:**

```csv
zone,home_kw,peak_coverage_pct,tag_rules,energy_usd_per_year,capacity_scale
COMED,4,90,,,
BGE,,,interval,,
PPL,,,,520,1.05
```

**API:** send the same rows as `zones` in a JSON body next to the other options, or send the CSV as the body with `Content-Type: text/csv`.

```json
{ "tagKw": 3, "zones": [ { "zone": "COMED", "home_kw": 4, "peak_coverage_pct": 90 }, { "zone": "BGE", "tag_rules": "interval" } ] }
```
