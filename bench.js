(function () {
  'use strict';
  const D = window.DispatchBench, $ = id => document.getElementById(id);
  const labels = { idle: 'Hold reserve', clock: 'Fixed clock', unguarded: 'Unguarded price plan', guarded: 'Guarded price plan' };
  const dollars = x => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(x);
  const n = x => x.toFixed(1);
  let source, runs, current;
  const keys = ['reserve', 'efficiency', 'affected', 'fleet', 'forecast', 'fault'];
  function unavailable(message) {
    runs = null; current = null;
    $('load-error').textContent = message; $('load-error').hidden = false;
    for (const prefix of ['without', 'with']) {
      $(prefix+'-number').textContent = '—';
      $(prefix+'-caption').textContent = 'No result';
      $(prefix+'-dots').textContent = '';
      $(prefix+'-delivery').textContent = '';
    }
    for (const id of ['delivery-chart','fleet-map','ledger','verdict','device-note','share-status']) $(id).textContent = '';
    $('comparison').querySelector('tbody').textContent = '';
    $('run-status').textContent = 'No replay calculated.';
    $('simple-takeaway').textContent = 'No result. Correct the experiment to try again.';
    for (const id of ['download-trace','download-run','share','policy','device']) $(id).disabled = true;
  }
  function options() {
    return { reserve: +$('reserve').value / 100, efficiency: +$('efficiency').value / 100, affected: +$('affected').value / 100, fleet: +$('fleet').value, forecast: $('forecast').value, fault: $('fault').value };
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function chart(r) {
    const width = 1000, height = 260, left = 65, top = 20, plotHeight = 190, dx = (width - left - 20) / 24;
    const max = Math.max(1, ...r.hours.flatMap(h => [Math.abs(h.scheduled), Math.abs(h.delivered)]));
    const y = v => top + plotHeight / 2 - v / max * plotHeight / 2;
    let content = `<line x1="${left}" x2="980" y1="${y(0)}" y2="${y(0)}" stroke="#7f7d7a"/>`;
    for (const v of [-max, 0, max]) content += `<text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    for (const h of r.hours) {
      const x = left + dx * h.hour, yp = y(h.scheduled), yd = y(h.delivered);
      content += `<rect x="${x + 3}" y="${Math.min(y(0), yp)}" width="${dx - 6}" height="${Math.abs(y(0) - yp)}" fill="#d8d7d5" stroke="#7f7d7a"/><rect x="${x + dx / 3}" y="${Math.min(y(0), yd)}" width="${dx / 3}" height="${Math.abs(y(0) - yd)}" fill="#1e4d2b"/><title>Hour ending ${h.hour + 1}: planned ${n(h.scheduled)} kW; delivered ${n(h.delivered)} kW</title>`;
      if (h.hour % 3 === 0) content += `<text x="${x + dx / 2}" y="240" text-anchor="middle">HE ${h.hour + 1}</text>`;
    }
    $('delivery-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${content}</svg>`;
    $('delivery-chart').setAttribute('aria-label', `${labels[r.policy]}. Planned export ${n(r.hours.reduce((s,h)=>s+Math.max(0,h.scheduled),0))} kWh. Delivered export ${n(r.sold)} kWh. Download the trace for hourly details.`);
  }
  function ledger() {
    if (!current) return;
    const id = Math.max(1, Math.min(current.config.fleet, Math.round(+$('device').value || 1)));
    $('device').value = id;
    const rows = current.trace.filter(r => r.device === id);
    $('ledger-caption').textContent = `Command ledger for device ${id} · ${labels[current.policy]}`;
    $('ledger').innerHTML = rows.length ? rows.map(r => `<tr><td>${r.hourEnding}</td><td>${r.commandHourEnding}</td><td>${r.attempt}</td><td>${n(r.requestedKwh)} kWh</td><td>${n(r.chargeKwh || r.dischargeKwh)} ${r.chargeKwh ? 'in' : 'out'}</td><td>${n(r.socAfter)} kWh</td><td>${r.reason}</td></tr>`).join('') : '<tr><td colspan="7">No commands: this device held its reserve.</td></tr>';
    $('device-note').textContent = rows.some(r => r.socAfter < current.config.capacity * current.config.reserve - 1e-8) ? 'Backup reserve was consumed by dispatch.' : 'Dispatch preserved the backup reserve.';
    document.querySelectorAll('.fleet-row').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.device === id)));
  }
  function inspect() {
    if (!runs) return;
    current = runs.find(r => r.policy === $('policy').value);
    document.querySelectorAll('#comparison tbody tr').forEach(row => row.classList.toggle('selected', row.dataset.policy === current.policy));
    chart(current);
    $('fleet-map').innerHTML = current.matrix.map((row,i) => `<button type="button" class="fleet-row" data-device="${i+1}" aria-label="Inspect device ${i+1}, ${row.includes('breach') ? 'reserve breached' : 'reserve preserved'}"><b>${i+1}</b><span class="cells" aria-hidden="true">${row.map(state => `<i class="${state}"></i>`).join('')}</span></button>`).join('');
    $('device').max = current.config.fleet;
    ledger();
  }
  function render() {
    if (!source) return;
    try {
      const o = options();
      runs = D.compare(source.hours.map(h => h.usd_mwh), o);
      for (const key of ['reserve', 'efficiency', 'affected']) $(key+'-label').textContent = Math.round(o[key]*100)+'%';
      $('comparison').querySelector('tbody').innerHTML = runs.map(r => `<tr data-policy="${r.policy}"><th scope="row">${labels[r.policy]}</th><td>${dollars(r.cash)}</td><td>${dollars(r.inventoryMark)}</td><td>${dollars(r.markedValue)}</td><td>${n(r.sold)} kWh</td><td class="${r.reserveBreaches ? 'bad-value' : 'good-value'}">${r.reserveBreaches} / ${o.fleet}</td></tr>`).join('');
      const safe = runs[3], naive = runs[2];
      $('simple-scope').textContent = `${o.fleet} simulated batteries. Recorded Texas prices. No real batteries are controlled.`;
      $('experiment').value = o.fault;
      const presetKey = o.forecast === 'shift' && o.fault === 'none' ? 'forecast' : o.forecast === 'known' ? ({none:'clean',duplicate:'retry',mixed:'mixed'}[o.fault]) : null;
      document.querySelectorAll('[data-preset]').forEach(b => { const active = b.dataset.preset === presetKey; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
      const explanations = {
        none: 'Each square is one simulated battery.',
        duplicate: 'No receipt. The same instruction is sent again.',
        late: 'Safeguards ignore commands that arrive too late.',
        stale: 'No fresh report. Safeguards pause dispatch.',
        mixed: 'Repeated commands. Delays. Lost contact.'
      };
      $('simple-explanation').textContent = explanations[o.fault];
      for (const [prefix, r] of [['without', naive], ['with', safe]]) {
        $(prefix+'-number').textContent = `${r.reserveBreaches} / ${o.fleet}`;
        $(prefix+'-caption').textContent = 'batteries used backup';
        $(prefix+'-dots').innerHTML = r.matrix.map(row=>`<i class="${row.includes('breach') ? 'spent' : 'preserved'}"></i>`).join('');
        $(prefix+'-delivery').textContent = `${Math.round(r.sold).toLocaleString()} kWh sent to the grid`;
      }
      $('simple-takeaway').textContent = o.reserve === 0 ? 'No backup set. Set a reserve in Engineer details.' : o.reserve === 1 ? 'All energy reserved. No power sold.' : naive.reserveBreaches ? 'Sell power. Keep the backup.' : safe.sold < naive.sold - .01 ? 'Less power sold. Backup protected.' : 'Backup protected.';
      $('try-failure').textContent = o.fault === 'none' ? 'Repeat a command' : 'Reset experiment';
      $('run-status').textContent = `${o.fleet} devices · ${safe.affectedDevices} exposed · repeatable seed 42`;
      $('verdict').innerHTML = `<p><strong>${safe.reserveBreaches} guarded reserve breaches; ${naive.reserveBreaches} unguarded.</strong></p><p>The guard exported ${n(safe.sold)} kWh, versus ${n(naive.sold)} kWh without checks. It rejected ${safe.rejected} expired or stale deliveries and ignored ${safe.duplicates} duplicate deliveries.</p><p>Ending stored energy: ${n(safe.endSoc)} kWh guarded, ${n(naive.endSoc)} kWh unguarded. A higher cash result can come from spending backup or ending with less stored energy.</p>`;
      $('load-error').hidden = true;
      for (const id of ['download-trace','download-run','share','policy','device']) $(id).disabled = false;
      inspect();
    } catch (error) { unavailable(`Check the scenario: ${error.message}`); }
  }
  keys.forEach(k => $(k).addEventListener('change', () => { document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active')); render(); }));
  $('experiment').addEventListener('change', () => { $('fault').value = $('experiment').value; render(); });
  $('try-failure').addEventListener('click', () => { $('fault').value = $('fault').value === 'none' ? 'duplicate' : 'none'; render(); });
  ['reserve','efficiency','affected'].forEach(k => $(k).addEventListener('input', render));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    const presets = { clean: ['none','known'], forecast: ['none','shift'], retry: ['duplicate','known'], mixed: ['mixed','known'] };
    [$('fault').value, $('forecast').value] = presets[button.dataset.preset];
    document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b===button)); render();
  }));
  $('policy').addEventListener('change', inspect); $('device').addEventListener('change', ledger);
  $('fleet-map').addEventListener('click', event => { const b = event.target.closest('[data-device]'); if (b) { $('device').value = b.dataset.device; ledger(); } });
  $('download-trace').addEventListener('click', () => { if (runs) download(`dispatch-${current.policy}-${source.delivery_date}.csv`, D.csv(current), 'text/csv'); });
  $('download-run').addEventListener('click', () => { if (runs) download('dispatch-bench.json', JSON.stringify({ model: 'dispatch-bench-v1', priceSource: source, runs },null,2), 'application/json'); });
  $('share').addEventListener('click', async () => {
    const url = new URL(location.href); url.search = new URLSearchParams(Object.fromEntries(keys.map(k=>[k,$(k).value]))).toString();
    try { await navigator.clipboard.writeText(url.href); $('share-status').textContent = 'Replay link copied.'; } catch (_) { $('share-status').textContent = url.href; }
  });
  const params = new URLSearchParams(location.search);
  keys.forEach(k => { if (params.has(k)) $(k).value = params.get(k); });
  fetch('/data/ercot-dam-houston.json').then(r => { if (!r.ok) throw new Error('price snapshot unavailable'); return r.json(); }).then(data => {
    if (!Array.isArray(data.hours) || data.hours.length !== 24 || data.hours.some((h,i)=>h.hour_ending!==i+1 || !Number.isFinite(h.usd_mwh))) throw new Error('price snapshot failed validation');
    source = data;
    $('source-line').textContent = `Recorded ${data.delivery_date} · Houston Hub day-ahead · USD/MWh · downloaded ${data.downloaded.slice(0,10)}. This is a historical replay, not live data.`;
    const a = document.createElement('a'); a.href = '/data/ercot-dam-houston.json'; a.textContent = ' View source snapshot.'; $('source-line').appendChild(a);
    render();
  }).catch(error => { unavailable(`Replay unavailable: ${error.message}. Open Engineer details for saved results.`); });
})();
