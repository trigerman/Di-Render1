import './register-source.mjs';
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '../app/node_modules/playwright/index.mjs';
const { dataFixture, plotObject } = await import('./data-helpers.mjs');
const { defaultPlotSpec } = await import('../app/src/domain/plots/spec.ts');

const base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173), directory='reports/analysis';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true}), page=await context.newPage();
const errors=[],external=[],results=[];
page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===base||/^(blob:|data:)/.test(url))return route.continue();external.push(url);return route.abort();});
const dialog=page.getByRole('dialog'), field=name=>dialog.getByLabel(name,{exact:true}), button=name=>dialog.getByRole('button',{name,exact:true});
const ready=async()=>page.waitForFunction(()=>[...document.querySelectorAll('.plot-workflow button')].some(b=>b.textContent.trim()==='Apply'&&!b.disabled));
const saved=async()=>{await page.locator('.app-shell:not([inert])').waitFor();await page.getByText('Saved locally',{exact:true}).waitFor();};
const download=async(id,name)=>{const [file]=await Promise.all([page.waitForEvent('download'),page.getByTestId(id).click()]);await file.saveAs(directory+'/'+name);return readFile(directory+'/'+name);};
const portable=async()=>JSON.parse(await download('save-project','current.obf.json'));
const edit=async()=>{await page.getByRole('tab',{name:/^Layers/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Edit plot',exact:true}).click();await ready();};
const open=async project=>{await page.getByText('Project opened',{exact:true}).waitFor({state:'hidden'});await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'analysis.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.getByText('Project opened',{exact:true}).waitFor();await page.locator('.app-shell:not([inert])').waitFor();};
const row=label=>dialog.locator('.plot-comparison-results tbody tr').filter({hasText:label});
const key=name=>JSON.stringify([name,null]);
const choosePair=async(a,b)=>{await field('Group A').selectOption(key(a));await field('Group B').selectOption(key(b));await ready();};
const check=async(name,run)=>{try{await run();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});await page.screenshot({path:directory+'/failure-'+results.length+'.png'});throw error;}};
let committed;
try{
  await page.goto(base);await page.getByRole('button',{name:'New figure',exact:true}).click();await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
  await page.getByTestId('insert-plot').click();await button('Import data').click();await field('Paste data').fill('Group\tValue\tID\nA\t1\ti1\nA\t3\ti2\nA\t4\ti3\nB\t5\ti1\nB\t8\ti2\nB\t10\ti4\nC\t11\ti1\nC\t12\ti2\nC\t16\ti3');await button('Continue to plot').click();await ready();
  await check('Three-group tests wait for explicit pairs; exact pair survives Welch, Student and Mann–Whitney switches',async()=>{
    await field('Statistical test').selectOption('welch');await ready();assert.equal(await field('Comparison family').inputValue(),'selected');assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),0);
    await choosePair('A','C');for(const test of ['student','mann-whitney','welch']){await field('Statistical test').selectOption(test);await ready();assert.equal(await row('A / C').count(),1);assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),1);}
  });
  await check('Paired tests require an ID mapping and report matched/excluded counts for each selected pair',async()=>{
    await field('Statistical test').selectOption('paired-t');await ready();assert.equal(await field('Subject ID').inputValue(),'c2');await field('Subject ID').selectOption('');await ready();assert.match(await row('A / C').innerText(),/Choose a subject ID/);
    await field('Subject ID').selectOption('c2');await ready();assert.match(await row('A / C').innerText(),/Paired t/);assert.deepEqual((await row('A / C').locator('td').allTextContents()).slice(5,8),['3','0','0']);
    await choosePair('A','B');assert.deepEqual((await row('A / B').locator('td').allTextContents()).slice(5,8),['2','1','1']);
    await field('Statistical test').selectOption('wilcoxon');await ready();assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),2);assert.equal(await field('Pairing').inputValue(),'id');
  });
  await check('ANOVA uses all three groups while Tukey pair filtering preserves full-family adjusted p and intervals',async()=>{
    await field('Statistical test').selectOption('anova');await ready();assert.match(await dialog.locator('.plot-omnibus-result').innerText(),/F\(2, 6\)/);assert.match(await dialog.locator('.statistics-table').innerText(),/Planned comparison family: 3|family.*3/i);
    const before=await row('A / C').locator('td').allTextContents();await field('Comparison family').selectOption('all');await ready();assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),3);assert.deepEqual(await row('A / C').locator('td').allTextContents(),before);
    assert.equal(await field('p adjustment').count(),0);assert.equal(await field('Use adjusted p').count(),0);
    await field('Comparison family').selectOption('selected');await ready();await button('Remove comparison: A / B').click();await ready();assert.deepEqual(await row('A / C').locator('td').allTextContents(),before);
    await dialog.locator('.plot-statistics-controls').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/anova-controls.png'});
  });
  await check('Overall test and brackets display independently; CSV includes confidence bounds and both ANOVA dfs',async()=>{
    const before=await row('A / C').locator('td').allTextContents();await field('Show overall test').uncheck();await ready();assert.doesNotMatch(await dialog.locator('.plot-preview').textContent(),/One-way ANOVA/);
    await field('Show comparison brackets').uncheck();await ready();assert.deepEqual(await row('A / C').locator('td').allTextContents(),before);
    await field('Show overall test').check();await field('Show comparison brackets').check();await ready();assert.match(await dialog.locator('.plot-preview').textContent(),/One-way ANOVA/);
    const [file]=await Promise.all([page.waitForEvent('download'),button('Download statistics (CSV)').click()]);await file.saveAs(directory+'/statistics.csv');const csv=await readFile(directory+'/statistics.csv','utf8');assert.match(csv,/df denominator/);assert.match(csv,/Difference CI low/);assert.match(csv,/Tukey HSD \/ Tukey–Kramer/);
    await field('Post-hoc comparisons').selectOption('none');await ready();assert.equal(await dialog.locator('.plot-comparison-results').count(),0);assert.match(await dialog.locator('.plot-omnibus-result').innerText(),/F\(2, 6\)/);
    await field('Post-hoc comparisons').selectOption('tukey');await ready();assert.deepEqual(await row('A / C').locator('td').allTextContents(),before);
  });
  await check('ANOVA/pair choices persist through Apply, reload, portable import, Undo and Redo; SVG, PNG and PDF export',async()=>{
    await button('Apply').click();await saved();committed=await portable();assert.equal(committed.objects[0].plot.analysis.test,'anova');assert.deepEqual(committed.objects[0].plot.analysis.pairs,[[key('A'),key('C')]]);
    const svg=(await download('export-svg','anova.svg')).toString();assert.match(svg,/One-way ANOVA/);assert.doesNotMatch(svg,/<script|<image/);assert.ok((await download('export-png','anova.png')).length>10000);
    await page.evaluate(()=>{window.print=()=>{};});await page.getByTestId('export-pdf').click();await page.locator('#publication-print svg').waitFor({state:'attached'});await page.pdf({path:directory+'/anova.pdf',printBackground:true,preferCSSPageSize:true});assert.doesNotMatch((await readFile(directory+'/anova.pdf')).toString('latin1'),/\/JavaScript|\/Launch|\/URI/);
    await page.reload();await saved();assert.deepEqual((await portable()).objects,committed.objects);await edit();await field('Statistical test').selectOption('welch');await ready();await button('Apply').click();await saved();await page.getByTestId('undo').click();await saved();assert.equal((await portable()).objects[0].plot.analysis.test,'anova');await page.getByTestId('redo').click();await saved();assert.equal((await portable()).objects[0].plot.analysis.test,'welch');await open(committed);await saved();
  });
  await check('Explicit source-row pairing retains missing-cell positions and survives test switches',async()=>{
    const f=dataFixture('A,B,C\n1,3,9\n2,,8\n4,8,7\n,10,6'),spec=defaultPlotSpec(f.dataset,'bar');spec.layout='wide';spec.roles={values:['c0','c1','c2']};await open({...f.project,objects:[plotObject(spec)]});await saved();await edit();await field('Statistical test').selectOption('paired-t');await ready();await choosePair('A','B');await field('Pairing').selectOption('row-order');await ready();assert.deepEqual((await row('A / B').locator('td').allTextContents()).slice(5,8),['2','2','2']);await field('Statistical test').selectOption('wilcoxon');await ready();assert.equal(await field('Pairing').inputValue(),'row-order');await button('Cancel').click();
  });
  await check('Stale pairs remain visible and repairable; missing control does not erase group choices',async()=>{
    const stale=structuredClone(committed);stale.objects[0].plot.analysis.pairs=[[key('A'),key('Gone')]];await open(stale);await saved();await page.getByRole('tab',{name:/^Layers/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Edit plot',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'no longer available'}).waitFor();await button('Remove comparison: A / Unavailable group').click();await ready();await choosePair('A','B');await field('Comparison family').selectOption('control');await dialog.getByRole('alert').filter({hasText:'Choose a control'}).waitFor();assert.equal(await field('Control').locator('option').count(),4);await field('Control').selectOption(key('B'));await ready();await button('Cancel').click();
  });
  await check('Grouped data shortcuts select only the intended within-X or within-series comparisons',async()=>{
    const f=dataFixture('X,Series,Y\nA,Early,1\nA,Early,3\nA,Late,4\nA,Late,7\nB,Early,6\nB,Early,8\nB,Late,9\nB,Late,11'),spec=defaultPlotSpec(f.dataset,'grouped-bar');spec.roles={x:'c0',series:'c1',y:'c2'};await open({...f.project,objects:[plotObject(spec)]});await saved();await edit();await field('Statistical test').selectOption('welch');await ready();await button('Compare series within each X').click();await ready();assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),2);assert.match(await dialog.locator('.plot-selected-pairs').innerText(),/A · Early \/ A · Late/);await button('Compare X within each series').click();await ready();assert.match(await dialog.locator('.plot-selected-pairs').innerText(),/A · Early \/ B · Early/);await button('Cancel').click();
  });
  await check('Untrusted group labels stay text in the pair picker and results; CSV formulas are escaped',async()=>{
    const label='<svg onload=window.plotInjected=1>', f=dataFixture(`Group,Y\n${label},1\n${label},3\n${label},4\n=1+1,6\n=1+1,7\n=1+1,9`), spec=defaultPlotSpec(f.dataset,'bar');spec.roles={x:'c0',y:'c1'};await open({...f.project,objects:[plotObject(spec)]});await saved();await edit();await field('Statistical test').selectOption('welch');await ready();assert.equal(await page.evaluate(()=>window.plotInjected??null),null);assert.equal(await dialog.locator('.plot-selected-pairs svg,.statistics-table svg').count(),0);assert.match(await dialog.locator('.plot-selected-pairs').innerText(),/svg onload/);
    const [file]=await Promise.all([page.waitForEvent('download'),button('Download statistics (CSV)').click()]);await file.saveAs(directory+'/hostile-labels.csv');assert.match(await readFile(directory+'/hostile-labels.csv','utf8'),/'=1\+1/);await button('Cancel').click();
  });
  await check('French controls and narrow layouts remain readable',async()=>{
    const french=structuredClone(committed);french.settings.locale='fr';await open(french);await page.getByRole('tab',{name:/^Calques/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Modifier le graphique',exact:true}).click();await field('Test statistique').waitFor();assert.equal(await field('Test statistique').inputValue(),'anova');await dialog.getByText('Test global',{exact:true}).waitFor();assert.equal(await field('Comparaisons post-hoc').inputValue(),'tukey');
    await page.setViewportSize({width:390,height:844});await dialog.locator('.plot-statistics-controls').scrollIntoViewIfNeeded();assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:directory+'/anova-french-mobile.png'});await button('Annuler').click();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}finally{await writeFile(directory+'/results.json',JSON.stringify({build:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'),results,errors,external},null,2));await browser.close();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed`);
