# Gap analysis: megawatt.fun's twin vs Airsup

One sentence: Airsup sells digital twins and publishes working simulations with a written model basis, so it is a real yardstick for simulation quality, and this measures `/twin` against it.

## The benchmark

- What: Airsup (Air Supply Technologies, Inc.), its public simulations at airsup.ai/factory, its published model basis, and its data center twin order page.
- Why this yardstick: Adam built starfab against the same benchmark, so the method is already proven once. Airsup's public simulations can be opened and inspected.
- Different subject, same method: Airsup's data center product is about construction fit-out. megawatt's twin is about power: prices, grid demand, a battery and a bill. The comparison is on how the simulation is built and shown, not on the subject.
- Source: airsup.ai pages and the starfab gap analysis, read 14 and 15 Nov 2026.
- Limit: only Airsup's public pages were inspected. Rows that rest on Airsup's own claims say so.

## The dimensions

| Dimension | What Airsup has or does | megawatt.fun today | Grade | Closes when |
|---|---|---|---|---|
| Engine determinism and tests | Fixed time steps and a test script for interlocks, buffers and replay (model basis) | `twin-core.js` steps through 8,760 real hours with no randomness. 13 tests: hand-traced fixtures, energy and money conservation, the reserve floor, and a match to the site's older backtest to the cent in every zone | 🟢 | Already matched. Stays green while every engine change ships with a test |
| Real inputs | Durations and rates are assumed and labelled as such (model basis) | Every hour's price and grid demand is ERCOT's own published figure. The wires rate is Oncor's filed tariff. Nothing in the year is invented | 🟢 | Already ahead on what is public |
| Assumption honesty | A model basis panel that separates sourced limits from assumed numbers and lists what is out of scope | A model basis table (T1 to T13) on the page, a "not included" list, and sources. Peak hours come from hourly data while ERCOT's official method uses 15-minute intervals, and the page says so | 🟢 | Already matched |
| No hindsight in the rules | Not applicable to a factory line | The watching battery policy and the peak-chasing data center rule are tested to act only on past hours. The hindsight policy is labelled as a ceiling, not a strategy | 🟢 | Stays green |
| What-if and ramp testing | Speed multipliers, pauses, holds. Site claims "speed your line up and see where it breaks" | Levers for battery size, power, reserve, policy, site size, run rate, battery hours and rule. A ramp test sweeps battery length and marks where all four peaks hold (4 hours). An outage test cuts the power on a chosen day | 🟢 | Already matched |
| Replay truth | Tracked units whose positions follow the model, checked by a test | The day replay draws the engine's own hourly record: price, state, charge level, cash. Tests check that days and months add up to the year | 🟢 | Already matched |
| 3D visual fidelity | Distinct machines for 27 workcells, workers, vehicles, a campus, three camera modes | The home has one 3D house that lights with the battery state. The data center has charts only, no 3D site | 🔴 | A 3D data center site (halls, battery yard, substation, the line to the grid) that shows the engine's state hour by hour |
| Scenario breadth | At least six public simulations | Two subjects (a home battery, a data center) across eight ERCOT load zones | 🟡 | A third subject with a different shape, for example a battery owner's fleet of homes, or a second grid such as PJM |
| Built from a customer's real data | Site says the twin is built from the customer's drawings and data (company claim, not seen) | A visitor can change levers but cannot load their own load shape, tariff or battery | 🔴 | A visitor loads a file of their own hourly load and gets their own bill and battery result, with problems reported in plain words |
| Asking the twin questions | "Supi" answers from the twin (company claim, not seen) | None | 🔴 | A question box that runs the engine and reports the run, and says "not understood" otherwise |
| Shipped to real users | Public since September 2026, one named customer | On a branch with an open pull request. Not on megawatt.fun yet | 🔴 | Merged, live, and opened by one person outside this session |
| An offer | Listed prices: $17,000 to $30,000 setup, optional $57,000 to $120,000 a year | No offer, no call to action, no founder page | 🔴 | A founder page with a booking link, and one line on each tool page saying what Adam will build for a visitor |

**Distance: 6/12 dimensions green** (first run, 2026-11-15).

Verification notes (2026-11-15): megawatt side: `node --test tests/*.test.cjs` gives 451 passing, 13 of them in `tests/twin.test.cjs`; `python -m pytest -q` gives 49 passing. The page was loaded in a browser at 390 px and 1280 px with no console errors and no sideways scroll. Airsup side: its pages were read on 14 Nov 2026; its paid workspace and agent were not seen.

## What the twin found

These are results of the simulation on the real year (1 Oct 2025 to 1 Oct 2026), not forecasts.

- A home battery on a fixed clock in West Texas earned $493.72 in the year. With perfect hindsight the same battery would have earned about $749. A simple rule that watches the last week of prices earned about $260, less than the clock.
- A 100 MW data center at 90% with a 90 MW battery: a 1-hour battery loses money, a 2-hour battery saves about $2.7M a year, and a 4-hour battery is the first that keeps the site off the grid in all four peak hours, saving about $6.4M.
- A rule that fires at a fixed grid demand level drains the battery before the real peak arrives and loses money. Chasing the month's running high works.

## Next dimension to close

Shipped to real users. It needs no more building: the pull request has to be merged and opened by one person outside this session. After that, the offer (a founder page) is the cheapest red, and the 3D data center site is the most visible one.
