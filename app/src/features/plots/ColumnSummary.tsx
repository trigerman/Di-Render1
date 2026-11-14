import { dataText as d, type Locale } from '../../i18n/messages';

export interface PlotGroupSummary { key: string; label: string; level: string; series: string | null; n: number; mean: number; paletteIndex: number }

export function ColumnSummary({ groups, locale, decimal }: { groups: PlotGroupSummary[]; locale: Locale; decimal: '.' | ',' }) {
  return <section className="plot-column-summary" aria-label={d(locale, 'columnSummary')}>
    <h3>{d(locale, 'columnSummary')}</h3>
    <div className="data-table-scroll"><table><thead><tr><th scope="col">{d(locale, 'groupX')}</th><th scope="col">n</th><th scope="col">{d(locale, 'mean')}</th></tr></thead>
      <tbody>{groups.map(group => <tr key={group.key}><th scope="row">{group.label}</th><td>{group.n}</td><td>{Number(group.mean.toPrecision(6)).toString().replace('.', decimal)}</td></tr>)}</tbody></table></div>
    <p>{d(locale, 'columnSummaryHint')}</p>
  </section>;
}
