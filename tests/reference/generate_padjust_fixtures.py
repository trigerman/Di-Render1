"""Exact rational fixtures for the supported R 4.5.2 p.adjust rules.

This uses independent arithmetic, not the application implementation or an R
runtime. The pinned upstream source defines NA preservation and planned n.
"""
from fractions import Fraction
from pathlib import Path
import json

vectors = [
    ([".01", ".04", None, ".03"], 4),
    ([".01", ".04", None, ".03"], 8),
    ([".05", ".05", ".2", "1", "0"], 5),
    ([None, None], 2),
    ([".07"], 1),
    ([".07"], 190),
    (["1e-40", "1e-200", ".99", None], 190),
    ([".8", ".9", "1"], 3),
    ([".004", ".001", ".009", ".002"], 4),
]
cases = []
for values, family in vectors:
    ordered = sorted((Fraction(p), index) for index, p in enumerate(values) if p is not None)
    for method in ("bonferroni", "holm", "bh"):
        result = [None] * len(values)
        if method == "bonferroni":
            for p, index in ordered:
                result[index] = min(Fraction(1), p * family)
        elif method == "holm":
            cumulative = Fraction(0)
            for rank, (p, index) in enumerate(ordered):
                cumulative = max(cumulative, p * (family - rank))
                result[index] = min(Fraction(1), cumulative)
        else:
            cumulative = Fraction(1)
            for rank in range(len(ordered) - 1, -1, -1):
                p, index = ordered[rank]
                cumulative = min(cumulative, p * family / (rank + 1))
                result[index] = cumulative
        cases.append({"p": [float(p) if p is not None else None for p in values],
                      "familySize": family, "method": method,
                      "expected": [float(p) if p is not None else None for p in result]})
fixture = {"reference": "R 4.5.2 stats::p.adjust",
           "source": "https://svn.r-project.org/R/tags/R-4-5-2/src/library/stats/R/p.adjust.R",
           "provenance": "Independent exact rational fixtures for pinned source semantics; no R runtime was invoked.",
           "cases": cases}
destination = Path(__file__).resolve().parents[1] / "fixtures/stats/r-4.5.2-padjust.json"
destination.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {len(cases)} adjustment fixtures: {destination.name}")
