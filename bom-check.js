/* BOM checker on /supply. File and paste stay in the browser. */
(function () {
  'use strict';
  const B = window.BomCheck;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let last = null;
  let demo = true;

  function setDemo(on) {
    demo = on;
    const badge = $('bom-demo-badge');
    if (!badge) return;
    badge.hidden = !on;
  }

  function render(res) {
    last = res;
    const status = $('bom-status');
    const table = $('bom-table');
    const download = $('bom-download');
    status.className = 'sp-status';
    status.textContent = '';
    if (res.errors.length) {
      status.className = 'notice notice-red sp-status';
      status.innerHTML = '<strong>Fix the file before it can be checked.</strong><ul>' + res.errors.slice(0, 12).map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>';
      table.innerHTML = '';
      download.disabled = true;
      return;
    }
    const flagged = res.ranked.filter((r) => r.single_supplier).length;
    const warn = res.warnings.length ? '<ul>' + res.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '';
    status.innerHTML = (demo ? '<p><span class="badge badge-yellow">Demo data</span> ' + esc(B.DEMO_NOTE) + '</p>' : '<p><span class="badge badge-solid">Your file</span> Read in this browser. Not uploaded.</p>') + warn;
    download.disabled = false;
    const rows = res.ranked.map((r) => '<tr' + (r.single_supplier ? ' class="is-short"' : '') + '>' +
      '<td data-label="Part"><strong>' + esc(r.part_number) + '</strong><br><span class="sp-small">' + esc(r.description) + '</span></td>' +
      '<td data-label="Qty" class="num">' + esc(r.qty) + '</td>' +
      '<td data-label="Supplier">' + esc(r.supplier) + (r.alt_suppliers ? '<br><span class="sp-small">Also: ' + esc(r.alt_suppliers) + '</span>' : '') + '</td>' +
      '<td data-label="Lead time" class="num">' + (r.lead_time_days == null ? 'unknown' : esc(r.lead_time_days) + ' days') + '</td>' +
      '<td data-label="Flag">' + (r.flag ? '<span class="badge badge-red">' + esc(r.flag) + '</span>' : '<span class="sp-small">More than one supplier</span>') + '</td>' +
      '<td data-label="Block score" class="num"><strong>' + esc(r.block_score_display) + '</strong>' + (r.rank ? '<br><span class="sp-small">Rank ' + r.rank + '</span>' : '') + '</td></tr>').join('');
    table.innerHTML = '<p class="sp-yd-sum"><strong>' + flagged + ' of ' + res.rows.length + ' row' + (res.rows.length === 1 ? '' : 's') + ' name only one supplier.</strong> Block score is <code>' + esc(res.formula) + '</code>. Single source is 1 or 0. A missing lead time stays unknown and is not counted as zero. Highest score is the row most likely to block the next install.</p>' +
      '<div class="sp-yd-scroll"><table class="ds-table sp-yd-table"><thead><tr><th>Part</th><th class="num">Qty</th><th>Supplier</th><th class="num">Lead time</th><th>Flag</th><th class="num">Block score</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function run(text, isDemo) {
    setDemo(isDemo);
    $('bom-paste').value = text;
    render(B.check(text));
  }

  function download() {
    if (!last || last.errors.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([last.flagged_csv], { type: 'text/csv' }));
    a.download = demo ? 'demo-flagged-bom.csv' : 'flagged-bom.csv';
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function init() {
    if (!B || !$('bom-check')) return;
    $('bom-formula').textContent = 'Score = ' + B.FORMULA + '.';
    $('bom-file').addEventListener('change', () => {
      const file = $('bom-file').files && $('bom-file').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        run(text, text.trim() === B.DEMO_CSV.trim());
      };
      reader.onerror = () => {
        $('bom-status').className = 'notice notice-red sp-status';
        $('bom-status').textContent = 'Could not read that file in the browser.';
      };
      reader.readAsText(file);
    });
    $('bom-check-btn').addEventListener('click', () => run($('bom-paste').value, $('bom-paste').value.trim() === B.DEMO_CSV.trim()));
    $('bom-sample').addEventListener('click', () => run(B.DEMO_CSV, true));
    $('bom-download').addEventListener('click', download);
    run(B.DEMO_CSV, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
