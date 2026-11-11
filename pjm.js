/* PJM, the next market. Data: data/pjm-value.json (scripts/pjm-value.cjs) and data/pjm-states.json.
   Math: pjm-core.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const C = () => window.PjmCore;
  let V = null, S = null, open = null;

  function params() {
    const year = V.capacity.deliveryYears.find((y) => y.year === $('capYear').value) || V.capacity.deliveryYears[0];
    return {
      tagKw: Number($('tagKw').value), hitRate: Number($('hitRate').value), capacityUsdPerMwDay: year.usdPerMwDay, capacityScale: Number($('capacityScale').value),
      includeEnergy: $('includeEnergy').checked, includeCapacity: $('includeCapacity').checked, includeTransmission: $('includeTransmission').checked,
      allowExports: $('allowExports').checked,
    };
  }
  // PPL's proposal makes transmission a utility charge for every customer, so no supplier keeps the tag saving.
  const zonesNow = () => V.zones.map((z) => ($('pplNonbypass').checked && z.id === 'PPL' ? { ...z, nitsUsdPerMwYear: 0, nonbypass: true } : z));

  const CHOICE = { open: ['Retail choice', 'badge-green'], partly: ['Partly open', 'badge-yellow'], none: ['No residential choice', 'badge'] };

  function render() {
    const p = params();
    $('o-tag').textContent = p.tagKw + ' kW';
    $('o-hit').textContent = Math.round(p.hitRate * 100) + '%';
    $('o-scale').textContent = p.capacityScale.toFixed(2) + 'x';
    const ranked = C().rank(zonesNow(), p);
    const max = Math.max(...ranked.map((r) => r.value.total), 1);
    const openZones = ranked.filter((r) => r.zone.choice === 'open');
    const top = openZones.slice(0, 3).map((r) => `${r.zone.utility.split(' (')[0]} (${usd(r.value.total)})`);
    const span = (k) => { const xs = ranked.map((r) => r.value[k]); return Math.max(...xs) - Math.min(...xs); };
    const drivers = [['energy', span('energy')], ['transmission', span('transmission')]].sort((a, b) => b[1] - a[1]);
    const flagged = openZones.slice(0, 3).filter((r) => (r.zone.flags || []).length).map((r) => r.zone.utility.split(' (')[0]);
    const ohio = V.zones.filter((z) => z.transmission && z.transmission.bypassable === false).length;
    const missed = V.zones.filter((z) => z.peaks.rtoFiveCP.some((x) => !x.coveredByClock) || !z.peaks.zoneOneCP.coveredByClock).map((z) => z.id);
    $('lede').textContent = `With these assumptions, the most valuable PJM zones where homes can choose their supplier are ${top.length > 1 ? top.slice(0, -1).join(', ') + ' and ' + top[top.length - 1] : top.join('')} a year for one battery.` +
      (flagged.length ? ` Read the launch rules before chasing ${flagged.join(' and ')}: see the flags below.` : '');
    $('keyfacts').innerHTML = [
      `<b>What drives the spread.</b> ${drivers[0][0] === 'energy' ? 'Energy' : 'Transmission'} varies most between zones (${usd(drivers[0][1])} from top to bottom), then ${drivers[1][0]} (${usd(drivers[1][1])}).`,
      `<b>Ohio.</b> In ${ohio} Ohio zones transmission is already a nonbypassable utility charge, so its tag counts as 0.`,
      p.allowExports ? '<b>Exports.</b> Energy here assumes full 20 kW exports, which PJM opens to aggregated home batteries on 1 Feb 2028.' : '<b>Exports.</b> Energy is capped at the home\u2019s own load: a home battery cannot sell exports into PJM until DER aggregation opens on 1 Feb 2028.',
      `<b>Peak timing.</b> A fixed 5 to 9 PM clock misses some summer 2026 tag-setting peaks in ${missed.length} of ${V.zones.length} zones${missed.includes('COMED') ? ', ComEd among them' : ''}, so tag value assumes a separate peak-day dispatch from about 2 PM.`,
    ].map((t) => `<li>${t}</li>`).join('');
    $('rank-note').textContent = `${V.period.start} to ${V.period.endExclusive} prices for energy. ${p.tagKw * p.hitRate} kW of tag reduction at ${usd(C().capacityPerKwYear(C().inputs(p).inputs))} per kW-year of capacity. Not Base revenue: an outside estimate from public data.`;
    $('zones').innerHTML = ranked.map((r, i) => {
      const z = r.zone, v = r.value, w = (x) => Math.max(0, (x / max) * 100);
      const [cl, cc] = CHOICE[z.choice] || ['', 'badge'];
      return `<li class="pjm-zone${open === z.id ? ' is-open' : ''}"><button type="button" class="pjm-row" data-zone="${esc(z.id)}" aria-expanded="${open === z.id}">
        <span class="pjm-rank">${i + 1}</span>
        <span class="pjm-name"><b>${esc(z.utility)}</b><span class="pjm-meta"><code>${esc(z.id)}</code> ${esc(z.states.join(', '))} <span class="badge ${cc}">${esc(cl)}</span>${z.baseStatus === 'operating' ? ' <span class="badge badge-solid">Base operates here</span>' : z.baseStatus === 'docket' ? ' <span class="badge badge-blue">Base in a PUC docket</span>' : ''}${z.nonbypass || (z.transmission && z.transmission.bypassable === false) ? ' <span class="badge badge-red">Transmission nonbypassable</span>' : ''}${(z.flags || []).length ? ' <span class="badge badge-orange">Launch flag</span>' : ''}</span></span>
        <span class="pjm-bar" aria-hidden="true"><i class="e" style="width:${w(v.energy)}%"></i><i class="c" style="width:${w(v.capacity)}%"></i><i class="t" style="width:${w(v.transmission)}%"></i></span>
        <span class="pjm-total">${usd(v.total)}<small>/yr</small></span></button>
        ${open === z.id ? detail(z, v) : ''}</li>`;
    }).join('');
  }
  function detail(z, v) {
    const st = S && S.states ? z.states.map((c) => S.states.find((x) => x.code === c)).filter(Boolean) : [];
    return `<div class="pjm-detail"><dl>
      <dt>Energy, ${params().allowExports ? 'full 20 kW exports (from Feb 2028)' : 'home load only'} (charge 1 to 5 AM, discharge 5 to 9 PM ${esc(z.timezone)})</dt><dd>${usd(v.energy)}</dd>
      <dt>Energy with full 20 kW exports, for comparison</dt><dd>${usd(z.energyExportUsdPerYear)}</dd>
      <dt>Capacity tag (paid the year after the peaks)</dt><dd>${usd(v.capacity)}</dd>
      <dt>Transmission tag (NITS ${usd(z.nitsUsdPerMwYear)}/MW-yr${z.nonbypass ? ', zeroed: nonbypassable' : ''})</dt><dd>${usd(v.transmission)}</dd>
      <dt>Energy from the two best months (${esc(z.energyTopTwoMonths.months.join(', '))}, full exports)</dt><dd>${Math.round(z.energyTopTwoMonths.share * 100)}%</dd>
      <dt>Average real-time price (highest hour)</dt><dd>$${z.avgRtUsdPerMwh.toFixed(2)} ($${Math.round(z.maxRtUsdPerMwh).toLocaleString('en-US')})/MWh</dd>
      <dt>Who sells to homes</dt><dd>${esc(z.choiceNote || (z.choice === 'open' ? 'Retail choice' : z.choice))}</dd></dl>
      ${peakTable(z)}
      <p class="pjm-small"><b>Transmission:</b> ${esc(z.transmission.note)}${srcLink(z.transmission.source)} <b>Tag method:</b> ${esc(z.tagMethod.text)}${srcLink(z.tagMethod.source)}</p>
      ${z.base ? `<p class="pjm-small"><b>${esc(z.base)}.</b>${srcLink(z.baseSource)}</p>` : ''}
      ${(z.flags || []).map((f) => `<p class="notice"><b>Launch flag.</b> ${esc(f.text)}${f.source ? ` <a href="${esc(f.source)}">Source</a>.` : ''}</p>`).join('')}
      ${st.length ? `<p class="pjm-small">Launch requirements: ${st.map((s) => `<a href="#state-${esc(s.code)}">${esc(s.name)}</a>`).join(', ')}.</p>` : ''}</div>`;
  }

  const srcLink = (u) => (!u ? '' : /^unverified$/i.test(u) ? ' <span class="badge badge-yellow">Unverified</span>' : ` <a href="${esc(u)}">Source</a>.`);
  const clock = (h) => { const a = h % 12 || 12; return `${a} ${h < 12 ? 'AM' : 'PM'}`; };
  // Summer 2026 hours that set the tags, and whether the fixed 5 PM to 9 PM clock was already discharging.
  function peakTable(z) {
    const row = (label, list) => `<tr><th>${label}</th><td>${list.map((x) => `<span class="${x.coveredByClock ? 'pk-hit' : 'pk-miss'}" title="${x.coveredByClock ? 'Inside the fixed discharge window' : 'Before the fixed discharge window'}">${esc(x.date.slice(5))} ${clock(x.localStart)}</span>`).join(' ')}</td><td class="num">${list.filter((x) => x.coveredByClock).length}/${list.length}</td></tr>`;
    return `<div class="mm-scroll"><table class="ds-table pjm-peaks"><thead><tr><th>Summer 2026 tag hours (${esc(z.timezone)} time)</th><th>Hour each one started</th><th class="num">In the 5 to 9 PM window</th></tr></thead><tbody>
      ${row('PJM five peaks (capacity PLC, most utilities)', z.peaks.rtoFiveCP)}${row('Zone five peaks', z.peaks.zoneFiveCP)}${row('Zone single peak (transmission NSPL)', [z.peaks.zoneOneCP])}</tbody></table></div>`;
  }

  function states() {
    if (!S || !S.states) { $('states').innerHTML = '<p class="pjm-small">State requirements are not in this build yet.</p>'; return; }
    const UNV = '<span class="badge badge-yellow">Unverified</span>';
    const isUnv = (t) => /^unverified$/i.test(String(t || '').trim());
    const src = (u, label = 'source') => (!u ? '' : isUnv(u) ? ' ' + UNV : /^https?:\/\//.test(u) ? ` <a href="${esc(u)}">${esc(label)}</a>` : '');
    // Text fields may say "unverified" in place, or end with "(secondary)" when only a secondary source exists.
    const txt = (t) => esc(t).replace(/\bunverified\b/gi, 'not confirmed').replace(/\(secondary\)/g, '<span class="badge">Secondary source</span>');
    const due = (d) => (!d ? '' : isUnv(d) ? ', due date not confirmed' : ', due ' + txt(d));
    const list = (items, f) => (items && items.length ? '<ul>' + items.map(f).join('') + '</ul>' : '<p class="pjm-small">None found.</p>');
    const billing = (b) => {
      if (!b) return '';
      if (typeof b === 'string') return `<h3>Billing</h3><p>${txt(b)}</p>`;
      const rows = Object.entries(b).filter(([k]) => k !== 'source');
      return `<h3>Billing</h3><ul>${rows.map(([k, v]) => `<li>${k === 'summary' ? '' : `<b>${esc(k)}</b>: `}${txt(v)}</li>`).join('')}</ul>${b.source ? `<p class="pjm-small">${src(b.source).trim()}</p>` : ''}`;
    };
    const order = { open: 0, limited: 1, none: 2 };
    $('states').innerHTML = [...S.states].sort((a, b) => (order[a.retail_choice] ?? 3) - (order[b.retail_choice] ?? 3)).map((s) => {
      if (s.retail_choice === 'none' || (!s.license && !(s.filings || []).length)) return `<p class="pjm-small" id="state-${esc(s.code)}"><b>${esc(s.name)}</b>: ${esc(s.notes || 'no residential retail choice')}</p>`;
      const L = s.license || {};
      return `<details class="card pjm-state" id="state-${esc(s.code)}"><summary><b>${esc(s.name)}</b> <span class="badge ${s.retail_choice === 'open' ? 'badge-green' : 'badge-yellow'}">${esc(s.retail_choice === 'open' ? 'Retail choice' : 'Limited choice')}</span> <span class="pjm-small">${esc(L.name || '')}</span></summary>
        <div class="pjm-state-body">
          <h3>License</h3><p>${txt([L.agency, L.name, L.rule].filter(Boolean).join(', '))}.${L.security ? ' Security: ' + txt(L.security) + '.' : ''}${L.fee ? ' Fee: ' + txt(L.fee) + '.' : ''}${L.review_time && !isUnv(L.review_time) ? ' Review: ' + txt(L.review_time) + '.' : ''}${src(L.source)}</p>
          ${billing(s.billing)}
          <h3>Recurring filings</h3>${list(s.filings, (f) => `<li><b>${txt(f.what)}</b>${due(f.due)}.${src(f.source)}</li>`)}
          <h3>Consumer rules that shape a battery offer</h3>${list(s.consumer, (c) => `<li>${txt(c.rule)}${src(c.source)}</li>`)}
          <h3>Battery programs and storage rules</h3>${list(s.programs, (g) => `<li><b>${txt(g.name)}</b>: ${txt(g.what)}${src(g.source)}</li>`)}
          ${(s.dockets || []).length ? `<h3>Open dockets</h3>${list(s.dockets, (d) => `<li><b>${txt(d.id)}</b>: ${txt(d.what)}${src(d.source)}</li>`)}` : ''}
          ${s.notes ? `<p class="pjm-small">${txt(s.notes)}</p>` : ''}
        </div></details>`;
    }).join('') + `<p class="pjm-small">Checked ${esc(S.checked)}.</p>`;
  }

  function method() {
    const caps = V.capacity.deliveryYears.map((y) => `<li><a href="${esc(y.source)}">PJM ${esc(y.year)} Base Residual Auction</a>: $${y.usdPerMwDay}/MW-day</li>`).join('');
    $('method').innerHTML = `<p>${esc(V.method)}</p>
      <ul class="pjm-small">
        <li>Battery: ${esc(V.spec.label)}.</li>
        <li>Clock: ${esc(V.schedule.label)}. The same clock runs every day; a real fleet would also chase price spikes, so energy here is a floor for this clock, not a forecast.</li>
        <li>${esc(V.capacity.note)}</li>
        <li>Exports: ${esc(V.exportsFrom.what)} starts ${esc(V.exportsFrom.date)} (<a href="${esc(V.exportsFrom.source)}">PJM</a>). Until then the battery serves only its home.</li>
        <li>Tag-setting hours come from PJM metered load for June to September 2026 (${esc(V.peaksSource.title)}). Each zone shows whether the fixed 5 to 9 PM clock was already discharging then. Where it was not, the tag value assumes a separate peak-day dispatch that covers the home from about 2 PM: at 3 kW that uses about 21 kWh of the 31 usable, so it fits but leaves less for that evening’s energy. Peak days are only known afterwards; lower “Peak hours actually covered” for missed calls.</li>
        <li>Tags are paid the year after the peaks that set them: summer 2026 peaks set capacity tags for delivery year 2027/2028 and transmission tags for calendar 2027. A new member saves nothing on tags in its first year.</li>
        <li>The transmission tag is set by one hour a year, so in practice it is all or nothing; the slider treats it as an expected value.</li>
        <li>Transmission counts only the zonal NITS rate. Regional expansion charges (PJM Schedule 12), also allocated on NSPL, are left out, so transmission value is understated, most in PSE&amp;G, Dominion and BGE.</li>
        <li>Tag and load-offset savings go to whoever is billed for that load: a retail supplier in a choice zone, or the utility. A supplier keeps them only where the utility sets tags and settles load from the home’s own interval meter. Check each utility’s method before counting them.</li>
        <li>Left out: PJM demand response or capacity offers by an aggregator, ancillary services, backup value to the member, retail margin, battery wear and the cost of the battery.</li>
      </ul>
      <p class="pjm-h">Sources</p><ul class="pjm-small">
        <li><a href="${esc(V.pricesSource.url)}">${esc(V.pricesSource.title)}</a>, ${esc(V.period.start)} to ${esc(V.period.endExclusive)} (fetched ${esc(V.period.fetched)})</li>
        ${caps}
        <li><a href="${esc(V.nits.source)}">PJM NITS rates by zone, effective ${esc(V.nits.effective)}</a></li>
        <li><a href="${esc(V.peaksSource.url)}">${esc(V.peaksSource.title)}</a></li>
        <li><a href="${esc(V.baseSaysSource.url)}">${esc(V.baseSaysSource.title)}</a></li>
        <li>Data files: <a href="/data/pjm-value.json">pjm-value.json</a>, <a href="/data/pjm-states.json">pjm-states.json</a>. Rebuild: <code>node scripts/fetch-pjm-prices.cjs</code> then <code>node scripts/pjm-value.cjs</code>.</li>
      </ul><p class="pjm-small">Not affiliated with Base Power. Built ${esc(V.built)}.</p>`;
  }

  function csv() {
    const p = params(), cell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const rows = C().rank(zonesNow(), p).map((r, i) => [i + 1, r.zone.id, r.zone.utility, r.zone.states.join(' '), r.zone.choice, r.value.energy, r.value.capacity, r.value.transmission, r.value.total, r.zone.nitsUsdPerMwYear]);
    const head = ['rank', 'zone', 'utility', 'states', 'retail_choice', 'energy_usd_yr', 'capacity_usd_yr', 'transmission_usd_yr', 'total_usd_yr', 'nits_usd_per_mw_yr'];
    const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + `\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `pjm-zones-${p.tagKw}kw-${Math.round(p.hitRate * 100)}pct.csv`; document.body.append(a); a.click(); a.remove();
  }

  function start([v, s]) {
    V = v; S = s;
    $('capYear').innerHTML = V.capacity.deliveryYears.map((y) => `<option value="${esc(y.year)}">${esc(y.year)}: $${y.usdPerMwDay}/MW-day</option>`).join('');
    ['tagKw', 'hitRate', 'capYear', 'capacityScale', 'includeEnergy', 'includeCapacity', 'includeTransmission', 'allowExports', 'pplNonbypass'].forEach((id) => $(id).addEventListener('input', render));
    $('zones').addEventListener('click', (e) => { const b = e.target.closest('[data-zone]'); if (!b) return; open = open === b.dataset.zone ? null : b.dataset.zone; render(); });
    $('dl').addEventListener('click', csv);
    render(); states(); method();
  }
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  function load() {
    $('error').innerHTML = '';
    Promise.all([get('/data/pjm-value.json'), get('/data/pjm-states.json').catch(() => null)]).then(start, (err) => {
      $('lede').textContent = '';
      $('error').innerHTML = '<div class="notice notice-red"><p>The PJM data failed to load. Check your connection, then try again.</p><button type="button" class="btn btn-outline btn-sm" id="retry">Try again</button></div>';
      $('retry').addEventListener('click', load);
      console.warn(err);
    });
  }
  load();
})();
