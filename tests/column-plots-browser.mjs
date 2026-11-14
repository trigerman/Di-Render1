import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173), directory = 'reports/column-plots';
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
const dialog = page.getByRole('dialog'), field = name => dialog.getByLabel(name, { exact: true }), button = name => dialog.getByRole('button', { name, exact: true });
const saved = async () => { await page.locator('.app-shell:not([inert])').waitFor(); await page.getByText('Saved locally', { exact: true }).waitFor(); };
const ready = async () => { await button('Apply').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.plot-workflow button')].some(button => button.textContent.trim() === 'Apply' && !button.disabled)); };
const summary = () => dialog.getByRole('region', { name: 'Column summaries' });
const rows = async () => summary().locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
const portable = async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-project').click()]);
  const path = directory + '/current.obf.json'; await download.saveAs(path); return JSON.parse(await readFile(path, 'utf8'));
};
const check = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); await page.screenshot({ path: directory + '/failure-' + results.length + '.png' }); throw error; }
};
let committed;
try {
  await page.goto(base); await page.getByRole('button', { name: 'New figure', exact: true }).click(); await page.getByRole('button', { name: 'Create figure', exact: true }).click(); await saved();
  await check('Column names on X creates mean bars with independent sample sizes and no inferred statistical test', async () => {
    await page.getByTestId('insert-plot').click(); await button('Import data').click();
    await field('Paste data').fill('ID\tControl\tTreatment\tUnused\na\tNA\t0\t900\nb\t2\t6\t901\nc\t4\t12\t902');
    await field('Dataset name').fill('Column means'); await button('Continue to plot').click();
    await field('Data arrangement').selectOption('rows'); await field('Data arrangement').selectOption('columns'); await dialog.getByRole('group', { name: 'Value columns', exact: true }).getByLabel('Unused', { exact: true }).uncheck(); await ready();
    assert.equal(await field('Plot type').inputValue(), 'bar'); assert.equal(await field('Aggregate').inputValue(), 'mean'); assert.equal(await field('Error bars').inputValue(), 'sd'); assert.equal(await field('Statistical test').inputValue(), '');
    assert.equal(await field('X / group').count(), 0); assert.equal(await dialog.getByRole('group', { name: 'Value columns', exact: true }).getByLabel('ID', { exact: true }).count(), 0);
    assert.deepEqual(await rows(), [['Control', '2', '3'], ['Treatment', '3', '6']]);
    assert.ok((await dialog.locator('.plot-preview').textContent()).includes('Control'));
    assert.ok((await dialog.locator('.plot-preview').textContent()).includes('Treatment'));
    await page.screenshot({ path: directory + '/mean-bars.png' });
  });
  await check('Column selection, missing values and means survive Back and a return from Review data', async () => {
    await button('Back').click(); assert.ok((await field('Paste data').inputValue()).includes('NA')); await button('Continue to plot').click(); await ready();
    assert.equal(await field('Data arrangement').inputValue(), 'columns'); assert.deepEqual(await rows(), [['Control', '2', '3'], ['Treatment', '3', '6']]);
    const columns = dialog.getByRole('group', { name: 'Value columns', exact: true }); await columns.getByLabel('Control', { exact: true }).uncheck(); await columns.getByLabel('Treatment', { exact: true }).uncheck();
    await dialog.getByRole('alert').filter({ hasText: 'Choose at least one value column' }).waitFor(); assert.equal(await button('Apply').isDisabled(), true);
    await columns.getByLabel('Treatment', { exact: true }).check(); await columns.getByLabel('Control', { exact: true }).check(); await ready();
    assert.deepEqual(await rows(), [['Control', '2', '3'], ['Treatment', '3', '6']]);
  });
  await check('Line and area means use distinct header positions; changing style preserves column selection', async () => {
    for (const type of ['line', 'area', 'dot-bar', 'dot-column', 'box', 'violin', 'bar']) {
      await field('Plot type').selectOption(type); await ready(); assert.equal(await field('Data arrangement').inputValue(), 'columns');
      assert.deepEqual(await rows(), [['Control', '2', '3'], ['Treatment', '3', '6']]);
      if (type === 'line' || type === 'area') {
        const labels = await dialog.locator('.plot-preview text').evaluateAll(nodes => nodes.filter(node => ['Control', 'Treatment'].includes(node.textContent)).map(node => ({ text: node.textContent, x: Number(node.getAttribute('x')) })));
        const control = labels.find(label => label.text === 'Control'), treatment = labels.find(label => label.text === 'Treatment'); assert.ok(control.x < treatment.x);
      }
    }
  });
  await check('Apply, Undo/Redo, reload and portable import preserve the selected column means', async () => {
    await button('Apply').click(); await saved(); committed = await portable(); const plot = committed.objects.find(object => object.kind === 'plot');
    assert.equal(plot.plot.layout, 'wide'); assert.deepEqual(plot.plot.roles, { values: ['c1', 'c2'] }); assert.equal(plot.plot.aggregate, 'mean');
    const [svgFile] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]); await svgFile.saveAs(directory + '/column-means.svg');
    const svg = await readFile(directory + '/column-means.svg', 'utf8'); assert.match(svg, /Control/); assert.match(svg, /Treatment/); assert.doesNotMatch(svg, /Unused|<script|NaN|Infinity/);
    await page.getByTestId('undo').click(); await saved(); assert.equal((await portable()).datasets.length, 0);
    await page.getByTestId('redo').click(); await saved(); await page.reload(); await saved(); assert.deepEqual((await portable()).objects, committed.objects);
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'columns.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(committed)) }); await saved();
    await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Edit plot', exact: true }).click(); await ready();
    assert.deepEqual(await rows(), [['Control', '2', '3'], ['Treatment', '3', '6']]);
  });
  await check('A numeric-X plot leaves column mode cleanly and the column-mean action restores a valid chart', async () => {
    await field('Plot type').selectOption('scatter'); assert.equal(await field('Data arrangement').inputValue(), 'rows');
    await field('X / group').selectOption('c1'); await field('Y / measure').selectOption('c2'); await ready();
    await dialog.getByRole('button', { name: /^Plot column means/ }).click(); await ready(); assert.equal(await field('Plot type').inputValue(), 'bar'); assert.equal(await field('Data arrangement').inputValue(), 'columns');
    assert.equal((await rows()).length, 3); await button('Cancel').click(); assert.deepEqual((await portable()).objects, committed.objects);
  });
  await check('Column-header markup is inert and stays escaped in preview and summaries', async () => {
    await page.getByTestId('insert-plot').click(); await button('Reset').click(); await button('Import data').click();
    await field('Paste data').fill('<img src=x onerror=alert(1)>\tSafe\n1\t2\n3\t4'); await button('Continue to plot').click(); await field('Data arrangement').selectOption('columns'); await ready();
    assert.equal(await dialog.locator('img, script, iframe, object').count(), 0); assert.ok((await rows())[0][0].includes('<img')); assert.equal(external.length, 0); await button('Cancel').click();
  });
  await check('Column means remain usable on narrow screens and French labels are localized', async () => {
    await page.getByRole('button', { name: 'Edit plot', exact: true }).click(); await ready();
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true); await summary().scrollIntoViewIfNeeded(); await page.screenshot({ path: directory + '/mean-bars-mobile.png' });
    await button('Cancel').click(); await page.setViewportSize({ width: 1440, height: 1000 });
    const project = structuredClone(committed); project.settings.locale = 'fr'; await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'fr.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) }); await page.locator('.app-shell:not([inert])').waitFor();
    await page.getByRole('tab', { name: /^Calques/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Modifier le graphique', exact: true }).click();
    await dialog.getByRole('region', { name: 'Résumé des colonnes' }).waitFor(); assert.equal(await field('Disposition des données').inputValue(), 'columns'); assert.doesNotMatch(await dialog.innerText(), /Column summaries|Column names on X|Plot column means/); await button('Annuler').click();
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ build: createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'), results, errors, external }, null, 2)); await browser.close();
}
console.log(`${results.filter(result => result.pass).length}/${results.length} checks passed`);
if (results.some(result => !result.pass) || errors.length || external.length) process.exitCode = 1;
