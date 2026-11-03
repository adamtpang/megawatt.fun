# Dispatch Bench

An independent, inspectable test of battery dispatch commands using public ERCOT prices and synthetic devices. Live demo: https://megawatt.fun/bench. Not affiliated with Base Power; built after the September 25–27, 2026 AITX event. No claim of entry, award, or validated customer economics.

## Restart evidence

A separate [crash/restart fixture](RESTARTS.md) now tests actual local child-process termination and SQLite receipts against a synthetic actuator. It exposes uncertain outcomes and missed delivery rather than claiming exactly-once hardware actions. Open **Restart evidence** on the website or run `python demo/dispatch-bench/restart_fixture.py`. Six cases and six regression tests; no production adapter.

## Assess it in five minutes

1. The page starts with **Everything works**. Both versions keep backup safe.
2. Click **Repeat a command**. Compare the batteries that spent backup, with and without safeguards. A retry applies the same command twice when there is spare hourly power. The guard applies a command ID only once.
3. Choose **Command arrives late** or **Connection goes quiet**. Open **Engineer details** to compare exported energy and inspect expired-command rejections. Lower delivery is visible rather than disguised as successful orchestration.
4. Change reserve to 50%. Inspect the schedule and the ending inventory. Compare cash and inventory-adjusted values together.
5. Download the trace CSV and replay JSON, or reproduce the saved experiment locally. Share links encode the six user controls.

## Reproduce

Node.js 18+; no dependencies, account, network access, or API key required:

```sh
node --test tests/bench.test.cjs tests/base.test.cjs
node scripts/replay-bench.cjs
```

The script writes `demo/dispatch-bench/results.json`, `results.csv`, and `guarded-trace.csv`. Six fixed scenarios each compare four policies. The source SHA-256 is recorded in the JSON. The source ZIP includes all files needed for these commands. The website can be served by any static HTTP server; the main repository's preview supports `/bench`.

## Inputs and decision

The existing `data/ercot-dam-houston.json` records hourly Houston Hub day-ahead prices for **2026-09-30**, downloaded that day through Megawatt's public server-side proxy of the [ERCOT dashboard feed](https://www.ercot.com/api/1/services/read/dashboards/systemWidePrices.json). This is a saved, dated source; the tool never relabels it live.

Defaults are synthetic: 100 identical 25 kWh / 5 kW batteries, 30% household reserve, 88% round-trip efficiency, and seed 42. Independent seeded exposure selects 32 of 100 devices at the default 30% probability. Exposure means the same selected devices receive the chosen faults during the 4–10 PM window. Actual affected count is shown.

For a fleet or market software engineer, the decision is whether command safeguards preserve household backup and how much scheduled delivery they sacrifice. This is an evaluation tool shape, not a claim that Base needs this exact implementation or lacks equivalent safeguards. The current [Software Engineering Intern role](https://jobs.ashbyhq.com/base-power/5353ea33-57d4-46fa-9a96-e392a3f841bc) lists fleet dispatch APIs among its possible domains. Base's [April 2025 telemetry post](https://inside.basepowercompany.com/p/building-a-telemetry-stack-for-the) describes unreliable connectivity, expiring commands, and durable edge storage, motivating the fault cases; it does not validate this simulator.

## Algorithm and command contract

`dispatch-bench-core.js` reuses `BaseCore.planDay` from `base-core.js`, the site's corrected marginal single-cycle planner. All buys precede all sells. It is not a multi-cycle, receding-horizon or stochastic optimizer.

The older planner uses charge-side storage units. This adapter supplies `physical capacity / sqrt(efficiency)` so the replay can use physical stored energy. Charge adds `grid kWh × sqrt(efficiency)`; export consumes `delivered kWh / sqrt(efficiency)`. Replay separately clamps capacity and aggregate hourly power. Healthy cycles return to the initial reserve.

The guarded command reducer checks an applied-ID set, a one-hour validity window, telemetry at most one hour old, and the local reserve. Successful applied IDs are remembered; rejected commands can still be retried within their validity window. Idempotency is in memory for this one-day replay. It does not survive restarts.

The clock baseline buys during hours starting 00:00–05:00 and sells during 17:00–22:00, subject to the same physical limits. The unguarded price plan and clock baseline deliberately omit all four command guards as diagnostic comparisons. The hold baseline does no trading. No claim is made that Base uses any of these policies.

Synthetic faults: lost acknowledgement duplicates a command once; late delivery shifts it by two hours; stale telemetry stops reports after hour starting 15:00 until 22:00. The mixed case combines all three on the same exposed devices. Forecast timing error circularly shifts the known price shape three hours later; it is not a forecasting model or a measured error distribution. Realized settlement remains the recorded day-ahead vector, so the experiment is not a real-time backtest.

## Accounting and evidence

Cash proxy = sum `(export − import) × hourly price / 1000`. Inventory mark = `(end stored − initial stored) × discharge efficiency × last-hour price / 1000`. The adjusted proxy sums both. Inventory is an arbitrary terminal mark, not a sale; inspect both columns. This avoids rewarding a policy merely for draining backup or penalizing it solely for retaining energy.

The default known-price healthy scenario yields $48.85 cash across 100 devices for the price plan, versus $41.20 for the clock. With duplicate delivery alone, 32 unguarded batteries consume reserve; the guard has zero breaches and ignores 128 retries. With multiple failures, the guard exports 1,116.3 kWh versus 1,687.0 unguarded, preserves reserve, and retains more energy. These are one-day illustrative results under the stated model, not revenue estimates.

Tests verify physical energy conservation with split losses, healthy closure at reserve, duplicate idempotency, expiry, retry after rejection, local reserve clamps, deterministic replay, and invalid input rejection. Negative-price scenarios and varied reserves/efficiencies stress accounting and guarded safety. Existing planner regression tests cover the previously forced unprofitable cycle bug.

## Honest limits and the next engineering step

There are no batteries, real network workers, durable command queues, process restarts, authentication, or utility APIs. Devices are identical; failures are constructed; a single public price day is not representative. The model excludes home loads, grid outages, tariffs, degradation, market impact, ancillary services, settlement rules, production latency distributions, and Base's private software.

The new restart fixture covers actual local process death and durable receipt handling with a synthetic actuator. It still needs a maintainer-approved command contract, a device/transport adapter and observed traces from a consenting system owner. No production adoption or real transport/hardware validation is claimed.

## 90-second demo script

- “This is a real recorded Texas price day and a simulated fleet. The question is what happens when dispatch commands go wrong.”
- “On clean transport, both price plans agree. The fixed-clock schedule is our simple baseline.”
- “Now lose an acknowledgement. A retry can spend household backup if the command isn't idempotent. Select a device and read the ledger.”
- “Turn on delays and stale telemetry. The guard preserves reserve, but misses scheduled delivery. The chart and inventory columns show that cost.”
- “Every run uses the same seed, and you can export the exact trace. This is a test bench, not a production controller or a claim about Base's customer returns.”
