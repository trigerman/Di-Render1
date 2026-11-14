import './register-source.mjs';
import './dom-environment.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '../app/node_modules/playwright/index.mjs';
const { dataFixture, plotObject, analysisConfig } = await import('./data-helpers.mjs');
const { initialPlotSpec } = await import('../app/src/domain/plots/recommend.ts');
const directory='reports/long-stats',base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173);
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true}),page=await context.newPage();
const errors=[],external=[],results=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===base||/^(blob:|data:)/.test(url))return route.continue();external.push(url);return route.abort();});
const dialog=page.getByRole('dialog'),field=name=>dialog.getByLabel(name,{exact:true}),button=name=>dialog.getByRole('button',{name,exact:true});
const ready=async()=>page.waitForFunction(()=>[...document.querySelectorAll('.plot-workflow button')].some(b=>b.textContent.trim()==='Apply'&&!b.disabled));
const saved=async()=>{await page.locator('.app-shell:not([inert])').waitFor();await page.getByText('Saved locally',{exact:true}).waitFor();};
const download=async(id,name)=>{const[file]=await Promise.all([page.waitForEvent('download'),page.getByTestId(id).click()]);await file.saveAs(directory+'/'+name);return readFile(directory+'/'+name);};
const edit=async()=>{await page.getByRole('tab',{name:/^Layers/}).click();await page.locator('.layer-main').first().click();await page.getByRole('tab',{name:'Style',exact:true}).click();await page.getByRole('button',{name:'Edit plot',exact:true}).click();await ready();};
const fresh=async text=>{await page.getByTestId('insert-plot').click();await button('Reset').click();await button('Import data').click();await field('Paste data').fill(text);await button('Continue to plot').click();await ready();};
const open=async project=>{await page.getByText('Project opened',{exact:true}).waitFor({state:'hidden'});await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'long.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.getByText('Project opened',{exact:true}).waitFor();await page.locator('.app-shell:not([inert])').waitFor();};
const annotations=()=>dialog.locator('.plot-preview text').evaluateAll(nodes=>nodes.filter(n=>/^(ns|\*+|p\s*[=<])/.test(n.textContent)).map(n=>({text:n.textContent,x:Number(n.getAttribute('x')),y:Number(n.getAttribute('y')),size:Number(n.getAttribute('font-size'))})));
const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});await page.screenshot({path:directory+'/failure-'+results.length+'.png'});throw error;}};
const sample='Student_Status\tMajor\tGrade\nGraduate\tPolitics\t67\nUndergraduate\tMath\t63\nGraduate\tMath\t78\nGraduate\tEcon\t78\nGraduate\tEcon\t65\nGraduate\tEcon\t69\nGraduate\tPolitics\t96';
try {
  await page.goto(base);await page.getByRole('button',{name:'New figure',exact:true}).click();await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
  await check('Reported long table: ANOVA and Tukey-Kramer render six computed comparisons',async()=>{
    await fresh(sample);assert.equal(await field('Data arrangement').inputValue(),'rows');assert.equal(await field('Plot type').inputValue(),'grouped-bar');
    await field('Statistical test').selectOption('anova');await ready();assert.match(await dialog.locator('.plot-omnibus-result').innerText(),/0.679988/);assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),6);assert.equal((await annotations()).length,6);
    assert.match(await dialog.locator('.plot-comparison-results').innerText(),/Tukey–Kramer/);await dialog.locator('.plot-live').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/long-anova.png'});
  });
  await check('Reported long table: Kruskal-Wallis and Dunn retain all comparisons at larger fonts',async()=>{
    await field('Statistical test').selectOption('kruskal-wallis');await field('Font size').fill('24');await ready();
    assert.match(await dialog.locator('.plot-omnibus-result').innerText(),/0.405855/);assert.equal((await annotations()).length,6);assert.match(await dialog.locator('.plot-notices').innerText(),/compacted/);
    for(const a of await annotations())assert.ok(a.y>a.size&&a.y<380);await page.screenshot({path:directory+'/long-kruskal-large-font.png'});
    const before=await dialog.locator('.plot-comparison-results tbody').innerText();await field('Show comparison brackets').uncheck();await ready();assert.equal((await annotations()).length,0);assert.equal(await dialog.locator('.plot-comparison-results tbody').innerText(),before);
    await field('Show comparison brackets').check();await field('Font size').fill('12');await ready();
  });
  await check('Long-table groups can be changed to Major alone and shown as categorical lines',async()=>{
    await field('Plot type').selectOption('bar');await field('X / group').selectOption('c1');await field('Series / heatmap column key').selectOption('');await field('Statistical test').selectOption('anova');await ready();
    assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),3);assert.equal((await annotations()).length,3);
    for(const type of ['line','area','box','violin','dot-column']){await field('Plot type').selectOption(type);await ready();assert.equal((await annotations()).length,3,type);}
    await button('Cancel').click();
  });
  await check('Six interleaved long-format cells keep 15 p-value brackets in the default frame',async()=>{
    const rows=['Group,Series,Value'];for(let r=0;r<3;r++)for(let s=0;s<3;s++)for(let g=0;g<2;g++)rows.push(`G${g},S${s},${g*20+s*7+r*r}`);
    await fresh(rows.join('\n'));await field('Statistical test').selectOption('kruskal-wallis');await field('Bracket labels').selectOption('p');await ready();assert.equal((await annotations()).length,15);assert.equal(await dialog.locator('.plot-comparison-results tbody tr').count(),15);
    await page.screenshot({path:directory+'/long-dense-p-values.png'});await button('Cancel').click();
  });
  await check('Small saved frames keep statistics through apply, reload, portable import and exports',async()=>{
    const f=dataFixture(sample),spec=initialPlotSpec(f.dataset);spec.analysis={...analysisConfig('anova'),showGlobal:true};f.project.objects=[{...plotObject(spec),height:180}];await open(f.project);await edit();assert.equal((await annotations()).length,6);await button('Apply').click();await saved();
    const portable=JSON.parse(await download('save-project','long-small.obf.json'));assert.equal(portable.objects[0].height,180);assert.equal(portable.objects[0].plot.result.comparisons.length,6);
    const svg=(await download('export-svg','long-small.svg')).toString();assert.equal((svg.match(/>ns<\/tspan>/g)??[]).length,6);assert.doesNotMatch(svg,/frame is too small|NaN|Infinity/);
    assert.ok((await download('export-png','long-small.png')).length>10000);await page.evaluate(()=>{window.print=()=>{};});await page.getByTestId('export-pdf').click();await page.locator('#publication-print svg').waitFor({state:'attached'});assert.equal(await page.locator('#publication-print tspan').filter({hasText:/^ns$/}).count(),6);await page.pdf({path:directory+'/long-small.pdf',printBackground:true,preferCSSPageSize:true});
    await page.reload();await saved();await edit();assert.equal((await annotations()).length,6);await button('Cancel').click();await open(portable);await edit();assert.equal((await annotations()).length,6);await button('Cancel').click();
  });
  await check('Wide groups and replicate-column layouts compute omnibus tests without crowding failures',async()=>{
    await fresh('A,B,C,D,E,F\n1,8,15,22,29,36\n3,10,17,24,31,38\n4,13,19,26,35,40');
    for(const method of ['anova','kruskal-wallis']){await field('Statistical test').selectOption(method);await ready();assert.equal((await annotations()).length,15);}
    await button('Cancel').click();await fresh('Group,R1,R2,R3\nA,1,3,4\nB,9,14,13\nC,12,16,19');await field('Data arrangement').selectOption('replicates');await field('Plot type').selectOption('bar');await field('Series / heatmap column key').selectOption('');await ready();
    for(const method of ['anova','kruskal-wallis']){await field('Statistical test').selectOption(method);await ready();assert.equal((await annotations()).length,3);}
    await button('Cancel').click();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
} finally {await writeFile(directory+'/results.json',JSON.stringify({build:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'),results,errors,external},null,2));await browser.close();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed`);
