# Private application and next-event notes

Checked 4 October 2026. Exclude this file from public deployments and source ZIPs. Adam submits applications and messages manually.

## Next opportunity

The missed [Base Power x AITX Talent Hackathon](https://luma.com/aitx-94j6) ran 25–27 September at Base HQ. The public brief named three tracks, not a numerical judging rubric. We did not verify an official winners list and cannot claim this project would have won.

The next announced Austin event in the [AITX calendar](https://luma.com/AITX) is the [AITX Community Monthly Meetup at Austin Tech Week](https://luma.com/aitx-oct26), Tuesday **27 October 2026, 5:30–7:30 PM CDT**, Antler VC, **800 Brazos St #340, Austin**. Luma registration is open and lists free general admission. Singapore/Malaysia time is **28 October, 6:30–8:30 AM**. This is an in-person community meetup with demo applications; it is not advertised as a Base hiring event, and Base attendance is unconfirmed. Apply to demo through https://www.aitxcommunity.com/participate (Austin → Demo Your Project). Do not claim remote participation is available.

Houston's next listed meetup is https://luma.com/dt1zlamk, **29 October, 5:30–7:30 PM CDT** at POST Houston; its workshop topic is TBD. It is another community event, not a confirmed hiring event. The official AITX hackathon archive lists past events but no next dated Base hackathon. No successor was verified on the current calendar or searches of Base/AITX event announcements.

## Apply today

Base's live official job-board feed, https://api.ashbyhq.com/posting-api/job-board/base-power, lists [Software Engineering Intern](https://jobs.ashbyhq.com/base-power/5353ea33-57d4-46fa-9a96-e392a3f841bc), Austin, internship. The fetched description explicitly values working software from side projects, coursework or internships. It has no stated student or degree condition. That absence is not confirmation that non-students qualify. The role describes in-person work; Adam's willingness and ability to work in Austin is not established.

**Exact action:** open that role, click Apply, indicate **Base Power Platform** and **Product Engineering** as areas of interest, link https://megawatt.fun/bench and https://megawatt.fun/base, and disclose non-student status and actual availability. If the form requires enrollment, do not invent it; use [General Interest Application](https://jobs.ashbyhq.com/base-power/8cba7cc5-f8df-4ff8-a7b8-4c1ab55af7f4). Ask for a non-student internship or entry-level full-time consideration. No event attendance or extra demo work is a prerequisite.

The current Backend listing now asks for 1–5 years of professional development; Product asks for 2+ years building production software. The certificate and assessment score alone do not establish those qualifications. Apply to either only with actual relevant experience; do not relabel personal projects as professional employment.

## Five sentences about the work

I built Dispatch Bench, a reproducible replay of public ERCOT prices against simulated battery devices, extending Megawatt's existing dispatch planner.
It compares a fixed-clock baseline and guarded and unguarded price plans under forecast timing error, duplicate deliveries, late commands, and stale telemetry.
I measured grid-side energy, cash and ending-inventory proxies, reserve breaches, and each command's application outcome.
In the default duplicate-delivery scenario, the unguarded plan consumed backup on 32 of 100 simulated devices, while the guarded plan preserved reserve and ignored 128 retries.
The tool could support fleet API and dispatch testing discussions at Base, with clear limits: one public price day, synthetic faults, no production device integration, and no validated customer economics.

## Base application draft

Areas of interest: Base Power Platform; Product Engineering.

I want to build software that helps make abundant, reliable electricity practical. I missed the September Base x AITX hackathon, so I built an independent contribution afterward: Dispatch Bench (https://megawatt.fun/bench), alongside a homeowner battery concept (https://megawatt.fun/base).

The bench extends my existing dispatch planner and makes failure behavior inspectable. It replays a public Houston price day, compares a clock baseline with price plans, and tests duplicate delivery, command expiry, stale telemetry and household reserve safeguards. Every device has a ledger, every scenario is reproducible, and the documentation distinguishes simulation results from real customer economics. The command reducer includes tests for idempotency, energy conservation, expiry and reserve enforcement. It is not connected to Base hardware or private systems.

I'm a US citizen and do not need sponsorship. I completed App Academy's full-stack engineering certificate and scored 100/100 on the CodeSignal engineering assessment I took for Ramp. I am not currently a student. I can offer full-time availability beginning October 2026 for at least a year, and would welcome a non-student internship or entry-level full-time consideration. I will provide my actual Austin/in-person availability in the application.

I'd like to discuss the engineering tradeoffs in the demo and contribute to fleet APIs, dispatch evaluation, or member-facing tools while learning the operational constraints of real batteries.

## AITX demo application draft

Project: Megawatt Dispatch Bench

I missed the Base x AITX talent hackathon and built an independent demo afterward. Dispatch Bench uses a recorded public ERCOT price day to show what happens when a simulated battery fleet receives duplicate or expired commands or loses telemetry. In 90 seconds I can show a clean baseline, a lost-acknowledgement failure, a command ledger, and the cost of preserving household backup when delivery degrades. It's a deterministic engineering tool, not an AI forecasting claim or a production controller. Demo: https://megawatt.fun/bench.

Add actual ability to attend Austin on 27 October before submitting. Acceptance, remote format and Base attendance are not confirmed.
