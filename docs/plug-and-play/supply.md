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

**Rules:** gap = `lead_time_weeks` minus `on_hand_weeks` (a blank cover counts as 0). Rows are sorted by gap, biggest first. Flags: **Will run short** when the gap is above 0, **Single source** when `second_source` is `no`, **Tariff 25%+** when `tariff_pct` is 25 or more. Tariff cost per battery adds `unit_cost_usd * qty_per_unit * tariff_pct / 100` over the rows that have all three. Column names match without regard to case or surrounding spaces, so `Lead_Time_Weeks` works; a column the tool does not know is named in a warning and ignored. A column written twice (the same name, or `Lead_Time_Weeks` and `Lead time weeks`) stops the load. A BOM checker file (`part_number`, `description`, `qty`, `lead_time_days`) stops the load with a message that points to the BOM CSV checker below. A gap that is above 0 but under 0.1 weeks (0.05 included) reads "under 0.1 wk", never "0 wk" or a rounded-up "0.1 wk". When no row has a tariff cost, the summary names only the columns that are missing. Missing required fields, unknown categories, text fields that are not text (in JSON, an object or a list; a number such as a part number is read as text), non-numbers (plain decimals only, after dropping `$`, `,` and `%`; `0x10` and `Infinity` are not numbers), negative numbers and values over the limits in the table stop the load and are listed by row. Duplicate part names load with a warning. Each row links to the public research card for its category.

**Example:**

```csv
part,category,supplier,country,lead_time_weeks,on_hand_weeks,second_source,tariff_pct,unit_cost_usd,qty_per_unit,note
Inverter module,power_electronics,Example Supplier A,Germany,30,12,no,25,900,1,
LFP cell,cells,Example Supplier C,China,16,8,yes,55,40,12,
```

### BOM CSV checker {#bom-checker}

A second checker on the same page, above the research. It reads a CSV in the browser and does not upload it. It is not the file above, and it is not `POST /api/v1/supply`: this one takes `part_number, description, qty, supplier` with times in days, the file above takes `part, category, lead_time_weeks` with times in weeks. The page says so beside the checker, and a file in the panel's format gets a message pointing to "Use your own data" at the top of the page. Missing required columns are listed in one message, a column written twice is an error, and an unknown column is ignored with a warning. The flagged-rows download puts an apostrophe in front of any text cell that starts with `=`, `+`, `-` or `@`, so a spreadsheet never runs it as a formula (every CSV the site writes does the same).

| Column | Meaning | Required |
| --- | --- | --- |
| `part_number` | part id | yes |
| `description` | what it is | yes |
| `qty` | how many, greater than 0, at most 10,000 | yes |
| `supplier` | who you buy it from | yes |
| `alt_suppliers` | other suppliers, separated by `;` (or `|`, or commas if there is no semicolon) | no |
| `alt_qualified` | `yes` if a listed alternate is qualified to ship, otherwise `no` | no |
| `lead_time_days` | days from order to delivery, 0 to 3,650 | no |
| `on_hand_days` | days of stock on hand, 0 to 3,650 (blank counts as 0, with a warning) | no |
| `unit_cost_usd` | price per unit, 0 to 1,000,000, used only to break ties | no |

Block score is `max(0, lead_time_days - on_hand_days) * (2 if single source, else 1)`, with ties broken by spend (`qty * unit_cost_usd`). The gap is how many days a reorder placed today would leave the build short. Single source means no qualified second source: listed alternates count only when `alt_qualified` is `yes`, and a row with unqualified alternates is flagged "Alternate listed, not qualified". Quantity does not raise the score, because one missing part stops the build whether you need 1 or 12. A missing lead time leaves the score unknown. Numbers are plain decimals (`$` and thousands commas are dropped first); `0x10`, `Infinity` and values over the limits in the table are row errors. Rows are not merged. The sample on the page is demo data with made-up suppliers. Download gives the flagged rows only.
