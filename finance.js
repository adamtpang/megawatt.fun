/* /finance page wiring. All math is in finance-core.js (window.FinanceCore). */
(function () {
  'use strict';
  const F = window.FinanceCore;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  let defaults = null;
  let publicDefaults = null;
  let arbOverride = null;
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
    if (kind === 'yours') return el('span', { class: 'badge badge-solid', text: 'Yours' });
    return el('span', { class: `badge ${kind === 'sourced' ? 'badge-green' : 'badge-yellow'}`, text: kind === 'sourced' ? 'Sourced' : 'Assumption' });
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
        // type=text: a number input hides what was typed when it is not a number, so the
        // error could not name it. Validation is FinanceCore.validateFields, the API's rules.
        const input = el('input', { id, name: f.key, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: String(f.value), placeholder: String(f.value), 'aria-describedby': `err-${f.key}` });
        const note = el('p', { class: 'fin-note' }, f.note);
        const err = el('p', { class: 'fin-error', id: `err-${f.key}`, hidden: '' });
        const link = sourceLink(f);
        if (link) note.append(' ', link, `, retrieved ${f.retrieved}.`);
        fs.append(el('div', { class: 'fin-field' },
          el('label', { for: id }, `${f.label} `, tag(f.kind)),
          el('div', { class: 'fin-input' }, input, el('span', { class: 'fin-unit', text: f.unit })),
          err,
          note));
      }
      wrap.append(fs);
    }
  }

  function buildZones() {
    const sel = $('zone');
    sel.textContent = '';
    if (!zones.length) {
      sel.append(el('option', { value: '', text: 'No zone data available' }));
      sel.disabled = true;
      $('zone-note').textContent = 'The zone value file has no zones, so energy arbitrage counts as $0.';
      return;
    }
    for (const z of zones) {
      sel.append(el('option', { value: z.id, text: `${z.id} (${z.kind}): $${Math.round(z.usdPerYear)}/yr` }));
    }
    const p = zoneMeta.period;
    const span = p ? `${p.start} to ${p.endExclusive} (end not included)` : '12 months';
    $('zone-period').textContent = span;
    $('zone-note').textContent = '';
    const clock = zoneMeta.schedule && zoneMeta.schedule.label ? `${zoneMeta.schedule.label}` : 'fixed charge and discharge clock';
    $('zone-note').append(`Energy arbitrage only, per battery per year, ${span}. ${clock}. Range $${Math.round(Math.min(...zones.map((z) => z.usdPerYear)))} to $${Math.round(Math.max(...zones.map((z) => z.usdPerYear)))}. `,
      el('a', { href: '/data/zone-value.json', text: 'Data and method' }), '.');
  }

  function setDefaults() {
    for (const f of fields()) $(`in-${f.key}`).value = String(f.value);
    $('revenueCase').value = defaults.revenueCaseDefault;
    if (zones.length) $('zone').value = F.pickZone(zones.map((z) => z.id), defaults.zoneDefault);
  }

  // Model inputs from the form, or null when any field is invalid. A blank field keeps
  // its default. Errors show under the field; nothing is computed from a bad value.
  function readInputs() {
    const typed = {};
    for (const f of fields()) typed[f.key] = $(`in-${f.key}`).value;
    const { values, errors } = F.validateFields(defaults, typed);
    for (const f of fields()) {
      const input = $(`in-${f.key}`), err = $(`err-${f.key}`);
      const msg = Object.prototype.hasOwnProperty.call(errors, f.key) ? errors[f.key] : '';
      err.textContent = msg ? `${msg} Allowed: ${f.min} to ${f.max}${f.integer ? ', whole numbers' : ''}.` : '';
      err.hidden = !msg;
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    const bad = Object.keys(errors).length;
    const note = $('invalid');
    note.hidden = !bad;
    note.textContent = bad ? `${bad} input${bad === 1 ? ' is' : 's are'} not valid, so the results below are from the last valid inputs. Fix the field${bad === 1 ? '' : 's'} marked in red.` : '';
    $('results').classList.toggle('is-stale', !!bad);
    if (bad) return null;
    const raw = Object.assign({ revenueCase: $('revenueCase').value }, values);
    const z = zones.find((x) => x.id === $('zone').value);
    raw.arbPerYear = arbOverride != null ? arbOverride : (z ? z.usdPerYear : 0);
    return F.normalize(raw);
  }

  function kpi(label, value, sub) {
    return el('div', { class: 'card kpi' }, el('p', { class: 'kpi-label', text: label }), el('p', { class: 'kpi-value mono', text: value }), sub ? el('p', { class: 'kpi-sub', text: sub }) : null);
  }

  function renderKpis(r, inp) {
    const k = $('kpis');
    k.textContent = '';
    k.append(
      kpi('Installed cost', usd(r.capex), inp.kwh > 0 ? `${usd(r.capex / inp.kwh)}/kWh` : 'no energy capacity'),
      kpi('CFADS, year 1', usd(r.year1Cfads), `weakest year in term ${usd(r.minCfads)}`),
      kpi('Debt', usd(r.debt), `${pct(r.debtPctCapex)} of cost`),
      kpi('Equity', usd(r.equity), r.equity <= 0 && r.netCapex > 0
        ? 'none: the loan covers the whole net cost (see What this means)'
        : `after ${usd(r.upfront)} from the member and ${usd(r.itc)} from selling the tax credit`),
    );
    const b = $('binding');
    b.textContent = F.bindingText(r);
    b.dataset.binding = r.binding;
    const noDebt = r.debt <= 0;
    b.classList.toggle('notice-green', !noDebt);
    b.classList.toggle('notice-red', noDebt);
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
    const row = (name, val, note, cls) => el('tr', cls ? { class: cls } : {}, el('th', { scope: 'row' }, name, note ? el('span', { class: 'fin-row-note', text: note }) : null), el('td', { class: 'num mono', text: usd(val) }));
    const off = (k) => (r.counted[k] === 0 && r.full[k] > 0 ? `${usd(r.full[k])} not counted in this case` : null);
    t.append(el('tbody', {},
      row('Member fees', r.counted.member, null),
      row('Retail energy margin', r.counted.retail, r.counted.retail === 0 ? 'left out (set to $0)' : 'only if the owner is the home\'s retail provider'),
      row('Utility toll', r.counted.toll, off('toll')),
      row('Energy arbitrage', r.counted.arb, off('arb')),
      row('Ancillary services (ADER)', r.counted.anc, off('anc')),
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
    li(`Tax credit at ${pct(r.itcRate)} of cost: ${usd(r.itcFace)} face value, sold at ${(r.itcPrice * 100).toFixed(1)} cents per dollar = `, el('b', { class: 'mono', text: usd(r.itc) }), ' in cash when the battery goes into service.');
    li(`Cap: advance rate x cost = `, el('b', { class: 'mono', text: usd(r.advanceCap) }), `; cost minus member payment minus tax credit = `, el('b', { class: 'mono', text: usd(r.netCapex) }), '.');
    li('Debt is the lowest of these: ', el('b', { class: 'mono', text: usd(r.debt) }), `. Equity fills the rest: `, el('b', { class: 'mono', text: usd(r.equity) }), '.');
  }

  function renderFleet(r, inp) {
    const n = inp.fleetCount;
    const mwCount = F.batteriesForMw(100, inp.kw);
    const a = F.fleet(r, n), b = F.fleet(r, mwCount);
    const t = $('fleet');
    t.textContent = '';
    const row = (name, x, y, fmt = big) => el('tr', {}, el('th', { scope: 'row', text: name }), el('td', { class: 'num mono', text: fmt(x) }), el('td', { class: 'num mono', text: fmt(y) }));
    t.append(
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', class: 'num', text: 'Fleet input' }), el('th', { scope: 'col', class: 'num', text: '100 MW' }))),
      el('tbody', {},
        row('Batteries', a.count, b.count, count),
        row('Power', a.count * inp.kw / 1000, b.count * inp.kw / 1000, (x) => `${Math.round(x).toLocaleString('en-US')} MW`),
        row('Installed cost', a.capex, b.capex),
        row('Member upfront payments', a.upfront, b.upfront),
        row('Tax credit, cash from sale', a.itc, b.itc),
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
    t.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Toll $/kW-yr' }), ...rates.map((x) => el('th', { scope: 'col', class: 'num', text: `${Math.round(x * 100)}%` })))));
    const body = el('tbody');
    for (const row of g) {
      const cur = Math.abs(row.toll - inp.tollPerKwYear) < 1e-9;
      body.append(el('tr', cur ? { class: 'cur' } : {}, el('th', { scope: 'row', text: `$${row.toll}${cur ? ' (now)' : ''}` }),
        ...row.cells.map((c) => {
          const td = el('td', { class: `num mono b-${c.binding === 'cost' ? 'advance' : c.binding}`, text: usd(c.debt) });
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
    add('Revenue case', F.CASES[publicDefaults.revenueCaseDefault].label, 'assumption', 'Merchant by default: it counts only public numbers (member fees and ERCOT arbitrage), not the toll placeholder. A utility toll is a private contract with no public price. Ancillary services count in merchant and stacked but default to $0.');
    add('Energy arbitrage zone', defaults.zoneDefault, 'sourced', 'ERCOT prices, our fixed-clock simulation. ', el('a', { href: '/data/zone-value.json', text: 'zone-value.json' }));
    for (const f of fields()) {
      const link = sourceLink(f);
      add(f.label, `${f.value} ${f.unit}`, f.kind, f.note, link ? ' ' : null, link, link ? `, retrieved ${f.retrieved}.` : null);
    }
    add('Lender terms', 'generic', 'assumption', "Rate, term, DSCR and advance rate above are generic placeholders, not any company's debt terms.");
    t.append(body);
  }

  function update() {
    const inp = readInputs();
    if (!inp) return;
    const r = F.sizeDebt(inp);
    renderKpis(r, inp);
    renderMeaning(r);
    renderCf(r);
    renderChart(r);
    renderSizing(r);
    renderFleet(r, inp);
    renderSens(inp);
  }

  /* Plug in a company's own inputs (yourdata.js). The public defaults stay untouched.
     fileZone: the file's zone, or null when it sets none. reset: "Back to public data".
     buildZones() rebuilds the zone list, so the zone is chosen after it (FinanceCore.zoneAfterLoad):
     the file's zone if it has one, else the zone on screen; reset restores the public default. */
  function useDefaults(d, arb, fileZone, reset) {
    const current = $('zone').value;
    defaults = d;
    arbOverride = arb;
    buildInputs();
    renderLedger();
    buildZones();
    setDefaults();
    if (zones.length) {
      $('zone').value = F.zoneAfterLoad({ zoneIds: zones.map((z) => z.id), current, fileZone, publicZone: publicDefaults.zoneDefault, reset: !!reset });
    }
    if (arb != null) $('zone-note').textContent = `Using your arbitrage value, $${Math.round(arb)} per battery per year. The zone list is ignored.`;
    update();
  }

  function mountYourData() {
    if (!window.YourData) return;
    window.YourData.mount({
      el: $('yourdata'),
      tool: 'finance',
      what: 'your own costs, revenue and loan terms',
      docs: '/plug-and-play#finance',
      templates: [{ name: 'finance-inputs.csv', label: 'Download CSV template', text: () => window.YourData.toCSV(F.templateRows(publicDefaults)) }],
      load(parsed) {
        const r = F.applyOverrides(publicDefaults, parsed, zones.map((z) => z.id));
        return {
          errors: r.errors,
          warnings: r.warnings,
          summary: `${r.changed.length} input${r.changed.length === 1 ? '' : 's'} changed${r.arbPerYear != null ? ', plus your arbitrage value' : ''}. Changed inputs are tagged Yours.`,
          apply: () => useDefaults(r.defaults, r.arbPerYear, r.zone, false),
        };
      },
      reset: () => useDefaults(publicDefaults, null, null, true),
    });
  }

  async function load() {
    try {
      const [d, z] = await Promise.all([
        fetch('/data/finance-defaults.json').then((x) => { if (!x.ok) throw new Error(x.status); return x.json(); }),
        fetch('/data/zone-value.json').then((x) => { if (!x.ok) throw new Error(x.status); return x.json(); }),
      ]);
      defaults = d;
      publicDefaults = d;
      zoneMeta = z;
      zones = (z.zones || []).slice().sort((a, b) => b.usdPerYear - a.usdPerYear);
      buildInputs();
      buildZones();
      setDefaults();
      renderLedger();
      $('inputs').addEventListener('input', update);
      $('inputs').addEventListener('change', update);
      $('reset').addEventListener('click', () => { setDefaults(); update(); });
      $('inputs').addEventListener('submit', (e) => e.preventDefault());
      $('status').hidden = true;
      $('app').hidden = false;
      update();
      mountYourData();
    } catch (e) {
      const s = $('status');
      s.classList.add('notice-red');
      s.textContent = "We couldn't load the input data, so there is nothing to show. Check your connection, then try again. ";
      const retry = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'Try again' });
      retry.addEventListener('click', () => {
        s.classList.remove('notice-red');
        s.textContent = 'Loading inputs...';
        load();
      });
      s.append(retry);
      $('app').hidden = true;
    }
  }

  load();
})();
