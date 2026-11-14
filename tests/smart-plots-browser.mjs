import './register-source.mjs';
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '../app/node_modules/playwright/index.mjs';
const { dataFixture, plotObject } = await import('./data-helpers.mjs');
const { initialPlotSpec } = await import('../app/src/domain/plots/recommend.ts');
const base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173), directory='reports/smart-plots';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true}),page=await context.newPage();
const errors=[],external=[],results=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===base||/^(blob:|data:)/.test(url))return route.continue();external.push(url);return route.abort();});
const dialog=page.getByRole('dialog'), field=name=>dialog.getByLabel(name,{exact:true}), button=name=>dialog.getByRole('button',{name,exact:true});
const ready=async()=>page.waitForFunction(()=>[...document.querySelectorAll('.plot-workflow button')].some(b=>b.textContent.trim()==='Apply'&&!b.disabled));
const saved=async()=>{await page.locator('.app-shell:not([inert])').waitFor();await page.getByText('Saved locally',{exact:true}).waitFor();};
const download=async(id,name)=>{const [file]=await Promise.all([page.waitForEvent('download'),page.getByTestId(id).click()]);await file.saveAs(directory+'/'+name);return readFile(directory+'/'+name);};
const portable=async()=>JSON.parse(await download('save-project','current.obf.json'));
const edit=async()=>{await page.getByRole('tab',{name:/^Layers/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Edit plot',exact:true}).click();await ready();};
const fresh=async(text)=>{await page.getByTestId('insert-plot').click();await button('Reset').click();await button('Import data').click();await field('Paste data').fill(text);await button('Continue to plot').click();await ready();};
const open=async project=>{await page.getByText('Project opened',{exact:true}).waitFor({state:'hidden'});await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'smart.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.getByText('Project opened',{exact:true}).waitFor();await page.locator('.app-shell:not([inert])').waitFor();};
const starTexts=()=>dialog.locator('.plot-preview text').evaluateAll(nodes=>nodes.filter(n=>/^\*+$/.test(n.textContent)).map(n=>n.textContent));
const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});await page.screenshot({path:directory+'/failure-'+results.length+'.png'});throw error;}};
let pairedProject,seriesProject;
try{
  await page.goto(base);await page.getByRole('button',{name:'New figure',exact:true}).click();await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
  await check('Numeric columns default to mean bars with SD, exclude IDs and highlight the active type',async()=>{
    await fresh('Subject ID,Before,After\n1,1,12\n2,2,16\n3,4,15\n4,3,19\n5,6,18\n6,5,21');
    assert.equal(await field('Data arrangement').inputValue(),'columns');assert.equal(await field('Plot type').inputValue(),'bar');assert.equal(await dialog.getByRole('combobox',{name:'Subject ID',exact:true}).inputValue(),'c0');assert.equal(await field('Statistical test').inputValue(),'');
    assert.equal(await dialog.getByRole('group',{name:'Value columns',exact:true}).getByLabel('Subject ID',{exact:true}).isChecked(),false);
    assert.equal(await dialog.locator('[data-plot-type=bar]').getAttribute('aria-pressed'),'true');assert.equal(await dialog.locator('.plot-smart-mapping').count(),0);assert.equal(await field('Error bars').inputValue(),'sd');
  });
  await check('Paired t stars appear in the actual preview for every supported group style, including line and area',async()=>{
    await field('Statistical test').selectOption('paired-t');await ready();
    for(const type of ['bar','dot-bar','dot-column','box','violin','line','area']){await field('Plot type').selectOption(type);await ready();assert.equal((await starTexts()).length,1,type);assert.match((await starTexts())[0],/^\*{2,4}$/);assert.equal(await field('Show comparison brackets').isChecked(),true);}
    await field('Plot type').selectOption('line');await ready();await dialog.locator('.plot-live').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/paired-stars-line.png'});
    const star=await dialog.locator('.plot-preview text').evaluateAll(nodes=>{const star=nodes.find(n=>/^\*+$/.test(n.textContent));return {x:Number(star.getAttribute('x')),y:Number(star.getAttribute('y'))};});assert.ok(star.y>0&&star.x>0);
  });
  await check('Bracket and label controls change visible annotations without changing computed p-values',async()=>{
    const before=await dialog.locator('.plot-comparison-results tbody').innerText();await field('Show comparison brackets').uncheck();await ready();assert.deepEqual(await starTexts(),[]);assert.equal(await dialog.locator('.plot-comparison-results tbody').innerText(),before);
    await field('Show comparison brackets').check();await ready();assert.equal((await starTexts()).length,1);
    await field('Bracket labels').selectOption('p');await ready();assert.deepEqual(await starTexts(),[]);assert.match(await dialog.locator('.plot-preview').textContent(),/p\s*[=<]/);
    await field('Bracket labels').selectOption('stars');await ready();
  });
  await check('Stars persist on the canvas, through reload and portable import, and in SVG/PNG/PDF',async()=>{
    await button('Apply').click();await saved();pairedProject=await portable();assert.equal(pairedProject.objects[0].plot.result.comparisons[0].matchedPairs,6);
    const svg=(await download('export-svg','paired-stars.svg')).toString();assert.match(svg,/\*{2,4}/);assert.ok((await download('export-png','paired-stars.png')).length>10000);
    await page.evaluate(()=>{window.print=()=>{};});await page.getByTestId('export-pdf').click();await page.locator('#publication-print svg').waitFor({state:'attached'});assert.match(await page.locator('#publication-print svg').textContent(),/\*{2,4}/);await page.pdf({path:directory+'/paired-stars.pdf',printBackground:true,preferCSSPageSize:true});
    await page.reload();await saved();await edit();assert.equal((await starTexts()).length,1);await button('Cancel').click();await open(pairedProject);await edit();assert.equal((await starTexts()).length,1);await button('Cancel').click();
  });
  await check('Wide non-time data defaults to row matching; a missing ID choice has a direct visible repair',async()=>{
    await fresh('Before,After\n1,12\n2,16\n4,15\n3,19\n6,18\n5,21');await field('Statistical test').selectOption('paired-t');await ready();assert.equal(await field('Pairing').inputValue(),'row-order');assert.equal((await starTexts()).length,1);assert.match(await dialog.locator('.plot-comparison-status').innerText(),/corresponding source rows/);await field('Pairing').selectOption('id');await ready();assert.deepEqual(await starTexts(),[]);assert.match(await dialog.locator('.plot-comparison-status').innerText(),/Paired p-values need matching/);
    await button('Match corresponding rows').click();await ready();assert.equal((await starTexts()).length,1);await field('Statistical test').selectOption('wilcoxon');await ready();assert.equal((await starTexts()).length,1);await button('Cancel').click();
  });
  await check('Wide time series use all measure columns, preserve gaps and keep manual edits through Back',async()=>{
    await fresh('Time (h),Control,Treatment\n0,1,7\n1,,8\n2,3,9');assert.equal(await field('Data arrangement').inputValue(),'series-columns');assert.equal(await field('Plot type').inputValue(),'line');assert.equal(await field('X / group').inputValue(),'c0');assert.equal(await field('Error bars').inputValue(),'sd');
    await field('Show points').check();await ready();assert.equal(await dialog.locator('.plot-preview circle').count(),5);assert.equal(await dialog.locator('.plot-preview path[fill="none"]').count(),3);
    await field('Plot type').selectOption('area');await ready();await button('Back').click();await button('Continue to plot').click();await ready();assert.equal(await field('Plot type').inputValue(),'area');
    await dialog.locator('[data-plot-type=line]').click();await ready();assert.equal(await field('Plot type').inputValue(),'line');await dialog.locator('.plot-live').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/wide-time-series.png'});
    await button('Apply').click();await saved();seriesProject=await portable();const plot=seriesProject.objects.find(o=>o.plot?.layout==='wide-series');assert.deepEqual(plot.plot.roles,{x:'c0',values:['c1','c2']});
    const svg=(await download('export-svg','time-series.svg')).toString();assert.match(svg,/Treatment/);assert.match(svg,/Control/);assert.doesNotMatch(svg,/NaN|Infinity/);
    await page.reload();await saved();assert.deepEqual((await portable()).objects,seriesProject.objects);
  });
  await check('Group pairs apply immediately, never add an intermediate pair, and adjusted t-test stars stay visible',async()=>{
    await fresh('CTRL,TEST2,TEST3\n1,12,20\n2,16,25\n4,15,21\n3,19,27\n6,18,26\n5,21,30\n7,23,32\n8,25,36');await field('Statistical test').selectOption('welch');await ready();assert.match(await dialog.locator('.plot-comparison-status').innerText(),/Choose groups/);assert.equal(await button('Add comparison').count(),0);
    const key=name=>JSON.stringify([name,null]);await field('Group A').selectOption(key('CTRL'));assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),0);await field('Group B').selectOption(key('TEST2'));await ready();assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),1);assert.equal(await field('Group A').inputValue(),'');assert.equal(await field('Group B').inputValue(),'');
    await field('Group A').selectOption(key('TEST2'));assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),1);await field('Group B').selectOption(key('TEST3'));await ready();assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),2);
    for(const method of ['welch','student','paired-t','wilcoxon']){await field('Statistical test').selectOption(method);await ready();for(const adjustment of ['holm','bonferroni','bh']){await field('p adjustment').selectOption(adjustment);await ready();assert.equal((await starTexts()).length,2,method+' '+adjustment);assert.match(await dialog.locator('.plot-comparison-status').innerText(),/adjusted p-values/);}}
    await button('Clear comparisons').click();await ready();assert.deepEqual(await starTexts(),[]);assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),0);await button('Cancel').click();
  });
  await check('The reported time-column paired setup has a prominent matching action and produces stars after row matching',async()=>{
    await fresh('Time,Neuron_1,Neuron_2\n0,1,12\n1,2,16\n2,4,15\n3,3,19\n4,6,18\n5,5,21\n6,7,23\n7,8,25');await field('Data arrangement').selectOption('columns');await ready();
    assert.equal(await dialog.getByRole('group',{name:'Value columns',exact:true}).getByLabel('Time',{exact:true}).isChecked(),false);
    await field('Statistical test').selectOption('paired-t');await ready();assert.equal(await field('Pairing').inputValue(),'id');assert.match(await dialog.locator('.plot-comparison-status').innerText(),/Paired p-values need matching/);assert.deepEqual(await starTexts(),[]);
    await dialog.locator('.plot-live').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/matching-required.png'});await button('Match corresponding rows').click();await ready();assert.equal((await starTexts()).length,1);assert.match(await dialog.locator('.plot-comparison-status').innerText(),/Comparisons displayed/);await page.screenshot({path:directory+'/matching-repaired.png'});await button('Cancel').click();
  });
  await check('Adjusted nonsignificant comparisons draw ns brackets unless deliberately hidden',async()=>{
    await fresh('CTRL,TEST2,TEST3\n1,12,20\n2,16,25\n4,15,21\n3,19,27\n6,18,26\n5,21,30');await field('Statistical test').selectOption('wilcoxon');await field('Comparison family').selectOption('all');await ready();
    assert.equal(await dialog.locator('.plot-preview text').filter({hasText:/^ns$/}).count(),3);assert.deepEqual(await starTexts(),[]);
    await field('Hide nonsignificant comparisons').check();await ready();assert.equal(await dialog.locator('.plot-preview text').filter({hasText:/^ns$/}).count(),0);assert.match(await dialog.locator('.plot-comparison-status').innerText(),/non-significant results hidden/);
    await button('Show non-significant comparisons').click();await ready();assert.equal(await dialog.locator('.plot-preview text').filter({hasText:/^ns$/}).count(),3);await button('Cancel').click();
  });
  await check('Long time data respects its group column; wide categorical measures produce side-by-side bars',async()=>{
    await fresh('Time,Group,Value\n0,A,1\n1,A,3\n0,B,7\n1,B,9');assert.equal(await field('Data arrangement').inputValue(),'rows');assert.equal(await field('Plot type').inputValue(),'line');assert.equal(await field('Series / heatmap column key').inputValue(),'c1');await button('Cancel').click();
    await fresh('Group,Before,After\nA,1,3\nA,3,5\nB,2,5\nB,4,7');assert.equal(await field('Data arrangement').inputValue(),'series-columns');assert.equal(await field('Plot type').inputValue(),'grouped-bar');
    const bars=await dialog.locator('.plot-preview rect').evaluateAll(nodes=>nodes.filter(n=>Number(n.getAttribute('width'))>8&&n.getAttribute('fill')!=='#FFFFFF').map(n=>Number(n.getAttribute('x'))));assert.equal(bars.length,4);assert.equal(new Set(bars).size,4);await button('Cancel').click();
  });
  await check('Dates select time series; explicit X selects scatter and supports a manual override',async()=>{
    await fresh('Date,A,B\n2026-01-01,1,4\n2026-01-02,2,5');assert.equal(await field('Plot type').inputValue(),'line');assert.match(await dialog.locator('.plot-preview').textContent(),/2026-01/);await button('Cancel').click();
    await fresh('X,Y\n1,3\n2,6\n3,4');assert.equal(await field('Plot type').inputValue(),'scatter');await field('Plot type').selectOption('line');await ready();await field('Plot type').selectOption('scatter');await ready();assert.equal(await field('Plot type').inputValue(),'scatter');await button('Cancel').click();
  });
  await check('Hostile headers stay inert in smart suggestions, series legends and SVG',async()=>{
    await fresh('Time,<svg onload=window.smartInjected=1>,Safe\n0,1,4\n1,2,5');assert.equal(await page.evaluate(()=>window.smartInjected??null),null);assert.equal(await dialog.locator('.plot-mapping svg').count(),0);assert.match(await dialog.locator('.plot-mapping').innerText(),/svg onload/);await button('Apply').click();await saved();const svg=(await download('export-svg','hostile-series.svg')).toString();assert.doesNotMatch(svg,/<svg onload|<script/);
  });
  await check('French smart defaults fit a narrow screen and keep editable mappings',async()=>{
    const f=dataFixture('Time,A,B\n0,1,4\n1,2,5');f.project.objects=[plotObject(initialPlotSpec(f.dataset))];f.project.settings.locale='fr';await open(f.project);
    await page.getByRole('tab',{name:/^Calques/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Modifier le graphique',exact:true}).click();await field('Disposition des données').waitFor();await page.setViewportSize({width:390,height:844});await dialog.locator('.plot-type-picker').scrollIntoViewIfNeeded();assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.equal(await dialog.locator('[data-plot-type=line]').getAttribute('aria-pressed'),'true');assert.equal(await dialog.locator('.plot-smart-mapping').count(),0);await page.screenshot({path:directory+'/smart-french-mobile.png'});await button('Annuler').click();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}finally{await writeFile(directory+'/results.json',JSON.stringify({build:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'),results,errors,external},null,2));await browser.close();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed`);
