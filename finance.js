/* /finance page wiring. All math is in finance-core.js (window.FinanceCore). */
(function () {
  'use strict';
  const F = window.FinanceCore;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  let defaults = null;
  let zones = [];
  let zoneMeta = null;

  const usd = (x) => (Number.isFinite(x) ? `${x < 0 ? '-' : ''}$${Math.round(Math.abs(x)).toLocaleString('en-US')}` : 'n/a');
  const big = (x) => {
    const a = Math.abs(x), s = x < 0 ? '-' : '';
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
    return usd(x);
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const count = (x) => Math.round(x).toLocaleString('en-US');

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  function tag(kind) {
    return el('span', { class: `tag ${kind === 'sourced' ? 'tag-src' : 'tag-asm'}`, text: kind === 'sourced' ? 'Sourced' : 'Assumption' });
  }

  function sourceLink(f) {
    if (!f.source) return null;
    const host = new URL(f.source).hostname.replace(/^www\./, '');
    return el('a', { href: f.source, text: `${host}${new URL(f.source).pathname}` });
  }

  function fields() { return defaults.groups.flatMap((g) => g.fields); }

  function buildInputs() {
    const wrap = $('groups');
    wrap.textContent = '';
    for (const g of defaults.groups) {
      const fs = el('fieldset', { class: 'fin-group' }, el('legend', { text: g.title }));
      for (const f of g.fields) {
        const id = `in-${f.key}`;
        const input = el('input', { id, name: f.key, type: 'number', inputmode: 'decimal', step: String(f.step ?? 'any'), value: String(f.value) });
        if (f.min != null) input.min = String(f.min);
        if (f.max != null) input.max = String(f.max);
        const note = el('p', { class: 'fin-note' }, f.note);
        const link = sourceLink(f);
        if (link) note.append(' ', link, `, retrieved ${f.retrieved}.`);
        fs.append(el('div', { class: 'fin-field' },
          el('label', { for: id }, `${f.label} `, tag(f.kind)),
          el('div', { class: 'fin-input' }, input, el('span', { class: 'fin-unit', text: f.unit })),
          note));
      }
      wrap.append(fs);
    }
  }

  function buildZones() {
    const sel = $('zone');
    sel.textContent = '';
    for (const z of zones) {
      sel.append(el('option', { value: z.id, text: `${z.id} (${z.kind}): $${Math.round(z.usdPerYear)}/yr` }));
    }
    const p = zoneMeta.period;
    const span = p ? `${p.start} to ${p.endExclusive} (end not included)` : '12 months';
    $('zone-period').textContent = span;
    $('zone-note').textContent = '';
    $('zone-note').append(`Energy arbitrage only, per battery per year, ${span}, fixed charge and discharge clock. Range $${Math.round(Math.min(...zones.map((z) => z.usdPerYear)))} to $${Math.round(Math.max(...zones.map((z) => z.usdPerYear)))}. `,
      el('a', { href: '/data/zone-value.json', text: 'Data and method' }), '.');
  }

  function setDefaults() {
    for (const f of fields()) $(`in-${f.key}`).value = String(f.value);
    $('revenueCase').value = defaults.revenueCaseDefault;
    $('zone').value = zones.some((z) => z.id === defaults.zoneDefault) ? defaults.zoneDefault : zones[0].id;
  }

  function readInputs() {
    const raw = { revenueCase: $('revenueCase').value };
    for (const f of fields()) {
      const v = $(`in-${f.key}`).value;
      raw[f.key] = v === '' ? 0 : Number(v);
    }
    const z = zones.find((x) => x.id === $('zone').value);
    raw.arbPerYear = z ? z.usdPerYear : 0;
    return F.normalize(raw);
  }

  function kpi(label, value, sub) {
    return el('div', { class: 'kpi' }, el('p', { class: 'kpi-label', text: label }), el('p', { class: 'kpi-value mono', text: value }), sub ? el('p', { class: 'kpi-sub', text: sub }) : null);
  }

  const BIND_TEXT = {
    dscr: 'Binding limit: cash flow (DSCR). More revenue or a cheaper loan raises the debt.',
    advance: 'Binding limit: advance rate on cost. Extra revenue does not raise the debt until the cap moves.',
    cost: 'Binding limit: net cost. The loan covers everything the member did not pay up front.',
    none: 'No debt: the weakest year has no cash left after operating cost.',
  };

  function renderKpis(r) {
    const k = $('kpis');
    k.textContent = '';
    k.append(
      kpi('Installed cost', usd(r.capex), `${usd(r.capex / Math.max(1e-9, readInputs().kwh))}/kWh`),
      kpi('CFADS, year 1', usd(r.year1Cfads), `weakest year in term ${usd(r.minCfads)}`),
      kpi('Debt', usd(r.debt), `${pct(r.debtPctCapex)} of cost`),
      kpi('Equity', usd(r.equity), `after ${usd(r.upfront)} from the member`),
    );
    const b = $('binding');
    b.textContent = BIND_TEXT[r.binding];
    b.dataset.binding = r.binding;
  }

  function renderMeaning(r) {
    const ul = $('meaning');
    ul.textContent = '';
    for (const line of F.explain(r)) ul.append(el('li', { text: line }));
    if (r.tenorClamped) ul.append(el('li', { text: `The loan term was cut to ${r.tenor} years so it does not outlive the battery.` }));
  }

  function renderCf(r) {
    const t = $('cf-table');
    t.textContent = '';
    const row = (name, val, note, cls) => el('tr', cls ? { class: cls } : {}, el('th', { scope: 'row' }, name, note ? el('span', { class: 'fin-row-note', text: note }) : null), el('td', { class: 'mono', text: usd(val) }));
    const off = (k) => (r.counted[k] === 0 && r.full[k] > 0 ? `${usd(r.full[k])} not counted in this case` : null);
    t.append(el('tbody', {},
      row('Member fees', r.counted.member, null),
      row('Retail energy margin', r.counted.retail, null),
      row('Utility toll', r.counted.toll, off('toll')),
      row('Energy arbitrage', r.counted.arb, off('arb')),
      row('Operating cost', -r.opex, null, 'neg'),
      row('CFADS', r.year1Cfads, null, 'total'),
      row('Yearly loan payment', -r.debtService, r.debt > 0 ? `${r.tenor} years at ${(r.rate * 100).toFixed(2)}%` : null, 'neg'),
      row('Left for equity, year 1', r.year1Cfads - r.debtService, r.minDscr ? `lowest coverage ${r.minDscr.toFixed(2)}x` : null, 'total'),
    ));
  }

  function renderChart(r) {
    const host = $('cf-chart');
    host.textContent = '';
    const W = 600, H = 200, pad = { l: 52, r: 8, t: 10, b: 24 };
    const vals = r.years.map((y) => y.cfads);
    const max = Math.max(1, r.debtService, ...vals);
    const min = Math.min(0, ...vals);
    const y = (v) => pad.t + (max - v) / (max - min) * (H - pad.t - pad.b);
    const bw = (W - pad.l - pad.r) / vals.length;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `CFADS per year from ${usd(vals[0])} in year 1 to ${usd(vals[vals.length - 1])} in year ${vals.length}; loan payment ${usd(r.debtService)} for ${r.tenor} years.`);
    const add = (name, a) => { const n = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); svg.append(n); return n; };
    for (const v of [max, (max + min) / 2, min]) {
      add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' });
      add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }).textContent = usd(v);
    }
    vals.forEach((v, i) => {
      const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
      add('rect', { x: pad.l + i * bw + bw * 0.15, y: top, width: bw * 0.7, height: Math.max(0.5, bottom - top), rx: 3, class: v >= 0 ? (i < r.tenor ? 'bar' : 'bar bar-free') : 'bar bar-neg' });
      if (vals.length <= 15 || i % 2 === 0) add('text', { x: pad.l + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }).textContent = String(i + 1);
    });
    if (r.debtService > 0) {
      add('line', { x1: pad.l, x2: pad.l + r.tenor * bw, y1: y(r.debtService), y2: y(r.debtService), class: 'ds' });
    }
    host.append(svg);
  }

  function renderSizing(r) {
    const ol = $('sizing');
    ol.textContent = '';
    const li = (...k) => ol.append(el('li', {}, ...k));
    li(`Weakest CFADS in the ${r.tenor}-year term: `, el('b', { class: 'mono', text: usd(r.minCfads) }), '.');
    li(`Divide by target DSCR ${r.dscrTarget.toFixed(2)}x: the loan can cost at most `, el('b', { class: 'mono', text: `${usd(r.allowedPayment)}/yr` }), '.');
    li(`Present value at ${(r.rate * 100).toFixed(2)}% over ${r.tenor} years (factor ${F.annuityFactor(r.rate, r.tenor).toFixed(3)}): cash flow supports `, el('b', { class: 'mono', text: usd(r.dscrDebt) }), '.');
    li(`Cap: advance rate x cost = `, el('b', { class: 'mono', text: usd(r.advanceCap) }), `; cost minus member payment = `, el('b', { class: 'mono', text: usd(r.netCapex) }), '.');
    li('Debt is the lowest of these: ', el('b', { class: 'mono', text: usd(r.debt) }), `. Equity fills the rest: `, el('b', { class: 'mono', text: usd(r.equity) }), '.');
  }

  function renderFleet(r, inp) {
    const n = inp.fleetCount;
    const mwCount = F.batteriesForMw(100, inp.kw);
    const a = F.fleet(r, n), b = F.fleet(r, mwCount);
    const t = $('fleet');
    t.textContent = '';
    const row = (name, x, y, fmt = big) => el('tr', {}, el('th', { scope: 'row', text: name }), el('td', { class: 'mono', text: fmt(x) }), el('td', { class: 'mono', text: fmt(y) }));
    t.append(
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: 'Fleet input' }), el('th', { scope: 'col', text: '100 MW' }))),
      el('tbody', {},
        row('Batteries', a.count, b.count, count),
        row('Power', a.count * inp.kw / 1000, b.count * inp.kw / 1000, (x) => `${Math.round(x).toLocaleString('en-US')} MW`),
        row('Installed cost', a.capex, b.capex),
        row('Member upfront payments', a.upfront, b.upfront),
        row('Debt', a.debt, b.debt),
        row('Equity', a.equity, b.equity),
        row('Yearly loan payment', a.debtService, b.debtService),
        row('CFADS, year 1', a.year1Cfads, b.year1Cfads),
      ),
    );
  }

  function renderSens(inp) {
    const tolls = [0, 30, 60, 90, 120, 180];
    const rates = [0.06, 0.08, 0.10, 0.12];
    const g = F.sensitivity(inp, tolls, rates);
    const maxDebt = Math.max(1, ...g.flatMap((r) => r.cells.map((c) => c.debt)));
    const t = $('sens');
    t.textContent = '';
    t.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Toll $/kW-yr' }), ...rates.map((x) => el('th', { scope: 'col', text: `${Math.round(x * 100)}%` })))));
    const body = el('tbody');
    for (const row of g) {
      const cur = Math.abs(row.toll - inp.tollPerKwYear) < 1e-9;
      body.append(el('tr', cur ? { class: 'cur' } : {}, el('th', { scope: 'row', text: `$${row.toll}${cur ? ' (now)' : ''}` }),
        ...row.cells.map((c) => {
          const td = el('td', { class: `mono b-${c.binding === 'cost' ? 'advance' : c.binding}`, text: usd(c.debt) });
          td.style.setProperty('--fill', `${Math.round(c.debt / maxDebt * 100)}%`);
          if (Math.abs(c.rate - inp.rate) < 1e-9 && cur) td.classList.add('here');
          return td;
        })));
    }
    t.append(body);
    $('sens-sub').textContent = inp.revenueCase === 'merchant'
      ? 'Rows: utility toll. Columns: interest rate. The merchant case does not count the toll, so rows match. Switch the revenue case to see the toll matter.'
      : 'Rows: utility toll. Columns: interest rate. All other inputs as set.';
  }

  function renderLedger() {
    const t = $('ledger');
    t.textContent = '';
    t.append(el('thead', {}, el('tr', {}, ...['Input', 'Default', 'Type', 'Where it comes from'].map((h) => el('th', { scope: 'col', text: h })))));
    const body = el('tbody');
    const add = (name, val, kind, ...src) => body.append(el('tr', {}, el('th', { scope: 'row', text: name }), el('td', { class: 'mono', text: val }), el('td', {}, tag(kind)), el('td', {}, ...src)));
    add('Revenue case', 'Tolled to a utility', 'assumption', 'Base names tolling and build-transfer. Which one, and at what price, is not public.');
    add('Energy arbitrage zone', defaults.zoneDefault, 'sourced', 'ERCOT prices, our fixed-clock simulation. ', el('a', { href: '/data/zone-value.json', text: 'zone-value.json' }));
    for (const f of fields()) {
      const link = sourceLink(f);
      add(f.label, `${f.value} ${f.unit}`, f.kind, f.note, link ? ' ' : null, link, link ? `, retrieved ${f.retrieved}.` : null);
    }
    add('Base debt terms', 'unknown', 'assumption', 'No public debt facility or terms found in a search on 2026-10-30. Rate, term, DSCR and advance rate above are placeholders.');
    t.append(body);
  }

  function update() {
    const inp = readInputs();
    const r = F.sizeDebt(inp);
    renderKpis(r);
    renderMeaning(r);
    renderCf(r);
    renderChart(r);
    renderSizing(r);
    renderFleet(r, inp);
    renderSens(inp);
  }

  async function load() {
    try {
      const [d, z] = await Promise.all([
        fetch('/data/finance-defaults.json').then((x) => { if (!x.ok) throw new Error(x.status); return x.json(); }),
        fetch('/data/zone-value.json').then((x) => { if (!x.ok) throw new Error(x.status); return x.json(); }),
      ]);
      defaults = d;
      zoneMeta = z;
      zones = z.zones.slice().sort((a, b) => b.usdPerYear - a.usdPerYear);
      buildInputs();
      buildZones();
      setDefaults();
      renderLedger();
      $('inputs').addEventListener('input', update);
      $('inputs').addEventListener('change', update);
      $('reset').addEventListener('click', () => { setDefaults(); update(); });
      $('status').hidden = true;
      $('app').hidden = false;
      update();
    } catch (e) {
      $('status').textContent = "We couldn't load the input data, so there is nothing to show. Try reloading.";
    }
  }

  load();
})();
