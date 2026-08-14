# megawatt.fun

An energy tooling suite, built in public. Live at
[megawatt.fun](https://megawatt.fun).

**Tool 001: fleet dispatch.** A day-ahead arbitrage dispatch planner for a
fleet of home batteries, run against real ERCOT day-ahead settlement
prices. Written in Go; the demo page (`index.html`) bakes in a real
captured price day.

Built by a candidate as a working point-of-view artifact for
[Base Power](https://www.basepowercompany.com). Not affiliated with, endorsed
by, or built from any non-public information about Base Power Company.

## What it does

Given one day of ERCOT day-ahead hourly prices and a battery's physical
envelope (capacity, power, round-trip efficiency), it plans the most
profitable single charge-then-discharge cycle, refuses to cycle when the
spread does not clear round-trip losses, and prices the result per battery
and per fleet.

Run on the vendored real price day (ERCOT hub average, day-ahead, captured
2026-08-13 from ERCOT's public system-wide prices endpoint):

```
$ go run . -batteries 30000

Day plan, one battery (25 kWh / 5 kW / 88% round-trip):

  interval action          kWh        $/MWh
  09:00    charge          5.0        12.83
  10:00    charge          5.0        11.02
  11:00    charge          5.0        12.43
  12:00    charge          5.0        14.78
  13:00    charge          5.0        17.43
  20:00    discharge       5.0        35.65
  21:00    discharge       5.0        36.66
  22:00    discharge       5.0        38.46
  23:00    discharge       5.0        32.81
  24:00    discharge       2.0        27.32

  charged 25.0 kWh for $0.34, discharged 22.0 kWh for $0.77
  net per battery: $0.43/day
  fleet of 30000: $12902.70/day, ~$4709486/year at this day's spread
```

It finds the shape a grid operator would expect without being told it: charge
through the midday solar trough, discharge into the evening peak.

## Run it

```
go test ./...        # 14 tests: dispatch logic, capex breakeven, ERCOT payload parsing
go run .             # vendored real day, default battery assumptions
go run . -live       # fetch today's real prices (US IPs only, see below)
go run . -kwh 39.2 -kw 5 -eff 0.9 -batteries 30000
go run . -capex-per-kwh 875 -capex-life-years 15   # see capex breakeven below
```

Battery defaults (25 kWh / 5 kW / 88%) are labeled assumptions, not Base
specs. Base's published Base Core units are 39.2 and 78.4 kWh
(Electrek, 2026-08-03); pass `-kwh` to match.

## The model, honestly

One daily cycle, energy-only arbitrage, perfect price foresight. Each of
those is a simplification, and together they make this a floor on battery
value, not an estimate of it:

- **No ancillary services.** Reserve and response products are a large part
  of real fleet economics (Base has publicly maxed the 20 MW ERCOT ADER
  pilot cap, per Canary Media, 2025-10-09). This model prices none of it.
- **Perfect foresight.** Day-ahead prices are known here; real-time dispatch
  against 15-minute settlement is a forecasting problem this model skips.
- **One cycle per day.** Volatile days reward intra-day recycling that a
  single-window plan leaves on the table.
- **No degradation cost, no retail-plan interaction, no resilience value.**

The interesting conclusion is the number itself: on a mild day the
energy-only floor is under half a dollar per battery. The value of a
battery fleet is mostly in the machine around the arbitrage: markets
participation, telemetry, and operations software.

## Capex breakeven

`dispatch.CapexModel` (`dispatch/capex.go`) answers a narrower question than
"is this battery valuable": does one day's energy-only cycle even cover the
hardware cost sitting behind it? It amortizes `$/kWh` capacity cost over a
calendar life, not a cycle-count life, since at one cycle/day an LFP
battery's 6,000-10,000+ cycle rating outlasts any realistic install
lifetime, years, not cycles, is the binding constraint.

Three presets ship in `dispatch/capex.go`:

| Preset | $/kWh | Basis |
|---|---|---|
| `CapexManufacturerLow` | $150 | LFP cells ~$60-80/kWh, ~2x for pack/electronics/install at OEM scale |
| `CapexManufacturerHigh` | $300 | same basis, upper end |
| `CapexRetailInstalled` | $875 | third-party solar-installer benchmark, $800-950/kWh installed |

Run it (`-capex-per-kwh` defaults to the manufacturer-low preset):

```
go run . -batteries 30000

  ...
  net per battery: $0.43/day

  capex breakeven: $150/kWh over 15 years -> $0.68 amortized per cycle-day
  this cycle does NOT clear its own hardware cost: $0.25 short/day
```

Even at the cheapest plausible capex, one energy-only cycle doesn't cover
its own amortized hardware cost, before the retail-installed case ($4.00
amortized/cycle) or fleet-level financing, O&M, or return requirements.
This isn't a bug in the plan, it's the same conclusion the section above
already draws from a different angle: energy-only arbitrage is a floor,
not the investment thesis. Whatever carries the actual capex (ancillary
services, retail hedge, resilience) has to show up as a separate revenue
line, not inside this number.

## Data source

`https://www.ercot.com/api/1/services/read/dashboards/systemWidePrices.json`,
ERCOT's public, keyless system-wide prices feed (the same one their public
dashboard reads). Caveat found by testing: ercot.com geo-blocks many non-US
IPs with a 403, so `-live` works from US networks; the vendored CSV in
`data/` is a real captured day for everyone else.
