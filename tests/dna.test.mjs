import './dom-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScientificElement} from '../app/src/domain/scientific/elements.ts';
import {createProject} from '../app/src/domain/project/factory.ts';
import {parseProject} from '../app/src/domain/project/schema.ts';

test('default DNA has two connected opposing backbones and paired editable rungs',()=>{
  const dna=createScientificElement('dna',200,200);
  assert.equal(dna.kind,'group');
  const project=createProject();project.objects=[dna];
  assert.equal(parseProject(project).objects[0].children.length,240);
  for(const name of ['Teal','Violet']){
    const strand=dna.children.filter(x=>x.name.startsWith(name+' backbone'));
    const endpoints=segment=>{
      const angle=segment.angle*Math.PI/180,dx=Math.cos(angle)*segment.width/2,dy=Math.sin(angle)*segment.width/2;
      return [[segment.x-dx,segment.y-dy],[segment.x+dx,segment.y+dy]];
    };
    for(let i=1;i<strand.length;i++){
      const end=endpoints(strand[i-1])[1],start=endpoints(strand[i])[0];
      assert.ok(Math.hypot(end[0]-start[0],end[1]-start[1])<1e-8);
    }
    assert.ok(strand.some(x=>x.x>40)&&strand.some(x=>x.x<-40));
  }
  const pairs=dna.children.filter(x=>x.name.startsWith('Base pair'));
  for(let i=0;i<pairs.length;i+=2){
    assert.equal(pairs[i].y,pairs[i+1].y);
    assert.equal(pairs[i].x,-pairs[i+1].x);
    assert.equal(pairs[i].width,pairs[i+1].width);
  }
});
