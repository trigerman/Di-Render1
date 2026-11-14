import './dom-environment.mjs';
import {chromium} from '../app/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {buildSvgExport} from '../app/src/domain/export/exporters.ts';
import {createProject} from '../app/src/domain/project/factory.ts';
const base='http://127.0.0.1:'+(process.env.OPENRENDER_PORT??4173);
const manifest=JSON.parse(await readFile('app/src/assets/packs/library-manifest.json','utf8'));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errors=[],external=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.text().startsWith('LIBRARY '))console.log(m.text());});
page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
// Test-only module delivery, never copied into the product's public directory.
const fabricSource=await readFile('vendor/fabric/dist/index.min.mjs','utf8');
await page.route('**/__test__/fabric.mjs',route=>route.fulfill({body:fabricSource,contentType:'text/javascript'}));
// The editor's drawing loader, so blending and group clipping render as they do in the app.
const drawingSource=stripTypeScriptTypes(await readFile('app/src/editor/svgDrawing.ts','utf8')).replace('from "fabric"','from "/__test__/fabric.mjs"');
await page.route('**/__test__/drawing.mjs',route=>route.fulfill({body:drawingSource,contentType:'text/javascript'}));
await page.exposeFunction('standaloneExport',svg=>{try{return {svg:buildSvgExport(svg,createProject())};}catch(error){return {error:error.message};}});
const boundedEvaluation=async promise=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Renderer batch exceeded 60 seconds')),60_000);timer.unref();})]);}
  finally{clearTimeout(timer);}
};
try{
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  for(let start=0;start<manifest.length;start+=20){
    const batch=await boundedEvaluation(page.evaluate(async records=>{
      const fabric=await import('/__test__/fabric.mjs');const drawing=await import('/__test__/drawing.mjs');const rows=[];
      // Share of inked 4x4 blocks whose mean colour differs on white: area colour errors count, edge anti-aliasing does not.
      const difference=(a,b,w,h)=>{let ink=0,bad=0;
        for(let by=0;by<Math.floor(h/4);by++)for(let bx=0;bx<Math.floor(w/4);bx++){const m=[0,0,0,0,0,0];
          for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=((by*4+y)*w+bx*4+x)*4;for(let c=0;c<3;c++){m[c]+=a[i+c]/16;m[c+3]+=b[i+c]/16;}}
          if(Math.min(...m)<250)ink++;if(Math.max(Math.abs(m[0]-m[3]),Math.abs(m[1]-m[4]),Math.abs(m[2]-m[5]))>24)bad++;}
        return ink?bad/ink:0;};
      const clipped=element=>/url\(/.test(element.getAttribute('clip-path')??'')||/clip-path\s*:\s*url\(/.test(element.getAttribute('style')??'');
      const newRendering=raw=>/mix-blend-mode/.test(raw)||[...new DOMParser().parseFromString(raw,'image/svg+xml').querySelectorAll('g')]
        .some(group=>clipped(group)&&[...group.querySelectorAll('*')].some(clipped));
      for(const record of records){
        let canvas;
        try{
          console.log('LIBRARY '+record.id);
          const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Rendering exceeded 5 seconds')),5000))]);
          const url='/artwork/'+record.integrity.slice(7).toLowerCase()+'.svg';
          const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status);
          if(response.headers.get('cache-control')!=='public, max-age=31536000, immutable')throw new Error('Missing immutable cache policy');
          const raw=await response.text();
          const img=new Image();img.src=url;await bounded(img.decode());
          const native=document.createElement('canvas');native.width=256;native.height=256;
          const ctx=native.getContext('2d');const scale=Math.min(240/img.naturalWidth,240/img.naturalHeight);
          ctx.drawImage(img,8,8,img.naturalWidth*scale,img.naturalHeight*scale);
          const ink=ctx.getImageData(0,0,256,256).data.some((v,i)=>i%4===3&&v>0);
          if(!ink)throw new Error('Empty native SVG rendering');
          const parts=await bounded(drawing.loadDrawingParts(raw));if(!parts.length)throw new Error('No Fabric objects');
          const group=drawing.drawingGroup(parts);
          if(!Number.isFinite(group.width+group.height)||group.width<=0||group.height<=0)throw new Error('Invalid Fabric dimensions');
          const factor=Math.min(220/Math.max(group.width,group.height),1);
          group.set({left:128,top:128,originX:'center',originY:'center',fill:null,stroke:null,scaleX:factor,scaleY:factor});
          canvas=new fabric.StaticCanvas(document.createElement('canvas'),{width:256,height:256,enableRetinaScaling:false});
          canvas.add(group);canvas.renderAll();
          const pixels=canvas.getContext().getImageData(0,0,256,256).data;
          if(!pixels.some((v,i)=>i%4===3&&v>0))throw new Error('Empty Fabric rendering');
          const svg=canvas.toSVG();
          // Blending and group clipping are newer to the renderer: the editor and the export must match the browser.
          let fidelity=null;
          if(newRendering(raw)){
            // Only the root element is parsed for the viewport: plain Fabric parsing can hang on nested group clips.
            const root=new DOMParser().parseFromString(raw,'image/svg+xml').documentElement.cloneNode(false);
            const viewport=(await bounded(fabric.loadSVGFromString(new XMLSerializer().serializeToString(root)))).options;
            const s=Math.min(240/viewport.width,240/viewport.height),w=Math.max(4,Math.round(viewport.width*s)),h=Math.max(4,Math.round(viewport.height*s));
            const flat=draw=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);draw(x);return x.getImageData(0,0,w,h).data;};
            const reference=flat(x=>x.drawImage(img,0,0,w,h));
            const framed=new fabric.StaticCanvas(document.createElement('canvas'),{width:w,height:h,enableRetinaScaling:false});
            try{
              framed.setViewportTransform([s,0,0,s,0,0]);framed.add(drawing.drawingGroup(await bounded(drawing.loadDrawingParts(raw))));framed.renderAll();
              const exported=await window.standaloneExport(framed.toSVG());
              if(exported.error)throw new Error('Standalone export: '+exported.error);
              const image=new Image();image.src=URL.createObjectURL(new Blob([exported.svg],{type:'image/svg+xml'}));await bounded(image.decode());
              fidelity={editor:difference(reference,flat(x=>x.drawImage(framed.getElement(),0,0)),w,h),export:difference(reference,flat(x=>x.drawImage(image,0,0,w,h)),w,h)};
            }finally{await Promise.race([framed.dispose(),new Promise(resolve=>setTimeout(resolve,1000))]);}
            for(const [name,value] of Object.entries(fidelity))
              if(value>0.05)throw new Error('Fidelity: '+name+' rendering differs from the native SVG in '+(value*100).toFixed(1)+'% of inked areas');
          }
          rows.push({id:record.id,title:record.title,pass:true,width:group.width,height:group.height,scale:factor,fidelity,svg});
        }catch(error){rows.push({id:record.id,title:record.title,pass:false,error:error.message});}
        finally{if(canvas)await Promise.race([canvas.dispose(),new Promise(resolve=>setTimeout(resolve,1000))]);}
      }
      return rows;
    },manifest.slice(start,start+20)));
    for(const row of batch){
      if(row.pass)try{buildSvgExport(row.svg,createProject());}catch(error){row.pass=false;row.error='Standalone export: '+error.message;}
      delete row.svg;results.push(row);
    }
    console.log('Screened '+results.length+'/'+manifest.length);
  }
}finally{
  await mkdir('reports',{recursive:true});
  const report={buildIdentifier:createHash('sha256').update(await readFile('app/dist/index.html')).digest('hex'),version:browser.version(),results,errors,externalRequests:external};
  await writeFile('reports/library-browser.json',JSON.stringify(report,null,2)+'\n');await browser.close();
}
const failures=results.filter(x=>!x.pass);
console.log(JSON.stringify({passed:results.length-failures.length,failures,errors,externalRequests:external}));
if(failures.length||errors.length||external.length)process.exitCode=1;
