import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, analysisConfig } from './data-helpers.mjs';
import { defaultPlotSpec } from '../app/src/domain/plots/spec.ts';

test('worker retains statistics and all comparisons in crowded frames and rejects hostile comparison payloads',async()=>{
  const f=dataFixture('Group,Y\n'+Array.from({length:6},(_,i)=>`G${i},${i+1}\nG${i},${i+3}`).join('\n'));
  const spec=defaultPlotSpec(f.dataset,'bar');spec.roles={x:'c0',y:'c1'};spec.analysis={...analysisConfig('anova'),showGlobal:true};
  const previous=globalThis.self;let response;const worker={onmessage:null,postMessage:value=>{response=value;}};
  const request={kind:'plot',source:f.source,dataset:f.dataset,spec,width:520,height:180};
  try{
    globalThis.self=worker;await import('../app/src/workers/dataWorker.ts');
    worker.onmessage({data:request});assert.equal(response.ok,true);assert.equal(response.value.scene.error,null);assert.equal(response.value.groups.length,6);assert.equal(response.value.scene.result.familySize,15);assert.equal(response.value.scene.observations,null);
    assert.equal(response.value.scene.primitives.filter(p=>p.kind==='text'&&/^(ns|\*+)$/.test(p.text)).length,15);
    spec.analysis.showBrackets=false;worker.onmessage({data:{...request,height:380}});assert.equal(response.ok,true);assert.equal(response.value.scene.error,null);assert.equal(response.value.scene.result.familySize,15);
    spec.analysis.pairs=Array.from({length:191},()=>['a','b']);worker.onmessage({data:request});assert.equal(response.ok,false);assert.equal(response.code,'invalid_data');assert.equal(Object.hasOwn(response,'value'),false);
    spec.analysis.pairs=[];spec.analysis.postHoc='dunn';worker.onmessage({data:request});assert.equal(response.ok,true);assert.match(response.value.scene.error,/compatible/);assert.equal(response.value.groups.length,6);
  }finally{if(previous===undefined)delete globalThis.self;else globalThis.self=previous;}
});
