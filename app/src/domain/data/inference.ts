import type { DatasetColumn, DatasetRead } from './schema';
import { readDate, readNumber } from './cells';
import { reportIssue, shortLabel, type Diagnostic } from './report';

export function inferColumns(names: string[], rows: { row: number; cells: string[] }[], read: DatasetRead, report: Diagnostic[]): DatasetColumn[] {
  return names.map((name, index) => {
    const present = rows.filter(row => !read.missing.includes(row.cells[index]!.trim()));
    let invalidNumbers = 0, invalidDates = 0, precision = false, leadingZero = false;
    const levels = new Set<string>();
    for (const row of present) {
      const raw = row.cells[index]!, number = readNumber(raw, read);
      if (number.state !== 'value') invalidNumbers++;
      else if (number.precision) precision = true;
      if (readDate(raw, read.dateFormat).state !== 'value') invalidDates++;
      if (/^[+-]?0\d/.test(raw.trim())) leadingZero = true;
      if (levels.size <= 200) levels.add(raw);
    }
    const type = present.length && !invalidNumbers && !precision && !leadingZero ? 'number'
      : present.length && !invalidDates ? 'date' : levels.size > 200 ? 'text' : 'category';
    if (invalidNumbers && invalidNumbers < present.length) reportIssue(report, `number_${index}`, `${invalidNumbers} of ${present.length} cells in ${shortLabel(name)} are not numbers.`);
    if (precision) reportIssue(report, `precision_${index}`, `Integer precision would be lost in ${shortLabel(name)}; suggested as category.`);
    if (leadingZero) reportIssue(report, `identifier_${index}`, `Leading-zero identifiers in ${shortLabel(name)}; suggested as category.`);
    return { key: `c${index}`, name, type, unit: null, levels: null };
  });
}
