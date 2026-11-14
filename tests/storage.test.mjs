import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture } from './data-helpers.mjs';
import { dataSourceKey } from '../app/src/domain/storage/dataSourceRecords.ts';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createProject } from '../app/src/domain/project/factory.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { migrateProject } from '../app/src/domain/project/migrations.ts';
import { INPUT_LIMITS, InputError } from '../app/src/domain/security/input.ts';
import {
  canonicalFigureContent, decodeFigureRecord, decodeSavedFigure, encodeFigureRecord, figureIdsToSync, figureRecordKey,
  figureSummaryKey, importCandidateIds, listFigureSummaries, parseFigureSummary, resolveImportDecision,
  selectLibrarySync, stateWithoutFigure, summarizeFigure,
} from '../app/src/domain/storage/figureLibrary.ts';
import {
  IndexedDbProjectStorage, MemoryProjectStorage, packState, readStoredState, storageFailure,
} from '../app/src/domain/storage/projectStorage.ts';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>';
const asset = () => ({
  id: 'private-asset', title: 'Private drawing', description: 'Schematic', keywords: ['cell'], category: 'Cells',
  source: { provider: 'Private import', sourceUrl: 'https://example.org/source', assetUrl: null, retrievedAt: '2026-10-07' },
  creator: { name: 'Researcher', url: null },
  license: { id: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true },
  attribution: { text: 'Private drawing by Researcher', modified: false, modificationNotes: null }, svg, verified: false,
});
const rect = (id = 'shape-a') => ({
  id, name: 'Shape', kind: 'rect', x: 10, y: 10, width: 20, height: 20, scaleX: 1, scaleY: 1, angle: 0,
  opacity: 1, visible: true, locked: false, fill: '#ffffff', stroke: '#263238', strokeWidth: 1,
});
function samplePng() {
  const crc = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0); body.copy(output, 4); output.writeUInt32BE(crc(body), 8 + data.length);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const png = samplePng();
const image = { id: 'image-' + createHash('sha256').update(png).digest('hex'), name: 'sample.png',
  mimeType: 'image/png', data: png.toString('base64'), width: 1, height: 1 };

const figure = (title, id) => {
  const project = createProject(); project.metadata.id = id; project.metadata.title = title; project.objects = [rect()];
  return parseProject(project);
};
const withArtwork = () => {
  const project = createProject(); project.metadata.id = 'fig-rich'; project.metadata.title = 'Figure with image';
  project.media = [image]; project.assets = [asset()];
  project.objects = [
    { ...rect('image-a'), kind: 'image', mediaId: image.id, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, flipX: false, flipY: false },
    { ...rect('svg-a'), kind: 'svg', assetId: 'private-asset' },
  ];
  return parseProject(project);
};
const at = minute => new Date(Date.UTC(2026, 9, 10, 12, minute)).toISOString();
const recent = (project, lastOpenedAt) => ({ project, lastOpenedAt });
const summaries = entries => new Map(entries.map(([project, savedAt]) => [project.metadata.id, summarizeFigure(project, savedAt)]));
const entry = (project, savedAt = at(1)) => ({ summary: summarizeFigure(project, savedAt), record: encodeFigureRecord(project) });
const code = expected => error => error instanceof InputError && error.code === expected;

test('library keys use their own v1 prefix beside the unchanged state record', () => {
  assert.equal(figureSummaryKey('fig-a'), 'openrender:figure-summary:v1:fig-a');
  assert.equal(figureRecordKey('fig-a'), 'openrender:figure:v1:fig-a');
});

test('a library entry round-trips a project with an embedded image and artwork', () => {
  const project = withArtwork();
  const stored = structuredClone(entry(project, at(5)));
  assert.deepEqual(decodeFigureRecord(stored.record, 'fig-rich'), project);
  assert.deepEqual(decodeSavedFigure('fig-rich', stored.summary, stored.record), project);
  assert.deepEqual(parseFigureSummary(stored.summary, 'fig-rich'),
    { version: 1, id: 'fig-rich', title: 'Figure with image', width: 1200, height: 800, savedAt: at(5) });
});

test('summaries are accepted only within the project schema bounds', () => {
  const valid = summarizeFigure(figure('Bounds', 'fig-a'), at(1));
  const longest = { ...valid, id: 'x'.repeat(128), title: 'x'.repeat(INPUT_LIMITS.textLength), width: 100, height: 10_000 };
  assert.deepEqual(parseFigureSummary(longest), longest);
  const missing = { ...valid }; delete missing.savedAt;
  for (const hostile of [
    { ...valid, title: 'x'.repeat(20_000) }, { ...valid, title: '' }, { ...valid, title: 5 }, { ...valid, title: ['A'] },
    { ...valid, id: '' }, { ...valid, id: 'x'.repeat(129) }, { ...valid, id: 7 },
    { ...valid, version: 2 }, { ...valid, version: '1' },
    { ...valid, width: '1200' }, { ...valid, height: null }, { ...valid, width: 99 }, { ...valid, height: 10_001 },
    { ...valid, width: 1200.5 }, { ...valid, width: Infinity }, { ...valid, height: NaN },
    { ...valid, savedAt: 'yesterday' }, { ...valid, savedAt: '2026-13-01T00:00:00.000Z' },
    { ...valid, savedAt: '2026-02-30T00:00:00.000Z' }, { ...valid, savedAt: '2026-10-10T12:00:00+02:00' }, { ...valid, savedAt: 0 },
    { ...valid, extra: true }, { ...valid, onload: 'steal()' }, { ...valid, ...JSON.parse('{"__proto__":{"polluted":true}}') },
    missing, null, undefined, 'summary', 42, [], [valid], new Map(Object.entries(valid)),
  ]) assert.equal(parseFigureSummary(hostile), null);
  assert.equal(parseFigureSummary(valid, 'fig-b'), null);
  assert.equal({}.polluted, undefined);
});

test('listing keeps valid summaries newest first and counts the rest as skipped', () => {
  const a = summarizeFigure(figure('A', 'fig-a'), at(1));
  const b = summarizeFigure(figure('B', 'fig-b'), at(2));
  assert.deepEqual(listFigureSummaries([
    [figureSummaryKey('fig-a'), a],
    [figureSummaryKey('fig-b'), b],
    [figureSummaryKey('fig-c'), { ...a, id: 'fig-c', title: 'x'.repeat(20_000) }],
    [figureSummaryKey('fig-d'), { ...b }],
    [figureSummaryKey('fig-e'), 'not a summary'],
    [figureRecordKey('fig-a'), a],
  ]), { figures: [b, a], skipped: 4 });
  assert.deepEqual(listFigureSummaries([]), { figures: [], skipped: 0 });
});

test('hostile or damaged library records are rejected before reaching the editor', () => {
  const project = figure('Record', 'fig-a');
  const rejects = (value, id = 'fig-a') => assert.throws(() => decodeFigureRecord(value, id), code('saved_figure_invalid'));
  for (const value of [undefined, null, 'record', 42, [], [encodeFigureRecord(project)], { project },
    { version: 2, project }, { ...encodeFigureRecord(project), extra: 1 }, { version: 1 }, { version: 1, project: null },
    { version: 1, project: 'json' }, { version: 1, project: { ...project, metadata: { ...project.metadata, createdAt: new Date() } } }])
    rejects(value);
  rejects(encodeFigureRecord(project), 'fig-b');
  const scripted = withArtwork();
  scripted.assets[0].svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>';
  rejects(encodeFigureRecord(scripted), 'fig-rich');
  const complex = structuredClone(project);
  complex.objects = Array.from({ length: INPUT_LIMITS.jsonNodes / 2 + 1 }, () => [0]);
  assert.throws(() => migrateProject(complex), /complexity/);
  rejects(encodeFigureRecord(complex));
  const cyclic = structuredClone(project); cyclic.objects = [cyclic];
  rejects(encodeFigureRecord(cyclic));
  assert.throws(() => decodeSavedFigure('fig-a', undefined, encodeFigureRecord(project)), code('saved_figure_invalid'));
  assert.throws(() => decodeSavedFigure('fig-a', summarizeFigure(project, at(1)), undefined), code('saved_figure_invalid'));
});

test('canonical content ignores identity and edit time but not edits such as the grid', () => {
  const a = figure('Same', 'fig-a');
  const b = structuredClone(a); b.metadata.id = 'fig-b'; b.metadata.updatedAt = at(30);
  assert.equal(canonicalFigureContent(b), canonicalFigureContent(a));
  assert.equal(canonicalFigureContent(Object.fromEntries(Object.entries(b).reverse())), canonicalFigureContent(a));
  const grid = structuredClone(a); grid.settings.grid.enabled = true;
  assert.notEqual(canonicalFigureContent(grid), canonicalFigureContent(a));
});

test('sync copies missing and stale figures, the newest copy per id, and nothing once synced', () => {
  const a = figure('A', 'fig-a'), b = figure('B', 'fig-b'), oldB = figure('B old', 'fig-b');
  const state = { current: a, recent: [recent(a, at(3)), recent(oldB, at(1)), recent(b, at(2))] };
  assert.deepEqual(figureIdsToSync(state), ['fig-a', 'fig-b']);
  assert.deepEqual(figureIdsToSync({ current: null, recent: [] }), []);
  assert.deepEqual(selectLibrarySync(state, new Map(), undefined, at(9)),
    [{ project: a, savedAt: at(3) }, { project: b, savedAt: at(2) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)], [oldB, at(1)]]), encodeFigureRecord(a), at(9)),
    [{ project: b, savedAt: at(2) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)], [b, at(2)]]), encodeFigureRecord(a), at(9)), []);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)], [oldB, at(5)]]), encodeFigureRecord(a), at(9)), []);
  const hostile = new Map([['fig-a', summarizeFigure(a, at(3))], ['fig-b', { ...summarizeFigure(b, at(2)), title: 'x'.repeat(20_000) }]]);
  assert.deepEqual(selectLibrarySync(state, hostile, encodeFigureRecord(a), at(9)), [{ project: b, savedAt: at(2) }]);
});

test('sync compares the current figure by content, not by timestamp', () => {
  const a = figure('A', 'fig-a');
  const grid = structuredClone(a); grid.settings.grid.enabled = true;
  const state = { current: grid, recent: [recent(grid, at(3))] };
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)]]), encodeFigureRecord(a), at(9)), [{ project: grid, savedAt: at(3) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)]]), { version: 1, project: { damaged: true } }, at(9)),
    [{ project: grid, savedAt: at(3) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(3)]]), encodeFigureRecord(grid), at(9)), []);
  assert.deepEqual(selectLibrarySync({ current: a, recent: [] }, new Map(), undefined, at(9)), [{ project: a, savedAt: at(9) }]);
  assert.deepEqual(selectLibrarySync({ current: a, recent: [] }, summaries([[a, at(9)]]), encodeFigureRecord(a), at(10)), []);
});

test('a recovered revision fills a missing library entry but never replaces a valid one', () => {
  const a = figure('A', 'fig-a');
  const newer = structuredClone(a); newer.metadata.title = 'A newer';
  const state = { current: a, recovered: true, recent: [] };
  assert.deepEqual(selectLibrarySync(state, new Map(), undefined, at(9)), [{ project: a, savedAt: at(9) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[newer, at(5)]]), encodeFigureRecord(newer), at(9)), []);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(9)]]), encodeFigureRecord(a), at(10)), []);
  for (const [stored, record] of [
    [new Map([['fig-a', { ...summarizeFigure(newer, at(5)), width: 99 }]]), encodeFigureRecord(newer)],
    [new Map(), encodeFigureRecord(newer)],
    [summaries([[newer, at(5)]]), { version: 1, project: { damaged: true } }],
    [summaries([[newer, at(5)]]), undefined],
    [summaries([[newer, at(5)]]), encodeFigureRecord(figure('A newer', 'fig-b'))],
  ]) assert.deepEqual(selectLibrarySync(state, stored, record, at(9)), [{ project: a, savedAt: at(9) }]);
});

test('a recovered revision yields to the newest copy of its figure in the recent list', () => {
  const a = figure('A', 'fig-a'), b = figure('B', 'fig-b');
  const latest = structuredClone(a); latest.metadata.title = 'A latest';
  const state = { current: a, recovered: true, recent: [recent(latest, at(4)), recent(b, at(2)), recent(a, at(1))] };
  assert.deepEqual(selectLibrarySync(state, new Map(), undefined, at(9)),
    [{ project: latest, savedAt: at(4) }, { project: b, savedAt: at(2) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(4)], [b, at(2)]]), { version: 1, project: null }, at(9)),
    [{ project: latest, savedAt: at(4) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[a, at(1)], [b, at(2)]]), encodeFigureRecord(a), at(9)),
    [{ project: latest, savedAt: at(4) }]);
  assert.deepEqual(selectLibrarySync(state, summaries([[latest, at(4)], [b, at(2)]]), encodeFigureRecord(latest), at(9)), []);
});

test('the state record is read with its recovered revision in packed and legacy shapes', () => {
  const a = figure('A', 'fig-a'), b = figure('B', 'fig-b');
  const pack = project => { const { media, ...body } = project; return { body, mediaIds: media.map(image => image.id) }; };
  const packed = current => ({ version: 3, current, previous: pack(b), recent: [{ project: pack(a), lastOpenedAt: at(2) }], media: [] });
  const legacy = current => ({ version: 2, current, previous: b, recent: [recent(a, at(2))] });
  for (const shape of [packed, legacy]) {
    const readable = readStoredState(shape(shape === packed ? pack(a) : a));
    assert.equal(readable.recovered, false);
    assert.deepEqual(readable.state, { version: 2, current: a, previous: b, recent: [recent(a, at(2))] });
    const damaged = readStoredState(shape({ damaged: true }));
    assert.equal(damaged.recovered, true);
    assert.deepEqual(damaged.state, { version: 2, current: b, previous: b, recent: [recent(a, at(2))] });
  }
  assert.deepEqual(readStoredState(undefined), { state: { version: 2, current: null, previous: null, recent: [] }, recovered: false });
  assert.throws(() => readStoredState({ ...packed({ damaged: true }), previous: null }), /No readable saved revision/);
  assert.throws(() => readStoredState({ version: 9 }), /invalid/);
});

test('opening a file resolves by content, never by timestamp (cases a to d)', () => {
  const saved = figure('Imported', 'fig-a');
  const none = { summary: undefined, record: undefined };
  const forkId = () => 'fork-id';
  assert.equal(resolveImportDecision(saved, none, [], forkId), saved);
  const newer = structuredClone(saved); newer.metadata.updatedAt = at(40);
  assert.deepEqual(resolveImportDecision(newer, entry(saved), [], forkId), saved);
  const changed = structuredClone(saved); changed.settings.grid.enabled = true;
  const fork = resolveImportDecision(changed, entry(saved), [], forkId);
  assert.deepEqual(fork, { ...changed, metadata: { ...changed.metadata, id: 'fork-id' } });
  const copy = structuredClone(changed); copy.metadata.id = 'fig-copy';
  assert.deepEqual(resolveImportDecision(changed, entry(saved), [['fig-copy', encodeFigureRecord(copy)]], forkId), copy);
  assert.match(resolveImportDecision(changed, entry(saved), []).metadata.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('damaged or tampered saved copies are skipped during import, never reused or overwritten', () => {
  const saved = figure('Imported', 'fig-a');
  const file = structuredClone(saved); file.settings.grid.enabled = true;
  const forkId = () => 'fork-id';
  assert.equal(resolveImportDecision(file, { summary: summarizeFigure(saved, at(1)), record: { version: 1, project: { damaged: true } } }, [], forkId).metadata.id, 'fork-id');
  assert.equal(resolveImportDecision(file, { summary: undefined, record: 'damaged' }, [], forkId).metadata.id, 'fork-id');
  const equal = id => { const project = structuredClone(file); project.metadata.id = id; return project; };
  const tampered = [['fig-b', encodeFigureRecord(equal('fig-c'))], ['fig-d', { version: 2, project: equal('fig-d') }], ['fig-e', undefined]];
  assert.equal(resolveImportDecision(file, entry(saved), tampered, forkId).metadata.id, 'fork-id');
  assert.deepEqual(resolveImportDecision(file, entry(saved), [...tampered, ['fig-f', encodeFigureRecord(equal('fig-f'))]], forkId), equal('fig-f'));
  const other = (id, title, width = 1200) => ({ ...summarizeFigure(figure(title, id), at(1)), width });
  assert.deepEqual(importCandidateIds(file, [other('fig-a', 'Imported'), other('fig-b', 'Imported'), other('fig-c', 'Other'),
    other('fig-d', 'Imported', 1600), other('fig-e', 'Imported')]), ['fig-b', 'fig-e']);
});

test('deleting a figure drops its recent item and recovery copy and refuses the current figure', () => {
  const a = figure('A', 'fig-a'), b = figure('B', 'fig-b'), c = figure('C', 'fig-c');
  const state = { version: 2, current: a, previous: b, recent: [recent(a, at(3)), recent(b, at(2)), recent(c, at(1))] };
  const before = structuredClone(state);
  assert.deepEqual(stateWithoutFigure(state, 'fig-b'), { version: 2, current: a, previous: null, recent: [recent(a, at(3)), recent(c, at(1))] });
  assert.deepEqual(stateWithoutFigure(state, 'fig-c'), { version: 2, current: a, previous: b, recent: [recent(a, at(3)), recent(b, at(2))] });
  assert.deepEqual(stateWithoutFigure(state, 'fig-x'), state);
  assert.throws(() => stateWithoutFigure(state, 'fig-a'), code('figure_in_use'));
  assert.deepEqual(state, before);
});

test('a full disk during a commit is reported as storage_full; other failures keep their message', () => {
  const fallback = new Error('The local save could not be committed.');
  const full = storageFailure(new DOMException('Simulated quota failure', 'QuotaExceededError'), fallback);
  assert.ok(full instanceof InputError);
  assert.equal(full.code, 'storage_full');
  assert.match(full.message, /storage is full.*delete saved figures.*backup/i);
  assert.equal(storageFailure(new DOMException('Cancelled', 'AbortError'), fallback), fallback);
  assert.equal(storageFailure(null, fallback), fallback);
});

test('memory storage lists, opens, resolves and deletes saved figures with the IndexedDB semantics', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 10, 12) });
  const storage = new MemoryProjectStorage();
  const a = figure('Library A', 'fig-a'), b = figure('Library B', 'fig-b');
  await storage.save(a); t.mock.timers.tick(1000);
  await storage.save(b); t.mock.timers.tick(1000);
  const listed = await storage.listFigures();
  assert.deepEqual(listed.figures.map(item => item.title), ['Library B', 'Library A']);
  assert.equal(listed.skipped, 0);
  assert.equal(listed.figures[0].savedAt, (await storage.listRecent())[0].lastOpenedAt);
  assert.deepEqual(await storage.loadFigure('fig-a'), a);
  await assert.rejects(storage.loadFigure('missing'), code('saved_figure_invalid'));
  await assert.rejects(storage.deleteFigure('fig-b'), code('figure_in_use'));
  assert.deepEqual(await storage.listFigures(), listed);

  assert.deepEqual(await storage.resolveImport(a), a);
  const unknown = figure('New file', 'fig-new');
  assert.deepEqual(await storage.resolveImport(unknown), unknown);
  const edited = structuredClone(a); edited.metadata.title = 'Library A edited';
  const forked = await storage.resolveImport(edited);
  assert.notEqual(forked.metadata.id, 'fig-a');
  assert.deepEqual(await storage.loadFigure('fig-a'), a);
  await storage.save(forked); t.mock.timers.tick(1000);
  assert.deepEqual(await storage.resolveImport(edited), forked);

  await storage.deleteFigure('fig-b');
  assert.deepEqual((await storage.listFigures()).figures.map(item => item.id), [forked.metadata.id, 'fig-a']);
  assert.deepEqual((await storage.listRecent()).map(item => item.project.metadata.id), [forked.metadata.id, 'fig-a']);
  await assert.rejects(storage.loadFigure('fig-b'), code('saved_figure_invalid'));
  const synced = await storage.listFigures();
  assert.deepEqual(await storage.load(), forked);
  assert.deepEqual(await storage.listFigures(), synced);
  await storage.clearRecent();
  assert.deepEqual(await storage.listFigures(), synced);
});

// A minimal stand-in for an idb-keyval store over one object store: requests complete on later
// turns, a transaction commits once nothing is pending, and an aborted one discards its writes.
// `before[n]` runs just before transaction n starts, standing in for a commit from another tab.
function fakeStore() {
  const data = new Map();
  const before = [];
  let started = 0, puts = 0;
  const putsByKey = new Map();
  const useStore = (mode, callback) => Promise.resolve().then(() => {
    before[started++]?.(data);
    const view = new Map(data);
    let pending = 0, finished = false;
    const transaction = { error: null, abort() {
      if (finished) throw new DOMException('The transaction has finished.', 'InvalidStateError');
      finished = true; setImmediate(() => transaction.onabort?.());
    } };
    const settle = () => {
      if (pending || finished) return;
      finished = true; data.clear(); view.forEach((value, key) => data.set(key, value)); transaction.oncomplete?.();
    };
    const request = run => {
      const pendingRequest = {}; pending++;
      setImmediate(() => { if (finished) return; pendingRequest.result = run(); pending--; pendingRequest.onsuccess?.(); setImmediate(settle); });
      return pendingRequest;
    };
    const inRange = range => [...view.keys()].filter(key => range.includes(key)).sort();
    const store = { transaction,
      get: key => request(() => structuredClone(view.get(key))),
      getAllKeys: range => request(() => inRange(range)),
      getAll: range => request(() => inRange(range).map(key => structuredClone(view.get(key)))),
      put: (value, key) => { const copy = structuredClone(value); puts++; putsByKey.set(key, (putsByKey.get(key) ?? 0) + 1); return request(() => { view.set(key, copy); }); },
      delete: key => request(() => { view.delete(key); }) };
    const result = callback(store);
    setImmediate(settle);
    return result;
  });
  return { data, before, useStore, putsByKey, get started() { return started; }, get puts() { return puts; } };
}
// Listing saved figures reads summaries by key range, which Node lacks.
globalThis.IDBKeyRange ??= { bound: (lower, upper, lowerOpen, upperOpen) =>
  ({ includes: key => (lowerOpen ? key > lower : key >= lower) && (upperOpen ? key < upper : key <= upper) }) };
const STATE_KEY = 'openrender:documents:v2';
const copyOf = data => new Map([...data].map(([key, value]) => [key, structuredClone(value)]));
const replaceWith = (data, entries) => { data.clear(); for (const [key, value] of entries) data.set(key, structuredClone(value)); };
const mentions = (data, id) => [...data].some(([key, value]) => key.includes(id) || JSON.stringify(value).includes(id));

test('the load-time sync keeps a delete committed by another tab after load read the state', async () => {
  const fake = fakeStore();
  const tab = new IndexedDbProjectStorage(fake.useStore), other = new IndexedDbProjectStorage(fake.useStore);
  const a = figure('A', 'fig-a'), b = figure('B', 'fig-b');
  await tab.save(a); await tab.save(b);
  const beforeDelete = copyOf(fake.data);
  await other.deleteFigure('fig-a');
  const afterDelete = copyOf(fake.data);
  assert.equal(mentions(afterDelete, 'fig-a'), false);
  replaceWith(fake.data, beforeDelete);
  fake.before[fake.started + 1] = data => replaceWith(data, afterDelete);
  assert.deepEqual(await tab.load(), b);
  assert.equal(mentions(fake.data, 'fig-a'), false);
});

test('the load-time sync keeps a newer save committed by another tab after load read the state', async () => {
  const fake = fakeStore();
  const tab = new IndexedDbProjectStorage(fake.useStore), other = new IndexedDbProjectStorage(fake.useStore);
  const a = figure('A', 'fig-a');
  await tab.save(a);
  const beforeSave = copyOf(fake.data);
  const newer = structuredClone(a); newer.metadata.title = 'A newer';
  await other.save(newer);
  const afterSave = copyOf(fake.data);
  replaceWith(fake.data, beforeSave);
  fake.before[fake.started + 1] = data => replaceWith(data, afterSave);
  const puts = fake.puts;
  assert.deepEqual(await tab.load(), a);
  assert.equal(fake.puts, puts);
  assert.deepEqual(decodeFigureRecord(fake.data.get(figureRecordKey('fig-a')), 'fig-a'), newer);
});

test('a sync that finds no readable state record writes nothing and never fails the load', async () => {
  for (const replacement of [undefined, { version: 9 }]) {
    const fake = fakeStore();
    const tab = new IndexedDbProjectStorage(fake.useStore);
    const a = figure('A', 'fig-a');
    await tab.save(a);
    for (const key of [figureSummaryKey('fig-a'), figureRecordKey('fig-a')]) fake.data.delete(key);
    fake.before[fake.started + 1] = data => replacement === undefined ? data.delete(STATE_KEY) : data.set(STATE_KEY, replacement);
    const puts = fake.puts;
    assert.deepEqual(await tab.load(), a);
    assert.equal(fake.puts, puts);
    assert.deepEqual([...fake.data.keys()], replacement === undefined ? [] : [STATE_KEY]);
  }
});

test('a recovered revision reaches the library once, without touching the state record', async () => {
  const fake = fakeStore();
  const tab = new IndexedDbProjectStorage(fake.useStore);
  const x = figure('X', 'fig-x'), y = figure('Y', 'fig-y');
  await tab.save(y); await tab.save(x); await tab.clearRecent();
  for (const key of [...fake.data.keys()]) if (key !== STATE_KEY) fake.data.delete(key);
  fake.data.set(STATE_KEY, { ...fake.data.get(STATE_KEY), current: { damaged: true } });
  const state = structuredClone(fake.data.get(STATE_KEY));
  assert.deepEqual(await tab.load(), y);
  assert.equal(tab.recoveredPreviousRevision, true);
  assert.deepEqual(decodeSavedFigure('fig-y', fake.data.get(figureSummaryKey('fig-y')), fake.data.get(figureRecordKey('fig-y'))), y);
  assert.equal(mentions(new Map([...fake.data].filter(([key]) => key !== STATE_KEY)), 'fig-x'), false);
  assert.deepEqual(fake.data.get(STATE_KEY), state);
  const puts = fake.puts;
  assert.deepEqual(await tab.load(), y);
  assert.equal(fake.puts, puts);
});

test('a recovered revision is resolved by content before it opens, so a differing save of its figure survives (D-6b)', async () => {
  const fake = fakeStore();
  const tab = new IndexedDbProjectStorage(fake.useStore);
  const x = figure('X', 'fig-x'), newer = structuredClone(x);
  newer.metadata.title = 'X newer';
  // The current revision is damaged, `previous` holds x, and the library holds X's newer save.
  await tab.save(x); await tab.save(newer); await tab.clearRecent();
  fake.data.set(STATE_KEY, { ...fake.data.get(STATE_KEY), current: { damaged: true } });
  const damaged = structuredClone(fake.data.get(STATE_KEY)), stored = copyOf(fake.data);
  const asX = project => ({ ...project, metadata: { ...project.metadata, id: 'fig-x' } });
  // (d) X's saved content differs: the recovered revision opens under a fresh id and nothing is written.
  const forked = await tab.load();
  assert.equal(tab.recoveredPreviousRevision, true);
  assert.notEqual(forked.metadata.id, 'fig-x');
  assert.deepEqual(asX(forked), x);
  assert.deepEqual(fake.data, stored);
  // (c) A saved figure with another id holds the recovered content: that figure opens.
  await tab.save(forked); fake.data.set(STATE_KEY, damaged);
  assert.deepEqual(await tab.load(), forked);
  // (b) The saved figure with its id holds the recovered content: it opens under its own id.
  await tab.save(x); fake.data.set(STATE_KEY, damaged);
  assert.deepEqual(await tab.load(), x);
  // A resolution that fails never blocks startup: the recovered revision opens under a fresh id.
  tab.resolveImport = () => Promise.reject(new Error('The saved figures could not be read.'));
  const fallback = await tab.load();
  assert.notEqual(fallback.metadata.id, 'fig-x');
  assert.deepEqual(asX(fallback), x);
});

test('a missing current revision is recovered from the previous one like a damaged one, so a differing save of its figure survives (D-6c)', async () => {
  for (const envelope of ['packed', 'legacy']) {
    const fake = fakeStore();
    const tab = new IndexedDbProjectStorage(fake.useStore);
    const x = figure('X', 'fig-x'), newer = structuredClone(x);
    newer.metadata.title = 'X newer';
    // The current revision is null, `previous` holds x, and the library holds X's newer save.
    await tab.save(x); await tab.save(newer); await tab.clearRecent();
    fake.data.set(STATE_KEY, envelope === 'packed' ? { ...fake.data.get(STATE_KEY), current: null }
      : { version: 2, current: null, previous: x, recent: [] });
    const stored = copyOf(fake.data), puts = fake.puts;
    const xEntries = () => [figureSummaryKey('fig-x'), figureRecordKey('fig-x')].map(key => fake.data.get(key));
    const saved = xEntries();
    // (d) X's saved content differs: the previous revision opens under a fresh id and nothing is written.
    const opened = await tab.load();
    assert.equal(tab.recoveredPreviousRevision, true, envelope);
    assert.notEqual(opened.metadata.id, 'fig-x', envelope);
    assert.deepEqual({ ...opened, metadata: { ...opened.metadata, id: 'fig-x' } }, x, envelope);
    assert.equal(fake.puts, puts, envelope);
    assert.deepEqual(fake.data, stored, envelope);
    await tab.save(opened);
    assert.deepEqual(xEntries(), saved, envelope);
  }
  // Both revisions null, as clear() leaves them: an empty state, not a recovery.
  for (const value of [{ version: 3, current: null, previous: null, recent: [], media: [] }, { version: 2, current: null, previous: null, recent: [] }])
    assert.deepEqual(readStoredState(value), { state: { version: 2, current: null, previous: null, recent: [] }, recovered: false });
});

test('with IndexedDB denied, every storage method rejects instead of throwing (AC-FAIL-2)', async () => {
  // idb-keyval opens the database synchronously, so a denied open throws from the store function.
  const tab = new IndexedDbProjectStorage(() => { throw new DOMException('denied', 'SecurityError'); });
  const x = figure('X', 'fig-x');
  let listing;
  assert.doesNotThrow(() => { listing = tab.listFigures(); });
  assert.ok(listing instanceof Promise);
  await assert.rejects(listing, { name: 'SecurityError' });
  await assert.rejects(tab.load(), { name: 'SecurityError' });
  for (const call of [() => tab.save(x), () => tab.clear(), () => tab.listRecent(), () => tab.removeRecent('fig-x'),
    () => tab.clearRecent(), () => tab.loadFigure('fig-x'), () => tab.deleteFigure('fig-x'), () => tab.resolveImport(x)]) {
    let result;
    assert.doesNotThrow(() => { result = call(); }, call.toString());
    await assert.rejects(result, call.toString());
  }
});


test('content-addressed sources are written once, shared by figures, and collected only after the last owner', async () => {
  const fake = fakeStore(), storage = new IndexedDbProjectStorage(fake.useStore), a = dataFixture().project, b = structuredClone(a);
  b.metadata.id = 'figure-b'; b.datasets[0].origin.name = 'second.tsv';
  const key = dataSourceKey(a.dataSources[0].id);
  await storage.save(a); assert.equal(fake.data.get(STATE_KEY).version, 5); assert.equal(fake.data.get(key).references, 2); assert.equal(fake.putsByKey.get(key), 1);
  a.metadata.title = 'Edit without changing data'; await storage.save(a); assert.equal(fake.putsByKey.get(key), 1);
  await storage.save(b); assert.equal(fake.data.get(key).references, 3);
  assert.equal((await storage.loadFigure(a.metadata.id)).datasets[0].origin.name, a.datasets[0].origin.name);
  assert.equal((await storage.loadFigure(b.metadata.id)).datasets[0].origin.name, 'second.tsv');
  const empty = createProject(); await storage.save(empty); await storage.deleteFigure(a.metadata.id); assert.equal(fake.data.get(key).references, 2);
  await storage.deleteFigure(b.metadata.id); assert.equal(fake.data.has(key), false); assert.equal(fake.data.get(STATE_KEY).version, 4);
});

test('v4 state and v1 data-bearing figures upgrade without losing provenance or double-counting sources', async () => {
  const fake = fakeStore(), storage = new IndexedDbProjectStorage(fake.useStore), a = dataFixture().project;
  fake.data.set(STATE_KEY, packState({version: 2, current: a, previous: null, recent: [{project:a,lastOpenedAt:a.metadata.updatedAt}]}));
  fake.data.set(figureRecordKey(a.metadata.id), encodeFigureRecord(a)); fake.data.set(figureSummaryKey(a.metadata.id), summarizeFigure(a, a.metadata.updatedAt));
  assert.deepEqual(await storage.load(), a); await storage.save(a);
  assert.equal(fake.data.get(dataSourceKey(a.dataSources[0].id)).references, 2); assert.equal(fake.data.get(figureRecordKey(a.metadata.id)).version, 2);
  assert.deepEqual(await storage.loadFigure(a.metadata.id), a);
});

test('a failed library write rolls back newly created source records, references, and revisions together', async () => {
  const fake = fakeStore(); let fail = false;
  const useStore = (mode, callback) => fake.useStore(mode, store => callback({...store, put(value, key) { if (fail && key.startsWith('openrender:figure:')) throw new DOMException('Full disk', 'QuotaExceededError'); return store.put(value,key); }}));
  const storage = new IndexedDbProjectStorage(useStore); await storage.save(createProject()); const before = copyOf(fake.data); fail = true;
  await assert.rejects(storage.save(dataFixture().project), code('storage_full')); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(fake.data, before);
});

test('a missing current source recovers the independent previous source and can save again', async () => {
  const fake = fakeStore(), storage = new IndexedDbProjectStorage(fake.useStore), a = dataFixture('Group,Y\nA,1\nB,2').project, b = dataFixture('Group,Y\nA,3\nB,4').project;
  await storage.save(a); await storage.save(b); fake.data.delete(dataSourceKey(b.dataSources[0].id));
  assert.deepEqual(await storage.load(), a); assert.equal(storage.recoveredPreviousRevision, true); await storage.save(a); assert.deepEqual(await storage.load(), a);
});
