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

**Rules:** a path in your file replaces that path's steps in every state, and public state rules do not apply to it. A path not in your file keeps the public steps. A step's `round_weeks` replaces its email-tennis cost; a step without one keeps the public cost for the same id, if there is one. Unknown paths, missing ids or names, ids reserved on every JavaScript object (`__proto__`, `constructor`, `prototype`, `toString` and the like), text fields that are not text (in JSON, an object or a list), non-numbers (durations are plain decimals: `0x10` and `Infinity` are not numbers), negative or over-260 durations, `high` below `low`, duplicate ids, unknown `depends_on` ids, cycles and bad `round_weeks` stop the load and are listed by row. A missing owner, or no `first_installs` step, gives a warning. Steps from your file are tagged **Yours**.

**Example:**

```csv
path,id,name,owner,low,high,depends_on,round_weeks,note
retail,entity,Form the company,Legal,1,3,,,
retail,license,Retail license,Regulatory,10,14,entity,3,Filed with staff
retail,edi,Market testing,Ops,6,9,license,,
retail,first_installs,First installs,Field,2,3,license;edi,,
```
