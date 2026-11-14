import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createDataSource, isWellFormedUnicode, verifyDataSourceHashes } from '../app/src/domain/data/source.ts';
import { createProject } from '../app/src/domain/project/factory.ts';
import { parseProject, FORMAT_VERSION } from '../app/src/domain/project/schema.ts';
import { migrateProject } from '../app/src/domain/project/migrations.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';
import { ProjectHistory } from '../app/src/domain/project/history.ts';
import { buildProjectJson } from '../app/src/domain/export/exporters.ts';
import { INPUT_LIMITS, InputError, preflightValue } from '../app/src/domain/security/input.ts';
import { packState, readStoredState, MemoryProjectStorage, storageFailure } from '../app/src/domain/storage/projectStorage.ts';
import { canonicalFigureContent, encodeFigureRecord, decodeFigureRecord, stateWithoutFigure } from '../app/src/domain/storage/figureLibrary.ts';

const at = '2026-10-10T12:00:00.000Z';
const hasCode = code => error => error instanceof InputError && error.code === code;
function dataset(source, origin = {}) {
  return {
    id: 'dataset-' + randomUUID(), name: 'Measurements', sourceId: source.id,
    origin: { name: 'table.csv', mediaType: 'text/csv', encoding: 'utf-8', bytes: Buffer.byteLength(source.content), importedAt: at, ...origin },
    read: { version: 1, delimiter: ',', header: 'first-row', skipRows: 0, decimal: '.', thousands: null,
      missing: ['', 'NA', 'N/A', 'NaN', 'null'], dateFormat: 'iso', transpose: false },
    columns: [{ key: 'c0', name: 'Group', type: 'category', unit: null, levels: null },
      { key: 'c1', name: 'Value', type: 'number', unit: null, levels: null }],
  };
}
function figure(content = 'Group,Value\nA,1\nB,2\n', origin) {
  const project = createProject(), source = createDataSource(content);
  project.dataSources = [source]; project.datasets = [dataset(source, origin)];
  return parseProject(project);
}
function state(current, previous = null, recent = []) {
  return { version: 2, current, previous, recent: recent.map(project => ({ project, lastOpenedAt: at })) };
}
function oldProject(version) {
  const { dataSources, datasets, ...project } = createProject();
  project.formatVersion = version;
  if (version === '1.0.0') delete project.media;
  return project;
}

test('new projects and every migration branch reach format 3 with empty data arrays', () => {
  assert.equal(FORMAT_VERSION, '3.0.0');
  for (const version of ['1.0.0', '2.0.0']) {
    const old = oldProject(version), before = structuredClone(old), migrated = migrateProject(old);
    assert.deepEqual(migrated, { ...old, formatVersion: FORMAT_VERSION, media: old.media ?? [], dataSources: [], datasets: [] });
    assert.deepEqual(old, before);
  }
  const legacy = migrateProject({ formatVersion: 0, title: 'Legacy' });
  assert.deepEqual(legacy.dataSources, []); assert.deepEqual(legacy.datasets, []);
  const current = createProject();
  assert.deepEqual(migrateProject(current), current);
});

test('older formats cannot smuggle data arrays or unsupported plot kinds through migration', () => {
  for (const version of ['1.0.0', '2.0.0']) {
    assert.throws(() => migrateProject({ ...oldProject(version), datasets: [] }), hasCode('invalid_project'));
    assert.throws(() => migrateProject({ ...oldProject(version), dataSources: [] }), hasCode('invalid_project'));
    assert.throws(() => migrateProject({ ...oldProject(version), objects: [{ kind: 'plot' }] }), hasCode('invalid_project'));
  }
});

test('source identity hashes decoded UTF-8 text, removes only the BOM, and keeps leading tabs and whitespace', () => {
  const text = '\tValue\r\nα,1\r\n🙂,2\r\n  ';
  const source = createDataSource('\ufeff' + text);
  assert.equal(source.content, text);
  assert.equal(source.id, 'data-' + createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.deepEqual(createDataSource(text), source);
  verifyDataSourceHashes([source]);
  const secondBom = createDataSource('\ufeff\ufeffValue');
  assert.equal(secondBom.content, '\ufeffValue'); // Only the first BOM is an encoding marker.
  const project = createProject(); project.dataSources = [secondBom]; project.datasets = [dataset(secondBom)];
  assert.deepEqual(readPortableProject(buildProjectJson(project)).dataSources, [secondBom]);
});

test('unpaired surrogates and binary text are refused before source identity can alias', () => {
  for (const text of ['\ud800', '\udc00', 'a\ud800b', '🙂\udc00', '\ud800\ud800\udc00']) {
    assert.equal(isWellFormedUnicode(text), false);
    assert.throws(() => createDataSource(text), hasCode('invalid_unicode'));
  }
  for (const text of ['🙂', '\ufffd', '', '\udbff\udfff']) assert.equal(isWellFormedUnicode(text), true);
  assert.throws(() => createDataSource('a\0b'), hasCode('binary_data'));
  const project = figure('\ufffd');
  assert.deepEqual(readPortableProject(buildProjectJson(project)), project);
  project.dataSources[0].content = '\ud800';
  assert.throws(() => readPortableProject(JSON.stringify(project)));
});

test('portable files verify content hashes while ordinary project validation does not rehash', () => {
  const project = figure(); project.dataSources[0].content += 'tampered';
  assert.doesNotThrow(() => parseProject(project));
  assert.throws(() => readPortableProject(JSON.stringify(project)), hasCode('data_hash_mismatch'));
});

test('only root dataSources array entries receive the byte-limited content exemption', () => {
  const content = 'a'.repeat(INPUT_LIMITS.textLength + 1);
  assert.doesNotThrow(() => preflightValue({ dataSources: [{ content }] }));
  for (const value of [{ content }, { other: { dataSources: [{ content }] } }, { dataSources: { content } },
    { dataSources: [[{ content }]] }, { datasets: [{ content }] }, { dataSources: [{ nested: { content } }] }])
    assert.throws(() => preflightValue(value), hasCode('text_limit'));
});

test('source ceilings use UTF-8 bytes on import and persisted content, including exact boundaries', () => {
  const ascii = 'a'.repeat(INPUT_LIMITS.dataSourceBytes);
  assert.equal(createDataSource(ascii).content.length, INPUT_LIMITS.dataSourceBytes);
  assert.doesNotThrow(() => preflightValue({ dataSources: [{ content: ascii }] }));
  for (const text of [ascii + 'a', 'é'.repeat(INPUT_LIMITS.dataSourceBytes / 2) + 'é']) {
    assert.throws(() => createDataSource(text), hasCode('input_too_large'));
    assert.throws(() => preflightValue({ dataSources: [{ content: text }] }), hasCode('input_too_large'));
  }
  const sources = Array.from({ length: 4 }, () => ({ content: ascii }));
  assert.doesNotThrow(() => preflightValue({ dataSources: sources }));
  assert.throws(() => preflightValue({ dataSources: [...sources, { content: 'a' }] }), hasCode('data_limit'));
});

test('data is charged to the embedded project budget alongside artwork', () => {
  const dataSources = Array.from({ length: 4 }, () => ({ content: 'a'.repeat(INPUT_LIMITS.dataSourceBytes) }));
  const assets = Array.from({ length: 17 }, () => ({ svg: 'a'.repeat(INPUT_LIMITS.svgBytes) }));
  assert.throws(() => preflightValue({ dataSources, assets }), hasCode('input_too_large'));
});

test('dataset and source schemas reject extra properties at every new model boundary', () => {
  for (const boundary of ['source', 'dataset', 'origin', 'read', 'column']) {
    const project = figure(), data = project.datasets[0];
    const target = { source: project.dataSources[0], dataset: data, origin: data.origin, read: data.read, column: data.columns[0] }[boundary];
    target.unexpected = true;
    assert.throws(() => parseProject(project), hasCode('invalid_project'));
  }
  const project = figure(); project.datasets[0].columns[0].levels = ['constructor', '__proto__', 'prototype', ''];
  assert.doesNotThrow(() => parseProject(project)); // Inert values, never object keys.
  project.datasets[0].columns[0].levels = JSON.parse('{"__proto__":"malicious"}');
  assert.throws(() => parseProject(project), hasCode('unsafe_key'));
});

test('dataset schema enforces bounded versions, types, provenance, and reading policy', () => {
  for (const change of [
    data => { data.read.version = 2; }, data => { data.read.decimal = ','; data.read.thousands = ','; },
    data => { data.origin.bytes = INPUT_LIMITS.dataSourceBytes + 1; }, data => { data.origin.importedAt = 'yesterday'; },
    data => { data.origin.mediaType = 'text/html'; }, data => { data.origin.encoding = 'utf-7'; },
    data => { data.id = 'dataset-plain'; }, data => { data.columns[0].type = 'javascript'; },
    data => { data.columns[0].levels = ['A', 'A']; }, data => { data.read.skipRows = -1; },
    data => { data.columns = Array.from({ length: INPUT_LIMITS.datasetColumns + 1 }, (_, i) => ({ ...data.columns[0], key: 'c' + i })); },
  ]) { const project = figure(); change(project.datasets[0]); assert.throws(() => parseProject(project), hasCode('invalid_project')); }
});

test('project graph rejects missing sources, orphan sources, duplicate IDs, and noncontiguous column keys', () => {
  const project = figure();
  const missing = structuredClone(project); missing.dataSources = [];
  assert.throws(() => parseProject(missing), hasCode('missing_data_source'));
  const orphan = structuredClone(project); orphan.datasets = [];
  assert.throws(() => parseProject(orphan), hasCode('unused_data_source'));
  const duplicate = structuredClone(project); duplicate.dataSources.push({ ...duplicate.dataSources[0] });
  assert.throws(() => parseProject(duplicate), hasCode('duplicate_id'));
  const duplicateDataset = structuredClone(project); duplicateDataset.datasets.push(structuredClone(duplicateDataset.datasets[0]));
  assert.throws(() => parseProject(duplicateDataset), hasCode('duplicate_id'));
  for (const key of ['c0', 'c3']) {
    const invalid = structuredClone(project); invalid.datasets[0].columns[1].key = key;
    assert.throws(() => parseProject(invalid), hasCode('invalid_columns'));
  }
});

test('source and dataset count ceilings accept their boundary and reject one more', () => {
  const project = createProject();
  for (let i = 0; i < INPUT_LIMITS.dataSources; i++) {
    const source = createDataSource('Value\n' + i); project.dataSources.push(source); project.datasets.push(dataset(source));
  }
  while (project.datasets.length < INPUT_LIMITS.datasets) project.datasets.push(dataset(project.dataSources[0]));
  assert.doesNotThrow(() => parseProject(project));
  const tooManyDatasets = structuredClone(project); tooManyDatasets.datasets.push(dataset(project.dataSources[0]));
  assert.throws(() => parseProject(tooManyDatasets), hasCode('invalid_project'));
  project.dataSources.push(createDataSource('extra'));
  assert.throws(() => parseProject(project), hasCode('invalid_project'));
});

test('packed state v4 shares sources across revisions and figures without merging provenance', () => {
  const a = figure(undefined, { name: 'first.csv' }), b = figure(undefined,
    { name: 'second.tab', encoding: 'utf-16le', importedAt: '2026-10-10T13:00:00.000Z', bytes: 100 });
  const original = state(b, a, [a, b]), packed = packState(original);
  assert.equal(packed.version, 4); assert.deepEqual(packed.dataSources, a.dataSources);
  assert.equal(Object.hasOwn(packed.current.body, 'dataSources'), false);
  assert.deepEqual(packed.current.dataSourceIds, [a.dataSources[0].id]);
  assert.deepEqual(readStoredState(structuredClone(packed)), { state: original, recovered: false });
  assert.deepEqual(readPortableProject(buildProjectJson(a)).datasets[0].origin, a.datasets[0].origin);
  assert.deepEqual(readPortableProject(buildProjectJson(b)).datasets[0].origin, b.datasets[0].origin);
  const changed = structuredClone(b); changed.dataSources[0].content += 'changed';
  assert.throws(() => packState(state(changed, a)), /identity is inconsistent/);
});

test('v4 recovery retains previous data when current references are damaged', () => {
  const previous = figure('Value\nold'), current = figure('Value\nnew');
  const packed = packState(state(current, previous, [current, previous]));
  packed.current.dataSourceIds = ['data-' + '0'.repeat(64)];
  const recovered = readStoredState(packed);
  assert.equal(recovered.recovered, true); assert.deepEqual(recovered.state.current, previous);
  const duplicateSource = packState(state(current, previous));
  duplicateSource.dataSources.push({ ...current.dataSources[0], content: 'conflicting content' });
  assert.deepEqual(readStoredState(duplicateSource).state.current, previous);
  const badUnicode = packState(state(current, previous)); badUnicode.dataSources[0].content = '\ud800';
  assert.deepEqual(readStoredState(badUnicode).state.current, previous);
});

test('stored versions 2 and 3 still migrate old projects and retain recovery behavior', () => {
  const old = oldProject('2.0.0'), expected = migrateProject(old), { media, ...body } = old;
  const shapes = [{ version: 2, current: old, previous: null, recent: [] },
    { version: 3, current: { body, mediaIds: [] }, previous: null, recent: [], media }];
  for (const shape of shapes) assert.deepEqual(readStoredState(shape), { state: state(expected), recovered: false });
});

test('undo and redo restore source definitions and import provenance independently', () => {
  const initial = figure(undefined, { name: 'first.csv' }), history = new ProjectHistory(initial, 2);
  const imported = history.current;
  imported.datasets.push(dataset(initial.dataSources[0], { name: 'second.tsv', encoding: 'utf-16be', bytes: 80 }));
  history.push(imported);
  const replaced = history.current, replacement = createDataSource('Group,Value\nA,5');
  replaced.dataSources.push(replacement); replaced.datasets[0].sourceId = replacement.id; replaced.datasets[0].origin.name = 'replacement.csv';
  history.push(replaced);
  assert.deepEqual(history.undo(), imported); assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), imported); assert.deepEqual(history.redo(), replaced);
  const external = history.current; external.dataSources[0].content = 'mutated externally'; external.datasets[0].origin.name = 'mutated externally';
  assert.deepEqual(history.current, replaced);
  const corrupt = history.current; corrupt.dataSources[0].content += 'changed';
  assert.throws(() => history.push(corrupt), /identity changed/);
});

test('saved figures, recent figures, import matching, and deletion include each figure’s data', async () => {
  const storage = new MemoryProjectStorage(), a = figure(undefined, { name: 'a.csv' }), b = figure(undefined, { name: 'b.csv' });
  await storage.save(a); await storage.save(b);
  assert.deepEqual(await storage.load(), b);
  assert.deepEqual(await storage.loadFigure(a.metadata.id), a);
  assert.deepEqual((await storage.listRecent()).map(item => item.project), [b, a]);
  assert.deepEqual(decodeFigureRecord(encodeFigureRecord(a), a.metadata.id), a);
  const copy = structuredClone(a); copy.metadata.updatedAt = '2026-10-10T14:00:00.000Z';
  assert.deepEqual(await storage.resolveImport(copy), a);
  assert.notEqual(canonicalFigureContent(a), canonicalFigureContent(b));
  const withoutA = stateWithoutFigure(state(b, a, [b, a]), a.metadata.id);
  assert.deepEqual(packState(withoutA).dataSources, b.dataSources);
  await storage.deleteFigure(a.metadata.id);
  await assert.rejects(storage.loadFigure(a.metadata.id), hasCode('saved_figure_invalid'));
  assert.deepEqual((await storage.listRecent()).map(item => item.project), [b]);
});

test('quota-full advice mentions datasets only when the save includes data', () => {
  const quota = new DOMException('Full disk', 'QuotaExceededError'), fallback = new Error('Other failure');
  assert.equal(storageFailure(fallback, fallback, true), fallback);
  assert.match(storageFailure(quota, fallback, true).message, /remove datasets/);
  assert.doesNotMatch(storageFailure(quota, fallback).message, /datasets/);
});
