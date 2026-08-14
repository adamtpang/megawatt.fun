# The arbitrage floor is thin. The machine around it is the company.

A point of view on Base Power's software problem, with working code.
Adam Pangelinan, August 2026.

## What I did

I built a Go dispatch planner and ran it against real ERCOT day-ahead
prices (hub average, 2026-08-13): given a home battery's physical envelope,
plan the most profitable charge-then-discharge cycle, and refuse to cycle
when the spread does not clear round-trip losses. Tests cover the physics
(power caps, efficiency gates, no discharge before charge). Repo: https://github.com/adamtpang/basepower-fleet-dispatch
Live demo: https://megawatt.fun

Without being told anything about the grid, it recovers the shape your
operators live daily: charge the midday solar trough at $11 to 17/MWh,
discharge the evening ramp at $33 to 38/MWh.

## The finding

On that day the energy-only floor is $0.43 per battery. Across the 30,000+
homes your careers page states, that is roughly $4.7M a year. Real fleet
revenue is obviously a multiple of this floor, and that multiple is the
point: it comes almost entirely from software problems, not from the
arbitrage math, which fits in one afternoon of Go.

Where the multiple actually lives, matched to problems your own postings
name: ancillary services (you have publicly maxed the 20 MW ADER pilot
cap), real-time dispatch against 15-minute settlement instead of perfect
foresight, sub-second telemetry from thousands of BMSes, 4CP positioning,
and the coming PJM expansion. Every one of these is an operating-system
problem. Your backend posting calls BaseOS "the operating system that runs
the modern power company," and I think the valuation agrees with that
sentence more than it agrees with the arbitrage spread.

## What I would want to own

- Workflow systems in Temporal for install and commissioning logistics.
  Every truck roll is a loss; the software that compresses scheduling,
  permitting, and commissioning is direct margin.
- The telemetry-to-markets pipeline: fleet state in, dispatchable and
  auditable market position out, at PJM-expansion scale.
- Making dispatch decisions verifiable. My recent work is agent-output
  verification (an eval-suite-backed reconciler that catches when claimed
  state drifts from real state). A trading fleet has the same shape: what
  the optimizer claims it did must be checkable against what the fleet
  physically did.

## The honest gap, and the honest fit

Your posting asks for 2+ years of production backend experience. I am
short of that on paper. What I have instead is shipped, verifiable systems
built alone and fast, in public: this planner, a career-agent product with
live ATS integrations, and the verification tooling above. Your careers
page says you care how people approach problems and asks for concrete
examples and a strong point of view. This document and the repo are mine.

US citizen. I will relocate to Austin and work in person at Base pace. I
build in whatever the problem needs; this artifact is Go because BaseOS
is. I can be in Austin the week of [DATE].

Worth 15 minutes?
