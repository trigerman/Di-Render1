import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {drawingGeometry} from '../app/src/domain/shapes/drawingml.ts';
import {SHAPE_DEFINITIONS, shapeGeometry} from '../app/src/domain/shapes/registry.ts';

test('vendored preset bytes and shipped legal notices match the pinned Apache POI source', async () => {
  const root = new URL('../vendor/poi-shapes/',import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('UPSTREAM.json',root),'utf8'));
  for (const entry of manifest.files) {
    const data = await readFile(new URL(entry.path,root));
    assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256);
    assert.equal(createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'),entry.gitBlob);
    if (entry.path !== 'presetShapeDefinitions.xml') assert.deepEqual(
      await readFile(new URL(`../app/public-browser/licenses/poi-shapes-${entry.path.toLowerCase()}.txt`,import.meta.url)),data);
  }
});

test('Office presets stay finite at portrait, landscape and extreme aspect ratios', () => {
  for (const definition of SHAPE_DEFINITIONS) for (const [width,height] of [[20,600],[600,20],[100,100],[definition.width,definition.height]]) {
    for (const adjustment of [0.15,0.4,0.85]) {
      const {paths,textRect} = shapeGeometry(definition.id,adjustment,width,height);
      assert.ok(paths.length > 0,definition.id);
      for (const path of paths) {
        assert.doesNotMatch(path.d,/NaN|Infinity|undefined/,definition.id);
        assert.ok(path.d.length < 20_000,definition.id);
      }
      assert.ok(Object.values(textRect).every(Number.isFinite),definition.id);
    }
  }
});

test('rounded rectangles keep circular corners at wide aspect ratios; arrow heads keep their proportions', () => {
  const rounded = shapeGeometry('rounded-rectangle',0.4,300,100).paths[0].d;
  assert.match(rounded,/A 16\.667 16\.667 /);
  const arrow = shapeGeometry('right-arrow',0.4,300,80).paths[0].d;
  assert.match(arrow,/L 260 0 L 300 40 L 260 80/);
  assert.match(shapeGeometry('right-arrow',0.85,300,80).paths[0].d,/M 0 6 L 260 6/,'The shaft must stay narrower than the arrowhead at maximum adjustment');
  assert.ok(SHAPE_DEFINITIONS.find(shape=>shape.id==='up-arrow').height > SHAPE_DEFINITIONS.find(shape=>shape.id==='up-arrow').width);
});

test('database rims retain independent fill/stroke paths and open shapes never get filled', () => {
  const paths = shapeGeometry('database').paths;
  assert.ok(paths.some(path=>path.fill && !path.stroke));
  assert.ok(paths.some(path=>!path.fill && path.stroke));
  for (const id of ['arc','bracket','brace','inhibition-arrow']) assert.ok(shapeGeometry(id).paths.every(path=>!path.fill && path.stroke));
});

test('elliptical full turns are emitted as four SVG arcs and formula input is never executable', () => {
  const preset = {adjustments:[],guides:[],textRect:['l','t','r','b'],paths:[{fill:true,stroke:true,commands:[['M','200','50'],['A','100','50','0','21600000'],['Z']]}]};
  const path = drawingGeometry(preset,200,100).paths[0].d;
  assert.equal((path.match(/A /g)??[]).length,4);
  assert.match(path,/A 100 50 0 0 1 100 100/);
  assert.match(path,/A 100 50 0 0 1 200 50 Z$/);
  assert.throws(()=>drawingGeometry({...preset,guides:[['bad','eval alert(1)']]},200,100),/Unknown preset operand/);
});
