import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '../app/node_modules/playwright/index.mjs';
import {SHAPE_DEFINITIONS, shapeGeometry, SHAPE_STYLE} from '../app/src/domain/shapes/registry.ts';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1260,height:900}});
  const cards=SHAPE_DEFINITIONS.map(shape=>`<article><svg viewBox="-8 -8 ${shape.width+16} ${shape.height+16}">${shapeGeometry(shape.id,0.4,shape.width,shape.height).paths.map(path=>`<path d="${path.d}" fill="${path.fill?SHAPE_STYLE.fill:'none'}" stroke="${path.stroke?SHAPE_STYLE.stroke:'none'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')}</svg><span>${shape.name}</span></article>`).join('');
  await page.setContent(`<style>body{margin:24px;font:13px sans-serif;background:#f3f5f7;color:#253849}h1{font-size:22px}p{color:#536675}main{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}article{height:150px;background:white;border:1px solid #dce2e7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px;box-sizing:border-box}svg{width:130px;height:102px}span{margin-top:10px}</style><h1>Di-Render shape library</h1><p>Apache POI presets · Native proportions · Editable vectors</p><main>${cards}</main>`);
  const bounds=await page.locator('svg').evaluateAll(shapes=>shapes.map(shape=>{const b=shape.getBBox();return {width:b.width,height:b.height,x:b.x,y:b.y};}));
  assert.equal(bounds.length,SHAPE_DEFINITIONS.length);
  bounds.forEach((box,index)=>assert.ok(box.width>0 && box.height>0,SHAPE_DEFINITIONS[index].id));
  await mkdir('reports/shapes-images',{recursive:true});
  await page.screenshot({path:'reports/shapes-images/presets.png',fullPage:true});
  console.log(`PASS ${bounds.length} shape presets have visible geometry`);
} finally {await browser.close();}
