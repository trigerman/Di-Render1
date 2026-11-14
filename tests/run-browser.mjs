const { chromium, firefox, webkit } = await import(process.env.OPENRENDER_PLAYWRIGHT_MODULE ?? '../app/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173);
const library=JSON.parse(await readFile('app/src/assets/packs/library-manifest.json','utf8'));
const engine=process.env.OPENRENDER_BROWSER ?? 'chromium';
const buildIdentifier=createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex');
const browser=await ({chromium,firefox,webkit}[engine]).launch({headless:true,...(process.env.OPENRENDER_BROWSER_EXECUTABLE ? {executablePath:process.env.OPENRENDER_BROWSER_EXECUTABLE} : {})});
const reportDirectory='reports/'+engine;
await mkdir(reportDirectory,{recursive:true});
const results=[],errors=[],network=[];
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
context.on('page',page=>{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))network.push(r.url());});
});
const page=await context.newPage();
page.setDefaultTimeout(8000);
const check=async(name,run)=>{const started=Date.now();try{await run();results.push({name,pass:true,ms:Date.now()-started});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.message});console.error('FAIL '+name+' '+error.message);await page.screenshot({path:reportDirectory+'/failure-'+results.length+'.png',fullPage:true});}};
const openProject=async(name)=> {
  await page.locator('input[type=file][accept*=".obf"]').setInputFiles('examples/'+name+'.obf.json');
  await page.getByText('Project opened',{exact:true}).waitFor();await page.getByTestId('workspace').waitFor();await saved();
};
const saved=async()=>{await page.getByText('Saved locally',{exact:true}).waitFor({timeout:12000});};
const pixels=async()=>createHash('sha256').update(await download('export-png','pixel-probe.png')).digest('hex');
const download=async(button,name)=>{
  const waiting=page.waitForEvent('download');await page.getByTestId(button).click();const file=await waiting;
  const path=reportDirectory+'/'+name;await file.saveAs(path);return readFile(path);
};
const projectFile=async()=>JSON.parse(await download('save-project','current.obf.json'));
const capture=async(name)=>{
  const data=await page.locator('canvas.lower-canvas').evaluate(element=>element.toDataURL());
  await writeFile(reportDirectory+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'));
  await download('export-svg',name+'.svg');
};
try{
  await page.goto(base);
  await check('first run, settings, fonts and local library',async()=>{
    await page.getByRole('heading',{name:'Create an editable scientific figure'}).waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:/Back to Di-Render/}).click();
    await page.getByRole('button',{name:'New figure',exact:true}).click();
    await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
    // The whole library opens as closed category shelves; no drawing tile renders until one is opened.
    assert.equal(await page.locator('.asset-shelf-header[aria-expanded=false]').count(),new Set(library.map(x=>x.category)).size);
    assert.equal(await page.locator('.asset-card').count(),0);
    assert.equal(await page.evaluate(()=>document.fonts.check('16px "IBM Plex Sans"')),true);
  });
  await check('one click on a New figure template or format opens it',async()=>{
    await page.getByRole('button',{name:'Di-Render Home',exact:true}).click();
    await page.getByRole('button',{name:'New figure',exact:true}).click();
    await page.getByRole('dialog').getByRole('tab',{name:/^Use a template/}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Pathway mechanism/}).click();await saved();
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal((await projectFile()).document.preset,'template:pathway-mechanism');
    await page.getByRole('button',{name:'Di-Render Home',exact:true}).click();
    await page.getByRole('button',{name:'New figure',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/^Journal figure/}).click();await saved();
    assert.equal(await page.getByRole('dialog').count(),0);
    const project=await projectFile();assert.equal(project.document.preset,'journal');assert.equal(project.objects.length,0);
  });
  await check('text/shapes, metadata editing, undo and redo',async()=>{
    await page.getByRole('button',{name:'Add text',exact:true}).click();
    await page.getByRole('button',{name:'Add rectangle',exact:true}).click();
    await page.getByRole('button',{name:'Add ellipse',exact:true}).click();await saved();
    assert.equal((await projectFile()).objects.length,3);
    await page.getByTestId('undo').click();await saved();assert.equal((await projectFile()).objects.length,2);
    await page.getByTestId('redo').click();await saved();assert.equal((await projectFile()).objects.length,3);
    await page.getByRole('textbox',{name:'Figure title'}).fill('Local αβ figure');await saved();
    assert.equal((await projectFile()).metadata.title,'Local αβ figure');
  });
  await check('SVG and exact-size PNG downloads',async()=>{
    const svg=(await download('export-svg','local-figure.svg')).toString();
    assert.match(svg,/<metadata/);assert.doesNotMatch(svg,/<!DOCTYPE|<script|<image/);
    const png=await download('export-png','local-figure.png');assert.equal(png.readUInt32BE(16),2400);assert.equal(png.readUInt32BE(20),1600);
  });
  await check('atomic autosave and reload preserve canvas',async()=>{
    await saved();const before=await pixels();await page.reload();await page.getByTestId('workspace').waitFor();await saved();
    assert.equal(await pixels(),before);
  });
  await check('asset search, insertion, provenance and reuse',async()=>{
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('Mitochondria');
    const illustration=page.locator('.asset-card').filter({has:page.getByText('Mitochondria',{exact:true})}).first();
    await illustration.waitFor();
    await illustration.locator('.asset-add').click();
    await page.locator('[role=tab][aria-selected=true]',{hasText:'Style'}).waitFor();
    await page.getByRole('tab',{name:/^License/}).click();
    await page.locator('.credit-card').filter({hasText:'Mitochondria'}).waitFor();await saved();
    const project=await projectFile();await writeFile(reportDirectory+'/asset-project.json',JSON.stringify(project,null,2));assert.equal(project.assets.length,1);assert.equal(project.assets[0].verified,true);
    const count=(await projectFile()).objects.length;
    await illustration.locator('.asset-add').click();
    await page.getByRole('tab',{name:/^Layers/}).getByText(String(count+1),{exact:true}).waitFor();
    await saved();assert.equal((await projectFile()).assets.length,1);
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('');
  });
  await check('portable reopen retains all pixels and trusted provenance',async()=>{
    await page.getByRole('tab',{name:'Style',exact:true}).click();
    const original=await pixels();await page.getByLabel('Fill',{exact:true}).fill('#bc416e');await saved();
    assert.notEqual(await pixels(),original);
    const before=await pixels();const file=await projectFile();
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'roundtrip.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
    await page.getByText('Project opened',{exact:true}).waitFor();
    await saved();assert.equal(await pixels(),before);assert.equal((await projectFile()).assets[0].verified,true);
  });
  await check('category shelves show every drawing, CC BY artwork, public caching and export credits',async()=>{
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('');
    const sizes=library.reduce((map,x)=>map.set(x.category,(map.get(x.category)??0)+1),new Map());
    const [category,size]=[...sizes].sort((a,b)=>b[1]-a[1])[0];
    const shelf=page.getByRole('button',{name:category+', '+size+' drawings',exact:true});
    await shelf.click();assert.equal(await shelf.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.asset-card').count(),size);
    await shelf.click();assert.equal(await page.locator('.asset-card').count(),0);
    const art=library.find(x=>x.license.id==='CC-BY-4.0');
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill(art.title);
    const card=page.locator('[data-asset-id="'+art.id+'"]');await card.waitFor();
    const response=await page.request.get(base+'/artwork/'+art.integrity.slice(7).toLowerCase()+'.svg');
    assert.equal(response.status(),200);assert.match(response.headers()['cache-control'],/max-age=31536000, immutable/);
    await card.locator('.asset-add').click();
    await page.getByRole('tab',{name:/^License/}).click();
    await page.locator('.credit-card').filter({hasText:art.title}).waitFor();await saved();
    const file=await projectFile(),asset=file.assets.find(x=>x.id===art.id);
    const credits=await page.locator('.licensing-panel').innerText();
    assert.doesNotMatch(credits,/Publication check|preflight|to correct/i);
    for(const x of file.assets)assert.ok(credits.includes(x.license.attributionRequired?'Credit: '+x.attribution.text:'No credit required.'),x.title);
    assert.equal(asset.verified,true);assert.equal(asset.license.attributionRequired,true);
    const svg=(await download('export-svg','cc-by-artwork.svg')).toString();
    assert.ok(svg.includes('CC-BY-4.0'));assert.ok(svg.includes(art.creator.name));
    assert.ok(svg.includes('https://creativecommons.org/licenses/by/4.0/'));
    const before=await pixels();
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'cc-by-roundtrip.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
    await page.getByText('Project opened',{exact:true}).waitFor();await saved();
    assert.equal(await pixels(),before);assert.equal((await projectFile()).assets.find(x=>x.id===art.id).verified,true);
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('');
  });
  await check('incubator search, insertion and portable SVG export',async()=>{
    const art=library.find(x=>x.id==='bioicons-lab-apparatus-kehan-incubator-e4cc4f80');
    assert.ok(art);
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('incubator');
    const card=page.locator('[data-asset-id="'+art.id+'"]');await card.waitFor();
    await card.locator('.asset-add').click();
    await page.getByRole('tab',{name:/^License/}).click();
    await page.locator('.credit-card').filter({hasText:'Incubator'}).waitFor();await saved();
    assert.equal((await projectFile()).assets.find(x=>x.id===art.id).verified,true);
    await download('export-svg','incubator.svg');
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('');
  });
  await check('blended and nested-clipped NIH drawings insert, export their compositing and survive portable reopen',async()=>{
    for(const [id,query] of [['nih-bioart-939-tuft-cell-802108','Tuft cell'],['nih-bioart-3-12-well-plate-626573','12 Well Plate']]){
      assert.ok(library.find(x=>x.id===id),id);
      await page.getByRole('textbox',{name:'Search scientific assets'}).fill(query);
      const card=page.locator('[data-asset-id="'+id+'"]');await card.waitFor();
      await card.locator('.asset-add').click();await saved();
    }
    const svg=(await download('export-svg','compositing.svg')).toString();
    assert.match(svg,/mix-blend-mode: multiply/);assert.match(svg,/isolation: isolate/);
    assert.ok((svg.match(/<clipPath/g)??[]).length>1);
    const before=await pixels();const file=await projectFile();
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'compositing.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
    await page.getByText('Project opened',{exact:true}).waitFor();await saved();
    assert.equal(await pixels(),before);
    await page.getByRole('textbox',{name:'Search scientific assets'}).fill('');
  });
  for(const name of ['sample-processing','cell-signaling','cell-schematic','graphical-abstract','schematic-with-plot'])
    await check('reference figure, SVG and pixel round trip: '+name,async()=>{
      await openProject(name);await download('export-svg',name+'.svg');
      await page.getByRole('button',{name:'Add rectangle',exact:true}).click();await saved();
      const before=await pixels();const file=await projectFile();await capture(name+'-before');
      await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:name+'.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
      await page.getByText('Project opened',{exact:true}).waitFor();
      await saved();await capture(name+'-after');assert.equal(await pixels(),before);
    });
  await check('transforms, grouping, clipboard and layer controls',async()=>{
    const fixture=await projectFile();
    const rect=fixture.objects.find(item=>item.kind==='rect');
    fixture.objects=[{...rect,id:'edit-a',name:'Edit A',x:200,y:200,width:120,height:80,angle:0},
      {...rect,id:'edit-b',name:'Edit B',x:500,y:200,width:120,height:80,angle:0}];
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'editing.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await page.getByText('Project opened',{exact:true}).waitFor();
    const canvas=page.locator('canvas.upper-canvas'),box=await canvas.boundingBox();
    const click=async(x,y)=>canvas.click({position:{x:x*box.width/fixture.document.width,y:y*box.height/fixture.document.height}});
    await click(200,200);await page.keyboard.down('Shift');await click(500,200);await page.keyboard.up('Shift');
    await page.getByRole('button',{name:'Group selection',exact:true}).click();await saved();
    const group=(await projectFile()).objects[0];assert.equal(group.kind,'group');assert.equal(group.children.length,2);
    await page.getByRole('button',{name:'Duplicate selection',exact:true}).click();await saved();
    const duplicated=await projectFile();assert.equal(duplicated.objects.length,2);
    assert.equal(duplicated.objects[1].x,group.x+18);assert.equal(duplicated.objects[1].children[0].x,group.children[0].x);
    await page.getByRole('button',{name:'Delete selection',exact:true}).click();await saved();
    await click(200,200);await page.getByRole('button',{name:'Ungroup selection',exact:true}).click();await saved();
    const restored=(await projectFile()).objects;assert.equal(restored.length,2);assert.equal(restored[0].x,200);assert.equal(restored[1].x,500);
    await page.getByRole('tab',{name:/Layers/}).click();
    await page.getByRole('button',{name:'Hide Edit A',exact:true}).click();await saved();assert.equal((await projectFile()).objects[0].visible,false);
    await page.getByRole('button',{name:'Show Edit A',exact:true}).click();
    await page.getByRole('button',{name:'Lock Edit A',exact:true}).click();await saved();assert.equal((await projectFile()).objects[0].locked,true);
    await page.getByRole('button',{name:'Unlock Edit A',exact:true}).click();
    await page.getByRole('button',{name:'Edit A rect',exact:true}).click();
    await page.getByRole('tab',{name:'Style',exact:true}).click();
    await page.getByLabel('Rotation',{exact:true}).fill('35');await saved();assert.equal((await projectFile()).objects[0].angle,35);
    await page.locator('details').filter({has:page.getByTestId('create-chart')}).locator('summary').click();
    await page.getByTestId('create-chart').click();
    await page.getByRole('dialog').getByRole('button',{name:'Type values',exact:true}).click();
    await page.getByRole('dialog').getByLabel('Dataset name',{exact:true}).fill('Local experiment');
    const cells = page.getByRole('dialog').locator('table input');
    for (const [index, value] of ['Group', 'Value', 'A', '1', 'B', '2'].entries()) await cells.nth(index).fill(value);
    await page.getByRole('dialog').getByRole('button',{name:'Continue to plot',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Apply',exact:true}).click();await saved();
    assert.equal((await projectFile()).objects.at(-1).kind,'plot');
    await page.getByRole('tab',{name:'Assets',exact:true}).click();
    for(const kind of ['cell','membrane','dna','panel','scale-bar']){
      await page.getByTestId('add-scientific-'+kind).click();await saved();
    }
    assert.equal((await projectFile()).objects.length,8);
    await download('export-svg','all-scientific-tools.svg');
    await openProject('schematic-with-plot');
  });
  await check('default DNA double helix renders and survives portable reopen',async()=>{
    const fixture=await projectFile();fixture.objects=[];fixture.assets=[];
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'dna-empty.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await page.getByText('Project opened',{exact:true}).waitFor();await saved();
    await page.getByRole('tab',{name:'Assets',exact:true}).click();
    const details=page.locator('details').filter({has:page.getByTestId('add-scientific-dna')});
    if(await details.getAttribute('open')===null)await details.locator('summary').click();
    await page.getByTestId('add-scientific-dna').click();await saved();
    const file=await projectFile();
    assert.equal(file.objects[0].name,'DNA double helix');
    assert.equal(file.objects[0].children.length,240);
    await capture('default-dna');const before=await pixels();
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'dna-roundtrip.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
    await page.getByText('Project opened',{exact:true}).waitFor();await saved();
    assert.equal(await pixels(),before);
    await openProject('schematic-with-plot');
  });
  await check('private SVG metadata remains untrusted and portable',async()=>{
    await page.locator('input[type=file][accept*=".svg"]').setInputFiles({name:'private.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><path fill="#087f8c" d="M0 0L50 0L25 50Z"/></svg>')});
    await page.getByRole('heading',{name:'Provenance metadata'}).waitFor();
    await page.getByLabel('Creator',{exact:true}).fill('Local researcher');
    await page.getByRole('button',{name:'Import SVG',exact:true}).click();await saved();
    const asset=(await projectFile()).assets.at(-1);assert.equal(asset.verified,false);assert.equal(asset.creator.name,'Local researcher');
    await openProject('schematic-with-plot');
  });
  await check('leaving the editor flushes a pending edit before autosave delay',async()=>{
    await page.getByRole('textbox',{name:'Figure title'}).fill('Immediate home transition');
    await page.getByRole('button',{name:'Di-Render Home',exact:true}).click();
    await page.getByRole('heading',{name:'Create an editable scientific figure'}).waitFor();
    await page.locator('.continue-card').filter({hasText:'Immediate home transition'}).click();
    await page.getByTestId('workspace').waitFor();await saved();
    assert.equal((await projectFile()).metadata.title,'Immediate home transition');
    await openProject('schematic-with-plot');
  });
  await check('malformed project and hostile SVG leave document intact',async()=>{
    const before=(await projectFile()).metadata.id;
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
    await page.getByText('The file is not valid project JSON.').waitFor();
    assert.equal((await projectFile()).metadata.id,before);
    await page.locator('input[type=file][accept*=".svg"]').setInputFiles({name:'hostile.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')});
    await page.getByText('SVG contains an unsupported element: script').waitFor();
    assert.equal((await projectFile()).metadata.id,before);
  });
  await check('amplified SVG clipping is rejected before import and leaves the project intact',async()=>{
    const before=await projectFile();
    const artwork='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><clipPath id="clip">'+
      '<rect width="10" height="10"/>'.repeat(300)+'</clipPath></defs>'+
      '<rect width="10" height="10" clip-path="url(#clip)"/>'.repeat(350)+'</svg>';
    await page.locator('input[type=file][accept*=".svg"]').setInputFiles({name:'amplified.svg',mimeType:'image/svg+xml',buffer:Buffer.from(artwork)});
    await page.getByText('Expanded artwork exceeds the project vector budget.',{exact:true}).waitFor();
    assert.deepEqual(await projectFile(),before);
    await page.getByText('Expanded artwork exceeds the project vector budget.',{exact:true}).waitFor({state:'hidden'});
    const fixture=structuredClone(before);
    fixture.assets=[{
      id:'private-clip',title:'Private clip',description:'Clipping fixture',keywords:['clip'],category:'Private',
      source:{provider:'Private import',sourceUrl:null,assetUrl:null,retrievedAt:'2026-10-07'},
      creator:{name:'Researcher',url:null},
      license:{id:'UNKNOWN',name:'Unknown',url:null,attributionRequired:false},
      attribution:{text:'Private fixture',modified:false,modificationNotes:null},svg:artwork,verified:false,
    }];
    fixture.objects=[{
      id:'clip-0',name:'Clip',kind:'svg',assetId:'private-clip',
      x:50,y:50,width:100,height:100,scaleX:1,scaleY:1,angle:0,
      opacity:1,visible:true,locked:false,fill:null,stroke:null,strokeWidth:0,
    }];
    await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'amplified.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await page.getByText('Expanded artwork exceeds the project vector budget.',{exact:true}).waitFor();
    assert.deepEqual(await projectFile(),before);
  });
  await check('delayed public drawing load cannot insert into a different document',async()=>{
    const art=library[0],url=base+'/artwork/'+art.integrity.slice(7).toLowerCase()+'.svg';
    let release,completed;
    const held=new Promise(resolve=>{release=resolve;}),done=new Promise(resolve=>{completed=resolve;});
    const handler=async route=>{
      if(route.request().resourceType()!=='fetch'){await route.continue();return;}
      await held;await route.continue();completed();
    };
    await page.route(url,handler);
    try{
      await page.getByRole('tab',{name:'Assets',exact:true}).click();
      await page.getByRole('textbox',{name:'Search scientific assets'}).fill(art.title);
      const request=page.waitForRequest(r=>r.url()===url&&r.resourceType()==='fetch');
      await page.locator('[data-asset-id="'+art.id+'"] .asset-add').click();await request;
      await page.getByRole('button',{name:'Di-Render Home',exact:true}).click();
      await page.getByRole('button',{name:'New figure',exact:true}).click();
      await page.getByRole('button',{name:'Create figure',exact:true}).click();await saved();
      const response=page.waitForResponse(r=>r.url()===url&&r.request().resourceType()==='fetch');
      release();await done;await (await response).finished();
      // A subsequent UI mutation establishes a later snapshot than the response.
      await page.getByRole('button',{name:'Add rectangle',exact:true}).click();await saved();
      const project=await projectFile();assert.equal(project.assets.length,0);assert.equal(project.objects.length,1);
      await openProject('schematic-with-plot');
    }finally{release();await page.unroute(url,handler);}
  });
  await check('failed IndexedDB commit retains previous save; corruption recovers previous revision',async()=>{
    const original=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('openrender-documents');request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('openrender:documents:v2');get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);
    }));
    await page.evaluate(()=>{
      const put=IDBObjectStore.prototype.put;let once=true;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='documents'&&once){once=false;this.transaction.abort();throw new DOMException('Simulated quota failure','QuotaExceededError');}return put.apply(this,args);};
    });
    await page.getByRole('textbox',{name:'Figure title'}).fill('Unsaved recovery probe');
    await page.locator('.status-error').waitFor();
    const persisted=await page.evaluate(()=>new Promise(resolve=>{
      const request=indexedDB.open('openrender-documents');request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readonly');const get=tx.objectStore('documents').get('openrender:documents:v2');get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};
    }));
    assert.deepEqual(persisted,original);
    await download('save-project','failed-save-portable-backup.obf.json');
    assert.equal(JSON.parse(await readFile(reportDirectory+'/failed-save-portable-backup.obf.json')).metadata.title,'Unsaved recovery probe');
    await page.getByRole('textbox',{name:'Figure title'}).fill('Recovered commit');await saved();
    await page.evaluate(()=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('openrender-documents');request.onsuccess=()=>{const db=request.result;const tx=db.transaction('documents','readwrite');const store=tx.objectStore('documents');const get=store.get('openrender:documents:v2');get.onsuccess=()=>store.put({...get.result,current:{damaged:true}},'openrender:documents:v2');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    }));
    await page.reload();await page.getByTestId('workspace').waitFor();await saved();
    assert.equal((await projectFile()).metadata.title,
      ([3,4,5].includes(original.version) ? original.current.body : original.current).metadata.title);
  });
  if(engine==='chromium') await check('PDF print contains vector paths, embedded fonts and no active actions',async()=>{
    await page.evaluate(()=>{window.print=()=>{};});
    await page.getByTestId('export-pdf').click();await page.locator('#publication-print svg').waitFor({state:'attached'});
    await page.pdf({path:reportDirectory+'/vector-figure.pdf',printBackground:true,preferCSSPageSize:true});
    const bytes=await readFile(reportDirectory+'/vector-figure.pdf');const text=bytes.toString('latin1');
    assert.doesNotMatch(text,/\/JavaScript|\/JS\b|\/Launch|\/EmbeddedFile/);
    assert.match(text,/\/Font/);assert.doesNotMatch(text,/\/Subtype\s*\/Image/);
    let commands='';for(const match of text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)){
      try{commands+=inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{}
    }
    assert.match(commands,/\bm\b/);assert.match(commands,/\b(?:l|c|re)\b/);
    assert.match(text,/\/MediaBox\s*\[0 0 900 600\]/); // 1200x800 px at 96 dpi.
  });
  await check('production CSP, static MIME, 404 and no external document requests',async()=>{
    const response=await page.request.get(base);assert.match(response.headers()['content-security-policy'],/script-src 'self'/);
    const missing=await page.request.get(base+'/missing.js');assert.equal(missing.status(),404);assert.match(missing.headers()['content-type'],/text\/plain/);
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
  });
  if(engine==='chromium') await page.screenshot({path:reportDirectory+'/local-editor-ready.png',fullPage:true,caret:'initial'});
}finally{
  await writeFile('reports/browser-'+engine+'.json',JSON.stringify({engine,version:browser.version(),buildIdentifier,results,errors,network},null,2)+'\n');
  await browser.close();
}
if(results.some(item=>!item.pass)||errors.length||network.length)process.exitCode=1;
