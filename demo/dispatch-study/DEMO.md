# 90-second demo script

**0:00 — Problem.** "Megawatt originally optimized one supplied price day and called the result a revenue floor. That was unjustified. I wanted to see what survives when the schedule is committed before actual prices arrive."

**0:15 — Run.** From the repository root:

```sh
go test ./...
go run ./cmd/dispatch-study
```

**0:30 — Result.** "These are synthetic stress scenarios. At 88% efficiency and 5 kWh reserve, strong price error takes the forecast strategy to $0.145 mean settlement per day and 38 losing days out of 120. The simple clock baseline earns $0.097, while the non-deployable hindsight reference earns $3.380. The hindsight gap isn't guaranteed recoverable value."

**0:50 — Mechanism.** Open `results/trace.csv`, filter `day=1`, `strategy=forecast`: the planned scarcity peak is delayed in the realization. Point to forecast and actual prices, discharge timing, cash and SOC. Show the `hindsight` rows to explain why future knowledge changes scheduling.

**1:05 — Correctness.** Open `dispatch/replay_test.go`: the hand-calculated losing-trade test settles at actual prices, the regression catches a partial-cycle bug, and the exhaustive oracle checks small independent optima. Replay enforces reserve/capacity/power and ends with the same inventory it started with.

**1:20 — Relevance and limit.** "Base balances grid support with household backup. This is a small evaluator a Markets engineer could inspect, not Base's controller. It has no load, outages, subhourly controls, degradation, or validated market economics. The next gate is timestamped public data with forecasts available before execution."

Full context and results: [README](README.md). All work remains local and was produced with coding-agent assistance; rehearse the implementation until you can explain each claim yourself.
