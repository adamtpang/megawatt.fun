# Retry after restart: a command-contract fixture

Question: a worker dies after sending an action but before recording its receipt. Can it safely repeat the command?

This is a small independent test fixture a fleet engineer could review or adapt, not a Base controller or a validated product request. Base's [public telemetry article](https://inside.basepowercompany.com/building-a-telemetry-stack) describes durable edge commands and expiry. It does not imply Base lacks restart safeguards.

## Run in a minute

Python 3.10+; SQLite is in the standard library. No accounts, network or dependencies.

```sh
python -m unittest discover -s tests -p test_restart_fixture.py -v
python demo/dispatch-bench/restart_fixture.py
```

The second command overwrites `restart-results.json`. It starts fresh child processes, terminates the first at defined boundaries with `os._exit(86)`, reopens the same database files and retries the same command in a new process. Six scenarios, including the clean control, each compare a volatile baseline and a durable receipt ledger. The results include the fixture source SHA-256 and exact child exit codes. The website displays this saved report; opening it never runs workers.

## What changes between baselines

Both use the same fake, non-idempotent actuator; initial stored energy 20 kWh, reserve 7.5 kWh, 88% round-trip efficiency, a 2 kWh export instruction, expiry and a one-time-unit freshness threshold. Timing units are synthetic. There is no grid economics, load, real battery or market model in this fixture. A separate actuator SQLite file keeps the synthetic action across worker restarts. It deliberately cannot be committed atomically with the worker receipt.

The baseline keeps no receipt across process lifetimes. The durable mode claims an ID/payload digest under `BEGIN IMMEDIATE`, commits an uncertain intent before the action, and saves a completed receipt after the action. A completed ID is ignored; a changed payload under the same ID is rejected. An uncertain ID is held for reconciliation. Concurrent worker processes cannot both claim the same ID.

This models a finite export pulse. Real dispatch may be a persistent power setpoint with supersession and device-specific retry semantics; adapting the contract is mandatory before interpreting it as a hardware test.

## The important tradeoff

| Boundary | Baseline applications | Durable applications | Durable retry |
| --- | --- | --- | --- |
| Clean restart after success | 2 | 1 | Ignore completed ID |
| Before intent is saved | 1 | 1 | Apply |
| During uncommitted intent | 1 | 1 | Apply after SQLite rollback |
| Intent saved, action not sent | 1 | 0 | Reconciliation required |
| Action sent, receipt not saved | 2 | 1 | Reconciliation required |
| Receipt saved, then process exits | 2 | 1 | Ignore completed ID |

After an uncertain crash the worker cannot distinguish zero actions from one action. Pausing avoids a blind duplicate but can miss the intended 2 kWh delivery. The fixture does not solve reconciliation, infer an outcome from aggregate state of charge, or promise exactly-once physical execution. The tests retain this availability cost as an expected outcome.

## Evidence and limits

Tests cover actual process termination/reopen at every boundary, changed payload identity, expiry, future/stale reports, eight competing child processes, reserve/energy-loss accounting and invalid payload rejection. The older JavaScript fleet replay remains separate and keeps its existing regression tests.

The stored-energy and reserve limits apply to the fake actuator in both modes. Avoiding duplicate work here does not by itself prove a physical reserve safety guarantee. SQLite FULL/WAL protects the committed test ledger under these process exits; this is not a test of power loss, disk corruption, full disks, write failures, device reboot or concurrent configuration changes. There is no authentication, command supersession/cancellation, telemetry clock-skew model, durable audit retention policy or production adapter. Reconciliation currently requires an external decision and has no automatic retry.

## What would make it adoptable

A Base maintainer must first identify a useful missing regression case and approve the actual command/receipt semantics. Substitute their adapter and incident traces, then verify restart boundaries, uncertain-result reconciliation, clock limits, cancellation/supersession, disk failures and hardware behavior. That owner and input contract are not yet established. A useful contribution is an inspectable failure test, not a promise that Base will ship this code.

## 60-second demo

1. Open Restart evidence on `/bench`. These are saved local checks, not live device controls.
2. Find Action sent, receipt not saved. The baseline applies twice; durable mode applies once and reports uncertainty.
3. Find Intent saved, action not sent. Durable mode sends nothing. Explain the missed-delivery cost.
4. Download the source and run the two commands. Compare the report bytes and source hash.
