// Live ERCOT system-wide prices, proxied server-side.
//
// Why a proxy at all: ercot.com sends no CORS headers (its dashboard is
// same-origin) and its Imperva layer 403s many non-US IPs, both verified
// the hard way. Vercel functions egress from US regions, and the CDN cache
// below keeps us to at most one upstream hit a minute.
const UPSTREAM =
  "https://www.ercot.com/api/1/services/read/dashboards/systemWidePrices.json";

export default async function handler(req, res) {
  try {
    const upstream = await fetch(UPSTREAM, {
      headers: {
        "user-agent": "megawatt.fun live prices (github.com/adamtpang/megawatt.fun)",
        accept: "application/json",
      },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `ERCOT upstream returned ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: "Could not reach ERCOT: " + (err?.message ?? "unknown") });
  }
}
