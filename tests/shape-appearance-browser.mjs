import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '../app/node_modules/playwright/index.mjs';
import {createProject} from '../app/src/domain/project/factory.ts';
import {SHAPE_DEFINITIONS,SHAPE_STYLE} from '../app/src/domain/shapes/registry.ts';

const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1600,height:1080},acceptDownloads:true});
const output = 'reports/shapes-images';
await mkdir(output,{recursive:true});
const errors = [],external=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(!/^(http:\/\/127\.0\.0\.1:4173|data:|blob:)/.test(request.url()))external.push(request.url());});
const frame = ()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const download = async id => {
  const pending = page.waitForEvent('download');
  await page.getByTestId(id).click();
  return readFile(await (await pending).path());
};
const save = async()=>JSON.parse(await download('save-project'));
const open = async project => {
  await page.locator('input[type=file][accept*=".obf"]').setInputFiles({name:'shape-review.obf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.getByText('Project opened',{exact:true}).waitFor();
  await frame();
};
try {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button',{name:'New figure',exact:true}).click();
  await page.getByRole('button',{name:'Create figure',exact:true}).click();
  const project = createProject('custom',{width:1610,height:1680});
  project.metadata.title='Shape appearance review';
  for (const [index,shape] of SHAPE_DEFINITIONS.entries()) {
    const x=(index%7)*230+115, y=Math.floor(index/7)*230+112;
    const base={x,y,scaleX:1,scaleY:1,angle:0,opacity:1,visible:true,locked:false};
    project.objects.push({...base,id:shape.id,name:shape.name,kind:'shape',shapeId:shape.id,
      width:shape.width,height:shape.height,adjustment:0.4,label:['process','database','round-callout'].includes(shape.id)?'Sample text':'',...SHAPE_STYLE});
    project.objects.push({...base,y:y+110,id:shape.id+'-caption',name:shape.name+' caption',kind:'text',
      text:shape.name,width:220,height:20,fontSize:14,fontFamily:'IBM Plex Sans',fontWeight:400,textAlign:'center',fill:'#263238',stroke:null,strokeWidth:0});
  }
  await open(project);
  const before = (await download('export-svg')).toString();
  await writeFile(output+'/canvas-shapes.svg',before);
  const png = await download('export-png');
  await writeFile(output+'/canvas-shapes.png',png);
  const saved=await save();
  assert.equal(saved.objects.filter(object=>object.kind==='shape').length,45);
  await open(saved);
  assert.ok((await download('export-png')).equals(png),'Every shape must reopen with identical pixels');
  await page.getByRole('tab',{name:/^Layers/}).click();
  await page.getByRole('button',{name:'Rounded rectangle shape',exact:true}).click();
  await page.getByRole('tab',{name:'Style',exact:true}).click();
  await page.getByLabel('Shape text',{exact:true}).fill('A centred label');
  await page.getByLabel('W',{exact:true}).fill('300');
  await page.getByLabel('H',{exact:true}).fill('100');
  await page.getByLabel('Fill',{exact:true}).fill('#cfe4ef');
  await page.getByLabel('Stroke',{exact:true}).fill('#17496a');
  await page.getByLabel('Stroke width',{exact:true}).fill('3');
  await page.getByLabel('Rotation',{exact:true}).fill('18');
  await page.getByLabel(/Adjust shape/).fill('0.65');
  const edited=await save();
  const item=edited.objects.find(object=>object.id==='rounded-rectangle');
  assert.equal(item.label,'A centred label');
  assert.equal(item.fill,'#cfe4ef');
  assert.equal(item.adjustment,0.65);
  const updatedSvg=(await download('export-svg')).toString();
  assert.notEqual(updatedSvg,before,'Style and geometry updates must reach export');
  assert.ok(updatedSvg.includes('rgb(207,228,239)'), 'Updated fill must reach the SVG paths');
  const editedPng=await download('export-png');
  await open(edited);
  assert.ok((await download('export-png')).equals(editedPng),'Resized, rotated and adjusted geometry must reopen unchanged');
  await page.locator('.shape-gallery summary').click();
  await page.getByRole('searchbox',{name:'Search shapes'}).fill('arrow');
  await page.screenshot({path:output+'/arrows-gallery.png'});
  await page.emulateMedia({colorScheme:'dark'});
  await page.screenshot({path:output+'/arrows-gallery-dark.png'});
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[]);
  console.log('PASS all 45 canvas presets, labels, resize/style/adjustment, SVG/PNG and pixel-identical reopen; no external requests');
} finally {await browser.close();}
