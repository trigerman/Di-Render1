import { useState } from 'react';
import type { PlotSpec } from '../../domain/plots/spec';
import type { AnalysisConfig } from '../../domain/stats/schema';
import { hasPostHoc, isPairedTest, pairKey, usesTukey } from '../../domain/analysis/comparisons';
import { INPUT_LIMITS } from '../../domain/security/input';
import { dataText as d, type Locale } from '../../i18n/messages';
import type { PlotGroupSummary } from './ColumnSummary';
import type { Dataset } from '../../domain/data/schema';
import { hasTimeColumn } from '../../domain/plots/recommend';
import { initialAnalysisConfig, statisticalChoices } from '../../domain/stats/guidance';

export function StatisticsControls({ spec, groups, dataset, locale, update }: {
  spec: PlotSpec; groups: PlotGroupSummary[]; dataset: Dataset | undefined; locale: Locale; update: (config: AnalysisConfig | null) => void;
}) {
  const [left, setLeft] = useState(''), [right, setRight] = useState(''), [pairMessage, setPairMessage] = useState('');
  const config = spec.analysis, paired = !!config && isPairedTest(config.test), omnibus = !!config && hasPostHoc(config), tukey = !!config && usesTukey(config);
  const change = (patch: Partial<AnalysisConfig>) => { if (config) update({ ...config, ...patch }); };
  const pairs = config?.pairs ?? [], keys = new Set(pairs.map(([a, b]) => pairKey(a, b))), groupKeys = new Set(groups.map(group => group.key));
  const pairLabel = (key: string) => groups.find(group => group.key === key)?.label ?? d(locale, 'unavailableGroup');
  const chooseGroup = (side: 'a' | 'b', value: string) => {
    const a = side === 'a' ? value : left, b = side === 'b' ? value : right;
    setPairMessage('');
    if (groupKeys.has(a) && groupKeys.has(b)) {
      if (a === b) setPairMessage('distinctPairHint');
      else if (keys.has(pairKey(a, b))) setPairMessage('existingPairHint');
      else if (pairs.length >= INPUT_LIMITS.plotComparisons) setPairMessage('comparisonLimit');
      else change({ pairs: [...pairs, [a, b]] });
      setLeft(''); setRight('');
    } else if (side === 'a') setLeft(value); else setRight(value);
  };
  const chooseTest = (test: AnalysisConfig['test'] | '') => {
    if (!test) { update(null); return; }
    const next: AnalysisConfig = config ? { ...config, test } : initialAnalysisConfig(spec, dataset, test, groups);
    if (test === 'anova') next.postHoc = config?.test === test ? config.postHoc : 'tukey';
    else if (test === 'kruskal-wallis') next.postHoc = config?.test === test ? config.postHoc : 'dunn';
    if (test === 'anova' || test === 'kruskal-wallis') next.showGlobal ??= true;
    update(next);
  };
  const groupPreset = (within: 'level' | 'series') => {
    const selected: [string, string][] = [];
    groups.forEach((a, index) => groups.slice(index + 1).forEach(b => { if (a[within] === b[within]) selected.push([a.key, b.key]); }));
    return selected;
  };
  const select = (label: string, value: string, options: readonly string[], onChange: (value: string) => void) => <label>{d(locale, label)}<select aria-label={d(locale, label)} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option} value={option}>{d(locale, option === 'control' ? 'controlChoice' : option === 'tukey' ? 'tukeyHsd' : option)}</option>)}</select></label>;
  return <section className="plot-statistics-controls" aria-labelledby="statistics-controls-heading">
    <h3 className="plot-subheading" id="statistics-controls-heading">{d(locale, 'statistics')}</h3>
    <p>{d(locale, spec.type === 'stacked-bar' ? 'stackedNoStats' : 'statisticsHint')}</p>
    {spec.type !== 'stacked-bar' && <details className="plot-test-guide"><summary>{d(locale, 'testGuide')}</summary>
      <p>{d(locale, 'testGuideHint')}</p>
      {dataset && hasTimeColumn(dataset) && <p className="plot-analysis-note">{d(locale, 'timeStatsHint')}</p>}
      {groups.length < 2 && <p>{d(locale, 'twoGroupsNeeded')}</p>}
      {statisticalChoices(groups.length).map(choice => <button key={choice.test} type="button" onClick={() => chooseTest(choice.test)}><strong>{d(locale, choice.test)}</strong><small>{d(locale, choice.reason)}</small></button>)}
      <p>{d(locale, 'studentGuide')}</p>
    </details>}
    <label>{d(locale, 'test')}<select aria-label={d(locale, 'test')} disabled={spec.type === 'stacked-bar'} value={config?.test ?? ''} onChange={event => chooseTest(event.target.value as AnalysisConfig['test'] | '')}>
      <option value="">{d(locale, 'noStatistics')}</option>{['anova', 'welch', 'student', 'paired-t', 'mann-whitney', 'wilcoxon', 'kruskal-wallis', 'pairwise-welch'].map(test => <option key={test} value={test}>{d(locale, test)}</option>)}
    </select></label>
    {config && <>
      <p className="plot-analysis-note">{d(locale, paired ? 'pairedVsPairwise' : 'independentMatchingHint')}</p>
      {omnibus && <div className="plot-analysis-note"><p>{d(locale, config.test === 'anova' ? 'anovaHint' : 'kruskalHint')}</p>
        {spec.roles.series && <p>{d(locale, 'oneFactorHint')}</p>}
        {select('postHoc', config.postHoc ?? (config.test === 'anova' ? 'tukey' : 'dunn'), ['none', config.test === 'anova' ? 'tukey' : 'dunn'], value => change({ postHoc: value as AnalysisConfig['postHoc'] }))}
      </div>}
      {paired && <div className="plot-analysis-note">{select('pairing', config.pairing, ['id', 'row-order'], value => change({ pairing: value as AnalysisConfig['pairing'] }))}
        <p>{d(locale, config.pairing === 'row-order' ? 'rowOrderWarning' : 'subjectMatchHint')}</p>
        {config.pairing === 'id' && !spec.roles.id && <p role="status">{d(locale, 'chooseSubjectHint')}</p>}
      </div>}
      {(!omnibus || config.postHoc !== 'none') && <fieldset className="plot-pair-picker"><legend>{d(locale, tukey ? 'pairsToDisplay' : 'pairsToTest')}</legend>
        {select('comparisons', config.comparisons, ['selected', 'all', 'control'], value => change({ comparisons: value as AnalysisConfig['comparisons'] }))}
        {config.comparisons === 'control' && <label>{d(locale, 'control')}<select aria-label={d(locale, 'control')} value={config.control ?? ''} onChange={event => change({ control: event.target.value || null })}>
          <option value="">{d(locale, 'chooseGroup')}</option>{groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
        </select></label>}
        {config.comparisons === 'selected' && <>
          {(['a', 'b'] as const).map(side => <label key={side}>{d(locale, side === 'a' ? 'groupA' : 'groupB')}<select aria-label={d(locale, side === 'a' ? 'groupA' : 'groupB')} value={groupKeys.has(side === 'a' ? left : right) ? side === 'a' ? left : right : ''} onChange={event => chooseGroup(side, event.target.value)}>
            <option value="">{d(locale, 'chooseGroup')}</option>{groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
          </select></label>)}
          <p>{d(locale, 'automaticPairHint')}</p>
          {pairMessage && <p role="status">{d(locale, pairMessage)}</p>}
          {pairs.length >= INPUT_LIMITS.plotComparisons && <p role="status">{d(locale, 'comparisonLimit')}</p>}
          <ul className="plot-selected-pairs">{pairs.map(([a, b], index) => <li key={pairKey(a, b)}><span>{pairLabel(a)} / {pairLabel(b)}{(!groupKeys.has(a) || !groupKeys.has(b)) && <small>{d(locale, 'repairPair')}</small>}</span><button type="button" aria-label={`${d(locale, 'removeComparison')}: ${pairLabel(a)} / ${pairLabel(b)}`} onClick={() => change({ pairs: pairs.filter((_, position) => position !== index) })}>×</button></li>)}</ul>
          {!pairs.length && <p role="status">{d(locale, 'choosePairsHint')}</p>}
          {groups.some(group => group.series !== null) && <div className="data-actions">{(['level', 'series'] as const).map(within => { const selected = groupPreset(within); return <button key={within} type="button" disabled={!selected.length || selected.length > INPUT_LIMITS.plotComparisons} title={selected.length > INPUT_LIMITS.plotComparisons ? d(locale, 'comparisonLimit') : undefined} onClick={() => change({ comparisons: 'selected', pairs: selected })}>{d(locale, within === 'level' ? 'withinX' : 'withinSeries')}</button>; })}</div>}
          {pairs.length > 0 && <button type="button" onClick={() => { change({ pairs: [] }); setLeft(''); setRight(''); setPairMessage(''); }}>{d(locale, 'clearComparisons')}</button>}
        </>}
        <p>{d(locale, tukey ? 'tukeyFamilyHint' : 'comparisonFamilyHint')}</p>
      </fieldset>}
      {!tukey && (!omnibus || config.postHoc !== 'none') && <>{select('adjustment', config.adjustment, ['none', 'bonferroni', 'holm', 'bh'], value => change({ adjustment: value as AnalysisConfig['adjustment'] }))}
        <p>{d(locale, config.adjustment === 'none' ? 'noCorrectionGuide' : config.adjustment + 'Guide')}</p>
        <label><input type="checkbox" checked={config.useAdjusted} onChange={event => change({ useAdjusted: event.target.checked })} />{d(locale, 'adjusted')}</label></>}
      <label>{d(locale, 'alpha')}<input type="number" step={.001} min={.000001} max={.999999} value={config.alpha} onChange={event => change({ alpha: event.target.valueAsNumber })} /></label>
      <fieldset><legend>{d(locale, 'plotAnnotations')}</legend>
        <p>{d(locale, 'bracketDisplayHint')}</p>
        {omnibus && <label><input type="checkbox" checked={config.showGlobal ?? false} onChange={event => change({ showGlobal: event.target.checked })} />{d(locale, 'showGlobal')}</label>}
        <label><input type="checkbox" checked={config.showBrackets !== false} onChange={event => change({ showBrackets: event.target.checked })} />{d(locale, 'showBrackets')}</label>
        {select('labelStyle', config.label, ['stars', 'p', 'scientific'], value => change({ label: value as AnalysisConfig['label'] }))}
        <label><input type="checkbox" checked={config.hideNs} onChange={event => change({ hideNs: event.target.checked })} />{d(locale, 'hideNs')}</label>
      </fieldset>
    </>}
  </section>;
}
