"""Percentile ranks and weighted composites for the expansion map.

Higher raw values are treated as higher readiness. Callers invert a factor
before it reaches this module when a larger number means more friction.
Missing values are left out of both the percentile and the composite.
They are not scored as zero.
"""


def percentile_ranks(values):
    """Midrank percentiles in [0, 1] for finite numbers. None stays None.

    Ties share the average of their positions. One finite value ranks 1.
    """
    indexed = [(i, v) for i, v in enumerate(values) if v is not None]
    out = [None] * len(values)
    n = len(indexed)
    if n == 0:
        return out
    if n == 1:
        out[indexed[0][0]] = 1.0
        return out
    order = sorted(indexed, key=lambda item: item[1])
    i = 0
    while i < n:
        j = i + 1
        while j < n and order[j][1] == order[i][1]:
            j += 1
        # positions i..j-1, scaled by n-1 so the ends are 0 and 1
        avg = (i + (j - 1)) / 2
        rank = avg / (n - 1)
        for k in range(i, j):
            out[order[k][0]] = rank
        i = j
    return out


def composite(rows, weights):
    """Weighted mean of per-factor percentiles.

    rows: list of {factor: percentile or None}
    weights: {factor: weight}. Non-positive weights are ignored.
    A row missing a factor drops that factor from its own denominator.
    """
    active = {k: float(w) for k, w in weights.items() if w is not None and float(w) > 0}
    scores = []
    for row in rows:
        num = 0.0
        den = 0.0
        for key, weight in active.items():
            value = row.get(key)
            if value is None:
                continue
            num += weight * float(value)
            den += weight
        scores.append(num / den if den else None)
    return scores
