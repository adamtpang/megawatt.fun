## Supply {#supply}

Page: `/supply`. Loads your own bill of materials and shows which parts will run short. The public research stays on the page below your card.

**File:** CSV with one row per part, or JSON `{ "parts": [ { ... } ] }` with the same fields (a bare array of parts also works). Download the template from the page: it has one fictional example row per category.

| Field | Meaning | Unit |
| --- | --- | --- |
| `part` | part name (required) | text |
| `category` | `power_electronics`, `bms_memory`, `cells`, `cellular`, `grid_equipment`, `labor`, `metals` or `other` (required) | id |
| `supplier` | who you buy it from | text |
| `country` | where it ships from | text |
| `lead_time_weeks` | weeks from order to delivery, 0 to 520 (required) | weeks |
| `on_hand_weeks` | inventory plus open orders, in weeks of production, 0 to 520 | weeks |
| `second_source` | `yes` or `no` | text |
| `tariff_pct` | US tariff on this part, 0 to 500 | % |
| `unit_cost_usd` | cost of one unit, 0 to 1,000,000 | $ |
| `qty_per_unit` | how many go into one battery, 0 to 10,000 | count |
| `note` | anything else | text |

**Rules:** gap = `lead_time_weeks` minus `on_hand_weeks` (a blank cover counts as 0). Rows are sorted by gap, biggest first. Flags: **Will run short** when the gap is above 0, **Single source** when `second_source` is `no`, **Tariff 25%+** when `tariff_pct` is 25 or more. Tariff cost per battery adds `unit_cost_usd * qty_per_unit * tariff_pct / 100` over the rows that have all three. Column names match without regard to case or surrounding spaces, so `Lead_Time_Weeks` works; a column the tool does not know is named in a warning and ignored. Missing required fields, unknown categories, text fields that are not text (in JSON, an object or a list; a number such as a part number is read as text), non-numbers (plain decimals only, after dropping `$`, `,` and `%`; `0x10` and `Infinity` are not numbers), negative numbers and values over the limits in the table stop the load and are listed by row. Duplicate part names load with a warning. Each row links to the public research card for its category.

**Example:**

```csv
part,category,supplier,country,lead_time_weeks,on_hand_weeks,second_source,tariff_pct,unit_cost_usd,qty_per_unit,note
Inverter module,power_electronics,Example Supplier A,Germany,30,12,no,25,900,1,
LFP cell,cells,Example Supplier C,China,16,8,yes,55,40,12,
```
