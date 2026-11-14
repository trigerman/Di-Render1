"""Development-only oracle. Runtime and npm test use the checked-in JSON, never Python."""
import json
import math
from pathlib import Path
import scipy
from scipy import stats
import numpy as np

assert scipy.__version__ == '1.17.1', 'Regenerate only with the pinned SciPy version.'
def number(value):
    return float(value) if math.isfinite(float(value)) else None

cases = []
samples = [([1, 2, 3, 4, 6], [2, 3, 5, 7, 9]), ([1, 1, 1, 1, 1], [1, 1, 1, 1, 1]),
           ([1, 1, 2, 3, 5], [1, 2, 2, 4, 8]), ([2, 2, 2], [1, 3, 8]),
           ([1, 20, 40], list(range(2, 121)))]
rng = np.random.default_rng(20261011)
samples += [(rng.normal(size=na).tolist(), rng.normal(.8, 2, size=nb).tolist()) for na, nb in [(2, 3), (5, 8), (9, 12), (30, 45), (70, 90)]]
for a, b in samples:
    for kind, fn in [('welch', lambda: stats.ttest_ind(a, b, equal_var=False)), ('student', lambda: stats.ttest_ind(a, b, equal_var=True)), ('mann-whitney', lambda: stats.mannwhitneyu(a, b, alternative='two-sided', method='auto'))]:
        value = fn()
        cases.append({'kind': kind, 'a': a, 'b': b, 'statistic': number(value.statistic), 'p': number(value.pvalue), 'df': number(value.df) if hasattr(value, 'df') else None})
for differences in [[-1, 2, 3, 4, 5], [-1, 1, 2, 2, 0], [0, 0, 0], list(range(-7, 10)), list(range(1, 52)), rng.normal(size=30).tolist()]:
    a, b = differences, [0] * len(differences)
    for kind, fn in [('paired-t', lambda: stats.ttest_rel(a, b)), ('wilcoxon', lambda: stats.wilcoxon(a, b, alternative='two-sided', zero_method='wilcox', correction=False, method='auto'))]:
        value = fn()
        cases.append({'kind': kind, 'a': a, 'b': b, 'statistic': number(value.statistic), 'p': number(value.pvalue), 'df': number(value.df) if hasattr(value, 'df') else None})
for groups in [[[1, 2, 2, 5], [2, 3, 4, 6], [7, 7, 9, 10]], [[1, 2], [2, 3], [4, 5], [3, 8]]]:
    value = stats.kruskal(*groups)
    cases.append({'kind': 'kruskal-wallis', 'groups': groups, 'statistic': number(value.statistic), 'p': number(value.pvalue), 'df': len(groups) - 1})
    merged = np.concatenate(groups); ranks = stats.rankdata(merged); N = len(merged)
    ties = np.unique(merged, return_counts=True)[1]; variance = N * (N + 1) / 12 - sum(t ** 3 - t for t in ties) / (12 * (N - 1))
    offset = 0; means = []
    for group in groups:
        means.append(float(np.mean(ranks[offset:offset + len(group)]))); offset += len(group)
    for a in range(len(groups)):
        for b in range(a + 1, len(groups)):
            z = (means[a] - means[b]) / math.sqrt(variance * (1 / len(groups[a]) + 1 / len(groups[b])))
            cases.append({'kind': 'dunn', 'groups': groups, 'aIndex': a, 'bIndex': b, 'statistic': z, 'p': float(2 * stats.norm.sf(abs(z))), 'df': None})
distributions = []
for z in [-8, -2, 0, .1, 2, 8, 12, 30]:
    distributions.append({'kind': 'normal', 'x': z, 'expected': float(stats.norm.sf(z))})
for df in [1, 2, 5, 30, 1000]:
    for x in [.1, 2, 10, 100]:
        distributions.append({'kind': 't', 'x': x, 'df': df, 'expected': float(2 * stats.t.sf(x, df))})
        distributions.append({'kind': 'chi', 'x': x, 'df': df, 'expected': float(stats.chi2.sf(x, df))})
for x, a, b in [(1, 1, 1), (3, 5, 20), (100, 10, 30), (.01, 2, 5)]:
    distributions.append({'kind': 'f', 'x': x, 'a': a, 'b': b, 'expected': float(stats.f.sf(x, a, b))})
values = [1, 2, 3, 4, 100]
descriptive = {'values': values, 'mean': float(np.mean(values)), 'sd': float(np.std(values, ddof=1)), 'sem': float(stats.sem(values)), 'median': float(np.median(values)), 'q1': float(np.quantile(values, .25, method='linear')), 'q3': float(np.quantile(values, .75, method='linear')), 'ciLow': float(stats.t.interval(.95, len(values)-1, loc=np.mean(values), scale=stats.sem(values))[0]), 'ciHigh': float(stats.t.interval(.95, len(values)-1, loc=np.mean(values), scale=stats.sem(values))[1])}
output = Path(__file__).resolve().parents[1] / 'fixtures' / 'stats' / 'scipy-1.17.1.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'scipy': scipy.__version__, 'cases': cases, 'distributions': distributions, 'descriptive': descriptive}, indent=2, allow_nan=False) + '\n', encoding='utf-8')
print(f'Wrote {len(cases)} tests and {len(distributions)} distribution values to {output}')
