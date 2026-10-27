const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { percentileRanks, composite } = require("../notes/score.js");

const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "expansion-score-cases.json"), "utf8")
);

test("percentile ranks match the shared fixture", () => {
  for (const item of cases.percentiles) {
    const got = percentileRanks(item.values);
    assert.equal(got.length, item.ranks.length);
    got.forEach((value, i) => {
      if (item.ranks[i] === null) assert.equal(value, null);
      else assert.ok(Math.abs(value - item.ranks[i]) < 1e-9);
    });
  }
});

test("a missing factor is left out of the denominator", () => {
  const scores = composite(
    [
      { homes: 1, saidi: null },
      { homes: 0, saidi: 1 },
    ],
    { homes: 1, saidi: 1 }
  );
  assert.ok(Math.abs(scores[0] - 1) < 1e-9);
  assert.ok(Math.abs(scores[1] - 0.5) < 1e-9);
});

test("a zero weight does not pull the score", () => {
  const scores = composite([{ homes: 0, saidi: 1 }], { homes: 0, saidi: 2 });
  assert.ok(Math.abs(scores[0] - 1) < 1e-9);
});
