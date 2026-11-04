// The /pitch page controller (pitch.js) in a tiny fake DOM: the utility box uses the same matcher as the API,
// a failed Build suggests the closest utility and marks the old sheet stale, and small programs keep their precision.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const P = require('../pitch-core.js');
const MAP = require('../data/expansion-map.json');
const MARKET = require('../data/market-states.json');

function el(id) {
  const e = {
    id, value: '', hidden: true, disabled: false, className: '', textContent: '', innerHTML: '', children: [], attrs: {}, listeners: {}, classes: new Set(),
    get firstChild() { return e.children[0] || null; },
    classList: { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) },
    setAttribute(k, v) { e.attrs[k] = String(v); }, removeAttribute(k) { delete e.attrs[k]; }, getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
    addEventListener(t, f) { (e.listeners[t] = e.listeners[t] || []).push(f); },
    appendChild(c) { e.children.push(c); return c; },
    insertBefore(c) { e.children.unshift(c); if (c.id) REG[c.id] = c; return c; },
    scrollIntoView() {},
    closest() { return 'data-id' in e.attrs ? e : null; },
    fire(t, ev) { (e.listeners[t] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: e }, ev || {}))); },
  };
  Object.defineProperty(e, 'textContent', {
    get() { return e._text + e.children.map((c) => c.textContent || '').join(''); },
    set(v) { e._text = String(v); e.children = []; },
  });
  e._text = '';
  return e;
}
let REG;
const IDS = ['controls', 'build', 'status', 'utility-list', 'utility', 'mw', 'largeloads', 'print', 'ranking-panel', 'sheet', 'ranking-title', 'ranking-help', 'ranking'];

async function page() {
  REG = {};
  IDS.forEach((id) => { REG[id] = el(id); });
  REG.mw.value = '100';
  const document = {
    readyState: 'complete',
    getElementById: (id) => REG[id] || null,
    createDocumentFragment: () => el(''),
    createElement: () => el(''),
    createTextNode: (t) => ({ textContent: String(t) }),
    addEventListener() {},
  };
  const files = { '/data/expansion-map.json': MAP, '/data/market-states.json': MARKET };
  const window = { document, print() {} };
  const ctx = vm.createContext({ window, document, fetch: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(files[u]) }), console, Promise });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'pitch-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'pitch.js'), 'utf8'), ctx);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.match(REG.status.textContent, /^Ready/);
  return {
    $: REG,
    build(text) { REG.utility.value = text; REG.controls.fire('submit'); },
    type(text) { REG.utility.value = text; REG.utility.fire('input'); },
  };
}

test('page: Build accepts ids, names, aliases and short names in any case, like the API', async () => {
  const pg = await page();
  const cases = { CoServ: 'CoServ Electric', '5078-TX': 'CoServ Electric', 'coserv electric': 'CoServ Electric', 'Austin Energy': 'Austin Energy', Oncor: 'Oncor', ComEd: 'Commonwealth Edison', 'Oncor, TX': 'Oncor' };
  for (const [typed, shown] of Object.entries(cases)) {
    pg.build(typed);
    assert.equal(pg.$.status.className, 'pt-status', typed + ': ' + pg.$.status.textContent);
    assert.equal(pg.$.sheet.hidden, false);
    assert.ok(pg.$.sheet.innerHTML.includes(shown), typed);
  }
});

test('page: a failed Build names the closest utility, offers it as a button, and marks the old sheet stale', async () => {
  const pg = await page();
  pg.build('Austin Energy');
  assert.equal(pg.$.print.disabled, false);
  pg.build('Austin Enrgy');
  assert.match(pg.$.status.className, /notice-red/);
  assert.match(pg.$.status.textContent, /No utility called "Austin Enrgy"\. Did you mean Austin Energy, TX/);
  const btn = pg.$.status.children.find((c) => c.attrs && c.attrs['data-id']);
  assert.equal(btn.attrs['data-id'], '1015-TX');
  assert.ok(pg.$.sheet.classes.has('pt-stale'));
  assert.equal(pg.$.print.disabled, true, 'a stale sheet cannot be printed');
  assert.match(pg.$.sheet.children[0].textContent, /^Out of date: this sheet is still for Austin Energy, TX, not "Austin Enrgy"/);
  // Clicking the suggestion builds it and clears the stale mark.
  pg.$.status.fire('click', { target: btn });
  assert.ok(!pg.$.sheet.classes.has('pt-stale'));
  assert.equal(pg.$.print.disabled, false);
  assert.match(pg.$.status.textContent, /^Ready/);
  // Ambiguous names list choices; a bare state offers its top-ranked utility.
  pg.build('AEP Texas');
  assert.match(pg.$.status.textContent, /matches 2 utilities\. Pick one:/);
  assert.equal(pg.$.status.children.filter((c) => c.attrs && c.attrs['data-id']).length, 2);
  pg.build('GA');
  assert.match(pg.$.status.textContent, /GA is a state\. Pick one of its utilities from the list\. Top of its call ranking: /);
  pg.build('');
  assert.match(pg.$.status.textContent, /^Type a utility name/);
  pg.build('x'.repeat(300));
  assert.match(pg.$.status.textContent, /longer than 200 characters/);
  // Typing a name that matches rebuilds the sheet as before.
  pg.type('Oncor');
  assert.ok(!pg.$.sheet.classes.has('pt-stale'));
  assert.ok(pg.$.sheet.innerHTML.includes('Oncor'));
});

test('page: a tiny program shows kW and kWh and says it was rounded up to one battery', async () => {
  const pg = await page();
  pg.$.mw.value = '0.0001';
  pg.build('5078-TX');
  const h = pg.$.sheet.innerHTML;
  assert.ok(!/0\.0 MW/.test(h), 'no "0.0 MW"');
  assert.ok(h.includes('<dd>20 kW</dd>'), 'nameplate in kW');
  assert.ok(h.includes('<dd>39.2 kWh</dd>'), 'energy in kWh');
  assert.ok(h.includes('rounded up to whole batteries from your 0.1 kW'));
  assert.ok(h.includes('You asked for 0.1 kW. Batteries come whole, so this is 1 battery at 20 kW each: 20 kW nameplate, rounded up.'));
  assert.ok(!h.includes('$0.0M'), 'landed cost under $1M is shown in dollars');
  pg.$.mw.value = '100';
  pg.$.mw.fire('input');
  assert.ok(pg.$.sheet.innerHTML.includes('<dd>100 MW</dd>'));
  assert.ok(!pg.$.sheet.innerHTML.includes('rounded up'));
});

test('core: every short name points at a real row, and the matcher caps input length', () => {
  const ids = new Set(MAP.utilities.map((u) => u.id));
  for (const id of Object.keys(P.SHORT_NAMES)) assert.ok(ids.has(id), id);
  const idx = P.utilityIndex(MAP.utilities);
  assert.deepEqual(P.matchUtility(idx, 'A'.repeat(201)), { tooLong: true, suggestion: null });
  assert.equal(P.matchUtility(idx, 'Oncor').u.id, '44372-TX');
  assert.equal(P.matchUtility(idx, 'oncor electric delivery').u.id, '44372-TX');
  assert.equal(P.matchUtility(idx, 'Austin Enrgy', null, { suggest: false }).suggestion, null);
  assert.equal(P.clip('abc'), 'abc');
  assert.equal(P.clip('x'.repeat(100)), 'x'.repeat(60) + '... (100 characters)');
  const t = Date.now();
  P.matchUtility(idx, 'Q'.repeat(200));
  assert.ok(Date.now() - t < 200, 'a 200-character miss is quick');
});
