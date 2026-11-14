import './register-source.mjs';
import './dom-environment.mjs';
import { chromium } from '../app/node_modules/playwright/index.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const { createProject } = await import('../app/src/domain/project/factory.ts');
const { createDataSource } = await import('../app/src/domain/data/source.ts');
const { defaultRead } = await import('../app/src/domain/data/detect.ts');
const { dataFixture, fixtureSpec, plotObject } = await import('./data-helpers.mjs');
const base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173), browser=await chromium.launch({headless:true}), page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
const result={browser:browser.version(),build:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex')}; await mkdir('reports/data-plots',{recursive:true});
await page.addInitScript(()=>{window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});});
const saved=async()=>{await page.locator('.app-shell:not([inert])').waitFor({timeout:30000});await page.getByText('Saved locally',{exact:true}).waitFor({timeout:30000});};
const open=async project=>{await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'ceiling.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.getByText('Project opened',{exact:true}).waitFor({timeout:30000});await saved();};
try {
 await page.goto(base);await page.getByRole('button',{name:'New figure',exact:true}).click();await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
 const project=createProject();project.metadata.title='20 MB storage ceiling';
 for(let index=0;index<4;index++){const source=createDataSource('Column\n'+String(index).repeat(5_000_000-7));project.dataSources.push(source);project.datasets.push({id:'dataset-'+randomUUID(),name:'Ceiling '+index,sourceId:source.id,origin:{name:'ceiling.txt',mediaType:'text/plain',encoding:'utf-8',bytes:5_000_000,importedAt:new Date().toISOString()},read:defaultRead,columns:[{key:'c0',name:'Column',type:'text',unit:null,levels:null}]});}
 await open(project);result.sourceBytes=project.dataSources.reduce((sum,source)=>sum+Buffer.byteLength(source.content),0);result.saves=[];
 for(let index=0;index<3;index++){await page.evaluate(()=>{window.longTasks=[];});const start=Date.now();await page.getByRole('textbox',{name:'Figure title'}).fill('20 MB save '+index);await saved();const elapsed=Date.now()-start;const tasks=await page.evaluate(()=>window.longTasks);result.saves.push({elapsedMs:elapsed,processingMs:Math.max(0,elapsed-450),maximumLongTaskMs:Math.max(0,...tasks.map(task=>task.duration))});}
 const content='Group,Y\n'+Array.from({length:100000},(_,index)=>`${index%2?'B':'A'},${index%100}`).join('\n'), fixture=dataFixture(content), spec=fixtureSpec(fixture.dataset,'violin');spec.roles={x:'c0',y:'c1'};
 await page.evaluate(()=>{window.longTasks=[];});const start=Date.now();await open({...fixture.project,objects:[plotObject(spec)]});result.largePlot={rows:100000,elapsedMs:Date.now()-start,tasks:await page.evaluate(()=>window.longTasks)};
 // Plot budget ceiling: 5,950 batched markers (23,800 marker commands plus axes).
 const dense=dataFixture('X,Y\n'+Array.from({length:5950},(_,index)=>`${index},${index%100}`).join('\n')), scatter=fixtureSpec(dense.dataset,'scatter');scatter.roles={x:'c0',y:'c1'};scatter.error='none';await open({...dense.project,objects:[plotObject(scatter)]});
 const pending=page.waitForEvent('download');await page.getByTestId('export-svg').click();const download=await pending;await download.saveAs('reports/data-plots/ceiling-scatter.svg');result.ceilingExport=true;
 assert.equal(result.sourceBytes,20_000_000);
 result.medianSaveProcessingMs=[...result.saves].map(save=>save.processingMs).sort((a,b)=>a-b)[1];
 assert.ok(result.medianSaveProcessingMs<1000,'20 MB metadata autosave exceeds the 1 s processing gate');
 console.log(JSON.stringify(result));
}finally{await writeFile('reports/data-plots/performance.json',JSON.stringify(result,null,2));await browser.close();}
