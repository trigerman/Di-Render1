import type { Dataset } from '../../domain/data/schema';
import type { PlotSpec } from '../../domain/plots/spec';
import type { PlotScene } from '../../domain/plots/scene';
import { hasPostHoc, isPairedTest, usesTukey } from '../../domain/analysis/comparisons';
import { canPairRows } from '../../domain/stats/guidance';
import { dataText as d, type Locale } from '../../i18n/messages';

/** Calculation readiness lives next to the preview, not behind a display toggle. */
export function ComparisonStatus({ spec, scene, dataset, locale, update }: {
  spec: PlotSpec; scene: PlotScene | undefined; dataset: Dataset | undefined; locale: Locale;
  update: (patch: { roles?: PlotSpec['roles']; analysis?: PlotSpec['analysis']; result?: null }) => void;
}) {
  const config = spec.analysis;
  if (!config) return null;
  const paired = isPairedTest(config.test), missingMatching = paired && (config.pairing === 'id' ? !spec.roles.id : !canPairRows(spec));
  const result = scene?.result, comparisons = result?.comparisons ?? [], computable = comparisons.filter(comparison => comparison.selectedP !== null);
  const noPostHoc = hasPostHoc(config) && config.postHoc === 'none';
  const missingPairs = !noPostHoc && config.comparisons === 'selected' && !config.pairs?.length;
  const unsupported = scene?.notices.includes('bracketsNeedCategories'), sameX = scene?.notices.includes('bracketsSameX');
  const visible = config.showBrackets !== false && !unsupported ? computable.filter(comparison => !config.hideNs || comparison.significant).length : 0;
  const heading = missingMatching ? 'matchingNeeded' : missingPairs ? 'pairsNeeded' : noPostHoc ? 'overallOnly' : !scene ? 'updatingPreview'
    : scene.error ? 'checkSettings' : !computable.length ? 'noComputedComparisons' : config.showBrackets === false ? 'comparisonsHidden' : unsupported || sameX ? 'bracketsNeedLayout' : !visible ? 'comparisonsHiddenNs' : 'comparisonsReady';
  return <section className="plot-comparison-status" data-state={visible && !missingMatching && !missingPairs ? 'ready' : 'setup'} aria-label={d(locale, 'comparisonStatus')}>
    <strong role="status">{d(locale, heading)}{heading === 'comparisonsReady' && ` (${visible})`}</strong>
    {missingMatching && <>
      <p>{d(locale, 'matchingNeededHint')}</p>
      {canPairRows(spec) && <><button type="button" onClick={() => update({ analysis: { ...config, pairing: 'row-order' }, result: null })}>{d(locale, 'matchRowsAction')}</button><small>{d(locale, 'rowMatchingAssumption')}</small></>}
      <label>{d(locale, 'matchIdColumn')}<select aria-label={d(locale, 'matchIdColumn')} value={spec.roles.id ?? ''} onChange={event => { if (event.target.value) update({ roles: { ...spec.roles, id: event.target.value }, analysis: { ...config, pairing: 'id' }, result: null }); }}>
        <option value="">{d(locale, 'chooseColumn')}</option>{dataset?.columns.map(column => <option key={column.key} value={column.key}>{column.name}</option>)}
      </select></label>
    </>}
    {missingPairs && <p>{d(locale, 'choosePairsHint')}</p>}
    {noPostHoc && <p>{d(locale, 'postHocNeededHint')}</p>}
    {computable.length > 0 && <p>{d(locale, usesTukey(config) || config.useAdjusted ? 'bracketsUseAdjusted' : 'bracketsUseRaw')}{(usesTukey(config) || config.useAdjusted) && ` · ${d(locale, usesTukey(config) ? 'tukeyHsd' : config.adjustment)}`} · {d(locale, 'familySize')}: {result!.familySize}</p>}
    {computable.length > 0 && paired && <p>{d(locale, config.pairing === 'row-order' ? 'matchingByRowActive' : 'matchingByIdActive')}</p>}
    {!missingMatching && comparisons.some(comparison => comparison.selectedP === null) && <ul>{comparisons.filter(comparison => comparison.selectedP === null).slice(0, 3).map(comparison => <li key={`${comparison.a}:${comparison.b}`}>{result!.groups[comparison.a]?.label} / {result!.groups[comparison.b]?.label}: {d(locale, comparison.result.reason ?? 'not-computable')}</li>)}</ul>}
    {unsupported && <p>{d(locale, 'bracketsNeedCategories')}</p>}{sameX && <p>{d(locale, 'bracketsSameX')}</p>}
    {heading === 'comparisonsHidden' && <button type="button" onClick={() => update({ analysis: { ...config, showBrackets: true }, result: null })}>{d(locale, 'showBrackets')}</button>}
    {heading === 'comparisonsHiddenNs' && <button type="button" onClick={() => update({ analysis: { ...config, hideNs: false }, result: null })}>{d(locale, 'showNsAction')}</button>}
  </section>;
}
