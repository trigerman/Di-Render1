import './register-source.mjs';
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import('../app/node_modules/playwright/index.mjs');
const { dataFixture, fixtureSpec, plotObject, analysisConfig } = await import('./data-helpers.mjs');
const { dataText: d, messages } = await import('../app/src/i18n/messages.ts');
const base = 'http://127.0.0.1:' + (process.env.OPENRENDER_PORT ?? 4173), directory = 'reports/data-acceptance';
await mkdir(directory, {recursive:true});
const browser = await chromium.launch({headless:true}), context = await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true});
await context.grantPermissions(['clipboard-read','clipboard-write']);
const page = await context.newPage(), errors = [], external = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).origin !== base && !/^(blob:|data:)/.test(request.url())) external.push(request.url()); });
await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
page.setDefaultTimeout(15000);
const saved = async () => { await page.locator('.app-shell:not([inert])').waitFor(); await page.getByText(new RegExp('^(' + messages.en.savedLocally + '|' + messages.fr.savedLocally + ')$')).waitFor(); };
const download = async (id, filename) => { const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]); const path=directory+'/'+filename; await file.saveAs(path); return readFile(path); };
const portable = async () => JSON.parse(await download('save-project','current.obf.json'));
const open = async project => { await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'acceptance.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.getByText('Project opened',{exact:true}).waitFor();await saved(); };
const selectPlot = async () => { await page.getByRole('tab',{name:/^Layers/}).click(); await page.locator('.layer-main').first().click(); await page.getByRole('tab',{name:'Style',exact:true}).click(); };
const sizes = svg => page.evaluate(value => {
  const parsed = new DOMParser().parseFromString(value,'image/svg+xml').documentElement, element=document.importNode(parsed,true);
  element.style.position='absolute';element.style.opacity='0';element.style.width=element.viewBox.baseVal.width+'px';element.style.height=element.viewBox.baseVal.height+'px';document.body.append(element);
  const sizes=[...element.querySelectorAll('text')].map(text=> {const matrix=text.getCTM();return Math.round(parseFloat(getComputedStyle(text).fontSize)*Math.hypot(matrix.a,matrix.b)*1000)/1000;}).sort((a,b)=>a-b); element.remove();return sizes;
},svg);
const check = async (name, run) => { try {await run();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.message});console.error('FAIL '+name+' '+error.message);await page.screenshot({path:directory+'/failure-'+results.length+'.png'});await page.keyboard.press('Escape');} };
try {
  await page.goto(base);await page.getByRole('button',{name:'New figure',exact:true}).click();await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
  const fixture=dataFixture(), spec=fixtureSpec(fixture.dataset,'box');spec.analysis=analysisConfig();
  await check('resize preserves rendered font sizes; undo/redo restore the saved frame', async () => {
    await open({...fixture.project,objects:[plotObject(spec)]});await selectPlot();const initial=await portable(), before=(await download('export-svg','before.svg')).toString();
    await page.getByLabel('W',{exact:true}).fill('700');await page.getByLabel('W',{exact:true}).press('Enter');await saved();const resized=await portable();assert.ok(resized.objects[0].scaleX>1.3);const afterSizes=await sizes((await download('export-svg','resized.svg')).toString()), beforeSizes=await sizes(before);assert.equal(afterSizes.length,beforeSizes.length);afterSizes.forEach((size,index)=>assert.ok(Math.abs(size-beforeSizes[index])<.01));
    await page.getByTestId('undo').click();await saved();assert.equal((await portable()).objects[0].scaleX,initial.objects[0].scaleX);await page.getByTestId('redo').click();await saved();assert.equal((await portable()).objects[0].scaleX,resized.objects[0].scaleX);
  });
  await check('nested rotated nonuniform groups keep plot fonts and save/reload identical vectors', async () => {
    const child=plotObject(spec);child.x=0;child.y=0;child.angle=30;
    const group={...plotObject(spec,'group-test'),kind:'group',children:[child],scaleX:1.4,scaleY:.8,angle:25};delete group.plot;
    await open({...fixture.project,objects:[group]});const svg=(await download('export-svg','group.svg')).toString();const rendered=await sizes(svg);assert.ok(rendered.every(size=>Math.abs(size-12)<.01 || Math.abs(size-14)<.01),JSON.stringify(rendered));await page.reload();await saved();assert.equal((await download('export-svg','group-reload.svg')).toString(),svg);
  });
  await check('dataset cache separates equal sources with different overrides; replacing and undoing restores the error frame', async () => {
    const second=structuredClone(fixture.dataset);second.id='dataset-22222222-2222-4222-8222-222222222222';second.name='Category override';second.columns[2].type='category';const secondSpec=structuredClone(spec);secondSpec.datasetId=second.id;
    await open({...fixture.project,datasets:[fixture.dataset,second],objects:[plotObject(spec,'first'),plotObject(secondSpec,'second')]});assert.match((await download('export-svg','different-overrides.svg')).toString(),/mapped column/);
    await page.getByRole('tab',{name:'Data',exact:true}).click();const row=page.locator('.data-row').filter({has:page.getByRole('textbox',{name:'Rename Category override',exact:true})});await row.getByRole('button',{name:'Replace data',exact:true}).click();await page.getByRole('dialog').locator('.data-column-types select').nth(2).selectOption('number');await page.getByRole('dialog').getByRole('button',{name:'Replace data',exact:true}).click();await saved();assert.doesNotMatch((await download('export-svg','override-repaired.svg')).toString(),/mapped column/);
    await page.getByTestId('undo').click();await saved();assert.match((await download('export-svg','override-undo.svg')).toString(),/mapped column/);
  });
  await check('ambiguity confirmation, virtual grid keyboard navigation, cancellation and focus return', async () => {
    await page.getByRole('tab',{name:'Data',exact:true}).click();await page.getByRole('button',{name:'Import data',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Paste data',{exact:true}).fill('Group\tValue\nA\t1,234\nB\t2,345');await dialog.getByLabel('I confirm this number policy',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Add dataset',exact:true}).isDisabled(),true);
    await dialog.locator('[data-cell="0,0"]').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement.dataset.cell==='0,1');await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement.dataset.cell==='1,1');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('button',{name:'Import data',exact:true}).evaluate(element=>element===document.activeElement),true);
  });
  await check('French import and plot controls, errors and result headers are localized', async () => {
    const french={...fixture.project,settings:{...fixture.project.settings,locale:'fr'},objects:[plotObject(spec)]};await open(french);await page.getByTestId('insert-plot').click();const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:d('fr','createPlot'),exact:true}).waitFor();await dialog.getByLabel(d('fr','test'),{exact:true}).selectOption('kruskal-wallis');await dialog.getByRole('alert').filter({hasText:d('fr','For two groups, select a two-group test explicitly.')}).waitFor();await dialog.getByRole('button',{name:d('fr','close'),exact:true}).click();
    await page.getByRole('tab',{name:d('fr','data'),exact:true}).click();await page.getByRole('button',{name:d('fr','importData'),exact:true}).click();await page.getByRole('dialog').getByLabel(d('fr','pasteData'),{exact:true}).fill('Groupe\tValeur\nA\t1\nB\t2');await page.getByRole('grid',{name:d('fr','tablePreview'),exact:true}).waitFor();assert.doesNotMatch(await page.getByRole('dialog').innerText(),/\uFFFD/);await page.keyboard.press('Escape');
  });
  await check('local file worker decodes UTF-16, requires explicit legacy encoding, and preserves original text under safe names', async () => {
    await open({...fixture.project,datasets:[],dataSources:[],objects:[]});await page.getByRole('tab',{name:'Data',exact:true}).click();await page.getByRole('button',{name:'Import data',exact:true}).click();
    let dialog=page.getByRole('dialog');await dialog.locator('input[type=file]').setInputFiles({name:'CON.csv',mimeType:'text/plain',buffer:Buffer.from('\ufeffGroup\tValue\nA\t1\nB\t2','utf16le')});await dialog.getByRole('grid').waitFor();await dialog.getByRole('button',{name:'Add dataset',exact:true}).click();await saved();
    let pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download original',exact:true}).click();let file=await pending;assert.match(file.suggestedFilename(),/^CON[-_].*\.csv$/i);await file.saveAs(directory+'/utf16-original.csv');assert.equal(await readFile(directory+'/utf16-original.csv','utf8'),'Group\tValue\nA\t1\nB\t2');assert.equal((await portable()).datasets[0].origin.encoding,'utf-16le');
    await page.getByRole('button',{name:'Import data',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('input[type=file]').setInputFiles({name:'notes.html',mimeType:'text/plain',buffer:Buffer.from('Group,Value\ncaf\xe9,2\nB,3','latin1')});await dialog.getByRole('alert').filter({hasText:'not valid Unicode'}).waitFor();await dialog.getByRole('button',{name:d('en','windows1252'),exact:true}).click();await dialog.getByRole('grid').waitFor();await dialog.getByRole('button',{name:'Add dataset',exact:true}).click();await saved();assert.equal((await portable()).datasets.at(-1).origin.encoding,'windows-1252');
    pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download original',exact:true}).last().click();file=await pending;assert.match(file.suggestedFilename(),/\.txt$/);assert.doesNotMatch(file.suggestedFilename(),/\.html$/);
  });
  await check('a plot edit over the shared figure budget leaves the last valid figure unchanged', async () => {
    const dense=dataFixture('Group,Y,X\n'+Array.from({length:500},(_,index)=>`${index%2?'B':'A'},${index%100},${index}`).join('\n'));
    const scatter=fixtureSpec(dense.dataset,'scatter');scatter.roles={x:'c2',y:'c1'};scatter.error='none';const bar=fixtureSpec(dense.dataset,'bar');bar.roles={x:'c0',y:'c1'};bar.error='none';
    await open({...dense.project,objects:[plotObject(scatter,'scatter-one'),plotObject(scatter,'scatter-two'),plotObject(bar,'budget-bar')]});await selectPlot();const before=await portable();await page.getByRole('button',{name:'Edit plot',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel(d('en','showPoints'),{exact:true}).check();await dialog.getByRole('button',{name:'Apply',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'plot export budget'}).waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await saved();assert.deepEqual((await portable()).objects,before.objects);
  });
  await check('duplicate portable mappings and oversized live previews are rejected without changing the figure', async () => {
    const before = await portable(), invalid = { ...fixture.project, objects: [plotObject(spec)] };
    invalid.objects[0].plot.layout = 'wide'; invalid.objects[0].plot.roles = { x: 'c0', replicates: Array(500).fill('c2') };
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({ name: 'duplicate-mappings.obf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.getByRole('status').filter({ hasText: /Unsupported data or settings|project.*unsupported/i }).waitFor();
    assert.deepEqual(await portable(), before);
    const dense = dataFixture('X,Y\n' + Array.from({ length: 1500 }, (_, index) => `${index},${index % 100}`).join('\n'));
    await open({ ...dense.project, objects: [] }); await page.getByTestId('insert-plot').click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel(d('en', 'plotType'), { exact: true }).selectOption('line');
    await dialog.getByRole('alert').filter({ hasText: /plot export budget/ }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Apply', exact: true }).isDisabled(), true);
    assert.equal(await dialog.locator('.plot-preview line').count(), 0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual((await portable()).objects, []);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
} finally { await writeFile(directory+'/results.json',JSON.stringify({results,errors,external},null,2));await browser.close(); }
if(results.some(result=>!result.pass)||errors.length||external.length)process.exitCode=1;
