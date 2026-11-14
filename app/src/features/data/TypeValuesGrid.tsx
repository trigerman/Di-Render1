import { dataText as d, type Locale } from '../../i18n/messages';

const encode = (rows: string[][]) => rows.map(row => row.map(cell => /[\t\r\n"]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell).join('\t')).join('\n');
/** Small explicit input grid; the resulting TSV uses the same immutable source and reader. */
export function TypeValuesGrid({ rows, locale, onChange }: { rows: string[][]; locale: Locale; onChange: (rows: string[][], text: string) => void }) {
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 2);
  const update = (next: string[][]) => onChange(next, encode(next));
  return <fieldset><legend>{d(locale, 'typeValues')}</legend><div className="data-preview-scroll"><table><tbody>{rows.map((row, index) => <tr key={index}>{Array.from({ length: width }, (_, column) => <td key={column}><input aria-label={`${d(locale, index === 0 ? 'header' : 'sourceRows')} ${index + 1}, ${d(locale, 'column')} ${column + 1}`} value={row[column] ?? ''} maxLength={1000} onChange={event => update(rows.map((value, position) => position === index ? Array.from({ length: width }, (_, cell) => cell === column ? event.target.value : value[cell] ?? '') : value))} /></td>)}</tr>)}</tbody></table></div><div className="data-actions"><button type="button" disabled={rows.length >= 26} onClick={() => update([...rows, Array.from({ length: width }, () => '')])}>{d(locale, 'addRow')}</button><button type="button" disabled={width >= 10} onClick={() => update(rows.map(row => [...Array.from({ length: width }, (_, index) => row[index] ?? ''), '']))}>{d(locale, 'addColumn')}</button></div></fieldset>;
}
