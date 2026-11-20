# megawatt.fun problem handoff

Audit date: Fri Nov 20, 2026, about 4:30 PM CT.
Scope: live site at https://megawatt.fun, repo at main `1c7421d` (the live `/api/v1/health` reports the same version).
Method: curl of 39 URLs (no JavaScript), headless Chrome on 33 pages at 1366 px and 390 px, link check of 64 internal and 260 external links, a read of the repo, branches, PRs and CI.
This file changes no code. It lists what is wrong and what to do about it.

## One-line purpose (recommendation)

**megawatt.fun answers one question from public data: where the grid is strained, and where the next home battery does the most good.**

Everything that does not serve that sentence moves off the front door.

## What is fine

- CI is green on main (last run Nov 16, 12:04 PM CT). No open PRs.
- The live deploy matches main (`/api/v1/health` returns `1c7421d`).
- No internal 404s. `/bench` now returns 200 (it was 404 on Oct 28).
- Pages load in about 0.8 to 1.2 seconds to network idle in headless Chrome.
- Most numbers carry a source and a read date. The method and limits text on `/market` is honest and clear.

## Ranked problems

Severity: Critical = blocks the gift. High = a Base reader would notice in 60 seconds. Medium = fix before sharing widely. Low = cleanup.

### 1. Critical: the site has no single purpose

Evidence. Five files describe five different products:

- `README.md:3` says it is one tool for what one battery earns at a Texas home and how much debt it carries.
- `llms.txt:3` says it is about what a battery is worth in each PJM utility zone.
- `about.html:26` says the suite is a Go dispatch planner, live ERCOT prices, a Kardashev calculator and a study of energy companies.
- `/roadmap` says "Build the power. Climb the scale." (Kardashev).
- `POV.md` is a pitch about Base's dispatch software.

The homepage h1 is "One battery, one day." There is no line saying who the site is for or why it exists. 34 HTML pages are live, 20 are in `sitemap.xml`, and the header has 13 links across 3 dropdowns (`index.html:28`): twin, power supply, homes, PJM, US map, data centers, siting, grid, live prices, financing, notes.

Fix. Adopt the one-line purpose above. Make the gift page the homepage or the first link. Cut the header to 3 or 4 links.

### 2. Critical: the recommended gift is split across pages, and the two halves disagree

Evidence.

- `/notes/expansion-map` now 308-redirects to `/market` (`vercel.json:28`). The map lives at `/market`. The node analysis lives at `/notes/where-batteries-earn-most`. Nothing joins them.
- `/market` has a box called "Where one battery earns most (Texas)". It uses 12 months of load-zone prices (Oct 1, 2025 to Oct 1, 2026, `data/zone-value.json`). It ranks LZ_WEST first at $493.72 a year and LZ_HOUSTON last at $322.57.
- `/notes/where-batteries-earn-most` uses 32 days of node prices (Sep 27 to Oct 28, 2026, `data/congestion.json`). It ranks nodes only in Houston, North and South. Its top node is RHESS2_ESS1 (LZ_SOUTH, P95 basis $64.31/MWh).
- Two pages with "earns most" in the title give different answers on different windows. A reader will not know which to trust.
- The note puts jargon above the finding (DMLBRK45, 5127__A, NP4-190-CD). The ranking table comes after the question, the ADER background and the method.

Fix. One page. Headline finding at the top in one plain sentence. One map, one ranking, then the node detail as a second section with its window stated. Rename one of the two "earns most" sections so they answer clearly different questions.

### 3. High: the pieces Maans said to cut are live and in the main nav

Evidence.

- PR #2 ("public-data suite for launch path and battery debt") was merged. The Oct 28 report assumed it was open.
- `/notes/financing-a-home-battery` is live with the illustrative debt layer (meta description, line 7).
- `/finance` ("Battery debt financing", about 7,800 words) is a top-level header link labeled "Financing" (`index.html:28`) and is linked again from the homepage (`index.html:136`).
- The homepage has a "A lender" tab (`index.html:80`).

The Oct 28 report said not to ship this. Illustrative capex and loan math on a Base-labeled page can read as a take on Base's economics.

Fix. Remove Financing from the header and the homepage tab. Keep the pages unlisted or move them under `/shelved`.

### 4. High: the homepage mixes Illinois and Texas, and Base's own terms

Evidence.

- The utility area defaults to ComEd (IL) (`day.js:242`, `z.id === 'COMED'`).
- On the same page, the owner tab says "These are Base Power's published Texas terms, shown as the model" (`index.html:85`), with $695 install and $19 a month.
- The same Base terms carry two different read dates: "Read 29 Oct 2026" (`day.js:186`) and "read 11 Nov 2026" (`index.html:101`).
- `/base` is titled "Your Battery Today" (`base.html:6`). It looks like a concept of a Base customer app screen ("Your battery charged from 8 AM to 12 PM...").

Fix. Default to a Texas zone if the page stays. Use one read date. Unlist `/base`, or retitle it so nobody mistakes it for a Base product.

### 5. High: without JavaScript the key pages show zeros or nothing

Evidence (curl, no JS).

- Homepage: "Loading real prices", "0.0¢ a kWh", "Cash so far today $0.00", "Yearly value $0".
- `/market`: "Loading the map data…" and "Loading…" in every ranking box. No table in the served HTML.
- `/notes/where-batteries-earn-most`: the ranking table has 0 rows in the served HTML.
- No page has a `<noscript>` fallback.

Link previews, readers in some email and DM apps, and quick skims see empty numbers. The Oct 28 checklist asked for tables that render without JavaScript.

Fix. Pre-render the headline numbers and the top-10 ranking as static HTML at build time (the data is already in `data/*.json`). Let JS add the sliders.

### 6. High: Base brand copying next to "not affiliated", plus three design systems

Evidence.

- `site.css:42-49` defines `--bpc-color-*` tokens (Base Power Company) with Base's greens and paper: `#b2dd79`, `#1e4d2b`, `#292826`, `#f0eeeb`.
- `site.css:1` and `site.css:35` say Instrument Sans stands in for Base's PP Neue Montreal.
- `siting.css:3-29`, `deploy.css:43`, `pjm-scene.js:12-16`, `roadmap.html:8`, `finance.html:8`, `supply.html:7` hard-code the same Base colors.
- `README.md:44` says pages render "on Base's public design system".
- Meanwhile most pages now load IBM Carbon (`vendor/carbon/styles.min.css`, `shell.css` with IBM Plex). The homepage build script adds Bricolage Grotesque (`scripts/make-day-home.py:29`).

So the site copies Base's look in some places, uses IBM's in others, and says "not affiliated" in the footer. That reads as mixed signals at best and impersonation at worst.

Fix. Pick one look that is clearly megawatt.fun's own. Remove the `--bpc` naming and Base hex values. Update `README.md:44`.

### 7. Medium-High: no author and no ask on the pages Base would see

Evidence. `index.html` and `market.html` contain zero mentions of Adam. Only `/notes` and `/about` name him ("Adam Pangelinan"). No page has the "three questions I would test on day one as an FDE" section from the Oct 28 checklist.

Fix. Add "Built by Adam Pang" with a GitHub link at the top or foot of the gift page. Add the three day-one questions (for example: permit-to-PTO time by city, where installs stall, which feeders are most constrained). Keep the independence line at the top.

### 8. Medium: orphan pages are live and indexable

Evidence. These all return 200: `/bench`, `/base`, `/pitch`, `/supply`, `/launch`, `/deploy`, `/ops`, `/essay`, `/why`, `/roadmap`, `/sources`, `/plug-and-play`, `/shelved/tools`, `/shelved/kardashev-climb`, and `/design/previews` (308 to a live page). `README.md:18` says pitch, supply, launch, bench, base, deploy and ops "are not linked from the site". They are still public and searchable. `/essay` is the only page without the shared header.

Fix. Decide per page: keep, move to `/shelved`, or exclude via `.vercelignore`. Add `noindex` to anything kept but unlisted.

### 9. Medium: broken scripts and stuck loading text

Evidence (headless Chrome).

- `/deploy`: page error "Cannot read properties of null (reading 'addEventListener')". After load it still shows "Loading public data…", "Loading period…", "Loading the shortlist…", and 2 of 4 tables are empty.
- `/finance` still has "Loading inputs..." in the page after load.
- `/supply` still has "Loading supply data..." after load.
- `/pitch` and `/notes/financing-a-home-battery` each have one empty table after load.

Fix. Fix or unlist `/deploy`. Check whether the other loading strings are visible or just hidden leftovers.

### 10. Medium: stale and conflicting facts

Evidence.

- `titans.html:94` says Base has "500+ MWh, 17,000 homes". `POV.md` also uses 17,000. Maans's Oct 28 report cites newer coverage of 750+ MWh across 30,000+ homes. I did not re-verify either number today.
- `about.html:26` describes an older suite. It does not mention the current homepage, the map or the twin.
- `README.md:72` says `index.html`, `climb.css` and `climb.js` implement the roadmap. The homepage is now "One battery, one day". It says `tools.html` preserves the energy tools. `tools.html` is a stub titled "PJM home battery value" (`tools.html:6`).
- K value differs by page: `/kardashev` says 0.728, `/roadmap` says 0.730, `/essay` says 0.73. `/kardashev` is labeled as earlier analysis, but all three are live.
- The `/market` ranking moved since Oct 28. Then: Michigan 76, Texas 71, Maryland 69. Now: Michigan 69 (#2 overall), California 68, Maryland 67 outside Base's footprint. Fine if the data changed, but nothing on the page says what changed.

Fix. Re-verify the Base fleet number with a dated source, or remove it. Rewrite About and README to match the one purpose. Add a short changelog line when the ranking moves.

### 11. Medium-Low: data windows are 3 to 7 weeks old

Evidence (`/api/v1/health` `data_as_of`): expansion_map 2026-10-27, market_states 2026-10-29, launch_steps 2026-10-30, zip_launch 2026-11-03, supply and finance_defaults 2026-11-04. The node note covers Sep 27 to Oct 28, 2026.

Fix. Refresh the node prices before sending. Show "data as of" next to the headline.

### 12. Medium-Low: dead source links

Evidence. These return 404 to curl (recheck in a browser):

- `https://help.basepowercompany.com/en/articles/12742081` (`analysis/build_expansion.py:1475`, `data/expansion-map.json`). This is a Base source on the gift page.
- 4 puco.ohio.gov links in `data/pjm-states.json`.
- 3 nxp.com links in `data/supply.json`.

About 25 more returned 403 or timed out (businesswire.com, ilga.gov, utilitydive.com and others). Those are likely bot blocks, not dead pages.

Fix. Replace the Base help link first. Swap the others for archived copies.

### 13. Low: mobile overflow on one page

Evidence. `/notes/kardashev-stack` is 405 px wide on a 390 px phone viewport. The other 32 pages had no horizontal overflow.

### 14. Low: page weight

Evidence. Every page loads `vendor/carbon/styles.min.css` (1.1 MB raw, 118 KB compressed). The homepage also loads three.js (`vendor/airsup/three.bundle.js`, 870 KB raw, 246 KB compressed) for the 3D house. Load is still fast today. A single gift page needs neither.

### 15. Low: branch clutter

Evidence. 10 remote branches besides main. 9 have 0 commits not in main: carbon, cursor/expansion-map-note-579d, cursor/texas-siting-0c4a, dc-site, market-map, one-day-homepage, pro-polish, supply, twin. `janitor/dependabot-config` shows 1 commit ahead, but PR #16 with the same title is merged. PR #9 ("a quieter, more professional look") was closed without merging.

Fix. Delete merged branches once Adam agrees.

## What to cut from the gift

- The financing pages and the "A lender" tab (`/finance`, `/notes/financing-a-home-battery`).
- `/base` ("Your Battery Today" concept screen).
- Base's colors and the `--bpc` token names.
- The Kardashev pages, `/titans`, `/roadmap`, `/essay` and `/why` as entry points. They can live elsewhere.
- The twin, data-center, siting, generation and grid pages from the gift's nav. See open question 2.
- The second "where batteries earn most" box on `/market`, or rename it.

## What "done" looks like (4 hours max)

One URL, for example `megawatt.fun/` or `megawatt.fun/where`. On it:

1. Top line: one plain-English finding, a "data as of" date, and "Independent project. Not affiliated with or endorsed by Base Power." (about 30 min)
2. One US map and one ranking, pre-rendered so it reads without JavaScript. Default view tells one story. (about 1.5 hours)
3. A Texas section: the node finding in 3 sentences, its date window, and a small table. Jargon goes below. (about 45 min)
4. A "Limits" box: no Base install times, permits, dispatch or costs. (15 min)
5. "Three things I would test on day one with real data." (15 min)
6. "Built by Adam Pang" plus GitHub link. (5 min)
7. Header cut to 3 or 4 links. Financing and `/base` unlisted. (30 min)
8. Check on a phone and with JavaScript off. Fix the Base help link. (20 min)

Out of scope for the 4 hours: a new design system, refreshing every data file, the twin and data-center work.

## Open questions for Adam

1. Is this site a Base gift, or your energy portfolio? If both, should the Base page live at its own URL, with the rest of the site behind it?
2. Data centers and the grid as an AI bottleneck: you said energy for AI matters to you. The twin, data-center and siting pages are the strongest work on that. Do they become a separate project, or the site's real purpose?
3. Base versus Tesla: you said you would not want to compete with Powerwall and Megapack. Should the gift say anything about where home batteries beat grid-scale storage, or stay purely about Base's question?
4. Which name goes on it: "Adam Pang" or "Adam Pangelinan"? The site uses Pangelinan today.
5. Do you want the Base colors gone entirely, or kept as a nod? The Oct 28 report and this audit both lean toward removing them.
6. Which orphan pages should stay public at all?
7. The Base fleet size: which number and source do you want, if any?
