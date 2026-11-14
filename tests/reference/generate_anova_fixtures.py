"""Independent development oracle; SciPy is never shipped to the browser."""
import json
from pathlib import Path
import scipy
from scipy import stats
import numpy as np

assert scipy.__version__ == '1.17.1'
rng = np.random.default_rng(20261012)
samples = [
    [[24.5,23.5,26.4,27.1,29.9],[28.4,34.2,29.5,32.2,30.1],[26.1,28.3,24.3,26.2,27.8]],
    [[1,2],[2,4,5],[5,8,12,16]],
    [[-2,-1,0],[0,1,2],[1,1,1]],
    [[1,2],[1,2]],
    [[1,2,4],[21,22,24],[41,42,44]],
    [[1e12+1,1e12+2,1e12+4],[1e12+5,1e12+7,1e12+9],[1e12+10,1e12+11,1e12+16]],
]
for sizes in [[2,2,2], [3,4,5,6], [15]*5, [2]*20, [500]*3]:
    samples.append([rng.normal(i/3,1,n).tolist() for i,n in enumerate(sizes)])
cases=[]
for groups in samples:
    anova=stats.f_oneway(*groups)
    hsd=stats.tukey_hsd(*groups)
    alpha=.05
    ci=hsd.confidence_interval(1-alpha)
    pooled=sum((len(g)-1)*np.var(g,ddof=1) for g in groups)/(sum(map(len,groups))-len(groups))
    pairs=[]
    for a in range(len(groups)):
        for b in range(a+1,len(groups)):
            pairs.append(dict(a=a,b=b,difference=float(hsd.statistic[a,b]),q=float(abs(hsd.statistic[a,b])/np.sqrt(pooled*(1/len(groups[a])+1/len(groups[b]))/2)),p=float(hsd.pvalue[a,b]),low=float(ci.low[a,b]),high=float(ci.high[a,b])))
    cases.append(dict(groups=groups,alpha=alpha,F=float(anova.statistic),p=float(anova.pvalue),df=len(groups)-1,df2=sum(map(len,groups))-len(groups),pairs=pairs))
distributions=[]
for k,df in [(2,2),(3,2),(3,3),(5,10),(20,20),(50,100),(3,10000),(20,200000)]:
    for q in [.1,3,6,12,25]:
        distributions.append(dict(k=k,df=df,q=q,p=float(stats.studentized_range.sf(q,k,df))))
output=Path(__file__).resolve().parents[1]/'fixtures'/'stats'/'anova-scipy-1.17.1.json'
output.write_text(json.dumps(dict(scipy=scipy.__version__,cases=cases,distributions=distributions),indent=2,allow_nan=False)+'\n',encoding='utf-8')
print(f'Wrote {len(cases)} ANOVA/Tukey cases and {len(distributions)} range values.')
