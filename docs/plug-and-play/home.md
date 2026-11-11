## Home battery ROI {#home}

Page: `/battery`. One Texas home. The same code answers `POST /api/v1/home`.

Send JSON. `query` is a ZIP (`77002`), a place (`Houston`), or a street address that contains a ZIP. `preset` is `bungalow`, `suburban` or `ranch`. `revenueCase` is `merchant`, `toll` or `stacked`. `fleetCount` is the fleet roll-up. `zone` is optional: send it when the ZIP is served by Oncor or TNMP, or when no load zone is on file.

Suburban annual use is the 2024 Texas residential average, 1,097 kWh a month. Bungalow (9,000 kWh) and ranch (18,000 kWh) are labeled assumptions. Earnings use `data/zone-value.json` (real-time load-zone prices, 2025-10-01 to 2026-10-01, fixed clock). Debt, payback, simple ROI and IRR use `finance-core.js`. Backup is $0 of cash flow: the replay already holds a 20% reserve, and no outage dollar is in the file.

A ZIP that does not pick one zone returns `needsZone: true` and does not invent a zone.

**Example:**

```json
{ "query": "77002", "preset": "suburban", "revenueCase": "merchant" }
```
