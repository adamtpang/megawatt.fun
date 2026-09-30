# Loom script draft: "Your battery today" (60 to 90 seconds)

Bullets only. Adam words it in his own voice.

- Who I am, one line. Missed the Base Power x AITX hackathon because I live in Malaysia.
- What I noticed in the public entries: fleet simulation, demand forecasting, utility ZIP targeting.
  All grid-side or business-side. None show what a member sees.
- The role I'm applying for is about making the energy system clear to members. So I built that screen.
- Show /base on a phone:
  - Top sentence: what the battery did today, generated from the day's data.
  - Chart: real ERCOT Houston prices; green is charging, amber is powering the home and the grid.
  - Backup right now; change home size.
  - Flip outage mode: hours for essentials, hours with AC, what to turn off.
- Show it failing honestly: `?battery=offline` says it can't reach the battery, no fake numbers.
  `?prices=offline` falls back to the last good day and says so.
- What's real vs assumed (prices real; battery behavior simulated; not Base's logic or revenue).
- What I'd build next with real telemetry.
- Close: I built this because I want to build this screen for real. Link in the description.
