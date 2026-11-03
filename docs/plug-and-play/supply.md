## Supply {#supply}

Page: `/supply`. Loads your own bill of materials and shows which parts will run short. The public research stays on the page below your card.

**File:** CSV with one row per part, or JSON `{ "parts": [ { ... } ] }` with the same fields (a bare array of parts also works). Download the template from the page: it has one fictional example row per category.

| Field | Meaning | Unit |
| --- | --- | --- |
| `part` | part name (required) | text |
| `category` | `power_electronics`, `bms_memory`, `cells`, `cellular`, `grid_equipment`, `labor`, `metals` or `other` (required) | id |
| `supplier` | who you buy it from | text |
| `country` | where it ships from | text |
| `lead_time_weeks` | weeks from order to delivery (required) | weeks |
| `on_hand_weeks` | inventory plus open orders, in weeks of production | weeks |
| `second_source` | `yes` or `no` | text |
| `tariff_pct` | US tariff on this part, 0 to 500 | % |
| `unit_cost_usd` | cost of one unit | $ |
| `qty_per_unit` | how many go into one battery | count |
| `note` | anything else | text |

**Rules:** gap = `lead_time_weeks` minus `on_hand_weeks` (a blank cover counts as 0). Rows are sorted by gap, biggest first. Flags: **Will run short** when the gap is above 0, **Single source** when `second_source` is `no`, **Tariff 25%+** when `tariff_pct` is 25 or more. Tariff cost per battery adds `unit_cost_usd * qty_per_unit * tariff_pct / 100` over the rows that have all three. Missing required fields, unknown categories, non-numbers, negative numbers and tariffs over 500% stop the load and are listed by row. Duplicate part names load with a warning. Each row links to the public research card for its category.

**Example:**

```csv
part,category,supplier,country,lead_time_weeks,on_hand_weeks,second_source,tariff_pct,unit_cost_usd,qty_per_unit,note
Inverter module,power_electronics,Example Supplier A,Germany,30,12,no,25,900,1,
LFP cell,cells,Example Supplier C,China,16,8,yes,55,40,12,
```
