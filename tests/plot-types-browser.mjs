import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173), directory = 'reports/plot-types';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage(), results = [], errors = [], external = [];
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = route.request().url(); if (new URL(url).origin === base || /^(blob:|data:)/.test(url)) return route.continue();
  external.push(url); return route.abort();
});
const dialog = page.getByRole('dialog'), picker = () => dialog.getByRole('region', { name: 'Suggested types (choose explicitly)' });
const field = name => dialog.getByLabel(name, { exact: true }), button = name => dialog.getByRole('button', { name, exact: true });
const saved = async () => { await page.locator('.app-shell:not([inert])').waitFor(); await page.getByText('Saved locally', { exact: true }).waitFor(); };
const ready = async () => page.waitForFunction(() => [...document.querySelectorAll('.plot-workflow button')].some(button => button.textContent.trim() === 'Apply' && !button.disabled));
const portable = async () => {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-project').click()]); await file.saveAs(directory + '/current.obf.json'); return JSON.parse(await readFile(directory + '/current.obf.json', 'utf8'));
};
const bars = async () => dialog.locator('.plot-preview rect').evaluateAll(nodes => nodes.filter(node => node.getAttribute('fill') !== '#FFFFFF' && Number(node.getAttribute('width')) > 8).map(node => ({ x: Number(node.getAttribute('x')), width: Number(node.getAttribute('width')), fill: node.getAttribute('fill') })));
const text = 'Treatment\tTimepoint\tValue\nControl\tEarly\t1\nControl\tEarly\t3\nControl\tLate\t5\nControl\tLate\t7\nDrug\tEarly\t9\nDrug\tEarly\t11\nDrug\tLate\t13\nDrug\tLate\t15';
const check = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.stack }); await page.screenshot({ path: directory + '/failure-' + results.length + '.png' }); throw error; }
};
let committed;
try {
  await page.goto(base); await page.getByRole('button', { name: 'New figure', exact: true }).click(); await page.getByRole('button', { name: 'Create figure', exact: true }).click(); await saved();
  await page.getByTestId('insert-plot').click(); await button('Import data').click(); await field('Paste data').fill(text); await field('Dataset name').fill('Treatment by timepoint'); await button('Continue to plot').click(); await ready();
  await check('Suggested types are visible at the top of the right sidebar and highlight the inferred type before allowing explicit changes', async () => {
    const placement = await picker().evaluate(element => {
      const sidebar = element.closest('.plot-settings'), bounds = element.getBoundingClientRect(), preview = document.querySelector('.plot-live').getBoundingClientRect();
      return { first: sidebar.firstElementChild === element, inMapping: !!element.closest('.plot-mapping'), visible: bounds.y >= 0 && bounds.bottom < window.innerHeight, right: bounds.left > preview.left };
    });
    assert.deepEqual(placement, { first: true, inMapping: false, visible: true, right: true });
    assert.equal(await field('Plot type').inputValue(), 'grouped-bar'); assert.equal(await field('Statistical test').inputValue(), '');
    await picker().getByRole('button', { name: 'Dot plot with cross bar', exact: true }).click(); await ready();
    assert.equal(await field('Plot type').inputValue(), 'dot-bar'); assert.equal((await bars()).length, 0); assert.equal(await dialog.locator('.plot-preview circle').count(), 8);
    assert.equal(await picker().getByRole('button', { name: 'Dot plot with cross bar', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: directory + '/suggested-types.png' });
  });
  await check('Dot plot with bar/column overlays all observations on columns and survives Back, save and reload', async () => {
    await picker().getByRole('button', { name: 'Dot plot with bar/column', exact: true }).click(); await ready();
    assert.equal(await field('Plot type').inputValue(), 'dot-column'); assert.equal((await bars()).length, 2); assert.equal(await dialog.locator('.plot-preview circle').count(), 8);
    await button('Back').click(); await button('Continue to plot').click(); await ready(); assert.equal(await field('Plot type').inputValue(), 'dot-column');
    await page.screenshot({ path: directory + '/dot-column.png' }); await button('Apply').click(); await saved();
    committed = await portable(); assert.equal(committed.objects[0].plot.type, 'dot-column');
    await page.reload(); await saved(); assert.deepEqual((await portable()).objects, committed.objects);
    await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Edit plot', exact: true }).click(); await ready();
    assert.equal(await field('Plot type').inputValue(), 'dot-column'); assert.equal(await dialog.locator('.plot-preview circle').count(), 8);
  });
  await check('Grouped bar uses distinct row factors, clusters four series means under two X labels and keeps series colors consistent', async () => {
    await picker().getByRole('button', { name: 'Grouped bar', exact: true }).click(); await ready();
    assert.equal(await field('Data arrangement').inputValue(), 'rows'); assert.equal(await field('X / group').inputValue(), 'c0'); assert.equal(await field('Series / heatmap column key').inputValue(), 'c1'); assert.equal(await field('Y / measure').inputValue(), 'c2');
    const columns = await bars(); assert.equal(columns.length, 4); assert.equal(columns[0].fill, columns[2].fill); assert.equal(columns[1].fill, columns[3].fill); assert.notEqual(columns[0].fill, columns[1].fill);
    assert.ok(columns[1].x - columns[0].x < columns[2].x - columns[1].x);
    assert.deepEqual(await dialog.locator('input[type=color]').evaluateAll(inputs => inputs.map(input => input.value.toUpperCase())), columns.map(column => column.fill.toUpperCase()));
    const labels = await dialog.locator('.plot-preview text').allTextContents(); assert.equal(labels.filter(value => value === 'Control').length, 1); assert.equal(labels.filter(value => value === 'Drug').length, 1); assert.ok(labels.includes('Early') && labels.includes('Late'));
    await page.screenshot({ path: directory + '/grouped-bar.png' });
    await button('Apply').click(); await saved(); const grouped = await portable(); assert.equal(grouped.objects[0].plot.type, 'grouped-bar'); assert.deepEqual(grouped.objects[0].plot.roles, { x: 'c0', series: 'c1', y: 'c2' });
    await page.getByTestId('undo').click(); await saved(); assert.equal((await portable()).objects[0].plot.type, 'dot-column'); await page.getByTestId('redo').click(); await saved(); await page.reload(); await saved(); assert.deepEqual((await portable()).objects, grouped.objects);
    committed = grouped;
    await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Edit plot', exact: true }).click(); await ready();
  });
  await check('Column-header mode is ordinary bars; Grouped bar requires an explicit separate series mapping', async () => {
    await field('Data arrangement').selectOption('columns'); await ready(); assert.equal(await field('Plot type').inputValue(), 'bar');
    await field('Plot type').selectOption('grouped-bar');
    await dialog.getByRole('alert').filter({ hasText: 'Grouped bars require group, series and value columns in row data.' }).waitFor(); assert.equal(await field('Data arrangement').inputValue(), 'rows'); assert.equal(await button('Apply').isDisabled(), true);
    await field('Series / heatmap column key').selectOption('c1'); await ready(); assert.equal((await bars()).length, 4);
    await field('Series / heatmap column key').selectOption('c0'); await dialog.getByRole('alert').filter({ hasText: 'distinct group, series and value' }).waitFor(); assert.equal(await button('Apply').isDisabled(), true);
    await field('Series / heatmap column key').selectOption('c1'); await ready();
  });
  await check('Suggested type cards remain reachable without horizontal overflow in desktop, dark and narrow layouts', async () => {
    for (const [width, height, theme] of [[1440,1000,'dark'],[900,700,'light'],[390,844,'light']]) {
      await page.setViewportSize({ width, height }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await picker().scrollIntoViewIfNeeded();
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      assert.equal(await picker().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await page.screenshot({ path: directory + `/suggestions-${width}-${theme}.png` });
    }
    await page.setViewportSize({ width:1440,height:1000 }); await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await button('Cancel').click();
  });
  await check('French plot labels and grouped-bar mapping errors are localized', async () => {
    const project = structuredClone(committed); project.settings.locale = 'fr';
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name:'fr.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project)) }); await page.locator('.app-shell:not([inert])').waitFor();
    await page.getByRole('tab', { name: /^Calques/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name:'Style', exact:true }).click(); await page.getByRole('button', { name:'Modifier le graphique', exact:true }).click();
    const frenchPicker = dialog.getByRole('region', { name:'Types suggérés (choisir explicitement)' }); await frenchPicker.waitFor();
    assert.equal(await frenchPicker.getByRole('button', { name:'Points avec barre transversale', exact:true }).count(), 1); assert.equal(await frenchPicker.getByRole('button', { name:'Points avec barre / colonne', exact:true }).count(), 1);
    await field('Série / colonne de carte thermique').selectOption(''); await dialog.getByRole('alert').filter({ hasText:'Les barres groupées nécessitent' }).waitFor(); assert.doesNotMatch(await dialog.innerText(), /Suggested types|Grouped bars require|Dot plot with/);
    await button('Annuler').click();
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ build:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'),results,errors,external },null,2)); await browser.close();
}
console.log(`${results.filter(result => result.pass).length}/${results.length} checks passed`);
if (results.some(result => !result.pass) || errors.length || external.length) process.exitCode=1;
