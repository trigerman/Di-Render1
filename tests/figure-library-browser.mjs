// Runtime checks for the saved-figure library and the editor's Figures tab, run against the built
// app on 127.0.0.1:$OPENRENDER_PORT. Every probe waits on UI state or IndexedDB reads.
const { chromium } = await import(process.env.OPENRENDER_PLAYWRIGHT_MODULE ?? '../app/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173);
const STATE = 'openrender:documents:v2', SUMMARY = 'openrender:figure-summary:v1:', RECORD = 'openrender:figure:v1:';
const QUOTA_NOTICE = 'Local storage is full. Delete saved figures you no longer need or download a project backup.';
const DAMAGED_NOTICE = 'This saved figure is missing or damaged and could not be opened.';
const IN_USE_NOTICE = 'This figure was saved most recently and may be open in another tab, so it was not deleted.';
const DELETE_FAILED_NOTICE = 'The saved figure could not be deleted. Nothing was removed.';
const SAVE_FAILED_NOTICE = 'Your current edits could not be saved locally. Download a project backup before switching figures.';
const RENDER_FAILED_NOTICE = 'The figure could not be rendered. The saved project has been preserved.';
const EMPTY_TEXT = 'Figures you edit are saved here automatically.';
const LIST_FAILED_TEXT = 'Saved figures could not be read in this browser.';
const reportDirectory = 'reports/figure-library';
await mkdir(reportDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], errors = [], network = [], dialogs = [], consoleTexts = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
context.on('page', target => {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => { consoleTexts.push(message.text()); if (message.type() === 'error') errors.push(message.text()); });
  target.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) network.push(request.url()); });
  target.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
});
// Startup fault: the next load of a tab whose window.name carries this flag fails its first library write.
await context.addInitScript(() => {
  if (window.name !== 'figure-library:fail-sync') return;
  window.name = '';
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (typeof key === 'string' && key.startsWith('openrender:figure')) {
      IDBObjectStore.prototype.put = put;
      window.__figureLibraryProbe = 'sync-failed';
      throw new DOMException('Simulated library sync failure', 'UnknownError');
    }
    return put.apply(this, arguments);
  };
});
// Startup hold: the next load of a tab whose window.name carries this flag holds the first image
// decoding, that of the figure the editor restores, until `__startupDecode.release()`.
await context.addInitScript(() => {
  if (window.name !== 'figure-library:hold-startup-decode') return;
  window.name = '';
  const decode = HTMLImageElement.prototype.decode;
  let release;
  const released = new Promise(resolve => { release = resolve; });
  const probe = window.__startupDecode = { held: false, release: () => release() };
  HTMLImageElement.prototype.decode = function () {
    if (probe.held) return decode.call(this);
    probe.held = true;
    return released.then(() => decode.call(this));
  };
});
// Every load reads the documents store just before and just after its first readwrite transaction,
// the startup library sync (AC-7, D-6a). IndexedDB runs both reads in order around the sync and
// before any later save, so a probe can tell the sync's own writes from the editor's autosave.
await context.addInitScript(() => {
  const transaction = IDBDatabase.prototype.transaction;
  const read = (db, done) => {
    const entries = [], cursor = transaction.call(db, 'documents', 'readonly').objectStore('documents').openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return done(entries);
      entries.push([cursor.result.key, cursor.result.value]);
      cursor.result.continue();
    };
  };
  IDBDatabase.prototype.transaction = function (scope, mode) {
    if (mode !== 'readwrite' || this.name !== 'openrender-documents' || window.__startupSync) return transaction.apply(this, arguments);
    const capture = window.__startupSync = { before: null, after: null, outcome: null };
    read(this, entries => { capture.before = entries; });
    const created = transaction.apply(this, arguments);
    for (const outcome of ['complete', 'abort'])
      created.addEventListener(outcome, () => read(this, entries => { capture.after = entries; capture.outcome = outcome; }));
    return created;
  };
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const check = async (name, run) => {
  const started = Date.now();
  try { await run(); results.push({ name, pass: true, ms: Date.now() - started }); console.log('PASS ' + name); }
  catch (error) {
    results.push({ name, pass: false, error: error.message });
    console.error('FAIL ' + name + ' ' + error.message);
    await page.screenshot({ path: reportDirectory + '/failure-' + results.length + '.png', fullPage: true }).catch(() => undefined);
  }
};

// A store read queues behind any open readwrite transaction; a probe that fails while holding one
// must fail its check, not stall the script.
const bounded = (promise, what) => {
  let timer;
  const expired = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(what + ' did not finish')), 15000); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
};
// IndexedDB access through a separate connection; the cursor read leaves patched getAll/get untouched.
const dump = () => bounded(page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('openrender-documents');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, entries = [], transaction = db.transaction('documents', 'readonly');
    const cursor = transaction.objectStore('documents').openCursor();
    cursor.onsuccess = () => { if (cursor.result) { entries.push([cursor.result.key, cursor.result.value]); cursor.result.continue(); } };
    transaction.oncomplete = () => { db.close(); resolve(entries); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
})), 'reading the documents store');
const writeStore = (puts, deletes = []) => bounded(page.evaluate(([puts, deletes]) => new Promise((resolve, reject) => {
  const open = indexedDB.open('openrender-documents');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
    for (const key of deletes) store.delete(key);
    for (const [key, value] of puts) store.put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
}), [puts, deletes]), 'writing the documents store');
const entries = async () => new Map(await dump());
const state = async () => (await entries()).get(STATE);
const summaries = async () => [...await entries()].filter(([key]) => key.startsWith(SUMMARY)).map(([, value]) => value);
const summary = async id => (await entries()).get(SUMMARY + id);
const record = async id => (await entries()).get(RECORD + id);
const libraryKeys = async () => (await dump()).map(([key]) => key).filter(key => key.startsWith('openrender:figure'));
const library = async () => (await dump()).filter(([key]) => key.startsWith('openrender:figure'));
const stored = async text => JSON.stringify(await dump()).includes(text);
const packedId = packed => packed?.body?.metadata?.id;
// Polls an IndexedDB or UI condition; the interval only paces the reads.
const until = async (probe, message, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

const saved = () => page.getByText('Saved locally', { exact: true }).waitFor({ timeout: 12000 });
const workspace = () => page.getByTestId('workspace').waitFor();
const titleBox = () => page.getByRole('textbox', { name: 'Figure title' });
const shell = () => page.locator('.app-shell');
const figuresTab = () => page.getByRole('tab', { name: /^Figures/ });
const assetsTab = () => page.getByRole('tab', { name: 'Assets', exact: true });
const row = title => page.locator('.figure-list li').filter({ has: page.getByText(title, { exact: true }) });
const listedTitles = () => page.locator('.figure-list li strong').allInnerTexts();
const showFigures = async () => {
  await figuresTab().click();
  await page.locator('.figure-list, .figures-state').first().waitFor();
};
const download = async (testId, name) => {
  const waiting = page.waitForEvent('download');
  // A failed click fails its check; the abandoned wait must not end the script.
  waiting.catch(() => undefined);
  await page.getByTestId(testId).click();
  const file = await waiting, path = reportDirectory + '/' + name;
  await file.saveAs(path);
  return readFile(path);
};
const projectFile = async () => JSON.parse(await download('save-project', 'current.obf.json'));
const lastSave = async () => (await state())?.recent?.[0]?.lastOpenedAt ?? null;
// A document switch is complete once its target save committed and the shell is interactive again.
const settled = async action => {
  const before = await lastSave();
  await action();
  await until(async () => (await lastSave()) !== before, 'the document switch saved nothing');
  await page.locator('.app-shell:not([inert])').waitFor();
  await saved();
};
const openFromList = title => settled(() => row(title).locator('.figure-row-open').click());
const deleteFromList = async (title, confirm = true) => {
  await row(title).getByRole('button', { name: 'Delete saved figure: ' + title, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete saved figure?' });
  await dialog.waitFor();
  if (confirm) await dialog.getByRole('button', { name: 'Delete figure', exact: true }).click();
  return dialog;
};
// Quiet: the shell is interactive and no save is pending. A reload starts quiet, because a pending
// save raises the unsaved-changes prompt, and returns once the reloaded editor is interactive.
const quiet = async () => {
  await page.locator('.app-shell:not([inert])').waitFor();
  await page.locator('.save-status:not(.status-saving)').waitFor();
};
const reload = async () => { await quiet(); await page.reload(); await workspace(); await page.locator('.app-shell:not([inert])').waitFor(); };
// Settled: quiet after the fonts and two frames have rendered, so every snapshot the editor emits
// for the load has been handled; a save it scheduled would show as pending or in the store.
const settle = async () => {
  await quiet();
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await quiet();
};
// The store as the startup sync of the current load found and left it.
const startupSync = async () => {
  await until(() => page.evaluate(() => Boolean(window.__startupSync?.outcome)), 'the startup sync did not finish');
  const { before, after, outcome } = await page.evaluate(() => window.__startupSync);
  return { outcome, before: new Map(before), after: new Map(after) };
};
const figureEntries = map => [...map].filter(([key]) => key.startsWith('openrender:figure'));
const titlesIn = map => figureEntries(map).filter(([key]) => key.startsWith(SUMMARY)).map(([, value]) => value.title).sort();
const newFigure = async title => {
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: 'Create figure', exact: true }).click();
  await saved();
  await titleBox().fill(title);
  await saved();
};
const viewMenu = async item => {
  await page.locator('summary').filter({ hasText: /^View$/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
};
// A small PNG drawn in the page, inserted through the image file input.
const insertImage = async (name, color) => {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 24, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
};
// Late edit during a switch: holds the next library read of `key` (its success reaches the storage
// code only on release) and the decoding of the next inserted image, and logs record reads and
// writes in order.
const holdLookup = key => page.evaluate(held => {
  const decode = HTMLImageElement.prototype.decode, get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
  const probe = window.__lateEdit = { events: [], inserting: false, holding: false, releaseImage: null, release: null,
    restore: () => { HTMLImageElement.prototype.decode = decode; IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.put = put; } };
  HTMLImageElement.prototype.decode = function () {
    if (probe.inserting) return decode.call(this);
    probe.inserting = true;
    return new Promise(resolve => { probe.releaseImage = resolve; }).then(() => decode.call(this));
  };
  IDBObjectStore.prototype.put = function (value, key) {
    if (typeof key === 'string' && key.startsWith('openrender:figure:v1:')) probe.events.push('put ' + key);
    return put.apply(this, arguments);
  };
  IDBObjectStore.prototype.get = function (key) {
    const request = get.apply(this, arguments);
    if (typeof key === 'string' && key.startsWith('openrender:figure:v1:')) probe.events.push('get ' + key);
    if (key === held && !probe.release) {
      let handler = null;
      Object.defineProperty(request, 'onsuccess', { configurable: true, get: () => handler, set: value => { handler = value; } });
      request.addEventListener('success', event => {
        probe.release = () => { probe.holding = false; handler?.call(request, event); };
        probe.holding = true;
      });
    }
    return request;
  };
}, key);
// Starts inserting an image into the open figure; it is placed once the probe releases its decoding.
const startImage = async () => {
  await insertImage('late-edit.png', '#c2410c');
  await page.waitForFunction(() => window.__lateEdit.inserting);
};
// Lets the image decode while the lookup is held, and releases the lookup as soon as the inserted
// image is a pending edit, long before its autosave would run.
const finishEditDuringLookup = () => page.evaluate(() => {
  const probe = window.__lateEdit, status = document.querySelector('.save-status');
  const observer = new MutationObserver(() => {
    if (!status.classList.contains('status-saving')) return;
    observer.disconnect();
    probe.events.push('edit pending');
    probe.release();
  });
  observer.observe(status, { attributes: true, attributeFilter: ['class'] });
  probe.releaseImage();
});
const lateEvents = () => page.evaluate(() => window.__lateEdit.events);
// The visible screen during a held switch: whether it is inert and busy, and whether `button` takes focus.
const busySurface = (screen, button) => page.evaluate(([screen, button]) => {
  const surface = document.querySelector(screen);
  const target = [...surface.querySelectorAll('button')].find(node => node.textContent.trim() === button);
  target.focus();
  return { inert: Boolean(surface.closest('[inert]')), busy: Boolean(surface.closest('[aria-busy="true"]')), focusable: document.activeElement === target };
}, [screen, button]);
// Script-dispatched clicks on the buttons of `screen` labelled `buttons`, in order; the file picker's
// input counts the clicks that reach it.
const pressDuringSwitch = (screen, buttons) => page.evaluate(([screen, buttons]) => {
  const surface = document.querySelector(screen);
  window.__pickerClicks = 0;
  document.querySelector('input[type=file][accept*=".obf"]').addEventListener('click', () => { window.__pickerClicks++; });
  for (const text of buttons)
    [...surface.querySelectorAll('button')].find(node => node.textContent.trim() === text).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, [screen, buttons]);
// After a switch to `id`, every other saved entry is unchanged, `id` was only saved again, and the
// recent list only moved `id` to the front.
const assertOnlySaved = async (before, id) => {
  const after = await entries();
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [key, value] of before)
    if (key !== STATE && key !== SUMMARY + id) assert.deepEqual(after.get(key), value, key);
  assert.deepEqual({ ...after.get(SUMMARY + id), savedAt: null }, { ...before.get(SUMMARY + id), savedAt: null });
  assert.equal(packedId(after.get(STATE).current), id);
  const recent = state => state.recent.map(item => packedId(item.project));
  assert.deepEqual(recent(after.get(STATE)), [id, ...recent(before.get(STATE)).filter(other => other !== id)]);
};
const endLateEdit = () => page.evaluate(() => { const probe = window.__lateEdit; probe.restore(); probe.releaseImage?.(); probe.release?.(); });
// Holds the last step of the next drawing load or image preparation: both end with a SHA-256 digest,
// after which they reach the App-level insertion in the same task.
const holdPreparation = () => page.evaluate(() => {
  const digest = SubtleCrypto.prototype.digest;
  const probe = window.__preparation = { held: false, release: null,
    restore: () => { SubtleCrypto.prototype.digest = digest; probe.release?.(); } };
  SubtleCrypto.prototype.digest = function () {
    const result = digest.apply(this, arguments);
    if (probe.held) return result;
    probe.held = true;
    return new Promise(resolve => { probe.release = resolve; }).then(() => result);
  };
});
// Holds the staging of the next figure opened: image decodings wait, so a figure with an embedded
// image stays staged. `release(count)` lets that many held decodings through and every later one pass
// at once; `done` counts the released decodings that have finished.
const holdStaging = () => page.evaluate(() => {
  const decode = HTMLImageElement.prototype.decode;
  const probe = window.__staging = { holding: true, held: [], released: 0, done: 0,
    release: count => { probe.holding = false; for (const resolve of probe.held.splice(0, count)) { probe.released++; resolve(); } },
    restore: () => { HTMLImageElement.prototype.decode = decode; probe.release(Infinity); } };
  HTMLImageElement.prototype.decode = function () {
    if (!probe.holding) return decode.call(this);
    return new Promise(resolve => probe.held.push(resolve)).then(() => decode.call(this)).finally(() => { probe.done++; });
  };
});
const endPreparation = () => page.evaluate(() => { window.__preparation?.restore(); window.__staging?.restore(); });
// After a late insertion from figure `source` was dropped while `target` opened: both figures and their
// stored entries hold their saved content, and each reopens with it.
const assertBothSaved = async (before, source, sourceId, target) => {
  const targetId = packedId((await state()).current);
  assert.equal(await titleBox().inputValue(), target);
  assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
  assert.deepEqual((await projectFile()).objects, before.get(RECORD + targetId).project.objects);
  await assertOnlySaved(before, targetId);
  await openFromList(source);
  assert.deepEqual((await projectFile()).objects, before.get(RECORD + sourceId).project.objects);
  await openFromList(target);
  assert.deepEqual((await projectFile()).objects, before.get(RECORD + targetId).project.objects);
};

let fileA, fileB, idA, idB, idC, titleB = 'Library B', localKeys = [];
const usedTitles = ['Library A', 'Library B', 'Library C', 'Typed before switch', 'Slow flush title', 'Schematic edited', 'Typed then reopened',
  'Switch probe D', 'Flush failure probe', 'Quota open probe', 'Quota open retried', 'Recovered figure newer', 'Held load A', 'Late edit fork',
  'French figure', 'Resume figure', 'Startup file B', 'Recent X old', 'Recent X newer',
  'Null current old', 'Null current newer'];
try {
  await page.goto(base);
  await check('AC-1 each figure is stored as its own library entry equal to its download', async () => {
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    await page.getByRole('button', { name: 'New figure', exact: true }).click();
    await page.getByRole('button', { name: 'Create figure', exact: true }).click();
    await saved();
    await titleBox().fill('Library A');
    await saved();
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await saved();
    fileA = await projectFile();
    await newFigure('Library B');
    fileB = await projectFile();
    idA = fileA.metadata.id; idB = fileB.metadata.id;
    assert.notEqual(idA, idB);
    assert.equal((await summaries()).length, 2);
    for (const file of [fileA, fileB]) {
      const entry = await record(file.metadata.id);
      assert.equal(entry.project.metadata.title, file.metadata.title);
      assert.deepEqual(entry.project.objects, file.objects);
      assert.equal((await summary(file.metadata.id)).title, file.metadata.title);
    }
    assert.equal(fileA.objects.length, 1);
    await page.getByRole('textbox', { name: 'Search scientific assets' }).waitFor();
    localKeys = await page.evaluate(() => Object.keys(localStorage).sort());
  });

  await check('AC-3 the left tabs follow the WAI-ARIA tabs pattern and keep the asset search', async () => {
    const sidebar = page.getByRole('complementary', { name: 'Library', exact: true });
    const tablist = sidebar.getByRole('tablist', { name: 'Library panels' });
    assert.equal(await tablist.getByRole('tab').count(), 3);
    assert.equal(await assetsTab().getAttribute('aria-selected'), 'true');
    assert.equal(await figuresTab().getAttribute('aria-selected'), 'false');
    assert.equal(await assetsTab().getAttribute('tabindex'), '0');
    assert.equal(await figuresTab().getAttribute('tabindex'), '-1');
    for (const tab of [assetsTab(), figuresTab(), page.getByRole('tab',{name:'Data',exact:true})]) {
      const panel = page.locator('#' + await tab.getAttribute('aria-controls'));
      assert.equal(await panel.getAttribute('role'), 'tabpanel');
      assert.equal(await panel.getAttribute('aria-labelledby'), await tab.getAttribute('id'));
    }
    assert.equal(await page.locator('#' + await figuresTab().getAttribute('aria-controls')).isHidden(), true);
    // A selected canvas object shows whether the arrow keys leaked to the editor's nudge.
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await saved();
    const placed = (await projectFile()).objects;
    const search = page.getByRole('textbox', { name: 'Search scientific assets' });
    await search.fill('Mitochondria');
    const favorites = page.locator('.asset-scopes').getByRole('button', { name: 'Favorites', exact: true });
    await favorites.click();
    await assetsTab().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await figuresTab().getAttribute('aria-selected'), 'true');
    assert.equal(await figuresTab().getAttribute('tabindex'), '0');
    assert.equal(await assetsTab().getAttribute('tabindex'), '-1');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role') + ':' + document.activeElement?.textContent), 'tab:' + await figuresTab().textContent());
    await page.locator('#' + await figuresTab().getAttribute('aria-controls')).waitFor();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await assetsTab().getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), await assetsTab().textContent());
    assert.equal(await search.inputValue(), 'Mitochondria');
    assert.equal(await favorites.getAttribute('aria-pressed'), 'true');
    assert.deepEqual((await projectFile()).objects, placed);
    const searchFocused = () => page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search scientific assets');
    await figuresTab().click();
    await viewMenu('Assets panel');
    await searchFocused();
    assert.equal(await assetsTab().getAttribute('aria-selected'), 'true');
    await figuresTab().click();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Search scientific assets');
    await page.keyboard.press('Enter');
    await searchFocused();
    assert.equal(await assetsTab().getAttribute('aria-selected'), 'true');
    // `/` outside a text field also brings the search back from the Figures tab.
    await figuresTab().click();
    await page.keyboard.press('/');
    await searchFocused();
    assert.equal(await assetsTab().getAttribute('aria-selected'), 'true');
    assert.equal(await search.inputValue(), 'Mitochondria');
    await page.locator('.asset-scopes').getByRole('button', { name: 'All', exact: true }).click();
    await search.fill('');
  });

  await check('AC-4 the Figures tab lists saved figures newest first and follows autosave and reload', async () => {
    await showFigures();
    assert.deepEqual(await listedTitles(), ['Library B', 'Library A']);
    const current = page.locator('.figure-list [aria-current="true"]');
    assert.equal(await current.count(), 1);
    assert.match(await current.innerText(), /Library B/);
    await current.getByText('Open', { exact: true }).waitFor();
    assert.equal(await row('Library B').getByRole('button', { name: /^Delete saved figure/ }).count(), 0);
    await row('Library A').getByRole('button', { name: 'Delete saved figure: Library A', exact: true }).waitFor();
    const size = row('Library A').locator('small');
    assert.equal(await size.innerText(), fileA.document.width + ' × ' + fileA.document.height + ' px');
    assert.match(await size.evaluate(element => getComputedStyle(element).fontVariantNumeric), /tabular-nums/);
    await row('Library A').locator('time').waitFor();
    assert.match(await figuresTab().innerText(), /^Figures\s*2$/);
    titleB = 'Library B renamed';
    await titleBox().fill(titleB);
    await saved();
    await row(titleB).waitFor();
    await reload();
    await showFigures();
    assert.deepEqual(await listedTitles(), [titleB, 'Library A']);
  });

  await check('AC-7 loading a figure and changing the selection without an edit saves nothing', async () => {
    await quiet();
    const before = JSON.stringify(await dump());
    await reload();
    await settle();
    await page.getByRole('tab', { name: /^Layers/ }).click();
    await page.locator('.layer-row .layer-main').first().click();
    await page.locator('.layer-row.is-selected').waitFor();
    await settle();
    await showFigures();
    assert.equal(await page.locator('.save-status.status-saving').count(), 0);
    assert.equal(JSON.stringify(await dump()), before);
  });

  await check('AC-5 switching from the list saves the pending edit and opens the saved figure', async () => {
    await titleBox().fill('Typed before switch');
    await settled(() => row('Library A').locator('.figure-row-open').click());
    assert.equal(await titleBox().inputValue(), 'Library A');
    const opened = await projectFile(), entry = await record(idA);
    assert.equal(opened.metadata.id, idA);
    assert.equal(entry.project.metadata.title, opened.metadata.title);
    assert.deepEqual(entry.project.objects, opened.objects);
    assert.equal(await page.getByTestId('undo').isDisabled(), true);
    assert.equal((await record(idB)).project.metadata.title, 'Typed before switch');
    await openFromList('Typed before switch');
    assert.equal(await titleBox().inputValue(), 'Typed before switch');
    titleB = 'Typed before switch';
    // Activating the open figure does nothing.
    const before = await lastSave();
    await row(titleB).locator('.figure-row-open').click();
    assert.equal(await shell().getAttribute('inert'), null);
    assert.equal(await lastSave(), before);
  });

  await check('AC-5 a slow flush keeps the shell inert and busy until every edit is saved', async () => {
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.__flush = { holding: false, release: false, restore: () => { IDBObjectStore.prototype.put = put; } };
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.apply(this, arguments);
        if (key === 'openrender:documents:v2') {
          IDBObjectStore.prototype.put = put;
          window.__flush.holding = true;
          // Chained reads keep the flush transaction open until the probe releases it.
          const store = this;
          const spin = () => { store.get('openrender:flush-probe').onsuccess = () => { if (window.__flush.release) window.__flush.holding = false; else spin(); }; };
          spin();
        }
        return request;
      };
    });
    const release = () => page.evaluate(() => { window.__flush.release = true; window.__flush.restore(); });
    await titleBox().fill('Slow flush title');
    const shown = await titleBox().inputValue();
    try {
      await row('Library A').locator('.figure-row-open').click();
      await page.waitForFunction(() => window.__flush.holding && document.querySelector('.app-shell')?.hasAttribute('inert'));
      assert.equal(await shell().getAttribute('aria-busy'), 'true');
      assert.equal(await titleBox().inputValue(), shown);
    } finally {
      await release();
    }
    await page.locator('.app-shell:not([inert])').waitFor();
    await saved();
    assert.equal(await titleBox().inputValue(), 'Library A');
    assert.equal((await record(idB)).project.metadata.title, shown);
    assert.equal((await summary(idB)).title, shown);
    titleB = shown;
  });

  await check('AC-5 one switch at a time: requests during a switch are ignored and the shell stays busy', async () => {
    await newFigure('Switch probe D');
    const idD = (await projectFile()).metadata.id;
    await showFigures();
    const before = await entries();
    await page.evaluate(([held, other]) => {
      const get = IDBObjectStore.prototype.get;
      const probe = window.__switchProbe = { holding: false, otherReads: 0, unlocked: 0, release: null, restore: () => { IDBObjectStore.prototype.get = get; } };
      IDBObjectStore.prototype.get = function (key) {
        const request = get.apply(this, arguments);
        if (key === other) probe.otherReads++;
        if (key === held && !probe.release) {
          // The load waits for this read; its success reaches the storage code only on release.
          let handler = null;
          Object.defineProperty(request, 'onsuccess', { configurable: true, get: () => handler, set: value => { handler = value; } });
          request.addEventListener('success', event => {
            probe.release = () => { probe.holding = false; handler?.call(request, event); };
            probe.holding = true;
          });
        }
        return request;
      };
      const shell = document.querySelector('.app-shell');
      new MutationObserver(() => { if (probe.holding && !shell.hasAttribute('inert')) probe.unlocked++; })
        .observe(shell, { attributes: true, attributeFilter: ['inert', 'aria-busy'] });
    }, [RECORD + idA, RECORD + idB]);
    const read = () => page.evaluate(() => ({ holding: window.__switchProbe.holding, otherReads: window.__switchProbe.otherReads, unlocked: window.__switchProbe.unlocked }));
    try {
      await row('Library A').locator('.figure-row-open').click();
      await page.waitForFunction(() => window.__switchProbe.holding);
      assert.equal(await shell().getAttribute('inert'), '');
      assert.equal(await shell().getAttribute('aria-busy'), 'true');
      // Undo from the keyboard and a click on another figure arrive while the first load is held.
      await page.keyboard.press('Control+z');
      await page.evaluate(title => {
        const item = [...document.querySelectorAll('.figure-list li')].find(node => node.querySelector('strong')?.textContent === title);
        item.querySelector('.figure-row-open').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, titleB);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await read(), { holding: true, otherReads: 0, unlocked: 0 });
      assert.equal(await shell().getAttribute('inert'), '');
      assert.equal(await shell().getAttribute('aria-busy'), 'true');
    } finally {
      await page.evaluate(() => { window.__switchProbe.restore(); window.__switchProbe.release?.(); });
    }
    await settle();
    await saved();
    assert.deepEqual(await read(), { holding: false, otherReads: 0, unlocked: 0 });
    assert.equal(await titleBox().inputValue(), 'Library A');
    assert.equal(packedId((await state()).current), idA);
    const after = await entries();
    for (const key of [SUMMARY + idD, RECORD + idD, SUMMARY + idB, RECORD + idB, RECORD + idA])
      assert.deepEqual(after.get(key), before.get(key), key);
    assert.deepEqual({ ...after.get(SUMMARY + idA), savedAt: null }, { ...before.get(SUMMARY + idA), savedAt: null });
    await deleteFromList('Switch probe D');
    await row('Switch probe D').waitFor({ state: 'detached' });
  });

  await check('AC-6 delete asks first, removes the figure everywhere and survives reload', async () => {
    await showFigures();
    await openFromList(titleB);
    assert.equal(packedId((await state()).previous), idA);
    let dialog = await deleteFromList('Library A', false);
    await page.waitForFunction(() => document.activeElement?.textContent === 'Cancel');
    const text = await dialog.innerText();
    assert.match(text, /Library A/);
    assert.match(text, /copy saved in this browser and its Recent projects entry/);
    assert.match(text, /Downloaded project files are not affected/);
    assert.match(await dialog.getByRole('button', { name: 'Delete figure', exact: true }).getAttribute('class'), /danger-outline/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await row('Library A').waitFor();
    dialog = await deleteFromList('Library A', false);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await row('Library A').waitFor();
    assert.equal(await stored(idA), true);
    await deleteFromList('Library A');
    await row('Library A').waitFor({ state: 'detached' });
    assert.equal(await stored(idA), false);
    assert.deepEqual(await listedTitles(), [titleB]);
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    assert.doesNotMatch(await page.locator('.recent-list').innerText(), /Library A/);
    await page.locator('.continue-card').click();
    await workspace();
    await saved();
    await reload();
    await showFigures();
    assert.deepEqual(await listedTitles(), [titleB]);
    assert.equal(await stored(idA), false);
  });

  await check('AC-6 a failed or refused delete changes nothing and shows a notice', async () => {
    await newFigure('Library C');
    idC = (await projectFile()).metadata.id;
    await showFigures();
    await openFromList(titleB);
    let before = await dump();
    await page.evaluate(() => {
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function () {
        IDBObjectStore.prototype.delete = remove;
        throw new DOMException('Simulated delete failure', 'UnknownError');
      };
    });
    await deleteFromList('Library C');
    await page.getByText(DELETE_FAILED_NOTICE, { exact: true }).waitFor();
    await row('Library C').waitFor();
    assert.deepEqual(await dump(), before);
    // Another tab opens C, so C becomes the state's current figure.
    const other = await context.newPage();
    await other.goto(base);
    await other.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    await other.locator('.recent-list button').filter({ hasText: 'Library C' }).first().click();
    await other.getByTestId('workspace').waitFor();
    await other.getByText('Saved locally', { exact: true }).waitFor();
    await until(async () => packedId((await state()).current) === idC, 'the other tab did not save C');
    await other.close();
    before = await dump();
    await deleteFromList('Library C');
    await page.getByText(IN_USE_NOTICE, { exact: true }).waitFor();
    await row('Library C').waitFor();
    assert.deepEqual(await dump(), before);
    titleB = 'Library B final';
    await titleBox().fill(titleB);
    await saved();
    assert.equal(packedId((await state()).current), idB);
  });

  await check('AC-2 and AC-FAIL-1 a quota failure on the last put changes nothing and says how to free space', async () => {
    let before = await dump();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (typeof key === 'string' && key.startsWith('openrender:figure:v1:')) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('Simulated quota failure', 'QuotaExceededError');
        }
        return put.apply(this, arguments);
      };
    });
    await titleBox().fill('Quota probe');
    await page.locator('.status-error').waitFor();
    await page.getByText(QUOTA_NOTICE, { exact: true }).waitFor();
    assert.deepEqual(await dump(), before);
    await titleBox().fill(titleB);
    await saved();
    await page.getByText(QUOTA_NOTICE, { exact: true }).waitFor({ state: 'hidden' });
    // A quota failure found at commit reaches the page as an aborted transaction whose error is
    // QuotaExceededError; a real full disk cannot be produced on demand, so the probe sets that error.
    before = await dump();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.apply(this, arguments);
        if (typeof key === 'string' && key.startsWith('openrender:figure:v1:')) {
          IDBObjectStore.prototype.put = put;
          const transaction = this.transaction;
          Object.defineProperty(transaction, 'error', { get: () => new DOMException('Simulated quota failure at commit', 'QuotaExceededError') });
          request.addEventListener('success', () => transaction.abort());
        }
        return request;
      };
    });
    await titleBox().fill('Abort quota probe');
    await page.locator('.status-error').waitFor();
    await page.getByText(QUOTA_NOTICE, { exact: true }).waitFor();
    assert.deepEqual(await dump(), before);
    await titleBox().fill(titleB);
    await saved();
    assert.equal((await record(idB)).project.metadata.title, titleB);
  });

  await check('AC-FAIL-2 a listing failure after a committed save leaves saving intact', async () => {
    await showFigures();
    await page.evaluate(() => {
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function () {
        IDBObjectStore.prototype.getAll = getAll;
        throw new DOMException('Simulated library read failure', 'UnknownError');
      };
    });
    await titleBox().fill('Listing failure probe');
    await saved();
    await page.getByText(LIST_FAILED_TEXT, { exact: true }).waitFor();
    assert.equal(await page.locator('.figure-list').count(), 0);
    assert.equal(await page.locator('.status-error').count(), 0);
    await page.getByText('Saved locally', { exact: true }).waitFor();
    assert.equal((await record(idB)).project.metadata.title, 'Listing failure probe');
    await titleBox().fill(titleB);
    await saved();
    await row(titleB).waitFor();
    assert.equal((await record(idB)).project.metadata.title, titleB);
  });

  await check('AC-5 a failed flush before a new figure or template keeps the open figure and says to back it up', async () => {
    await quiet();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.__restorePut = () => { IDBObjectStore.prototype.put = put; };
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === 'openrender:documents:v2') throw new DOMException('Simulated save failure', 'UnknownError');
        return put.apply(this, arguments);
      };
    });
    const dialog = page.getByRole('dialog', { name: 'Create a new figure' });
    try {
      const before = await dump();
      await titleBox().fill('Flush failure probe');
      await page.getByRole('button', { name: 'New document', exact: true }).click();
      await dialog.getByRole('button', { name: 'Create figure', exact: true }).click();
      await page.getByText(SAVE_FAILED_NOTICE, { exact: true }).waitFor();
      await page.locator('.app-shell:not([inert])').waitFor();
      assert.equal(await titleBox().inputValue(), 'Flush failure probe');
      assert.deepEqual(await dump(), before);
      await page.getByText(SAVE_FAILED_NOTICE, { exact: true }).waitFor({ state: 'hidden' });
      await dialog.getByRole('tab', { name: /Use a template/ }).click();
      await dialog.locator('.template-choice').first().click();
      await page.getByText(SAVE_FAILED_NOTICE, { exact: true }).waitFor();
      await page.locator('.app-shell:not([inert])').waitFor();
      assert.equal(await titleBox().inputValue(), 'Flush failure probe');
      assert.deepEqual(await dump(), before);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    } finally {
      await page.evaluate(() => window.__restorePut());
    }
    await titleBox().fill(titleB);
    await saved();
    assert.equal((await record(idB)).project.metadata.title, titleB);
  });

  await check('AC-7 a pre-feature profile is copied into the library on load without changing the state', async () => {
    await quiet();
    const before = await state();
    const expected = [...new Map([before.current, ...before.recent.map(item => item.project)]
      .map(packed => [packed.body.metadata.id, packed.body.metadata.title])).values()].sort();
    assert.deepEqual(expected, ['Library C', titleB].sort());
    await writeStore([], await libraryKeys());
    assert.deepEqual(await libraryKeys(), []);
    await reload();
    const sync = await startupSync();
    assert.equal(sync.outcome, 'complete');
    assert.deepEqual(figureEntries(sync.before), []);
    assert.deepEqual(titlesIn(sync.after), expected);
    assert.deepEqual(sync.before.get(STATE), before);
    assert.deepEqual(sync.after.get(STATE), before);
    await settle();
    assert.deepEqual(await state(), before);
    assert.deepEqual((await summaries()).map(item => item.title).sort(), expected);
    await showFigures();
    assert.deepEqual([...await listedTitles()].sort(), expected);
  });

  await check('AC-7 a stale entry is refreshed and a failed sync is retried on the next load', async () => {
    const stale = await summary(idC), staleRecord = await record(idC);
    await writeStore([
      [SUMMARY + idC, { ...stale, title: 'Stale C', savedAt: '2000-01-01T00:00:00.000Z' }],
      [RECORD + idC, { ...staleRecord, project: { ...staleRecord.project, metadata: { ...staleRecord.project.metadata, title: 'Stale C' } } }],
    ]);
    await reload();
    let sync = await startupSync();
    assert.equal(sync.before.get(SUMMARY + idC).title, 'Stale C');
    assert.equal(sync.after.get(SUMMARY + idC).title, 'Library C');
    assert.equal(sync.after.get(RECORD + idC).project.metadata.title, 'Library C');
    assert.deepEqual(sync.after.get(STATE), sync.before.get(STATE));
    await showFigures();
    await row('Library C').waitFor();
    assert.equal(await row('Stale C').count(), 0);
    await settle();
    const before = await state();
    await writeStore([], await libraryKeys());
    await page.evaluate(() => { window.name = 'figure-library:fail-sync'; });
    await reload();
    assert.equal(await page.evaluate(() => window.__figureLibraryProbe), 'sync-failed');
    sync = await startupSync();
    assert.equal(sync.outcome, 'abort');
    assert.deepEqual(figureEntries(sync.after), []);
    assert.deepEqual(sync.before.get(STATE), before);
    assert.deepEqual(sync.after.get(STATE), before);
    await settle();
    await showFigures();
    await page.getByText(EMPTY_TEXT, { exact: true }).waitFor();
    assert.deepEqual(await libraryKeys(), []);
    assert.deepEqual(await state(), before);
    await reload();
    sync = await startupSync();
    assert.equal(sync.outcome, 'complete');
    assert.deepEqual(figureEntries(sync.before), []);
    assert.deepEqual(titlesIn(sync.after), ['Library C', titleB].sort());
    await settle();
    assert.deepEqual(await state(), before);
    await showFigures();
    assert.deepEqual([...await listedTitles()].sort(), ['Library C', titleB].sort());
  });

  await check('AC-7 (D-6a) a stale startup read cannot resurrect a deleted figure or replace a newer record', async () => {
    const serveStaleStateOnce = async (flag, snapshot) => {
      await page.addInitScript(([flag, snapshot]) => {
        if (window.name !== flag) return;
        window.name = '';
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (key) {
          const request = get.apply(this, arguments);
          if (key === 'openrender:documents:v2') {
            IDBObjectStore.prototype.get = get;
            window.__figureLibraryProbe = 'stale-state-served';
            Object.defineProperty(request, 'result', { get: () => snapshot });
          }
          return request;
        };
      }, [flag, snapshot]);
      await page.evaluate(flag => { window.name = flag; }, flag);
      await reload();
      assert.equal(await page.evaluate(() => window.__figureLibraryProbe), 'stale-state-served');
      const sync = await startupSync();
      assert.equal(sync.outcome, 'complete');
      assert.deepEqual(sync.after.get(STATE), sync.before.get(STATE));
      await settle();
      return sync;
    };
    const listingC = await state();
    assert.ok(listingC.recent.some(item => packedId(item.project) === idC));
    await showFigures();
    await deleteFromList('Library C');
    await row('Library C').waitFor({ state: 'detached' });
    assert.equal(await stored(idC), false);
    let sync = await serveStaleStateOnce('figure-library:stale-deleted', listingC);
    assert.equal(JSON.stringify([...sync.after]).includes(idC), false);
    await showFigures();
    await row(titleB).waitFor();
    assert.equal(await row('Library C').count(), 0);
    assert.equal(await stored(idC), false);

    const older = await state();
    titleB = 'Library B newer';
    await titleBox().fill(titleB);
    await saved();
    const newer = await state();
    sync = await serveStaleStateOnce('figure-library:stale-current', older);
    assert.equal(sync.after.get(RECORD + idB).project.metadata.title, titleB);
    // The tab shows the older revision it was served; once startup has settled the store still holds
    // the newer record, summary and state.
    assert.equal(await titleBox().inputValue(), older.current.body.metadata.title);
    assert.equal((await record(idB)).project.metadata.title, titleB);
    assert.equal((await summary(idB)).title, titleB);
    assert.deepEqual(await state(), newer);
    await reload();
    assert.equal(await titleBox().inputValue(), titleB);

    await settle();
    const readable = await state();
    const recoveredId = 'recovered-' + randomUUID();
    const body = structuredClone(readable.current.body);
    body.metadata = { ...body.metadata, id: recoveredId, title: 'Recovered figure' };
    const damaged = { ...readable, current: { body: { damaged: true }, mediaIds: [] }, previous: { body, mediaIds: readable.current.mediaIds, dataSourceIds: readable.current.dataSourceIds } };
    assert.equal(readable.recent.some(item => packedId(item.project) === recoveredId), false);
    await writeStore([[STATE, damaged]]);
    await reload();
    await page.getByText('Recovered the previous valid saved revision. Export a backup before continuing.', { exact: true }).waitFor();
    sync = await startupSync();
    assert.equal(sync.outcome, 'complete');
    assert.deepEqual(sync.after.get(STATE), damaged);
    assert.equal(sync.before.has(SUMMARY + recoveredId), false);
    assert.equal(sync.after.get(SUMMARY + recoveredId).title, 'Recovered figure');
    assert.equal(sync.after.get(RECORD + recoveredId).project.metadata.title, 'Recovered figure');
    await settle();
    assert.deepEqual(await state(), damaged);
    await showFigures();
    await row('Recovered figure').waitFor();
    assert.equal(await row('Recovered figure').count(), 1);
    // A second load meets the same damaged state and writes nothing.
    const synced = JSON.stringify(await dump());
    await reload();
    sync = await startupSync();
    assert.equal(sync.outcome, 'complete');
    assert.deepEqual(figureEntries(sync.after), figureEntries(sync.before));
    await settle();
    assert.equal(JSON.stringify(await dump()), synced);
    // A newer valid entry for the recovered figure is never replaced by the recovered revision.
    const open = await projectFile();
    const newerRecovered = structuredClone(open);
    newerRecovered.metadata = { ...newerRecovered.metadata, title: 'Recovered figure newer' };
    const newerSummary = { ...(await summary(recoveredId)), title: 'Recovered figure newer', savedAt: new Date().toISOString() };
    await writeStore([[SUMMARY + recoveredId, newerSummary], [RECORD + recoveredId, { version: 1, project: newerRecovered }]]);
    await reload();
    sync = await startupSync();
    assert.equal(sync.outcome, 'complete');
    assert.deepEqual(figureEntries(sync.after), figureEntries(sync.before));
    await settle();
    assert.equal(await titleBox().inputValue(), 'Recovered figure');
    assert.deepEqual(await summary(recoveredId), newerSummary);
    assert.deepEqual(await record(recoveredId), { version: 1, project: newerRecovered });
    assert.deepEqual(await state(), damaged);
    await showFigures();
    await row('Recovered figure newer').waitFor();
    assert.equal(await row('Recovered figure').count(), 0);
    await openFromList(titleB);
    assert.equal(packedId((await state()).current), idB);
  });

  // D-6b: figure X's damaged current revision leaves an older recovered revision, while the library
  // holds X's newer save. The recovered revision opens as a separate figure, from Home and in the
  // editor restored at startup, and no later save reaches X.
  await check('AC-7 (D-6b) a recovered revision that differs from its saved figure opens as a separate figure and never overwrites it', async () => {
    await settle();
    const readable = await state(), open = await projectFile();
    const id = 'resume-' + randomUUID();
    const body = structuredClone(readable.current.body);
    body.metadata = { ...body.metadata, id, title: 'Resume figure' };
    const newer = structuredClone(open);
    newer.metadata = { ...newer.metadata, id, title: 'Resume figure newer' };
    const xEntries = [[SUMMARY + id, { version: 1, id, title: 'Resume figure newer', width: newer.document.width, height: newer.document.height,
      savedAt: new Date().toISOString() }], [RECORD + id, { version: 1, project: newer }]];
    const seed = () => writeStore([[STATE, { ...readable, current: { body: { damaged: true }, mediaIds: [] },
      previous: { body, mediaIds: readable.current.mediaIds, dataSourceIds: readable.current.dataSourceIds }, recent: [] }], ...xEntries]);
    const unchanged = async () => {
      const now = await entries();
      for (const [key, value] of xEntries) assert.deepEqual(now.get(key), value, key);
    };
    const separate = async () => {
      const opened = await projectFile();
      assert.equal(opened.metadata.title, 'Resume figure');
      assert.notEqual(opened.metadata.id, id);
      assert.deepEqual(opened.objects, newer.objects);
      assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
      return opened.metadata.id;
    };
    // From Home, Continue opens the recovered revision and saves it as its own figure.
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    await seed();
    await page.reload();
    await startupSync();
    await page.locator('.continue-card').filter({ hasText: 'Resume figure' }).waitFor();
    await settled(() => page.locator('.continue-card').click());
    let fork = await separate();
    assert.equal(packedId((await state()).current), fork);
    await unchanged();
    // Both figures survive a reload, and X reopens with its newer content.
    await reload();
    await showFigures();
    await row('Resume figure').waitFor();
    await unchanged();
    await openFromList('Resume figure newer');
    assert.deepEqual((await projectFile()).objects, newer.objects);
    assert.deepEqual((await record(id)).project, newer);
    await deleteFromList('Resume figure');
    await row('Resume figure').waitFor({ state: 'detached' });
    // The same state with the editor restored at startup: an edit and Settings → Back save only the
    // separate figure.
    await seed();
    await reload();
    await startupSync();
    await settle();
    fork = await separate();
    await unchanged();
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await until(async () => (await record(fork))?.project.objects.length === newer.objects.length + 1, 'the edit was not saved');
    await unchanged();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settled(() => page.getByRole('button', { name: 'Back to Di-Render', exact: true }).click());
    assert.equal(await titleBox().inputValue(), 'Resume figure');
    assert.equal(packedId((await state()).current), fork);
    assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
    await unchanged();
    await reload();
    await showFigures();
    await row('Resume figure newer').waitFor();
    await unchanged();
    await openFromList(titleB);
    for (const title of ['Resume figure', 'Resume figure newer']) {
      await deleteFromList(title);
      await row(title).waitFor({ state: 'detached' });
    }
  });

  // Recent projects open by content (D-5): X's damaged current revision leaves an older recovered
  // revision, X-old, which is also X's Recent projects item, while the library holds X's newer save.
  // X-old opened from Home's Recent projects is a separate figure, and X is never saved over.
  await check('AC-7 and AC-8 a Recent projects item that differs from its saved figure opens as a separate figure and never overwrites it', async () => {
    await settle();
    const readable = await state();
    const id = 'recent-' + randomUUID();
    const body = structuredClone(readable.current.body);
    body.metadata = { ...body.metadata, id, title: 'Recent X old' };
    const newer = structuredClone(fileA);
    newer.metadata = { ...newer.metadata, id, title: 'Recent X newer' };
    assert.notDeepEqual(newer.objects, body.objects);
    const xEntries = [[SUMMARY + id, { version: 1, id, title: 'Recent X newer', width: newer.document.width, height: newer.document.height,
      savedAt: new Date().toISOString() }], [RECORD + id, { version: 1, project: newer }]];
    const old = { body, mediaIds: readable.current.mediaIds, dataSourceIds: readable.current.dataSourceIds };
    const unchanged = async () => {
      const now = await entries();
      for (const [key, value] of xEntries) assert.deepEqual(now.get(key), value, key);
    };
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    // The Recent item is older than X's newer save, so the startup sync keeps that save.
    await writeStore([[STATE, { ...readable, current: { body: { damaged: true }, mediaIds: [] }, previous: old,
      recent: [{ project: old, lastOpenedAt: new Date(Date.now() - 60000).toISOString() }] }], ...xEntries]);
    await page.reload();
    await startupSync();
    const recentItem = page.locator('.recent-list button').filter({ hasText: 'Recent X old' }).first();
    await recentItem.waitFor();
    await unchanged();
    await settled(() => recentItem.click());
    await unchanged();
    const opened = await projectFile();
    assert.equal(opened.metadata.title, 'Recent X old');
    assert.notEqual(opened.metadata.id, id);
    assert.deepEqual(opened.objects, body.objects);
    assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
    assert.equal(packedId((await state()).current), opened.metadata.id);
    // Both figures survive a reload, and X reopens with its newer content.
    await reload();
    await showFigures();
    await row('Recent X old').waitFor();
    await row('Recent X newer').waitFor();
    await unchanged();
    await openFromList('Recent X newer');
    assert.equal(await titleBox().inputValue(), 'Recent X newer');
    assert.deepEqual((await projectFile()).objects, newer.objects);
    await openFromList(titleB);
    for (const title of ['Recent X old', 'Recent X newer']) {
      await deleteFromList(title);
      await row(title).waitFor({ state: 'detached' });
    }
  });

  // D-6c: X's state record has no current revision, only an older previous one, X-old, while the
  // library holds X's newer save. X-old is recovered like a damaged current revision: it opens as a
  // separate figure, and neither the load, Home Continue, an edit nor a reload reaches X.
  await check('AC-7 (D-6c) a state without a current revision recovers the previous one as a separate figure and never overwrites its saved figure', async () => {
    await settle();
    const readable = await state();
    const id = 'null-current-' + randomUUID();
    const body = structuredClone(readable.current.body);
    body.metadata = { ...body.metadata, id, title: 'Null current old' };
    const newer = structuredClone(fileA);
    newer.metadata = { ...newer.metadata, id, title: 'Null current newer' };
    assert.notDeepEqual(newer.objects, body.objects);
    const xEntries = [[SUMMARY + id, { version: 1, id, title: 'Null current newer', width: newer.document.width, height: newer.document.height,
      savedAt: new Date().toISOString() }], [RECORD + id, { version: 1, project: newer }]];
    const unchanged = async () => {
      const now = await entries();
      for (const [key, value] of xEntries) assert.deepEqual(now.get(key), value, key);
    };
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    await writeStore([[STATE, { ...readable, current: null, previous: { body, mediaIds: readable.current.mediaIds, dataSourceIds: readable.current.dataSourceIds }, recent: [] }], ...xEntries]);
    await page.reload();
    assert.equal((await startupSync()).outcome, 'complete');
    await unchanged();
    await page.getByText('Recovered the previous valid saved revision. Export a backup before continuing.', { exact: true }).waitFor();
    await page.locator('.continue-card').filter({ hasText: 'Null current old' }).waitFor();
    await settled(() => page.locator('.continue-card').click());
    const opened = await projectFile();
    assert.equal(opened.metadata.title, 'Null current old');
    assert.notEqual(opened.metadata.id, id);
    assert.deepEqual(opened.objects, body.objects);
    assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
    assert.equal(packedId((await state()).current), opened.metadata.id);
    await unchanged();
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await until(async () => (await record(opened.metadata.id))?.project.objects.length === body.objects.length + 1, 'the edit was not saved');
    assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
    await unchanged();
    // Both figures survive a reload, and the separate figure stays open.
    await reload();
    assert.equal(await titleBox().inputValue(), 'Null current old');
    await showFigures();
    await row('Null current old').waitFor();
    await row('Null current newer').waitFor();
    await unchanged();
    await openFromList(titleB);
    for (const title of ['Null current old', 'Null current newer']) {
      await deleteFromList(title);
      await row(title).waitFor({ state: 'detached' });
    }
  });

  await check('AC-8 opening a project file never overwrites different saved content', async () => {
    const text = await readFile('examples/schematic-with-plot.obf.json', 'utf8');
    const example = JSON.parse(text), file = { name: 'schematic-with-plot.obf.json', mimeType: 'application/json', buffer: Buffer.from(text) };
    const notice = () => page.getByText('Project opened', { exact: true });
    const openExample = async prepare => {
      await notice().waitFor({ state: 'hidden' });
      await prepare?.();
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles(file);
      await notice().waitFor();
      await saved();
      return projectFile();
    };
    const count = async () => (await summaries()).length;
    const start = await count();
    const first = await openExample();
    assert.equal(first.metadata.id, example.metadata.id);
    assert.equal(await count(), start + 1);
    await titleBox().fill('Schematic edited');
    await saved();
    const second = await openExample();
    assert.notEqual(second.metadata.id, example.metadata.id);
    assert.equal(second.metadata.title, example.metadata.title);
    assert.equal(await count(), start + 2);
    assert.equal((await record(example.metadata.id)).project.metadata.title, 'Schematic edited');
    const third = await openExample();
    assert.equal(third.metadata.id, second.metadata.id);
    assert.equal(await count(), start + 2);
    await settled(() => viewMenu(/^(Show|Hide) grid$/));
    const toggled = await record(second.metadata.id);
    assert.notEqual(toggled.project.settings.grid.enabled, third.settings.grid.enabled);
    assert.equal(toggled.project.metadata.updatedAt, third.metadata.updatedAt);
    const fourth = await openExample();
    assert.notEqual(fourth.metadata.id, second.metadata.id);
    assert.deepEqual(await record(second.metadata.id), toggled);
    assert.equal(await count(), start + 3);
    // The title edit is still pending when the file opens.
    const fifth = await openExample(() => titleBox().fill('Typed then reopened'));
    assert.notEqual(fifth.metadata.id, fourth.metadata.id);
    assert.equal((await record(fourth.metadata.id)).project.metadata.title, 'Typed then reopened');
    assert.equal(fifth.metadata.title, example.metadata.title);
  });

  await check('AC-FAIL-1 a file whose save fails on a full disk stays open and pending until a later save', async () => {
    await quiet();
    const file = JSON.parse(await readFile('examples/schematic-with-plot.obf.json', 'utf8'));
    const id = 'quota-open-' + randomUUID();
    file.metadata = { ...file.metadata, id, title: 'Quota open probe' };
    const before = await dump();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (typeof key === 'string' && key.startsWith('openrender:figure:v1:')) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('Simulated quota failure', 'QuotaExceededError');
        }
        return put.apply(this, arguments);
      };
    });
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'quota-open.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await page.getByText(QUOTA_NOTICE, { exact: true }).waitFor();
    await page.locator('.app-shell:not([inert])').waitFor();
    assert.equal(await titleBox().inputValue(), 'Quota open probe');
    await page.locator('.save-status.status-error').waitFor();
    assert.deepEqual(await dump(), before);
    // The opened figure is still pending: switching away saves it first.
    await showFigures();
    await openFromList(titleB);
    assert.equal((await record(id)).project.metadata.title, 'Quota open probe');
    assert.equal((await record(id)).project.objects.length, file.objects.length);
    await openFromList('Quota open probe');
    await titleBox().fill('Quota open retried');
    await saved();
    assert.equal((await record(id)).project.metadata.title, 'Quota open retried');
    assert.equal((await summary(id)).title, 'Quota open retried');
    assert.equal(packedId((await state()).current), id);
  });

  await check('AC-5 and AC-8 a switch from Home owns the shell until the opened figure has finished loading', async () => {
    await quiet();
    // The figure carries an embedded image, so the probe can hold the decoding of its first load.
    await newFigure('Held load A');
    const id = packedId((await state()).current);
    await insertImage('held-load.png', '#1b6ca8');
    await until(async () => (await record(id))?.project.objects.some(object => object.kind === 'image'), 'the image was not saved');
    await quiet();
    await showFigures();
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    const before = await entries(), opened = await lastSave();
    await page.evaluate(other => {
      const decode = HTMLImageElement.prototype.decode, get = IDBObjectStore.prototype.get;
      let resume;
      const resumed = new Promise(resolve => { resume = resolve; });
      const probe = window.__firstLoad = { held: 0, released: false, otherReads: 0, unlocked: 0, release: () => {
        probe.released = true;
        HTMLImageElement.prototype.decode = decode;
        IDBObjectStore.prototype.get = get;
        resume();
      } };
      // The editor's first load waits for its image, whose decoding waits for the release.
      HTMLImageElement.prototype.decode = function () {
        if (probe.held++ === 0) {
          const shell = document.querySelector('.app-shell');
          new MutationObserver(() => {
            if (!probe.released && (!shell.hasAttribute('inert') || shell.getAttribute('aria-busy') !== 'true')) probe.unlocked++;
          }).observe(shell, { attributes: true, attributeFilter: ['inert', 'aria-busy'] });
        }
        return resumed.then(() => decode.call(this));
      };
      IDBObjectStore.prototype.get = function (key) {
        if (key === other) probe.otherReads++;
        return get.apply(this, arguments);
      };
    }, RECORD + idB);
    const read = () => page.evaluate(() => {
      const probe = window.__firstLoad;
      return { held: probe.held > 0, released: probe.released, otherReads: probe.otherReads, unlocked: probe.unlocked };
    });
    const choosers = [], onChooser = chooser => choosers.push(chooser);
    const newDialog = page.getByRole('dialog', { name: 'Create a new figure' });
    const palette = page.getByRole('dialog', { name: 'Quick actions' });
    page.on('filechooser', onChooser);
    try {
      // The command palette is opened before the switch and stays open over it.
      await page.keyboard.press('Control+k');
      await palette.waitFor();
      await page.evaluate(() => [...document.querySelectorAll('.recent-list button')]
        .find(button => button.textContent.includes('Held load A'))
        .dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForFunction(() => window.__firstLoad.held > 0);
      // The opened figure is saved while its first load is still held.
      await until(async () => (await lastSave()) !== opened, 'the opened figure was not saved');
      await page.locator('.save-status.status-saved').waitFor();
      // Its editing action is ignored during the switch, and Ctrl+K opens no palette. The palette now
      // sits in the inert shell, so the click is dispatched like the one on the figure row below.
      await page.evaluate(() => document.getElementById('command-add-text').dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await palette.waitFor({ state: 'detached' });
      await page.keyboard.press('Control+k');
      await page.keyboard.press('Control+o');
      await page.keyboard.press('Control+n');
      await page.evaluate(title => {
        const item = [...document.querySelectorAll('.figure-list li')].find(node => node.querySelector('strong')?.textContent === title);
        item.querySelector('.figure-row-open').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, titleB);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await read(), { held: true, released: false, otherReads: 0, unlocked: 0 });
      assert.equal(choosers.length, 0);
      assert.equal(await newDialog.count(), 0);
      assert.deepEqual({
        palettes: await palette.count(),
        pendingSaves: await page.locator('.save-status.status-saving').count(),
        undoDisabled: await page.getByTestId('undo').isDisabled(),
      }, { palettes: 0, pendingSaves: 0, undoDisabled: true });
      assert.equal(await shell().getAttribute('inert'), '');
      assert.equal(await shell().getAttribute('aria-busy'), 'true');
    } finally {
      page.off('filechooser', onChooser);
      await page.evaluate(() => window.__firstLoad.release());
      // A failed probe must not leave the New dialog or the palette over the following checks.
      if (await newDialog.count()) await newDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (await palette.count()) {
        await page.locator('.app-shell:not([inert])').waitFor();
        await palette.getByRole('button', { name: 'Close commands', exact: true }).click();
      }
    }
    await page.locator('.app-shell:not([inert])').waitFor();
    await settle();
    assert.deepEqual(await read(), { held: true, released: true, otherReads: 0, unlocked: 0 });
    assert.equal(choosers.length, 0);
    assert.equal(await newDialog.count(), 0);
    assert.equal(await palette.count(), 0);
    assert.equal(await page.getByTestId('undo').isDisabled(), true);
    assert.equal(await titleBox().inputValue(), 'Held load A');
    assert.equal(packedId((await state()).current), id);
    assert.deepEqual((await projectFile()).objects, before.get(RECORD + id).project.objects);
    const after = await entries();
    for (const key of [RECORD + id, SUMMARY + idB, RECORD + idB]) assert.deepEqual(after.get(key), before.get(key), key);
    assert.deepEqual({ ...after.get(SUMMARY + id), savedAt: null }, { ...before.get(SUMMARY + id), savedAt: null });
  });

  await check('AC-5 an edit that completes during the target lookup is saved before the target opens', async () => {
    await quiet();
    const id = packedId((await state()).current), title = await titleBox().inputValue();
    const count = (await record(id)).project.objects.length;
    await holdLookup(RECORD + idB);
    try {
      await startImage();
      await showFigures();
      await row(titleB).locator('.figure-row-open').click();
      await page.waitForFunction(() => window.__lateEdit.holding);
      await finishEditDuringLookup();
      await page.locator('.app-shell:not([inert])').waitFor();
      await settle();
      assert.equal(await titleBox().inputValue(), titleB);
      assert.equal(packedId((await state()).current), idB);
      await page.locator('.save-status.status-saved').waitFor();
      // The image was saved with its figure before the target was looked up again and opened.
      const events = await lateEvents();
      const pending = events.indexOf('edit pending'), savedEdit = events.indexOf('put ' + RECORD + id, pending);
      assert.ok(events.indexOf('get ' + RECORD + idB) < pending && pending < savedEdit &&
        savedEdit < events.indexOf('get ' + RECORD + idB, savedEdit), events.join(', '));
      const stored = (await record(id)).project;
      assert.equal(stored.objects.length, count + 1);
      assert.equal(stored.objects.at(-1).kind, 'image');
      // Nothing was left pending: the next switch has nothing to save before its lookup.
      await openFromList(title);
      const next = (await lateEvents()).slice(events.length);
      assert.equal(next[0], 'get ' + RECORD + id, next.join(', '));
    } finally {
      await endLateEdit();
    }
    assert.equal((await projectFile()).objects.length, count + 1);
    await reload();
    assert.equal(await titleBox().inputValue(), title);
    assert.deepEqual((await projectFile()).objects, (await record(id)).project.objects);
    assert.equal((await record(id)).project.objects.length, count + 1);
  });

  await check('AC-8 an edit that completes during an import lookup is saved first and decides the import', async () => {
    await quiet();
    const id = packedId((await state()).current);
    // The file equals the open figure as saved, so without the edit it would open that figure itself.
    const file = (await record(id)).project;
    await holdLookup(RECORD + id);
    let events;
    try {
      await startImage();
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'late-edit.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => window.__lateEdit.holding);
      await finishEditDuringLookup();
      await page.getByText('Project opened', { exact: true }).waitFor();
      await settle();
      events = await lateEvents();
    } finally {
      await endLateEdit();
    }
    const pending = events.indexOf('edit pending'), savedEdit = events.indexOf('put ' + RECORD + id, pending);
    assert.ok(events.indexOf('get ' + RECORD + id) < pending && pending < savedEdit &&
      savedEdit < events.indexOf('get ' + RECORD + id, savedEdit), events.join(', '));
    const stored = (await record(id)).project;
    assert.equal(stored.objects.length, file.objects.length + 1);
    // Saved with the image, the figure no longer equals the file, which opens as a new figure.
    const opened = await projectFile();
    assert.notEqual(opened.metadata.id, id);
    assert.equal(opened.metadata.title, file.metadata.title);
    assert.deepEqual(opened.objects, file.objects);
    assert.equal(packedId((await state()).current), opened.metadata.id);
    await page.locator('.save-status.status-saved').waitFor();
    await titleBox().fill('Late edit fork');
    await saved();
    await showFigures();
    await row('Late edit fork').waitFor();
    await openFromList(file.metadata.title);
    assert.deepEqual((await projectFile()).objects, stored.objects);
    await reload();
    assert.deepEqual((await projectFile()).objects, stored.objects);
    await showFigures();
    await deleteFromList('Late edit fork');
    await row('Late edit fork').waitFor({ state: 'detached' });
  });

  await check('AC-5 a file opened from Home whose first load fails releases the switch and keeps the render notice', async () => {
    await quiet();
    const id = packedId((await state()).current), file = (await record(id)).project;
    await showFigures();
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    const before = await entries();
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        HTMLImageElement.prototype.decode = decode;
        return Promise.reject(new DOMException('Simulated decoding failure', 'EncodingError'));
      };
    });
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'render-failure.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await page.getByText(RENDER_FAILED_NOTICE, { exact: true }).waitFor();
    await page.locator('.app-shell:not([inert])').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByText(RENDER_FAILED_NOTICE, { exact: true }).waitFor();
    assert.equal(await page.getByText('Project opened', { exact: true }).count(), 0);
    assert.deepEqual((await entries()).get(RECORD + id), before.get(RECORD + id));
    // The switch has ended: a new figure can be requested again.
    await page.keyboard.press('Control+n');
    const dialog = page.getByRole('dialog', { name: 'Create a new figure' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await openFromList(titleB);
    await openFromList(file.metadata.title);
    assert.deepEqual((await projectFile()).objects, file.objects);
  });

  await check('AC-5 a file opened from Home keeps Home inert and busy while it is looked up and ignores Settings, New and Open', async () => {
    await quiet();
    const id = packedId((await state()).current), file = (await record(id)).project;
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
    const before = await entries();
    const newDialog = page.getByRole('dialog', { name: 'Create a new figure' });
    // The file's lookup is held as in the late-edit probes; ending that probe releases it.
    await holdLookup(RECORD + id);
    try {
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'home-lookup.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => window.__lateEdit.holding);
      const surface = await busySurface('.start-screen', 'Settings');
      await pressDuringSwitch('.start-screen', ['Open project', 'New figure', 'Settings']);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual({
        ...surface,
        pickerClicks: await page.evaluate(() => window.__pickerClicks),
        newDialogs: await newDialog.count(),
        home: await page.locator('.start-screen').count(),
        settings: await page.locator('.settings-screen').count(),
      }, { inert: true, busy: true, focusable: false, pickerClicks: 0, newDialogs: 0, home: 1, settings: 0 });
    } finally {
      await endLateEdit();
      // A failed probe must not leave the New dialog over the following checks.
      if (await newDialog.count()) {
        await page.locator('.app-shell:not([inert])').waitFor();
        await newDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    await page.getByText('Project opened', { exact: true }).waitFor();
    await settle();
    assert.equal(await titleBox().inputValue(), file.metadata.title);
    assert.equal(await newDialog.count(), 0);
    assert.equal(await page.locator('.settings-screen').count(), 0);
    await assertOnlySaved(before, id);
  });

  await check('AC-5 a file opened from Settings keeps Settings inert and busy while it is looked up and ignores Clear recent and Back', async () => {
    await quiet();
    const id = packedId((await state()).current), file = (await record(id)).project;
    await page.getByRole('button', { name: 'Di-Render Home', exact: true }).click();
    await page.locator('.start-screen').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Files', exact: true }).click();
    const clear = page.getByRole('button', { name: 'Clear recent list', exact: true });
    await clear.waitFor();
    assert.equal(await clear.isDisabled(), false);
    const before = await entries();
    await holdLookup(RECORD + id);
    try {
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'settings-lookup.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => window.__lateEdit.holding);
      const surface = await busySurface('.settings-screen', 'Clear recent list');
      await pressDuringSwitch('.settings-screen', ['Clear recent list', 'Back to Di-Render']);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual({
        ...surface,
        recent: (await state()).recent.length,
        settings: await page.locator('.settings-screen').count(),
        home: await page.locator('.start-screen').count(),
      }, { inert: true, busy: true, focusable: false, recent: before.get(STATE).recent.length, settings: 1, home: 0 });
    } finally {
      await endLateEdit();
    }
    await page.getByText('Project opened', { exact: true }).waitFor();
    await settle();
    assert.equal(await titleBox().inputValue(), file.metadata.title);
    assert.equal(await page.locator('.settings-screen').count(), 0);
    await assertOnlySaved(before, id);
  });

  await check('AC-6 while the delete confirmation is open, editing keys, paste and application shortcuts never reach the open figure', async () => {
    await quiet();
    const id = packedId((await state()).current), stored = (await record(id)).project.objects;
    await viewMenu('Layers panel');
    await page.locator('.layer-row .layer-main').first().click();
    // The nudge leaves an edit that Ctrl+Z could undo, and the copy an object that Ctrl+V could paste.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Control+c');
    await until(async () => JSON.stringify((await record(id)).project.objects) !== JSON.stringify(stored), 'the nudge was not saved');
    await settle();
    const before = await entries(), objects = before.get(RECORD + id).project.objects;
    assert.equal(await page.getByTestId('undo').isDisabled(), false);
    await showFigures();
    const dialog = await deleteFromList(titleB, false);
    const focused = name => page.waitForFunction(name => document.activeElement?.closest('[role=alertdialog]') !== null &&
      document.activeElement.textContent.trim() === name, name);
    await focused('Cancel');
    // `/` must not pull the focus out of the dialog to the asset search either.
    for (const key of ['Delete', 'Backspace', 'Control+z', 'Control+v', '/']) await page.keyboard.press(key);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual({
      dialogs: await dialog.count(),
      pendingSaves: await page.locator('.save-status.status-saving').count(),
      undoDisabled: await page.getByTestId('undo').isDisabled(),
      figuresSelected: await figuresTab().getAttribute('aria-selected'),
      focus: await page.evaluate(() => document.activeElement?.textContent.trim()),
    }, { dialogs: 1, pendingSaves: 0, undoDisabled: false, figuresSelected: 'true', focus: 'Cancel' });
    // Nor do the application shortcuts: no palette, New dialog, file picker or shortcuts dialog opens.
    const choosers = [], onChooser = chooser => choosers.push(chooser);
    page.on('filechooser', onChooser);
    await page.evaluate(() => {
      window.__pickerClicks = 0;
      document.querySelector('input[type=file][accept*=".obf"]').addEventListener('click', () => { window.__pickerClicks++; });
    });
    for (const key of ['Control+k', 'Control+n', 'Control+o', '?']) await page.keyboard.press(key);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shown = {
      palettes: await page.getByRole('dialog', { name: 'Quick actions' }).count(),
      newDialogs: await page.getByRole('dialog', { name: 'Create a new figure' }).count(),
      shortcuts: await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(),
      pickerClicks: await page.evaluate(() => window.__pickerClicks),
      choosers: choosers.length,
      focus: await page.evaluate(() => document.activeElement?.textContent.trim()),
    };
    page.off('filechooser', onChooser);
    // A failed probe must not leave a dialog over the following checks; Escape closes every dialog.
    if (shown.palettes + shown.newDialogs + shown.shortcuts) await page.keyboard.press('Escape');
    assert.deepEqual(shown, { palettes: 0, newDialogs: 0, shortcuts: 0, pickerClicks: 0, choosers: 0, focus: 'Cancel' });
    // The dialog keeps its own keys: Tab cycles within it, Cancel and Escape close it.
    await page.keyboard.press('Tab');
    await focused('Delete figure');
    await page.keyboard.press('Tab');
    await focused('Cancel');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await deleteFromList(titleB, false);
    await focused('Cancel');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await settle();
    assert.deepEqual((await projectFile()).objects, objects);
    assert.deepEqual(await entries(), before);
    await row(titleB).waitFor();
  });

  await check('AC-5 a paste that completes after another figure opened changes neither figure', async () => {
    await quiet();
    const id = packedId((await state()).current), title = await titleBox().inputValue();
    // A pasted image is decoded again, so the probe can hold the paste until another figure is open.
    assert.ok((await record(id)).project.objects.some(object => object.kind === 'image'));
    await viewMenu('Layers panel');
    await page.locator('.layer-row').filter({ has: page.locator('small', { hasText: /^image$/ }) }).first().locator('.layer-main').click();
    await page.keyboard.press('Control+c');
    await page.getByText('Copied', { exact: true }).waitFor();
    await showFigures();
    const before = await entries();
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      const probe = window.__latePaste = { held: false, decoded: false, release: null, restore: () => { HTMLImageElement.prototype.decode = decode; } };
      HTMLImageElement.prototype.decode = function () {
        if (probe.held) return decode.call(this);
        probe.held = true;
        return new Promise(resolve => { probe.release = resolve; }).then(() => decode.call(this)).finally(() => { probe.decoded = true; });
      };
    });
    try {
      await page.keyboard.press('Control+v');
      await page.waitForFunction(() => window.__latePaste.held);
      await openFromList(titleB);
      await page.evaluate(() => window.__latePaste.release());
      await page.waitForFunction(() => window.__latePaste.decoded);
    } finally {
      await page.evaluate(() => { const probe = window.__latePaste; probe.restore(); probe.release?.(); });
    }
    await settle();
    assert.equal(await titleBox().inputValue(), titleB);
    assert.equal(await page.locator('.save-status.status-error').count(), 0, 'the save status shows an error');
    assert.deepEqual((await projectFile()).objects, before.get(RECORD + idB).project.objects);
    await assertOnlySaved(before, idB);
    // Both figures still switch cleanly.
    await openFromList(title);
    assert.deepEqual((await projectFile()).objects, before.get(RECORD + id).project.objects);
    await openFromList(titleB);
    assert.deepEqual((await projectFile()).objects, before.get(RECORD + idB).project.objects);
    assert.equal(await page.getByText(SAVE_FAILED_NOTICE, { exact: true }).count(), 0);
    await openFromList(title);
  });

  // The target carries embedded images, so its staging can be held while the source's insertion is
  // prepared; the editor still reports the source until the target is staged.
  await check('AC-5 an image prepared in one figure never lands in the figure opened meanwhile', async () => {
    await quiet();
    const target = await titleBox().inputValue();
    assert.ok((await record(packedId((await state()).current))).project.objects.some(object => object.kind === 'image'));
    await showFigures();
    await openFromList(titleB);
    await settle();
    const before = await entries();
    await holdPreparation();
    try {
      await insertImage('late-prepared.png', '#7c3aed');
      await page.waitForFunction(() => window.__preparation.held);
      await holdStaging();
      await row(target).locator('.figure-row-open').click();
      await page.waitForFunction(() => window.__staging.held.length > 0);
      // The preparation completes while the target is staging; its App-level continuation runs
      // within the same task.
      await page.evaluate(() => window.__preparation.release());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => window.__staging.release(1));
      await page.locator('.app-shell:not([inert])').waitFor();
      // Any decoding the insertion started is released once the target is open.
      await page.evaluate(() => window.__staging.release(Infinity));
      await page.waitForFunction(() => window.__staging.done === window.__staging.released);
    } finally {
      await endPreparation();
    }
    await settle();
    await assertBothSaved(before, titleB, idB, target);
  });

  await check('AC-5 a drawing loaded in one figure is dropped when another figure opens while it loads', async () => {
    await quiet();
    const target = await titleBox().inputValue();
    await openFromList(titleB);
    await settle();
    await assetsTab().click();
    const search = page.getByRole('textbox', { name: 'Search scientific assets' });
    await search.fill('Mitochondria');
    const card = page.locator('.asset-card').filter({ has: page.getByText('Mitochondria', { exact: true }) }).first();
    const busy = () => card.getAttribute('aria-busy');
    const before = await entries(), local = await page.evaluate(() => ({ ...localStorage }));
    await holdPreparation();
    try {
      await card.locator('.asset-add').click();
      await page.waitForFunction(() => window.__preparation.held);
      await holdStaging();
      await showFigures();
      await row(target).locator('.figure-row-open').click();
      await page.waitForFunction(() => window.__staging.held.length > 0);
      // The drawing load completes while the target is staging, and the insertion it started ends.
      await page.evaluate(() => window.__preparation.release());
      await until(async () => (await busy()) === 'false', 'the drawing insertion did not end');
      await page.evaluate(() => window.__staging.release(Infinity));
      await page.waitForFunction(() => window.__staging.done === window.__staging.released);
    } finally {
      await endPreparation();
    }
    await page.locator('.app-shell:not([inert])').waitFor();
    await settle();
    await assetsTab().click();
    await search.fill('');
    await showFigures();
    // A dropped drawing is not recorded as used either.
    assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), local, 'the dropped drawing was recorded as used');
    await assertBothSaved(before, titleB, idB, target);
  });

  await check('AC-3 in a French figure, / and the asset-search actions from Figures focus the translated search', async () => {
    await quiet();
    const english = await projectFile();
    const french = structuredClone(english);
    french.metadata = { ...french.metadata, id: randomUUID(), title: 'French figure' };
    french.settings = { ...french.settings, locale: 'fr' };
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'french-figure.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(french)) });
    await page.getByText('Project opened', { exact: true }).waitFor();
    await settle();
    const ressources = page.getByRole('tab', { name: 'Ressources', exact: true });
    const search = page.getByRole('textbox', { name: 'Rechercher des ressources scientifiques', exact: true });
    const favorites = page.locator('.asset-scopes').getByRole('button', { name: 'Favoris', exact: true });
    await ressources.click();
    await search.fill('Mitochondria');
    await favorites.click();
    const reveal = async open => {
      await figuresTab().click();
      await open();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Rechercher des ressources scientifiques');
      assert.deepEqual({ selected: await ressources.getAttribute('aria-selected'), text: await search.inputValue(), scope: await favorites.getAttribute('aria-pressed') },
        { selected: 'true', text: 'Mitochondria', scope: 'true' });
    };
    await reveal(() => page.keyboard.press('/'));
    await reveal(() => viewMenu('Assets panel'));
    await reveal(async () => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('Search scientific assets');
      await page.keyboard.press('Enter');
    });
    await page.locator('.asset-scopes').getByRole('button', { name: 'Toutes', exact: true }).click();
    await search.fill('');
    // The English figure reopens in English, and the French one is removed again.
    await showFigures();
    await openFromList(english.metadata.title);
    await assetsTab().waitFor();
    await showFigures();
    await deleteFromList('French figure');
    await row('French figure').waitFor({ state: 'detached' });
  });

  // The editor restored at startup loads image-bearing A outside any switch; a file opened with Ctrl+O
  // before that load has finished must stay the open figure.
  await check('AC-5 and AC-8 a file opened while the restored figure is still loading stays open', async () => {
    await quiet();
    const restored = packedId((await state()).current), title = await titleBox().inputValue();
    assert.ok((await record(restored)).project.objects.some(object => object.kind === 'image'));
    const before = await entries();
    const file = structuredClone(fileA);
    file.metadata = { ...file.metadata, id: randomUUID(), title: 'Startup file B' };
    await page.evaluate(() => { window.name = 'figure-library:hold-startup-decode'; });
    await page.reload();
    await page.waitForFunction(() => window.__startupDecode?.held);
    // The file's lookup marks when the switch reaches its target; the rest of that step needs no task.
    await page.evaluate(key => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (requested) {
        const request = get.apply(this, arguments);
        if (requested === key) {
          IDBObjectStore.prototype.get = get;
          request.addEventListener('success', () => { window.__startupDecode.lookedUp = true; });
        }
        return request;
      };
    }, RECORD + file.metadata.id);
    // Ctrl+O asks for a file; in the browser the inert shell keeps its picker closed, so the file is
    // set on the input as the other probes do, as a desktop open dialog would deliver it.
    try {
      await page.keyboard.press('Control+o');
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'startup-file-b.obf.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)) });
      await page.waitForFunction(() => window.__startupDecode.lookedUp);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      await page.evaluate(() => window.__startupDecode?.release());
    }
    // The shell is interactive once both the restored load and the switch have ended.
    await page.locator('.app-shell:not([inert])').waitFor();
    await page.getByText('Project opened', { exact: true }).waitFor();
    await settle();
    assert.equal(await titleBox().inputValue(), 'Startup file B');
    assert.deepEqual((await projectFile()).objects, file.objects);
    assert.equal(await page.getByTestId('undo').isDisabled(), true);
    assert.equal(packedId((await state()).current), file.metadata.id);
    const after = await entries();
    for (const key of [SUMMARY + restored, RECORD + restored]) assert.deepEqual(after.get(key), before.get(key), key);
    await showFigures();
    await openFromList(title);
    await deleteFromList('Startup file B');
    await row('Startup file B').waitFor({ state: 'detached' });
  });

  // IndexedDB denied: in a context of its own, indexedDB.open throws before the app runs. Startup
  // still reaches Home, and a new figure can be edited and downloaded while saving fails.
  await check('AC-FAIL-2 with IndexedDB denied, startup reaches Home and a new figure is edited and downloaded', async () => {
    const denied = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const issues = [], requests = [];
    try {
      await denied.addInitScript(() => {
        IDBFactory.prototype.open = function () { throw new DOMException('denied', 'SecurityError'); };
        window.addEventListener('unhandledrejection', event => console.error('Unhandled rejection: ' + event.reason));
      });
      const tab = await denied.newPage();
      tab.setDefaultTimeout(8000);
      tab.on('pageerror', error => issues.push(error.message));
      tab.on('console', message => { if (message.type() === 'error') issues.push(message.text()); });
      tab.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) requests.push(request.url()); });
      tab.on('dialog', dialog => { issues.push('dialog: ' + dialog.message()); void dialog.dismiss(); });
      await tab.goto(base);
      // Home as for a first visit replaces the loading screen.
      await tab.getByRole('heading', { name: 'Create an editable scientific figure' }).waitFor();
      assert.equal(await tab.getByText('Opening Di-Render…').count(), 0);
      assert.equal(await tab.locator('.continue-card').count(), 0);
      await tab.getByText('No recent projects yet', { exact: true }).waitFor();
      // New figure opens the editor; its own save fails, so the New dialog stays open with the notice.
      const newDialog = tab.getByRole('dialog', { name: 'Create a new figure' });
      await tab.getByRole('button', { name: 'New figure', exact: true }).click();
      await newDialog.getByRole('button', { name: 'Create figure', exact: true }).click();
      await tab.getByText('This figure is open but could not be saved locally. Download a project backup.', { exact: true }).waitFor();
      await tab.getByTestId('workspace').waitFor();
      await tab.locator('.app-shell:not([inert])').waitFor();
      await newDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await newDialog.waitFor({ state: 'detached' });
      await tab.getByRole('tab', { name: /^Figures/ }).click();
      await tab.getByText(LIST_FAILED_TEXT, { exact: true }).waitFor();
      // A title edit applies, its save fails visibly, and the downloaded project holds it.
      const title = tab.getByRole('textbox', { name: 'Figure title' });
      await title.fill('Denied storage figure');
      await tab.locator('.save-status.status-saving').waitFor();
      await tab.locator('.save-status.status-error').waitFor({ timeout: 12000 });
      assert.equal(await title.inputValue(), 'Denied storage figure');
      const waiting = tab.waitForEvent('download');
      waiting.catch(() => undefined);
      await tab.getByTestId('save-project').click();
      const file = JSON.parse(await readFile(await (await waiting).path(), 'utf8'));
      assert.equal(file.metadata.title, 'Denied storage figure');
      assert.equal(await tab.locator('.save-status.status-error').count(), 1);
      assert.deepEqual(issues, []);
      assert.deepEqual(requests, []);
    } finally {
      await denied.close();
    }
  });

  await check('AC-SEC-1 and AC-FAIL-3 hostile or damaged entries are listed safely and never open', async () => {
    await showFigures();
    const open = await projectFile();
    const make = (id, title, change) => {
      const project = structuredClone(open);
      project.metadata = { ...project.metadata, id, title };
      change?.(project);
      return { version: 1, project };
    };
    const summaryOf = (id, title) => ({ version: 1, id, title, width: open.document.width, height: open.document.height,
      savedAt: new Date(Date.now() + 60_000).toISOString() });
    const markup = '<img src=x onerror="window.__figureLibraryXss=1">Hostile markup';
    const scripted = make('hostile-script', markup, project => {
      project.assets = [...project.assets, {
        id: 'hostile-asset', title: 'Hostile asset', description: 'Probe', keywords: ['probe'], category: 'Private',
        source: { provider: 'Private import', sourceUrl: null, assetUrl: null, retrievedAt: '2026-10-07' },
        creator: { name: 'Researcher', url: null },
        license: { id: 'UNKNOWN', name: 'Unknown', url: null, attributionRequired: false },
        attribution: { text: 'Probe', modified: false, modificationNotes: null },
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__figureLibraryXss=1</script><rect width="10" height="10"/></svg>',
        verified: false,
      }];
      project.objects = [...project.objects, { id: 'hostile-object', name: 'Hostile', kind: 'svg', assetId: 'hostile-asset',
        x: 50, y: 50, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true, locked: false,
        fill: null, stroke: null, strokeWidth: 0 }];
    });
    const complex = make('hostile-complex', 'Hostile complex', project => { project.objects = Array.from({ length: 100_001 }, () => [0]); });
    await writeStore([
      [SUMMARY + 'hostile-script', summaryOf('hostile-script', markup)], [RECORD + 'hostile-script', scripted],
      [SUMMARY + 'hostile-complex', summaryOf('hostile-complex', 'Hostile complex')], [RECORD + 'hostile-complex', complex],
      [SUMMARY + 'hostile-long', summaryOf('hostile-long', 'x'.repeat(20_000))], [RECORD + 'hostile-long', make('hostile-long', 'Long')],
      [SUMMARY + 'hostile-mismatch', summaryOf('hostile-mismatch', 'Hostile mismatch')], [RECORD + 'hostile-mismatch', make('hostile-other', 'Hostile mismatch')],
      [SUMMARY + 'hostile-string', summaryOf('hostile-string', 'Hostile string')], [RECORD + 'hostile-string', 'not a saved figure'],
      [SUMMARY + 'hostile-missing', summaryOf('hostile-missing', 'Hostile missing')],
    ]);
    await reload();
    await showFigures();
    const hostile = [markup, 'Hostile complex', 'Hostile mismatch', 'Hostile string', 'Hostile missing'];
    for (const title of hostile) await row(title).waitFor();
    assert.equal((await listedTitles()).some(title => title.length >= 20_000), false);
    for (const title of hostile) {
      await page.getByText(DAMAGED_NOTICE, { exact: true }).waitFor({ state: 'hidden' });
      await row(title).locator('.figure-row-open').click();
      await page.getByText(DAMAGED_NOTICE, { exact: true }).waitFor();
      await page.locator('.app-shell:not([inert])').waitFor();
      assert.equal(await titleBox().inputValue(), open.metadata.title);
    }
    assert.deepEqual(await projectFile(), open);
    assert.equal(await page.evaluate(() => window.__figureLibraryXss), undefined);
    assert.deepEqual(dialogs, []);
    for (const title of [markup, 'Hostile missing']) {
      await deleteFromList(title);
      await row(title).waitFor({ state: 'detached' });
    }
    assert.equal(await stored('hostile-missing'), false);
  });

  await check('AC-SEC-2 the library stays local and figure content never leaves IndexedDB', async () => {
    const view = await page.evaluate(async () => ({
      localKeys: Object.keys(localStorage).sort(),
      local: Object.values(localStorage).join('\n'),
      session: Object.keys(sessionStorage).join('\n') + Object.values(sessionStorage).join('\n'),
      url: location.href,
      databases: (await indexedDB.databases()).map(database => database.name).sort(),
    }));
    assert.deepEqual(view.localKeys, localKeys);
    for (const title of usedTitles) {
      for (const [where, text] of [['localStorage', view.local], ['sessionStorage', view.session], ['URL', view.url], ['console', consoleTexts.join('\n')]])
        assert.equal(text.includes(title), false, title + ' found in ' + where);
    }
    assert.equal(view.databases.every(name => ['openrender-documents', 'keyval-store'].includes(name)), true, view.databases.join(','));
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
  });
} finally {
  await writeFile('reports/figure-library-chromium.json',
    JSON.stringify({ engine: 'chromium', version: browser.version(), results, errors, network, dialogs }, null, 2) + '\n');
  await browser.close();
}
if (results.some(item => !item.pass) || errors.length || network.length || dialogs.length) process.exitCode = 1;
