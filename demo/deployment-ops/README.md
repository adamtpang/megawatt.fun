# From battery to backup

A local operations simulation at **`/ops`**, inspired by Base's public deployment work and Airsup's spatial simulations. It is a capacity experiment, not Base's internal software or a validated forecast.

## Try it

1. Open `/ops`. Six installation crews are the baseline constraint.
2. Click **Add 3 crews**. Forecast output rises and the constraint moves to commissioning.
3. Move **Commissioning resources** from 2 to 3. More completed jobs reach the fleet.
4. Try **Longer visits** or shrink a queue. Select a stage to inspect its workload; open **Assumptions & sources** for all parameters.

The process is site review → battery prep → delivery → installation → commissioning → fleet enrollment. It starts with already eligible jobs; it does not manufacture eligibility, route trucks or reproduce Base's facilities. Houses and parked trucks are illustrations. Queue blocks and moving job markers follow model state, with a maximum of 12 visible queue blocks per stage; numeric counts show the full queue. Resource figures represent capacity, not actual tracked staff.

## Computed results

Thirty 8-hour production shifts after warm-up, seed 11:

| Scenario | Homes / shift | Constraint |
|---|---:|---|
| 6 install crews; 2 commissioning resources | 15.60 | Installation |
| 9 install crews; 2 commissioning resources | 21.30 | Commissioning |
| 9 install crews; 3 commissioning resources | 23.27 | Installation |
| 6 crews; installation takes 4.5 hours | 10.40 | Installation |

These are synthetic scenario outputs. They are not estimates of Base's actual performance. A single seed is a reproducibility fixture, not an uncertainty interval. More capacity costs money; no cost or return-on-investment conclusion follows from this model.

## Method and assumptions

The MIT [Airsup factory-skill](https://github.com/AirsupHQ/factory-skill) discrete-event engine is pinned in `vendor/airsup`; its licenses and provenance are included. Megawatt supplies the original operating specification, neighborhood diorama, UI, tests and camera tour. Throughput counts actual simulated completions. Finite queues block upstream resources; resource interruptions pause unfinished work, then resume it. Adding or removing capacity does not create or destroy jobs. Lowering a queue cap preserves existing jobs while the excess drains. Changing cycle time applies to future jobs; active jobs finish with their original duration.

Every operating input is **unsourced and synthetic**: stage times 0.5 / 0.75 / 1 / 3 / 0.75 / 0.25 hours; resources 3 / 4 / 5 / 6 / 2 / 2; one job per resource; 12-job input queues; 10% lognormal duration variability; installation interruptions averaging 40 busy hours apart with 1-hour exponential recovery; 100% yield, no rework; an 8-hour shift beginning at 08:00; target 24 homes/shift; seed 11. Raw material and jobs are replenished in capacity mode. No shortage, transport-network or member-scheduling model is implied.

Live runs begin after two warm-up shifts. Forecast runs warm up for 2.5× the processing path (at least half a shift), then measure 30 shifts. Megawatt computes utilization and the bottleneck from cumulative counters across that entire horizon, avoiding the upstream live-window retention limit. Live bars show recent utilization; the red outline shows the forecast constraint. Shifts measure production time, excluding off-shift/calendar delays. The bottleneck is highest busy + interrupted resource-time share, a screening heuristic rather than an optimizer.

No real customer/crew records, permits, tariffs, actual labor or material costs, dispatch telemetry, ancillary commitments, earnings or outage outcomes are present. Existing ERCOT evidence remains separately available at `/deploy`; synthetic staffing results are not multiplied into purported Base revenue.

## Sources, checked October 19, 2026

- [Base: self-scheduling](https://inside.basepowercompany.com/self-scheduling) documents crew supply, materials, geography and scheduling constraints, and Base's existing solution. It motivates the question; it does not supply this simulation's coefficients.
- [Base utility partnerships](https://www.basepowercompany.com/utilities) describes deployment and fleet operations.
- [Airsup warehouse-ops](https://www.airsup.ai/lab/warehouse-ops) is the visual/interaction target. The exact warehouse source was not found in public trees. Related public repositories: [factory-skill](https://github.com/AirsupHQ/factory-skill), [machine-skill](https://github.com/AirsupHQ/machine-skill), [airsup-lab](https://github.com/AirsupHQ/airsup-lab).

See `FEATURE-PARITY.md` for the observed/missing capability map. This is the first local slice, not full warehouse feature parity.

## Reproduce

```sh
node --test tests/ops.test.cjs
node scripts/replay-ops.cjs
python scripts/serve.py
```

`results.json` contains the inputs and computed outputs. No dependencies need installing to run the model or page. The vendored renderer is Three.js r185. No network request or AI model powers the simulation.

## Record and reply

The supplied film mode steps the actual model deterministically: baseline, +3 crews at 8 seconds, +1 commissioning resource at 20 seconds. `scripts/record-ops.py` captures 36 seconds at 1920×1080/24fps through isolated Helium, encoded locally to H.264 MP4 with ffmpeg. It is a scripted simulation tour, not a recording of real Base operations. No voice, microphone, desktop or private session is captured.

With the preview running, from this repository in PowerShell:

```powershell
$env:MEGAWATT_ROOT = (Get-Location).Path
Get-Content scripts/record-ops.py -Raw | helium-agent --profile megawatt-design run
```

For your own narrated take, use **OBS**: Window Capture → Helium, 1920×1080, 30fps, microphone only, disable desktop audio, record 35–45 seconds, trim dead time, attach the MP4 directly to X. OBS recommends a short test recording first. MKV is resilient while recording; use OBS's remux feature to produce MP4. [OBS setup](https://obsproject.com/kb/quick-start-guide) · [Recording formats](https://obsproject.com/kb/standard-recording-output-guide).

Loom is convenient for sharing a link, but its Starter Free plan does not allow downloading your recording, making it a poor fit for this native-video reply. [Loom download policy](https://support.atlassian.com/loom/docs/download-your-loom-video).

Copy-ready reply, after reviewing the video:

> Your warehouse demo inspired me to try this for battery deployment, using your open-source factory engine. Adding crews moves the bottleneck to commissioning. Synthetic operating inputs, computed queues and throughput. A small Base-inspired experiment in Megawatt.

Upload the local video yourself. This tool has not been deployed; do not present `/ops` as live on megawatt.fun until it is released. Nothing has been posted or sent.
