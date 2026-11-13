/* How power moves through Texas: the math and the flow-diagram geometry behind /grid. Pure: no DOM, no network.
   Input is data/grid-ercot.json (scripts/grid-ercot.py). Used by grid.js (window.GridCore) and the Node tests. */
(function (root) {
  'use strict';

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const SMALL = ['hydro', 'biomass']; // too thin to draw alone: shown as one strand

  // The two sides of the flow, largest first. Left: where power is made. Right: where it goes.
  function sides(data) {
    const big = data.sources.filter((s) => SMALL.indexOf(s.id) < 0).map((s) => ({ id: s.id, name: s.name, gwh: s.gwh }));
    const small = data.sources.filter((s) => SMALL.indexOf(s.id) >= 0);
    const left = big.concat([{ id: 'small', name: small.map((s) => s.name).join(' and '), gwh: sum(small.map((s) => s.gwh)) }]).sort((a, b) => b.gwh - a.gwh);
    const right = data.zones.map((z) => ({ id: z.id, name: z.name, gwh: z.gwh, kind: 'zone' })).sort((a, b) => b.gwh - a.gwh)
      .concat([{ id: 'charging', name: 'Battery charging', gwh: data.storage.chargingGwh, kind: 'storage' }]);
    return { left, right, madeGwh: sum(left.map((n) => n.gwh)), usedGwh: sum(right.map((n) => n.gwh)) };
  }

  /* Lay the flow out in a box W by H. Each side is scaled to its own total, so both fill the same height.
     Returns node rectangles and one band per node: left bands run from a source to the grid, right bands
     from the grid to a use. A band is the path of a ribbon whose thickness is the node's energy. */
  function flow(data, W, H, opts) {
    const o = opts || {}, nodeW = o.nodeW || 10, gap = o.gap == null ? 4 : o.gap, top = o.top == null ? 4 : o.top;
    const s = sides(data), midX = W / 2 - nodeW / 2, usable = H - top * 2;
    function stack(list, total) {
      const scale = (usable - gap * (list.length - 1)) / total;
      let y = top;
      return list.map((n) => { const h = Math.max(1, n.gwh * scale); const r = Object.assign({}, n, { y, h, share: n.gwh / total }); y += h + gap; return r; });
    }
    const left = stack(s.left, s.madeGwh), right = stack(s.right, s.usedGwh);
    // On the grid node the strands sit flush, with no gaps, in the same order.
    function flush(list, total) { let y = top; const scale = usable / total; return list.map((n) => { const h = n.gwh * scale; const r = { y, h }; y += h; return r; }); }
    const midL = flush(s.left, s.madeGwh), midR = flush(s.right, s.usedGwh);
    const band = (x0, a, x1, b) => {
      const c = (x0 + x1) / 2, f = (v) => v.toFixed(1);
      return 'M' + f(x0) + ' ' + f(a.y) + 'C' + f(c) + ' ' + f(a.y) + ' ' + f(c) + ' ' + f(b.y) + ' ' + f(x1) + ' ' + f(b.y)
        + 'L' + f(x1) + ' ' + f(b.y + b.h) + 'C' + f(c) + ' ' + f(b.y + b.h) + ' ' + f(c) + ' ' + f(a.y + a.h) + ' ' + f(x0) + ' ' + f(a.y + a.h) + 'Z';
    };
    return {
      W, H, nodeW, midX,
      left: left.map((n, i) => Object.assign(n, { x: 0, path: band(nodeW, n, midX, midL[i]) })),
      right: right.map((n, i) => Object.assign(n, { x: W - nodeW, path: band(midX + nodeW, midR[i], W - nodeW, n) })),
      mid: { x: midX, y: top, h: usable },
      madeGwh: s.madeGwh, usedGwh: s.usedGwh,
    };
  }

  // The facts the page states in words.
  function facts(data) {
    const src = (id) => data.sources.find((s) => s.id === id);
    const zones = data.zones;
    const fastest = zones.slice().sort((a, b) => b.change - a.change)[0];
    const mostAdded = zones.slice().sort((a, b) => (b.gwh - b.previousGwh) - (a.gwh - a.previousGwh))[0];
    return {
      balance: Math.abs(data.differenceGwh) / data.madeGwh,            // how closely made and used agree
      biggest: zones[0], fastest, mostAdded, addedGwh: mostAdded.gwh - mostAdded.previousGwh,
      peakOverAverage: data.peak.mw / data.averageMw,
      totalValueUsd: sum(data.sources.map((s) => s.valueUsd)),
      solar: src('solar'), gas: src('gas'), wind: src('wind'), other: src('other'),
      // Batteries: the price paid to charge against the price the 'Other' line earned.
      chargePrice: data.storage.chargingAvgPriceUsdPerMwh,
    };
  }

  const api = { sides, flow, facts, SMALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GridCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
