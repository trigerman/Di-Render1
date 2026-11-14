import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173);
const directory = 'reports/plot-workflow';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], external = [], results = [];
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = route.request().url();
  if (new URL(url).origin === base || /^(blob:|data:)/.test(url)) return route.continue();
  external.push(url); return route.abort();
});
const dialog = page.getByRole('dialog');
const button = name => dialog.getByRole('button', { name, exact: true });
const field = name => dialog.getByLabel(name, { exact: true });
const data = 'Group\tValue\nControl\t1\nControl\t2\nControl\t3\nTreatment\t4\nTreatment\t5\nTreatment\t6';
const saved = async () => { await page.locator('.app-shell:not([inert])').waitFor(); await page.getByText('Saved locally', { exact: true }).waitFor(); };
const portable = async () => {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-project').click()]);
  const path = directory + '/current.obf.json'; await file.saveAs(path); return JSON.parse(await readFile(path, 'utf8'));
};
const enter = async (text = data, name = 'Draft measurements') => {
  await button('Import data').click(); await field('Paste data').fill(text); await field('Dataset name').fill(name);
  await button('Continue to plot').click(); await dialog.locator('.plot-preview').waitFor();
};
const check = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); await page.screenshot({ path: directory + '/failure-' + results.length + '.png' }); await page.keyboard.press('Escape'); }
};
try {
  await page.goto(base); await page.getByRole('button', { name: 'New figure', exact: true }).click(); await page.getByRole('button', { name: 'Create figure', exact: true }).click(); await saved();
  const blank = await portable();
  await check('Back and earlier steps retain data, read policy, column types, plot style and statistics', async () => {
    await page.getByTestId('insert-plot').click(); await page.screenshot({ path: directory + '/01-source.png' });
    await button('Import data').click(); await field('Paste data').fill(data); await field('Dataset name').fill('Retained draft');
    await field('Date format').selectOption('dmy'); await dialog.getByRole('grid').waitFor();
    await dialog.locator('.data-column-types select').first().selectOption('text');
    await button('Continue to plot').click(); await field('Plot type').selectOption('box'); await field('Title').fill('Custom title'); await field('Statistical test').selectOption('welch');
    await button('Back').click(); assert.equal(await field('Paste data').inputValue(), data); assert.equal(await field('Dataset name').inputValue(), 'Retained draft'); assert.equal(await field('Date format').inputValue(), 'dmy');
    await dialog.getByRole('grid').waitFor(); assert.equal(await dialog.locator('.data-column-types select').first().inputValue(), 'text');
    await button('Back').click(); await button('Import data').click(); assert.equal(await field('Paste data').inputValue(), data);
    await button('Continue to plot').click(); assert.equal(await field('Plot type').inputValue(), 'box'); assert.equal(await field('Title').inputValue(), 'Custom title'); assert.equal(await field('Statistical test').inputValue(), 'welch');
    await dialog.getByRole('navigation').getByRole('button', { name: 'Choose data', exact: true }).click();
    await button('Import data').click(); await button('Continue to plot').click(); assert.equal(await field('Title').inputValue(), 'Custom title');
    await button('Cancel').click(); await saved(); assert.deepEqual(await portable(), blank);
  });
  await check('Reset from design clears all draft data and settings without saving anything', async () => {
    await page.getByTestId('insert-plot').click(); await enter(); await field('Title').fill('Discard this'); await field('Plot type').selectOption('violin');
    await button('Reset').click(); await dialog.getByRole('status').filter({ hasText: 'Draft cleared' }).waitFor(); assert.equal(await button('Back').isDisabled(), true);
    await button('Import data').click(); assert.equal(await field('Paste data').inputValue(), ''); assert.equal(await field('Dataset name').inputValue(), ''); assert.equal(await field('Date format').inputValue(), 'iso'); assert.equal(await dialog.locator('input[type=file]').evaluate(input => input.files.length), 0);
    assert.equal(await button('Continue to plot').isDisabled(), true);
    await field('Paste data').fill(data); await button('Continue to plot').click(); assert.equal(await field('Plot type').inputValue(), 'bar'); assert.notEqual(await field('Title').inputValue(), 'Discard this');
    await button('Cancel').click(); assert.deepEqual(await portable(), blank);
  });
  await check('Typed values, embedded quotes and added rows survive Back; Reset empties the grid', async () => {
    await page.getByTestId('insert-plot').click();
    await page.evaluate(() => {
      const original = window.requestAnimationFrame, callbacks = [];
      window.requestAnimationFrame = callback => { callbacks.push(callback); return 0; };
      window.releasePlotFrames = () => { window.requestAnimationFrame = original; callbacks.forEach(callback => callback(performance.now())); };
    });
    await button('Type values').click();
    let cells = dialog.locator('table input');
    await cells.nth(2).focus(); await page.evaluate(() => window.releasePlotFrames());
    assert.equal(await cells.nth(2).evaluate(input => document.activeElement === input), true, 'step focus must not interrupt an active cell edit');
    for (const [index, value] of ['Group', 'Value', 'A "quoted"', '1', 'B', '2'].entries()) await cells.nth(index).fill(value);
    await button('Add row').click(); await cells.nth(6).fill('C\twith tab'); await cells.nth(7).fill('3');
    await button('Continue to plot').click(); await button('Back').click();
    cells = dialog.locator('table input'); assert.equal(await cells.count(), 8); assert.equal(await cells.nth(2).inputValue(), 'A "quoted"'); assert.equal(await cells.nth(6).inputValue(), 'C\twith tab');
    await button('Back').click(); await button('Type values').click(); assert.equal(await dialog.locator('table input').nth(6).inputValue(), 'C\twith tab');
    await button('Reset').click(); await button('Type values').click(); assert.deepEqual(await dialog.locator('table input').evaluateAll(inputs => inputs.map(input => input.value)), Array(6).fill(''));
    await button('Cancel').click(); assert.deepEqual(await portable(), blank);
  });
  await check('Reset while reading a file cancels the old result; the same file can be selected again', async () => {
    await page.getByTestId('insert-plot').click(); await button('Import data').click();
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () { const file = this; return new Promise((resolve, reject) => { window.releasePlotFile = () => original.call(file).then(resolve, reject); }); };
      window.restorePlotFile = () => { File.prototype.arrayBuffer = original; };
    });
    const file = { name: 'same-data.csv', mimeType: 'text/csv', buffer: Buffer.from(data) };
    await dialog.locator('input[type=file]').setInputFiles(file); assert.equal(await button('Continue to plot').isDisabled(), true);
    await button('Reset').click(); await page.evaluate(async () => { await window.releasePlotFile(); window.restorePlotFile(); });
    await button('Import data').click(); assert.equal(await field('Paste data').inputValue(), ''); assert.equal(await dialog.locator('input[type=file]').evaluate(input => input.files.length), 0);
    await dialog.locator('input[type=file]').setInputFiles(file); await button('Continue to plot').click(); await button('Back').click(); assert.equal(await field('Paste data').inputValue(), data); assert.equal(await field('Dataset name').inputValue(), 'same-data');
    await button('Cancel').click(); assert.deepEqual(await portable(), blank);
  });
  await check('Reset during a held preview worker prevents a stale preview from returning', async () => {
    await page.getByTestId('insert-plot').click(); await enter();
    let release, seen;
    const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { seen = resolve; });
    await page.route('**/dataWorker-*.js', async route => { seen(); await held; try { await route.continue(); } catch { /* Terminated worker request. */ } });
    await field('Title').fill('Held calculation'); await started; await button('Reset').click(); release(); await page.unroute('**/dataWorker-*.js');
    await button('Import data').click(); assert.equal(await field('Paste data').inputValue(), ''); assert.equal(await dialog.locator('.plot-preview').count(), 0);
    await button('Cancel').click(); assert.deepEqual(await portable(), blank);
  });
  await check('Apply commits data with the plot; one Undo removes both; Redo and reload restore both', async () => {
    await page.getByTestId('insert-plot').click(); await enter(); await page.screenshot({ path: directory + '/03-design.png' }); await button('Apply').click(); await saved();
    const inserted = await portable(); assert.equal(inserted.datasets.length, 1); assert.equal(inserted.objects.length, 1); assert.equal(inserted.objects[0].plot.datasetId, inserted.datasets[0].id);
    await page.getByTestId('undo').click(); await saved(); let current = await portable(); assert.deepEqual(current.datasets, []); assert.deepEqual(current.dataSources, []); assert.deepEqual(current.objects, []);
    await page.getByTestId('redo').click(); await saved(); await page.reload(); await saved(); current = await portable(); assert.deepEqual(current.datasets, inserted.datasets); assert.deepEqual(current.objects, inserted.objects);
  });
  await check('Reset preserves saved datasets and plots; existing-data navigation works', async () => {
    const before = await portable(); await page.getByTestId('insert-plot').click(); await button('Back').click(); await button('Reset').click();
    await field('Dataset').selectOption(before.datasets[0].id); await button('Use dataset').click(); await field('Title').fill('Unsaved second plot');
    await button('Back').click(); await button('Use dataset').click(); assert.equal(await field('Title').inputValue(), 'Unsaved second plot');
    await button('Reset').click(); await button('Cancel').click(); assert.deepEqual(await portable(), before);
  });
  await check('Edit plot keeps its target across data re-entry and commits the replacement atomically', async () => {
    const before = await portable(); await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Edit plot', exact: true }).click();
    await button('Reset').click(); await enter(data.replaceAll('Treatment', 'New group'), 'Replacement draft'); await button('Back').click(); await button('Continue to plot').click(); await button('Apply').click(); await saved();
    const after = await portable(); assert.equal(after.objects.length, 1); assert.equal(after.objects[0].id, before.objects[0].id); assert.equal(after.datasets.length, 2); assert.deepEqual(after.datasets[0], before.datasets[0]); assert.equal(after.objects[0].plot.datasetId, after.datasets[1].id);
    await page.getByTestId('undo').click(); await saved(); const undone = await portable(); assert.deepEqual(undone.datasets, before.datasets); assert.deepEqual(undone.objects, before.objects);
  });
  await check('Keyboard focus remains in the dialog and returns to Insert plot after Escape', async () => {
    await page.getByTestId('insert-plot').click(); await button('Reset').click(); await button('Import data').click(); await field('Dataset name').focus();
    for (let index = 0; index < 35; index++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true); }
    await button('Back').click(); await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0); assert.equal(await page.getByTestId('insert-plot').evaluate(element => element === document.activeElement), true);
  });
  await check('Hostile dataset names and cells remain inert text in review and preview', async () => {
    const before = await portable(), hostile = '<img src=x onerror=alert(1)>';
    await page.getByTestId('insert-plot').click(); await button('Reset').click(); await button('Import data').click();
    await field('Paste data').fill('Group\tValue\n' + hostile + '\t1\n' + hostile + '\t2\nB\t3\nB\t4'); await field('Dataset name').fill(hostile);
    await dialog.getByRole('grid').waitFor(); assert.equal(await dialog.locator('img, script, iframe, object').count(), 0);
    await button('Continue to plot').click(); await dialog.locator('.plot-preview').waitFor(); assert.equal(await dialog.locator('img, script, iframe, object').count(), 0); assert.ok((await dialog.locator('.plot-preview').textContent()).includes(hostile));
    await button('Reset').click(); await button('Cancel').click(); assert.deepEqual(await portable(), before);
  });
  await check('Oversized local files are rejected before reading and reset recovers the import form', async () => {
    await page.getByTestId('insert-plot').click(); await button('Reset').click(); await button('Import data').click();
    await page.evaluate(() => { const original = File.prototype.arrayBuffer; window.plotReads = 0; File.prototype.arrayBuffer = function () { window.plotReads++; return original.call(this); }; window.restorePlotFile = () => { File.prototype.arrayBuffer = original; }; });
    await dialog.locator('input[type=file]').setInputFiles({name:'oversize.csv',mimeType:'text/csv',buffer:Buffer.alloc(5_000_001, 65)});
    await dialog.getByRole('alert').filter({hasText:'byte limit'}).waitFor(); assert.equal(await page.evaluate(() => window.plotReads), 0); await page.evaluate(() => window.restorePlotFile());
    await button('Reset').click(); await button('Import data').click(); assert.equal(await dialog.getByRole('alert').count(), 0); assert.equal(await field('Paste data').inputValue(), ''); await button('Cancel').click();
  });
  await check('Light, dark, desktop and narrow layouts keep navigation visible without horizontal overflow', async () => {
    await page.getByTestId('insert-plot').click();
    for (const [width, height, theme] of [[1440,1000,'light'], [900,700,'light'], [390,844,'light'], [390,844,'dark'], [1440,1000,'dark']]) {
      await page.setViewportSize({width,height}); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const bounds = await dialog.boundingBox(), footer = await dialog.locator('footer').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1); assert.ok(footer.y >= 0 && footer.y + footer.height <= height);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await page.screenshot({path:directory + `/design-${width}-${theme}.png`});
    }
    await button('Back').click(); await button('Import data').click(); await field('Paste data').fill(data); await dialog.getByRole('grid').waitFor(); await page.screenshot({path:directory + '/02-review-dark.png'});
    await page.setViewportSize({width:1440,height:1000}); await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await page.screenshot({path:directory + '/02-review-light.png'});
    await button('Cancel').click();
  });
  await check('French navigation and reset are localized', async () => {
    const project = await portable(); project.settings.locale = 'fr'; await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'fr.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
    await page.locator('.app-shell:not([inert])').waitFor(); await page.getByTestId('insert-plot').click(); await button('Réinitialiser').click(); await button('Importer des données').click();
    assert.equal(await button('Retour').count(), 1); assert.equal(await button('Continuer vers le graphique').isDisabled(), true); assert.doesNotMatch(await dialog.innerText(), /\bReset\b|Draft cleared|Review data/);
    await button('Réinitialiser').click(); await dialog.getByRole('status').filter({hasText:'Brouillon effacé'}).waitFor(); await button('Annuler').click();
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ build: createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'), results, errors, external }, null, 2)); await browser.close();
}
console.log(`${results.filter(result => result.pass).length}/${results.length} checks passed`);
if (results.some(result => !result.pass) || errors.length || external.length) process.exitCode = 1;
