/* No model-generated number enters the calculator or ranking. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), D = window.Deployment, M = window.MarketIntelligence;
  const money = (x, digits = 0) => Number.isFinite(x) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(x) : 'Missing';
  const number = x => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(x);
  const safe = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let prices, sites, geometry, selected = '48201', selectedPoint = 'LZ_HOUSTON', results = {}, stacks = {}, ranked = [], diagnostics = {}, liveAI = false, busy = false;
  let periodLabel = '';
  let params = { ...D.DEFAULTS }, history = [];
  const site = () => sites.sites.find(s => s.county === selected && s.segment === $('segment').value);
  const val = id => $(id).value.trim() === '' ? null : Number($(id).value);
  function battery() {
    for (const id of ['capacity', 'power', 'efficiency', 'reserve', 'wear']) if (val(id) === null) throw new Error(`Enter ${id} before recalculating.`);
    return D.parameters({ capacity: val('capacity'), power: val('power'), efficiency: val('efficiency') / 100,
      reserve: val('reserve') / 100, wear: val('wear') });
  }
  function drawMap() {
    const svg = $('texas-map'), ns = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const project = ([lon, lat]) => [(lon + 107) * 49, (37 - lat) * 55 + 10];
    for (const feature of geometry.features) {
      const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
      const d = polygons.map(poly => poly.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'}${project(p).map(n => n.toFixed(1)).join(',')}`).join(' ') + 'Z').join(' ')).join(' ');
      const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'county');
      const county = feature.properties.GEOID;
      if (sites.sites.some(s => s.county === county)) {
        path.dataset.county = county;
        const title = document.createElementNS(ns, 'title'); title.textContent = feature.properties.NAME; path.append(title);
        path.addEventListener('click', () => select(county));
      }
      svg.append(path);
    }
    for (const s of sites.sites.filter(s => s.segment === 'residential')) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = s.name.replace(' homes', ''); b.dataset.county = s.county;
      b.addEventListener('click', () => select(s.county)); $('map-buttons').append(b);
    }
  }
  function select(county) { selected = county; selectedPoint = site().zone; $('price-point').value = selectedPoint; renderEvidence(); renderEconomics(); }
  function renderEvidence() {
    const s = site(), point = selectedPoint, result = results[point], diag = diagnostics[point], stack = stacks[point];
    $('selected-name').textContent = point === s.zone ? s.name.replace(/ homes| businesses/, '') : point.replace(/^(HB|LZ)_/, '').replaceAll('_', ' ');
    $('selected-zone').textContent = `${point} / ${point === s.zone ? 'COUNTY PRICE PROXY' : prices.zones[point].kind.toUpperCase() + ' · NO SITE ASSIGNMENT'}`;
    $('annual-energy').textContent = money(result.net);
    $('battery-summary').textContent = `${params.capacity} kWh · ${params.power} kW · ${number(params.efficiency * 100)}% efficiency · ${number(params.reserve * 100)}% reserve${params.wear ? ' · wear deducted' : ''}`;
    const stats = [['Average DAM / RT · $/MWh', `${money(diag.meanDA, 2)} / ${money(diag.meanRT, 2)}`], ['Mean DAM − RT', `${money(diag.meanDASpread, 2)}/MWh`], ['Mean absolute spread', `${money(diag.meanAbsoluteSpread, 2)}/MWh`], ['RT volatility', `${money(diag.volatility, 2)}/MWh`], ['Spikes in top 3 hours', `${number(stack.topThreeHourShare * 100)}%`], ['Losing months', `${result.months.filter(m => m.net < 0).length} / ${result.months.length}`]];
    $('zone-stats').innerHTML = stats.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    $('monthly-results').innerHTML = result.months.map(m => `<tr><td>${m.month}</td><td>${money(m.energy, 2)}</td><td>${money(m.wear, 2)}</td><td class="${m.net < 0 ? 'negative' : ''}">${money(m.net, 2)}</td><td>$0.00</td></tr>`).join('');
    const counts = prices.zones[point].spikeIntervalsByHour, max = Math.max(1, ...counts);
    $('spike-summary').textContent = stack.spikeIntervals ? `${number(stack.spikeIntervals)} spike intervals. ${number(stack.topThreeHourShare * 100)}% occurred in hours starting ${stack.topHours.map(h => String(h).padStart(2, '0') + ':00').join(', ')}.` : 'No intervals met the spike threshold.';
    $('spike-chart').innerHTML = counts.map((v, h) => `<span style="height:${v / max * 100}%" title="${String(h).padStart(2, '0')}:00 — ${v} intervals" role="img" aria-label="${h}:00: ${v} spike intervals"></span>`).join('');
    const latest = diag.last;
    $('latest-price').textContent = `Last cached hour: ${latest[0]}, HE ${latest[1]} · DAM ${money(latest[3], 2)} · RT ${money(latest[4], 2)}/MWh. Historical, not live.`;
    $('price-download').href = `/data/deployment/${point}.csv`;
    const values = sites.sites.map(s => results[s.zone].net), min = Math.min(...values), range = Math.max(...values) - min;
    document.querySelectorAll('.county[data-county]').forEach(path => {
      const countySite = sites.sites.find(x => x.county === path.dataset.county);
      const intensity = range ? (results[countySite.zone].net - min) / range : .5;
      path.style.fill = `rgb(${Math.round(178 - intensity * 148)},${Math.round(221 - intensity * 144)},${Math.round(121 - intensity * 78)})`;
      path.classList.toggle('selected', path.dataset.county === selected);
    });
    $('map-buttons').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.county === selected)));
  }
  function renderRanking() {
    const weight = Number($('energy-weight').value) / 100;
    ranked = D.rank(sites.sites, results, weight, $('segment').value);
    const alternative = D.rank(sites.sites, results, .3, $('segment').value);
    $('weight-value').textContent = `${Math.round(weight * 100)}%`; $('scale-weight').textContent = `Market size ${Math.round(100 - weight * 100)}%`;
    $('ranked-sites').innerHTML = ranked.map((s, i) => `<tr><td><a href="#value" class="rank-target" data-county="${s.county}">${i + 1}. ${safe(s.name)}</a><span class="rank-reason">${safe(s.reason)}</span></td><td>${money(s.annualEnergy)}<span class="rank-reason">${s.zone} · ${periodLabel}</span></td><td><a class="evidence-link" href="${s.source}" target="_blank" rel="noopener">${number(s.scale)} ${safe(s.scaleLabel)} ↗</a><span class="rank-reason">Census · ${safe(s.vintage)}<br>Reviewed ${sites.reviewedAt}</span></td><td>${s.score === null ? '—' : s.score.toFixed(1)}</td></tr>`).join('');
    $('ranked-sites').querySelectorAll('[data-county]').forEach(a => a.addEventListener('click', () => select(a.dataset.county)));
    $('alternative-ranking').textContent = alternative.map((s, i) => `${i + 1}. ${s.name}`).join(' → ') + (alternative.every((s, i) => ranked[i]?.id === s.id) ? ' · Same order at the current weighting.' : ' · Order changes.');
    $('conclusion').textContent = `Investigate ${ranked.map(s => `${s.name} (${money(s.annualEnergy)}/battery/year in energy cashflow)`).join(', ')} in that order under these weights. These are regional screens, not approved installations. Meter eligibility, feeder headroom, customer tariffs and verified ancillary commitments could change the order; the evidence does not yet justify allocating 10,000 batteries.`;
  }
  function renderEconomics() {
    const s = site(), retail = $('valuation').value === 'retail';
    $('retail-inputs').hidden = !retail;
    $('peak-label').hidden = $('rate-plan').value === 'flat';
    $('economics-location').textContent = `${s.name.toUpperCase()} / ${retail ? 'BILL SCENARIO' : 'ENERGY SCENARIO'}`;
    try {
      const p = battery();
      let result = results[s.zone];
      if (retail) {
        if (val('annual-usage') === null || val('off-peak') === null || ($('rate-plan').value === 'tou' && val('peak') === null)) throw new Error('Enter annual usage and your tariff to calculate bill savings.');
        result = D.backtest(prices.zones[s.zone].rows, p, { tariff: { annualUsage: val('annual-usage'), profile: $('profile').value,
          offPeak: val('off-peak'), peak: $('rate-plan').value === 'flat' ? val('off-peak') : val('peak') } });
      }
      const e = D.economics(result, { cost: val('cost'), operatorShare: val('operator-share'), ancillary: val('ancillary'), reliability: val('reliability'), annualCost: val('annual-cost') });
      const parts = [[retail ? 'Customer bill savings' : 'Energy arbitrage', money(e.energy, 2)], ['Ancillary services', e.ancillary === null ? 'Missing' : money(e.ancillary)], ['Capacity / reliability', e.reliability === null ? 'Missing' : money(e.reliability)], ['Operator share', e.operatorShare === null ? 'Missing' : `${e.operatorShare}%`], ['Wear deduction', money(e.wear, 2)], ['Other annual costs', e.annualCost === null ? 'Missing' : money(e.annualCost)]];
      $('value-parts').innerHTML = parts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
      $('annual-total').textContent = e.total === null ? 'Needs inputs' : money(e.total);
      $('payback').textContent = e.payback === null ? (e.total !== null && e.total <= 0 ? 'No payback' : 'Needs inputs') : `${number(e.payback)} years`;
      $('economics-status').textContent = e.status === 'missing-inputs' ? 'Enter compensation and each missing value, including an explicit 0 for an energy-only scenario.' :
        `${e.cost === null ? 'Enter installed cost to estimate simple payback. ' : ''}User assumptions, not Base pricing.${(e.ancillary > 0 || e.reliability > 0) ? ' Added service values are not co-optimized or independently validated.' : ''} Residual inventory: ${number(result.residualKWh)} kWh; no terminal credit.`;
      $('calculation-error').hidden = true;
    } catch (error) {
      $('calculation-error').textContent = error.message; $('calculation-error').hidden = false;
      $('annual-total').textContent = 'Needs inputs'; $('payback').textContent = 'Needs inputs'; $('value-parts').replaceChildren(); $('economics-status').textContent = '';
    }
  }
  function updateBattery() {
    try {
      params = battery();
      stacks = Object.fromEntries(Object.entries(prices.zones).map(([zone, data]) => [zone, M.valueStack(data, params)]));
      results = Object.fromEntries(Object.entries(stacks).map(([zone, stack]) => [zone, stack.backtest]));
      window.dispatchEvent(new CustomEvent('market-update', { detail: { results, prices } }));
      $('load-error').hidden = true; $('load-error').textContent = ''; renderEvidence(); renderRanking(); renderEconomics();
    } catch (error) {
      $('load-error').textContent = `${error.message} Map and ranking retain the last valid battery settings.`; $('load-error').hidden = false; renderEconomics();
    }
  }
  function message(text, role = 'assistant') {
    const p = document.createElement('p'); p.className = `${role}-message`; p.textContent = text;
    $('franklin-messages').append(p); p.scrollIntoView({ block: 'nearest' });
  }
  function guide(question) {
    if (!prices) return 'The evidence has not loaded yet. Check the data status above.';
    if (question.includes('payback')) return 'Energy cashflow is only one part of payback. We still need installed cost, operator compensation, annual costs and explicit choices for other revenues. “Use energy-only scenario” sets the extra values to zero; it does not reveal Base’s economics.';
    if (question.includes('ranking')) return `The ranking mixes backtested energy value with county market size. Try the 30% energy weighting. ${ranked[0].name} currently leads, but actual meter eligibility, tariff and feeder constraints could overturn this county-level screen. No addresses are qualified yet.`;
    return `We replay a simple clock rule against a year of real ERCOT prices. ${site().name} uses ${site().zone} as a price proxy and produces ${money(results[site().zone].net)}/battery/year under the displayed settings. This compares regions; it is not Base revenue or a customer offer. I’m in guide mode, using the page’s calculations—not a live AI model.`;
  }
  async function ask(question) {
    if (!question.trim() || busy) return;
    message(question, 'user');
    if (!liveAI) { message(guide(question)); return; }
    busy = true; $('franklin-send').disabled = true; $('franklin-send').textContent = 'Reading the evidence…';
    try {
      const response = await fetch('/api/franklin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: history.slice(-6), zone: site().zone, segment: $('segment').value, energyWeight: Number($('energy-weight').value) / 100, battery: params }), signal: AbortSignal.timeout(30000) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Franklin is unavailable.');
      message(body.answer); history.push({ role: 'user', content: question }, { role: 'assistant', content: body.answer });
      $('franklin-question').value = '';
    } catch (error) { message(`Could not reach Franklin. ${error.message} The calculations above still work.`); }
    finally { busy = false; $('franklin-send').disabled = false; $('franklin-send').textContent = 'Ask Franklin'; }
  }
  function setPanel(open) {
    $('franklin-panel').hidden = !open; $('franklin-launch').setAttribute('aria-expanded', String(open));
    (open ? $('franklin-close') : $('franklin-launch')).focus();
  }
  const sectionLinks = [...document.querySelectorAll('.section-nav a[href^="#"]')];
  function markSection(id) {
    sectionLinks.forEach(link => {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  const sectionObserver = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (visible) markSection(visible.target.id);
  }, { rootMargin: '-25% 0px -65% 0px' });
  ['value', 'sites', 'economics'].forEach(id => sectionObserver.observe($(id)));
  sectionLinks.forEach(link => link.addEventListener('click', () => markSection(link.hash.slice(1))));
  $('franklin-launch').addEventListener('click', () => setPanel($('franklin-panel').hidden));
  $('franklin-close').addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('franklin-panel').hidden) setPanel(false); });
  document.querySelectorAll('[data-question]').forEach(b => b.addEventListener('click', () => ask(b.dataset.question)));
  $('franklin-send').addEventListener('click', () => ask($('franklin-question').value));
  $('franklin-question').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); } });
  async function start() {
    try {
      [prices, sites, geometry] = await Promise.all([M.loadPrices(), ...['sites.json', 'texas-counties.geojson'].map(async name => {
        const r = await fetch(`/data/deployment/${name}`); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.json();
      })]);
      periodLabel = `${prices.period.start} – ${prices.period.endExclusive} (exclusive)`;
      $('price-period').textContent = periodLabel;
      $('price-point').innerHTML = Object.entries(prices.zones).map(([point, series]) => `<option value="${point}">${point} · ${series.kind}</option>`).join('');
      $('price-point').value = selectedPoint;
      $('price-point').addEventListener('change', () => { selectedPoint = $('price-point').value; renderEvidence(); });
      diagnostics = Object.fromEntries(Object.entries(prices.zones).map(([z, data]) => [z, D.diagnostics(data.rows)]));
      drawMap(); updateBattery();
      $('data-status').textContent = `${Object.keys(prices.zones).length} settlement points · 12 complete months · public data`;
      $('retrieved-date').textContent = prices.sources.map(s => s.retrievedAt.slice(0, 10)).sort().at(-1) || 'See manifest';
      ['capacity', 'power', 'efficiency', 'reserve', 'wear'].forEach(id => $(id).addEventListener('input', updateBattery));
      $('energy-weight').addEventListener('input', renderRanking);
      $('segment').addEventListener('change', () => { renderRanking(); renderEvidence(); renderEconomics(); });
      $('use-alternative').addEventListener('click', () => { $('energy-weight').value = 30; renderRanking(); });
      ['valuation', 'annual-usage', 'profile', 'rate-plan', 'off-peak', 'peak', 'cost', 'operator-share', 'annual-cost', 'ancillary', 'reliability'].forEach(id => $(id).addEventListener('input', renderEconomics));
      $('energy-only').addEventListener('click', () => { ['operator-share', 'annual-cost', 'ancillary', 'reliability'].forEach(id => $(id).value = 0); renderEconomics(); });
    } catch (error) {
      $('load-error').hidden = false; $('load-error').textContent = `Public dataset unavailable: ${error.message}. No estimates substituted.`;
      $('data-status').textContent = 'Data unavailable'; $('conclusion').textContent = 'A deployment conclusion needs the cached evidence. Restore the dataset to continue.';
    }
    try {
      const r = await fetch('/api/franklin'); if (!r.ok) return;
      const config = await r.json(); liveAI = config.enabled === true;
      if (liveAI) { $('franklin-mode').textContent = 'AI · grounded in this dataset'; $('franklin-question').disabled = false; $('franklin-send').disabled = false; }
    } catch (_) { /* Static preview retains explicit guide mode. */ }
  }
  start();
})();
