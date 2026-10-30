# Base-focused operations simulation

Selected by Adam: [Airsup warehouse operations](https://www.airsup.ai/lab/warehouse-ops). Inspected October 19, 2026. Supporting implementation reference: [AirsupHQ/factory-skill](https://github.com/AirsupHQ/factory-skill), MIT, pinned `9fde7554e6a30e77ea1008dec08f2ba8d8d37f27`.

Success means a viewer can see a deployment constraint, change capacity, and explain why the next constraint moves. A polished animation alone does not establish forecasting accuracy or operator adoption.

## Evidence

- Follow-up repository audit: [personal account, six local clones, pinned versions and reuse decisions](docs/airsup-reuse-audit.md). Konstantin's personal account is `Pytro001`; two public website files matched the live site byte-for-byte. `megastructures-tv` provides an MIT-licensed reference for Franklin changing validated simulation controls. The exact warehouse app was not found in the inspected repositories.

- The warehouse page's first-party shipped JavaScript exposes entity inspection, zone navigation, person-follow camera, dock views, trails/heat layers, speed controls and injected deadlock/crane/late/missing events. It has a film mode. The heavy live page timed out in isolated Helium; these features were identified from shipped code, not all interactively verified.
- The linked [X post](https://x.com/konstantinsaifo/status/2112103898693427587) was blocked with HTTP 403 directly. A public FxTwitter rendering returned the author's warehouse-overview description and a 38.2-second 1920×1080 video. Replies were not accessible; no claim that the whole thread was read. Counts and “live” are the author's claims, not evidence of a production deployment.
- [AirsupHQ/airsup-lab](https://github.com/AirsupHQ/airsup-lab) is MIT and contains machine scenes and a recording tool. Its public tree did not include warehouse-ops. [machine-skill](https://github.com/AirsupHQ/machine-skill) is MIT and has a deterministic recording pipeline. [factory-skill](https://github.com/AirsupHQ/factory-skill) contains the reusable queueing engine, examples and renderer. The exact warehouse application's source was not found in those public trees.
- Base's [self-scheduling engineering article](https://inside.basepowercompany.com/self-scheduling) identifies crew supply, materials, drive-time constraints and scheduling as operational concerns. It describes a solution already in use; this demo does not claim to solve an untouched Base problem. [Utility partnerships](https://www.basepowercompany.com/utilities) describes an integrated deployment and operations process.

## Capability map

| Capability | Megawatt status | Evidence / boundary |
|---|---|---|
| Spatial operations overview | Partial | Original 3D six-stage process diorama at `/ops`; schematic, not real geography or a facility |
| Select an entity or process area | Partial | Select a stage by mouse or keyboard; no individual staff tracking |
| Time controls and camera | Match for basic use | Play/pause, speed, orbit, overview |
| Computed queue / throughput / bottleneck | Implemented from factory reference | Same seeded DES in browser and Node; full-horizon statistics, tested job conservation |
| Capacity changes and what-if comparison | Implemented | Crews, commissioning resources, installation time, finite queues; fixed baseline comparison |
| Operational interruptions | Partial | Synthetic installation interruptions and longer-visit scenario; no warehouse deadlock/crane event copy |
| Real worker, truck and customer telemetry | Blocked by evidence | No access, no fake live feed; vehicles and houses are illustrative |
| Geographic routing / workforce scheduling | Missing | Serial service stations are not a routing optimizer or Base's anchor scheduler |
| Heatmap, entity-follow, dock schedule | Missing / domain dependent | Not required for first deployment bottleneck demo |
| Money / staffing optimization | Missing | Capacity study only; no labor quotes, purchase prices or ROI claims |
| Market dispatch evidence | Existing separate tool | `/deploy` retains real ERCOT backtests; not fused with synthetic operational ROI |
| Deterministic short video | Implemented | `?film=1` steps actual simulation and scenario settings, original camera tour |

## First slice and next acceptance gates

The first slice is local, not full warehouse feature parity. Tests cover resource changes, conservation, queue bounds, interruptions, seeded reproducibility and an exact serial fixture. UI shows baseline vs scenario, with synthetic labels in both app and film.

Next useful work requires an operator: validate whether deployment capacity is the relevant decision and obtain anonymized task timestamps, material constraints, crew calendars and confirmed site mappings. Then implement route-aware scheduling or material scarcity only if that evidence establishes the need. Avoid building a decorative “digital twin” of unknown operations.

No posting, paid services, commits or deployment. Adam must manually post the reply/video under the repository's personal-communication rule.
