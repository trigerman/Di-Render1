import { hydrateState, hydrateFigure, dataSourceKey } from '../app/src/domain/storage/dataSourceRecords.ts';
// Stage 1: verify actual IndexedDB transactions and portable-file boundaries in the built app.
// Run: node --import ./tests/register-source.mjs tests/data-foundation-browser.mjs
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createProject } from '../app/src/domain/project/factory.ts';
import { createDataSource } from '../app/src/domain/data/source.ts';

const { chromium } = await import(process.env.OPENRENDER_PLAYWRIGHT_MODULE ?? '../app/node_modules/playwright/index.mjs');
const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173);
const STATE = 'openrender:documents:v2', RECORD = 'openrender:figure:v1:', SUMMARY = 'openrender:figure-summary:v1:';
const reportDirectory = 'reports/data-foundation';
await mkdir(reportDirectory, { recursive: true });
const buildIdentifier = createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [], network = [], results = [];
await context.route('**/*', route => {
  const url = route.request().url();
  if (new URL(url).origin === base || /^(data|blob):/.test(url)) return route.continue();
  network.push(url); return route.abort();
});
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', dialog => { void dialog.dismiss(); });
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const until = async (probe, message) => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) { if (await probe()) return; await page.waitForTimeout(50); }
  throw new Error(message);
};
const storeEntries = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('openrender-documents');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, transaction = db.transaction('documents', 'readonly'), store = transaction.objectStore('documents');
    const keys = store.getAllKeys(), values = store.getAll();
    transaction.oncomplete = () => { db.close(); resolve(keys.result.map((key, index) => [key, values.result[index]])); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
}));
const entries = async () => new Map(await storeEntries());
const rawState = async () => (await entries()).get(STATE);
const state = async () => { const all = await entries(); return hydrateState(all.get(STATE), async key => all.get(key)); };
const figure = async (all, id) => (await hydrateFigure(all.get(RECORD + id), async key => all.get(key))).project;
const quiet = async () => {
  await page.locator('.app-shell:not([inert])').waitFor();
  await page.getByText('Saved locally', { exact: true }).waitFor();
};
const downloadProject = async () => {
  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const file = await download, path = reportDirectory + '/current.obf.json';
  await file.saveAs(path); return JSON.parse(await readFile(path, 'utf8'));
};
const openFile = async project => {
  await page.locator('input[type=file][accept*=".obf"]').setInputFiles({
    name: 'data-fixture.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
};
const openFigure = async project => {
  await openFile(project);
  await until(async () => (await state())?.current?.body?.metadata?.id === project.metadata.id, 'the imported figure was not saved');
  await quiet();
};
const check = async (name, run) => {
  const started = Date.now();
  try { await run(); results.push({ name, pass: true, ms: Date.now() - started }); console.log('PASS ' + name); }
  catch (error) {
    results.push({ name, pass: false, error: error.message }); console.error('FAIL ' + name + ' ' + error.message);
    await page.screenshot({ path: reportDirectory + '/failure-' + results.length + '.png', fullPage: true }).catch(() => undefined);
    throw error;
  }
};
function fixture(title, text = '\tValue\r\nα,1\r\n' + 'A,2\r\n'.repeat(2500), origin = {}) {
  const project = createProject(), source = createDataSource(text);
  project.metadata.title = title; project.dataSources = [source];
  project.datasets = [{
    id: 'dataset-' + randomUUID(), name: 'Measurements', sourceId: source.id,
    origin: { name: 'original.csv', mediaType: 'text/csv', encoding: 'utf-8', bytes: Buffer.byteLength(text),
      importedAt: '2026-10-10T12:00:00.000Z', ...origin },
    read: { version: 1, delimiter: ',', header: 'first-row', skipRows: 0, decimal: '.', thousands: null,
      missing: ['', 'NA', 'N/A', 'NaN', 'null'], dateFormat: 'iso', transpose: false },
    columns: [{ key: 'c0', name: 'Group', type: 'category', unit: null, levels: null },
      { key: 'c1', name: 'Value', type: 'number', unit: null, levels: null }],
  }];
  return project;
}
const a = fixture('Data foundation A'), b = fixture('Data foundation B', undefined,
  { name: 'different.tab', encoding: 'utf-16le', importedAt: '2026-10-10T13:00:00.000Z', bytes: 30_000 });
const assertData = (actual, expected) => {
  assert.deepEqual(actual.dataSources, expected.dataSources); assert.deepEqual(actual.datasets, expected.datasets);
};
try {
  await page.goto(base);
  await check('data survives portable import, autosave, reload and portable export', async () => {
    await openFigure(a); await page.reload(); await quiet();
    const portable = await downloadProject(); assert.equal(portable.formatVersion, '3.0.0'); assertData(portable, a);
    assert.equal((await rawState()).version, 5); const packed = await state(); assert.equal(packed.version, 4); assert.deepEqual(packed.dataSources, a.dataSources);
    assert.equal(Object.hasOwn(packed.current.body, 'dataSources'), false);
  });
  await check('canvas edits, undo and redo preserve datasets', async () => {
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click(); await quiet();
    assertData(await downloadProject(), a);
    await page.getByTestId('undo').click(); await quiet(); assertData(await downloadProject(), a);
    await page.getByTestId('redo').click(); await quiet(); assertData(await downloadProject(), a);
  });
  await check('loading and selecting a data-backed figure produces no extra autosave', async () => {
    const before = await storeEntries();
    await page.reload(); await quiet();
    await page.getByRole('tab', { name: /^Layers/ }).click();
    await page.locator('.layer-row .layer-main').first().click();
    await page.locator('.layer-row.is-selected').waitFor();
    // Observe beyond the 450 ms autosave debounce, including a falsely scheduled save.
    await page.waitForTimeout(800);
    assert.deepEqual(await storeEntries(), before);
  });
  await check('two figures with equal text share a packed source and keep distinct provenance', async () => {
    await openFigure(b); await page.reload(); await quiet();
    const packed = await state(), all = await entries();
    assert.deepEqual(packed.dataSources, a.dataSources);
    assertData(await figure(all, a.metadata.id), a); assertData(await figure(all, b.metadata.id), b); assert.equal(all.get(dataSourceKey(a.dataSources[0].id)).references, 3);
    assertData(await downloadProject(), b);
    assert.ok(packed.recent.some(item => item.project.body.metadata.id === a.metadata.id));
  });
  await check('opening a saved figure from Figures restores its own data and provenance', async () => {
    await page.getByRole('tab', { name: /^Figures/ }).click();
    const row = page.locator('.figure-list li').filter({ has: page.getByText(a.metadata.title, { exact: true }) });
    await row.locator('.figure-row-open').click();
    await until(async () => (await state())?.current?.body?.metadata?.id === a.metadata.id, 'saved figure did not open');
    await quiet(); assertData(await downloadProject(), a);
  });
  await check('hash mismatch and lone-surrogate files leave the open figure and storage intact', async () => {
    const before = await downloadProject(), stored = await storeEntries();
    const tampered = structuredClone(a); tampered.dataSources[0].content += 'tampered';
    await openFile(tampered);
    await page.getByText(/does not match its content fingerprint/).waitFor();
    assert.deepEqual(await downloadProject(), before); assert.deepEqual(await storeEntries(), stored);
    const surrogate = fixture('Lone surrogate', '\ufffd'); surrogate.dataSources[0].content = '\ud800';
    await openFile(surrogate);
    await page.getByText(/unpaired Unicode surrogate/).waitFor();
    assert.deepEqual(await downloadProject(), before); assert.deepEqual(await storeEntries(), stored);
  });
  await check('a replacement character with its correct fingerprint opens normally', async () => {
    const replacement = fixture('Valid replacement character', '\ufffd');
    await openFigure(replacement); assertData(await downloadProject(), replacement);
  });
  await check('deleting saved figures removes their records, recovery copies and unused pooled data', async () => {
    await page.getByRole('tab', { name: /^Figures/ }).click();
    for (const project of [a, b]) {
      await page.getByRole('button', { name: 'Delete saved figure: ' + project.metadata.title, exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete figure', exact: true }).click();
      await until(async () => !(await entries()).has(RECORD + project.metadata.id), 'deleted figure record remains');
    }
    const all = await entries(), packed = await state();
    for (const project of [a, b]) {
      assert.equal(all.has(SUMMARY + project.metadata.id), false);
      assert.ok(packed.recent.every(item => item.project.body.metadata.id !== project.metadata.id));
      assert.notEqual(packed.previous?.body.metadata.id, project.metadata.id);
    }
    assert.equal(packed.dataSources.some(source => source.id === a.dataSources[0].id), false); assert.equal(all.has(dataSourceKey(a.dataSources[0].id)), false);
  });
  await check('previous-revision recovery restores the dataset and source', async () => {
    const original = await state();
    await page.evaluate(({ key, original }) => new Promise((resolve, reject) => {
      const open = indexedDB.open('openrender-documents');
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('documents', 'readwrite');
        transaction.objectStore('documents').put({ ...original, previous: original.current,
          current: { body: { damaged: true }, mediaIds: [], dataSourceIds: [] } }, key);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    }), { key: STATE, original });
    await page.reload();
    await page.getByText('Recovered the previous valid saved revision. Export a backup before continuing.', { exact: true }).waitFor();
    await quiet(); assertData(await downloadProject(), { dataSources: original.dataSources, datasets: original.current.body.datasets });
  });
  await check('a quota failure aborts state and library writes and gives dataset-specific advice', async () => {
    const before = await storeEntries();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (typeof key === 'string' && key.startsWith('openrender:figure')) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('Simulated full disk', 'QuotaExceededError');
        }
        return put.apply(this, arguments);
      };
    });
    await page.getByRole('textbox', { name: 'Figure title' }).fill('Unsaved data figure');
    await page.getByText('Local storage is full. Delete saved figures or remove datasets you no longer need, or download a project backup.', { exact: true }).waitFor();
    assert.deepEqual(await storeEntries(), before);
    assert.equal((await downloadProject()).metadata.title, 'Unsaved data figure');
  });
  await check('no external request or browser error during data storage and file operations', async () => {
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
  });
} finally {
  await writeFile(reportDirectory + '/results.json', JSON.stringify({ browser: browser.version(), buildIdentifier, results, errors, network }, null, 2));
  await browser.close();
}
if (results.some(result => !result.pass) || errors.length || network.length) process.exitCode = 1;
