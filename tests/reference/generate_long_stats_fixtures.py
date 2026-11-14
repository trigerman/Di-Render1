"""Independent development oracle for sparse long-table groups; never shipped."""
import json
from pathlib import Path
import numpy as np
import scipy
from scipy import stats

assert scipy.__version__ == '1.17.1'
cases = []
for groups in [[[67, 96], [63], [78], [78, 65, 69]], [[1], [2, 4], [6]], [[1, 3, 4], [8, 12], [9, 13, 17, 20]]]:
    k, n = len(groups), sum(map(len, groups))
    means = [np.mean(g) for g in groups]
    # Direct residual sums avoid the undefined singleton sample variance.
    mse = sum(sum((x - np.mean(g)) ** 2 for x in g) for g in groups) / (n - k)
    critical = stats.studentized_range.ppf(.95, k, n-k)
    ranked = stats.rankdata(np.concatenate(groups))
    ties = np.unique(np.concatenate(groups), return_counts=True)[1]
    variance = n * (n+1) / 12 - sum(t ** 3 - t for t in ties) / (12 * (n-1))
    rank_means, offset = [], 0
    for g in groups:
        rank_means.append(np.mean(ranked[offset:offset+len(g)]))
        offset += len(g)
    pairs = []
    for a in range(k):
        for b in range(a+1, k):
            difference = means[a] - means[b]
            se = np.sqrt(mse * (1/len(groups[a]) + 1/len(groups[b])) / 2)
            q = abs(difference) / se
            z = (rank_means[a] - rank_means[b]) / np.sqrt(variance * (1/len(groups[a]) + 1/len(groups[b])))
            pairs.append(dict(a=a, b=b, q=float(q), tukeyP=float(stats.studentized_range.sf(q, k, n-k)),
                              low=float(difference-critical*se), high=float(difference+critical*se),
                              dunnP=float(2*stats.norm.sf(abs(z)))))
    f, h = stats.f_oneway(*groups), stats.kruskal(*groups)
    cases.append(dict(groups=groups, F=float(f.statistic), anovaP=float(f.pvalue), H=float(h.statistic), kruskalP=float(h.pvalue), pairs=pairs))
output = Path(__file__).resolve().parents[1] / 'fixtures' / 'stats' / 'long-scipy-1.17.1.json'
output.write_text(json.dumps(dict(scipy=scipy.__version__, cases=cases), indent=2, allow_nan=False)+'\n', encoding='utf-8')
print(f'Wrote {len(cases)} sparse-group references (SciPy distributions; pooled Tukey-Kramer formula).')
