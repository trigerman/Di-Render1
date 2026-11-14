import './register-source.mjs';
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { dataFixture, fixtureSpec, plotObject } = await import('./data-helpers.mjs');
const { PLOT_TYPES } = await import('../app/src/domain/plots/spec.ts');
const { sanitizeSvg } = await import('../app/src/domain/assets/sanitize.ts');
const { chromium } = await import(process.env.OPENRENDER_PLAYWRIGHT_MODULE ?? '../app/node_modules/playwright/index.mjs');
const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173), directory = 'reports/data-plots';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.OPENRENDER_BROWSER_EXECUTABLE ? { executablePath: process.env.OPENRENDER_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true }), page = await context.newPage();
await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
const errors = [], external = [], results = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith(base) && !/^(blob:|data:)/.test(request.url())) external.push(request.url()); });
await context.grantPermissions(['clipboard-read','clipboard-write']);
page.setDefaultTimeout(12000);
const saved = async () => {
  await page.locator('.app-shell:not([inert])').waitFor();
  await page.getByText('Saved locally', { exact: true }).waitFor();
};
const download = async (id, name) => { const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]), path = directory + '/' + name; await file.saveAs(path); return readFile(path); };
const projectFile = async () => JSON.parse(await download('save-project', 'current.obf.json'));
const open = async project => { await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'plot.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) }); await page.getByText('Project opened', { exact: true }).waitFor(); await saved(); };
const check = async (name, run) => { const start = Date.now(); try { await run(); results.push({ name, pass: true, ms: Date.now() - start }); console.log('PASS ' + name); } catch (error) { results.push({ name, pass: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); await page.screenshot({ path: directory + '/failure-' + results.length + '.png' }); await page.keyboard.press('Escape'); } };
try {
  await page.goto(base); await page.getByRole('button', { name: 'New figure', exact: true }).click(); await page.getByRole('button', { name: 'Create figure', exact: true }).click(); await saved();
  await check('visible Insert plot; paste import, box, Kruskal-Wallis/Dunn/Holm, autosave and reload', async () => {
    await page.getByTestId('insert-plot').click(); const plot = page.getByRole('dialog'); await plot.getByRole('button', { name: 'Import data', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('Paste data', { exact: true }).fill('Group\tValue\nA\t1\nA\t2\nA\t3\nB\t4\nB\t5\nB\t6\nC\t7\nC\t8\nC\t9');
    await dialog.getByLabel('Dataset name', { exact: true }).fill('Browser measurements'); await dialog.getByRole('button', { name: 'Continue to plot', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Plot type', { exact: false }).selectOption('box'); await page.getByRole('dialog').getByLabel('Statistical test', { exact: false }).selectOption('kruskal-wallis');
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await saved(); const project = await projectFile(); assert.equal(project.datasets.length, 1); assert.equal(project.objects[0].kind, 'plot'); assert.equal(project.objects[0].plot.result.familySize, 3); assert.equal(project.objects[0].plot.result.global.test, 'Kruskal–Wallis');
    const before = (await download('export-svg', 'box-before.svg')).toString(); await page.reload(); await page.getByTestId('workspace').waitFor(); await saved(); assert.equal((await download('export-svg', 'box-reload.svg')).toString(), before);
  });
  await check('Figures tab and portable files preserve data-backed plots', async () => {
    const before = await projectFile(); await page.getByRole('tab', { name: /^Figures/ }).click(); await page.locator('.figure-row-open').first().click(); await saved(); const after = await projectFile(); assert.deepEqual(after.datasets, before.datasets);
    await open(before); assert.equal((await projectFile()).objects[0].plot.result.fingerprint, before.objects[0].plot.result.fingerprint);
  });
  await check('replace data with missing measure opens an error frame; undo and repair work', async () => {
    await page.getByRole('tab', { name: 'Data', exact: true }).click(); await page.getByRole('button', { name: 'Replace data', exact: true }).click(); await page.getByRole('dialog').getByLabel('Paste data', { exact: true }).fill('Group\tRenamed\nA\t1\nB\t2\nC\t3'); await page.getByRole('dialog').getByRole('button', { name: 'Replace data', exact: true }).click(); await saved();
    const broken = await projectFile(); assert.equal(broken.objects[0].plot.roles.y, 'c999999'); assert.match((await download('export-svg', 'mapping-error.svg')).toString(), /mapped column/);
    await page.getByTestId('undo').click(); await saved(); assert.equal((await projectFile()).objects[0].plot.roles.y, 'c1'); await page.getByTestId('redo').click(); await saved();
    await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByRole('button', { name: 'Edit plot', exact: true }).click(); await page.getByRole('dialog').getByLabel('Y / measure', { exact: false }).selectOption('c1'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await saved(); assert.equal((await projectFile()).objects[0].plot.roles.y, 'c1');
  });
  const fixture = dataFixture();
  for (const type of PLOT_TYPES) await check(type + ' native canvas, SVG, PNG and vector PDF exports at normal and high zoom', async () => {
    const spec = fixtureSpec(fixture.dataset, type), project = { ...fixture.project, objects: [plotObject(spec)] }; project.metadata.title = type + ' export'; await open(project);
    await page.getByRole('button', { name: /Fit to screen/ }).click();
    const file = await projectFile(); assert.equal(file.objects[0].kind, 'plot'); assert.equal(file.objects[0].plot.type, type); assert.equal('children' in file.objects[0], false);
    const svg = (await download('export-svg', type + '.svg')).toString(); sanitizeSvg(svg); assert.doesNotMatch(svg, /<script|<image|(?:href|src)="https?:/);
    const png = await download('export-png', type + '.png'); assert.ok(png.length > 10000); assert.equal(png.readUInt32BE(16), project.document.width * 2);
    await page.evaluate(() => { window.print = () => {}; }); await page.getByTestId('export-pdf').click(); await page.locator('#publication-print svg').waitFor({ state: 'attached' }); await page.pdf({ path: directory + '/' + type + '.pdf', printBackground: true, preferCSSPageSize: true }); const pdf = await readFile(directory + '/' + type + '.pdf'); assert.match(pdf.toString('latin1'), /^%PDF/); assert.doesNotMatch(pdf.toString('latin1'), /\/JavaScript|\/Launch|\/URI/);
    const canvasShot = async name => {
      const bounds = await page.locator('canvas.lower-canvas').boundingBox(), scale = bounds.width / project.document.width;
      await page.screenshot({ path: directory + '/' + name, clip: { x: bounds.x + 140 * scale, y: bounds.y + 110 * scale, width: 520 * scale, height: 380 * scale } });
    };
    await canvasShot(type + '-canvas.png');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); assert.equal((await download('export-svg', type + '-zoom.svg')).toString(), svg); assert.deepEqual(await download('export-png', type + '-zoom.png'), png); await page.getByTestId('export-pdf').click(); await page.locator('#publication-print svg').waitFor({state:'attached'}); await page.pdf({path: directory + '/' + type + '-zoom.pdf',printBackground:true,preferCSSPageSize:true});
    await canvasShot(type + '-canvas-zoom.png');
  });
  await check('stored result tampering is recomputed everywhere and produces an explicit notice', async () => {
    const current = await projectFile(), spec = fixtureSpec(fixture.dataset, 'bar'); spec.analysis = { test: 'welch', pairing: 'id', comparisons: 'all', control: null, adjustment: 'holm', alpha: .05, useAdjusted: true, label: 'stars', hideNs: false }; const initial = { ...fixture.project, objects: [plotObject(spec)] }; await open(initial); const stored = await projectFile(); const comparison = stored.objects[0].plot.result.comparisons[0]; comparison.result.p = comparison.adjustedP = comparison.selectedP = 1e-100; comparison.significant = true; comparison.label = '****'; await open(stored);
    await page.getByRole('tab', { name: /^Layers/ }).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab', { name: 'Style', exact: true }).click(); await page.getByText('Statistics were recomputed from the source data.', { exact: true }).waitFor(); const after = await projectFile(); assert.ok(after.objects[0].plot.result.comparisons[0].result.p > 1e-10); assert.doesNotMatch((await download('export-svg', 'tampered-recomputed.svg')).toString(), />\*\*\*\*</); const [statisticsFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button',{name:'Download statistics (CSV)',exact:true}).click()]); await statisticsFile.saveAs(directory+'/current-statistics.csv'); const csv=await readFile(directory+'/current-statistics.csv','utf8'); assert.ok(csv.includes(String(after.objects[0].plot.result.comparisons[0].result.p))); await page.getByRole('button',{name:'Copy table',exact:true}).click(); await page.getByText('Table copied',{exact:true}).waitFor(); assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes(String(after.objects[0].plot.result.comparisons[0].result.p))); await open(current);
  });
  await check('malformed Unicode, content hashes and excess plot budgets leave the current figure intact', async () => {
    const before = await projectFile(); for (const transform of [project => { project.dataSources[0].content += 'tampered'; }, project => { project.dataSources[0].content = '\ud800'; }, project => { project.objects = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(project.objects[0]), id: 'overflow-' + index })); }]) {
      const damaged = structuredClone(before); transform(damaged); await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'damaged.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(damaged)) }); await page.getByRole('status').filter({ hasText: /fingerprint|Unicode|unsupported|budget/ }).waitFor(); assert.equal((await projectFile()).metadata.id, before.metadata.id);
    }
  });
  await check('all app, worker, artwork and font requests remain local', async () => { assert.deepEqual(external, []); assert.deepEqual(errors, []); });
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ build: createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'), results, errors, external }, null, 2)); await browser.close();
}
console.log(`${results.filter(value => value.pass).length}/${results.length} checks passed`); if (results.some(value => !value.pass) || errors.length || external.length) process.exitCode = 1;
