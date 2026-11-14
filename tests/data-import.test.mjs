import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewImport, DatasetCache } from '../app/src/domain/data/dataset.ts';
import { defaultRead, detectRead } from '../app/src/domain/data/detect.ts';
import { tokenize } from '../app/src/domain/data/tokenize.ts';
import { readNumber, readDate } from '../app/src/domain/data/cells.ts';
import { decodeDataFile } from '../app/src/domain/data/source.ts';
import { exportTable, originalDownloadName } from '../app/src/domain/data/exportCsv.ts';
import { INPUT_LIMITS } from '../app/src/domain/security/input.ts';
import { dataFixture } from './data-helpers.mjs';
test('RFC 4180 quotes, escaped quotes, quoted newlines and all newline styles', () => {
  const records = tokenize('a,b\r\n"one,two","a""b"\r"line\nnext",2\n', ',', defaultRead);
  assert.deepEqual(records.map(row => row.cells), [['a','b'], ['one,two','a"b'], ['line\nnext','2']]);
  for (const value of ['a,b\n"unterminated,2', 'a,b\n"closed"extra,2', 'a,b\nun"quoted,2']) assert.throws(() => tokenize(value, ',', defaultRead));
});
test('delimiter scoring handles ragged tables, quoted punctuation, decimal commas and leading tab', () => {
  for (const [text, delimiter, width] of [['a;b\n1,5;2,5\n3,5;4,5',';',2], ['group,value\nA,1\nB\nC,3',',',2], ['group,value\n"a;b",2\nx,4',',',2], ['value\n1,5\n2,5','\t',1], ['\tValue\nA\t1\nB\t2','\t',2]]) {
    const result = previewImport(text); assert.equal(result.read.delimiter, delimiter); assert.equal(result.table.columns.length, width);
  }
  const ragged = previewImport('group,value\nA,1\nB\nC,3'); assert.equal(ragged.table.rows[1].cells[1].state, 'missing'); assert.ok(ragged.table.report.some(entry => entry.code === 'ragged_row'));
  assert.equal(detectRead('a;b\n1,5;2,5').decimal, ',');
});
test('one numeric grammar handles exponent, policy grouping and ambiguous values', () => {
  const comma = { decimal: ',', thousands: '.' }, dot = { decimal: '.', thousands: ',' };
  assert.equal(readNumber('1e-6', defaultRead).value, 1e-6); assert.equal(readNumber('1.234,56', comma).value, 1234.56);
  assert.equal(readNumber('0,500', comma).value, .5); assert.equal(readNumber('1,5', comma).value, 1.5);
  assert.equal(readNumber('0,500', dot).value, 500); assert.equal(readNumber('1,5', dot).state, 'invalid');
  for (const value of ['12 34', '12%', '£4', '1e999']) assert.equal(readNumber(value, defaultRead).state, 'invalid');
  assert.equal(readNumber('12 345', { decimal: '.', thousands: ' ' }).value, 12345);
  assert.equal(previewImport('id\n00123\n00456').table.columns[0].type, 'category');
  assert.equal(previewImport('id\n9007199254740993').table.columns[0].type, 'category');
  assert.ok(previewImport('value\n1,234', { ...defaultRead, delimiter: '\t', decimal: ',' }).ambiguous.length);
});
test('calendar validation and selected date formats use explicit UTC', () => {
  assert.equal(readDate('2024-02-30', 'iso').state, 'invalid'); assert.equal(readDate('2024-02-29', 'iso').value, Date.UTC(2024,1,29));
  assert.equal(readDate('1/2/2024', 'dmy').value, Date.UTC(2024,1,1)); assert.equal(readDate('1/2/2024', 'mdy').value, Date.UTC(2024,0,2));
  assert.equal(readDate('2024-02-01T12:00+02:00', 'iso').value, Date.UTC(2024,1,1,10));
});
test('headers, transpose, missing and invalid cells retain explicit diagnostic distinctions', () => {
  const result = previewImport(',Name,Name\nA,1,NA\nB,bad,2', defaultRead); assert.deepEqual(result.table.columns.map(value => value.name), ['Column 1','Name','Name (2)']);
  const columns = result.table.columns.map((column, index) => index === 1 ? { ...column, type: 'number' } : column);
  const forced = previewImport(result.source.content, defaultRead, columns); assert.equal(forced.table.rows[1].cells[1].state, 'invalid'); assert.equal(forced.table.rows[0].cells[2].state, 'missing');
  const transposed = previewImport('Group,A,B\nValue,1,2', { ...defaultRead, transpose: true }); assert.deepEqual(transposed.table.columns.map(value => value.name), ['Group','Value']); assert.equal(transposed.table.rows[1].cells[1].value, 2);
});
test('ragged expansion and input ceilings are refused before padding', () => {
  assert.throws(() => previewImport('h\n' + 'a\n'.repeat(90000) + Array(500).fill('b').join(','), defaultRead), error => error.code === 'data_cells');
  assert.throws(() => previewImport('a'.repeat(INPUT_LIMITS.dataSourceBytes + 1))); assert.throws(() => previewImport('x\n\ud800'));
});
test('UTF decoding preserves text and needs an explicit legacy-encoding fallback', () => {
  assert.equal(decodeDataFile(new Uint8Array([0xef,0xbb,0xbf,0xef,0xbb,0xbf,0x61])).source.content, '\ufeffa');
  assert.equal(decodeDataFile(new Uint8Array([0xff,0xfe,0x61,0,0x0a,0,0x62,0])).source.content, 'a\nb');
  assert.throws(() => decodeDataFile(new Uint8Array([0xe9]))); assert.equal(decodeDataFile(new Uint8Array([0xe9]), 'windows-1252').source.content, 'é');
  assert.throws(() => decodeDataFile(new Uint8Array([65,0,66])));
});
test('cache key includes the entire read policy and column overrides', () => {
  const fixture = dataFixture('Group,Value\nA,1\nB,2'), cache = new DatasetCache(); const first = cache.get(fixture.source, fixture.dataset);
  const changed = { ...fixture.dataset, columns: fixture.dataset.columns.map(column => ({ ...column, type: 'category' })) }; const second = cache.get(fixture.source, changed);
  assert.equal(first.rows[0].cells[1].value, 1); assert.equal(second.rows[0].cells[1].value, '1'); assert.equal(cache.get(fixture.source, fixture.dataset), first);
});
test('spreadsheet text is prefixed before quoting; numbers retain their type', () => {
  const text = ['=A1','+a','-text','@x','\tx','\rx','quote",comma\nline'];
  const csv = exportTable([text, [-2, 3.5, null]]); const rows = tokenize(csv, ',', defaultRead);
  assert.deepEqual(rows[0].cells, text.map(value => /^[=+\-@\t\r]/.test(value) ? "'" + value : value)); assert.deepEqual(rows[1].cells, ['-2','3.5','']);
  const tsv = exportTable([text], '\t'); assert.deepEqual(tokenize(tsv, '\t', defaultRead)[0].cells, rows[0].cells);
  for (const name of ['notes.html','CON.csv','../../evil.html','a\u0001\\bad.txt']) { const filename = originalDownloadName({ origin: { name, mediaType: 'text/csv' } }); assert.match(filename, /\.csv$/); assert.doesNotMatch(filename, /[\\/\u0000-\u001f]/); assert.notEqual(filename.toUpperCase(), 'CON.CSV'); }
});
