import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173);
const directory = 'reports/svg-drag';
const publication = process.env.OPENRENDER_PUBLISHED_BUILD;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = hash(await readFile('app/dist/index.html'));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const results = [], errors = [], external = [];
page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(base + '/') || /^(blob:|data:)/.test(url)) return route.continue();
  external.push(url);
  return route.abort();
});
const saved = () => page.getByText('Saved locally', { exact: true }).waitFor();
const count = async () => Number(await page.getByRole('tab', { name: /^Layers/ }).locator('span').innerText());
const waitCount = expected => page.getByRole('tab', { name: /^Layers/ }).getByText(String(expected), { exact: true }).waitFor();
const download = async (id, name) => {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]);
  await file.saveAs(directory + '/' + name);
  return readFile(directory + '/' + name);
};
const project = async () => JSON.parse(await download('save-project', 'current.obf.json'));
const check = async (name, run) => {
  try { await run(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.stack }); await page.screenshot({ path: directory + '/failure.png' }); throw error; }
};
const drop = async payload => page.locator('.upper-canvas').evaluate((canvas, payload) => {
  const transfer = new DataTransfer();
  if ('id' in payload) transfer.setData('application/x-openbiofigure-asset', payload.id);
  if (payload.url) transfer.setData('text/uri-list', payload.url);
  if (payload.file) {
    const bytes = payload.file.base64 ? Uint8Array.from(atob(payload.file.base64), c => c.charCodeAt(0)) : payload.file.text;
    transfer.items.add(new File([bytes], payload.file.name, { type: payload.file.mime }));
  }
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 210, clientY: rect.top + 160 }));
}, payload);
let assetId;
try {
  await check('Local runtime and published build contain the exact hotfix bytes', async () => {
    assert.equal(hash(await (await page.request.get(base)).body()), build);
    if (publication) {
      let files = 0;
      const compare = async (relative = '') => {
        const local = await readdir('app/dist/' + relative, { withFileTypes: true });
        const published = await readdir(publication + '/' + relative, { withFileTypes: true });
        assert.deepEqual(local.map(f => f.name).sort(), published.map(f => f.name).sort(), relative);
        for (const file of local) {
          if (file.isDirectory()) await compare(relative + file.name + '/');
          else { assert.equal(hash(await readFile('app/dist/' + relative + file.name)), hash(await readFile(publication + '/' + relative + file.name)), relative + file.name); files++; }
        }
      };
      await compare();
      assert.equal(files, 2708);
    }
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'New figure', exact: true }).click();
  await page.getByRole('button', { name: 'Create figure', exact: true }).click();
  await saved();
  await page.getByRole('textbox', { name: 'Search scientific assets' }).fill('Mitochondria');
  const card = page.locator('.asset-card').filter({ has: page.getByText('Mitochondria', { exact: true }) }).first();
  await card.waitFor();
  assetId = await card.getAttribute('data-asset-id');
  await page.evaluate(() => {
    window.dragProbe = [];
    for (const type of ['dragstart', 'drop']) document.addEventListener(type, event => window.dragProbe.push({ type, target: event.target.tagName, types: [...event.dataTransfer.types], id: event.dataTransfer.getData('application/x-openbiofigure-asset') }));
  });
  await check('Native pointer drag from the SVG thumbnail inserts verified artwork at the drop point', async () => {
    assert.equal(await card.locator('img').getAttribute('draggable'), 'false');
    await card.locator('img').dragTo(page.locator('.upper-canvas'), { targetPosition: { x: 210, y: 160 } });
    await waitCount(1); await saved();
    const file = await project();
    assert.equal(file.objects[0].kind, 'svg'); assert.equal(file.objects[0].assetId, assetId);
    assert.equal(file.assets[0].verified, true); assert.equal(file.media.length, 0);
    const scale = await page.locator('.canvas-transform').evaluate(el => Number(el.style.transform.match(/scale\(([^)]+)\)/)[1]));
    assert.ok(Math.abs(file.objects[0].x - 210 / scale) < 3); assert.ok(Math.abs(file.objects[0].y - 160 / scale) < 3);
    const probe = await page.evaluate(() => window.dragProbe);
    assert.ok(probe.some(event => event.type === 'dragstart' && event.id === assetId));
    assert.ok(probe.some(event => event.type === 'drop' && event.id === assetId));
    assert.equal(await page.getByText('Choose a PNG or JPEG image.', { exact: true }).count(), 0);
  });
  await check('Native card-title drag, repeated asset reuse and Undo/Redo work', async () => {
    await card.locator('strong').dragTo(page.locator('.upper-canvas'), { targetPosition: { x: 310, y: 230 } });
    await waitCount(2); await saved();
    assert.equal((await project()).assets.length, 1);
    await page.getByTestId('undo').click(); await waitCount(1); await saved();
    assert.equal((await project()).objects.length, 1);
    await page.getByTestId('redo').click(); await waitCount(2); await saved();
    assert.equal((await project()).objects.length, 2);
  });
  await check('Catalog ID wins over a browser SVG file and an untrusted URL in the same drop', async () => {
    await drop({ id: assetId, url: 'https://untrusted.invalid/thumbnail.svg', file: { name: 'thumbnail.svg', mime: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.injected=true</script></svg>' } });
    await waitCount(3); await saved();
    const file = await project();
    assert.equal(file.objects.at(-1).kind, 'svg'); assert.equal(file.assets.length, 1); assert.equal(file.media.length, 0);
    assert.equal(file.assets[0].verified, true); assert.doesNotMatch(file.assets[0].svg, /window.injected|<script/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.getByText('Choose a PNG or JPEG image.', { exact: true }).count(), 0);
  });
  await check('External PNG and JPEG file drops still create image objects', async () => {
    for (const mime of ['image/png', 'image/jpeg']) {
      const base64 = await page.evaluate(mime => { const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cc2244'; ctx.fillRect(0, 0, 16, 12); return canvas.toDataURL(mime).split(',')[1]; }, mime);
      const before = await count();
      await drop({ file: { name: mime.endsWith('png') ? 'drop.png' : 'drop.jpg', mime, base64 } });
      await waitCount(before + 1); await saved();
      const file = await project(); assert.equal(file.objects.at(-1).kind, 'image'); assert.equal(file.media.at(-1).mimeType, mime);
    }
  });
  await check('Unknown or empty catalog IDs and URL-only drops cannot import arbitrary artwork', async () => {
    const before = await project();
    for (const payload of [{ id: 'not-in-catalog' }, { id: '' }, { url: 'https://untrusted.invalid/file.svg' }, { id: 'not-in-catalog', file: { name: 'spoof.svg', mime: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }]) {
      await drop(payload);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual((await project()).objects, before.objects);
    }
  });
  await check('External SVG files remain outside raster import and do not modify the figure', async () => {
    const before = await project();
    await drop({ file: { name: 'external.svg', mime: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' } });
    await page.getByText('Choose a PNG or JPEG image.', { exact: true }).waitFor();
    const after = await project(); assert.deepEqual(after.objects, before.objects); assert.deepEqual(after.assets, before.assets);
  });
  await check('Dragged artwork survives autosave, reload, portable reopen and SVG/PNG exports', async () => {
    await saved(); const before = await project();
    await page.reload(); await page.getByTestId('workspace').waitFor(); await saved();
    const restored = await project(); assert.deepEqual(restored.objects, before.objects); assert.deepEqual(restored.assets, before.assets);
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'dragged.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) });
    await page.getByText('Project opened', { exact: true }).waitFor(); await saved();
    assert.deepEqual((await project()).objects, before.objects);
    const svg = (await download('export-svg', 'dragged.svg')).toString(); assert.match(svg, /Mitochondria/); assert.doesNotMatch(svg, /<script|window.injected|untrusted.invalid/);
    assert.ok((await download('export-png', 'dragged.png')).length > 1000);
    await page.screenshot({ path: directory + '/verified-drag.png', fullPage: true });
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally {
  await writeFile(directory + '/results.json', JSON.stringify({ build, publication, browser: browser.version(), results, errors, external }, null, 2) + '\n');
  await browser.close();
}
console.log(`${results.length}/${results.length} checks passed`);
