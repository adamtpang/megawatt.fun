## Launch {#launch}

Page: `/launch`. Swaps the public launch steps for your own steps, durations and email-tennis costs.

**File:** CSV with one row per step, or JSON `{ "paths": { "retail": { "steps": [ ... ] } }, "tennis": [ ... ] }` (a partial copy of `/data/launch-steps.json`). Download the template from the page: it lists the selected path's steps for the selected state, with each step's round cost.

| Column | Meaning | Unit |
| --- | --- | --- |
| `path` | `retail` or `utility` | text |
| `id` | step id, unique within the path; letters, digits, `_`, `.`, `-` | text |
| `name` | step name shown on the page | text |
| `owner` | who does it (optional) | text |
| `low` | fast case, 0 to 260 | weeks |
| `high` | slow case, at least `low`, at most 260 | weeks |
| `depends_on` | step ids this step waits for, separated by `;` | ids |
| `round_weeks` | cost of one extra back-and-forth round for this step (optional) | weeks |
| `note` | anything you want shown under the step (optional) | text |

In JSON, `depends_on` is a list, and `tennis` entries are `{ "step", "round_weeks", "with", "bounce", "fix" }`.

**Rules:** a path in your file replaces that path's steps in every state, and public state rules do not apply to it. A path not in your file keeps the public steps. A step's `round_weeks` replaces its email-tennis cost; a step without one keeps the public cost for the same id, if there is one. Unknown paths, missing ids or names, ids reserved on every JavaScript object (`__proto__`, `constructor`, `prototype`, `toString` and the like), text fields that are not text (in JSON, an object or a list), non-numbers (durations are plain decimals: `0x10` and `Infinity` are not numbers), negative or over-260 durations, `high` below `low`, duplicate ids, unknown `depends_on` ids, cycles and bad `round_weeks` stop the load and are listed by row. Column names match without regard to case, surrounding spaces, or spaces and hyphens for underscores (`Depends On` works); an unknown column is ignored with a warning. A missing owner, no `first_installs` step, a plan where every step is 0 weeks, or a 0-week step whose name or note does not say "milestone" gives a warning. The public `license_filed` step is a 0-week milestone: in Texas, market testing starts there, alongside the license review. Steps from your file are tagged **Yours**.

**Example:**

```csv
path,id,name,owner,low,high,depends_on,round_weeks,note
retail,entity,Form the company,Legal,1,3,,,
retail,license,Retail license,Regulatory,10,14,entity,3,Filed with staff
retail,edi,Market testing,Ops,6,9,license,,
retail,first_installs,First installs,Field,2,3,license;edi,,
```

### ZIP lookup {#zip}

The same page looks up one US ZIP: wires utility, permit office (city or county), interconnection path, and days to a first install. `POST /api/v1/zip` with `{ "zip": "78704" }` runs the same lookup. There is no company file for it. The public file is `data/zip-launch.json`.

A figure that is not in the source files is the word unknown. The day total is `permit_review_days + interconnection_days + crew_days`, and only when each input is a calendar-day number. Coverage is Texas first (Austin, Houston, Dallas, San Antonio), plus Illinois, Georgia, and Connecticut. Oncor, CenterPoint, AEP Texas, and TNMP are not in the OpenEI ZIP file, so in Texas the wires companies inside retail choice come from Power to Choose, the PUCT plan site, ZIP by ZIP. A ZIP split between one of them and a city utility or co-op lists both. The ZIP is text: `"06103"`, not the number `6103`.
