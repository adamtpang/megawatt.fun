/* Percentile ranks and weighted composites. Mirrors analysis/score.py. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExpansionScore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function percentileRanks(values) {
    var indexed = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i] !== null && values[i] !== undefined && values[i] === values[i]) {
        indexed.push([i, values[i]]);
      }
    }
    var out = new Array(values.length).fill(null);
    var n = indexed.length;
    if (n === 0) return out;
    if (n === 1) {
      out[indexed[0][0]] = 1;
      return out;
    }
    indexed.sort(function (a, b) { return a[1] - b[1]; });
    var i = 0;
    while (i < n) {
      var j = i + 1;
      while (j < n && indexed[j][1] === indexed[i][1]) j++;
      var avg = (i + (j - 1)) / 2;
      var rank = avg / (n - 1);
      for (var k = i; k < j; k++) out[indexed[k][0]] = rank;
      i = j;
    }
    return out;
  }

  function composite(rows, weights) {
    var active = [];
    Object.keys(weights).forEach(function (key) {
      var weight = Number(weights[key]);
      if (weight > 0) active.push([key, weight]);
    });
    return rows.map(function (row) {
      var num = 0;
      var den = 0;
      for (var i = 0; i < active.length; i++) {
        var value = row[active[i][0]];
        if (value === null || value === undefined || value !== value) continue;
        num += active[i][1] * value;
        den += active[i][1];
      }
      return den ? num / den : null;
    });
  }

  return { percentileRanks: percentileRanks, composite: composite };
});
