import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkDocument, artworkParts, artworkMatrix, editArtwork, bakeArtworkPaint, createArtworkVariant } from '../app/src/domain/assets/artwork.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { createProject } from '../app/src/domain/project/factory.ts';
import pack from '../app/src/assets/packs/local-cc0.json' with {type:'json'};

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="paint"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><clipPath id="clip"><rect width="80" height="80"/></clipPath></defs><g transform="translate(10 20) scale(2)" fill="#008800"><path id="icon-body" style="fill:url(#paint);stroke:#000000;stroke-width:2" clip-path="url(#clip)" d="M0 0 L30 0 L30 30 Z"/><text x="0" y="30">Label</text></g></svg>';
const find = (value, label) => artworkParts(artworkDocument(value).documentElement).find(p => p.label === label);

test('artwork lists selectable parts and gradient stops without exposing clipping geometry', () => {
  const parts = artworkParts(artworkDocument(svg).documentElement);
  assert.deepEqual(parts.map(p => p.tag), ['stop', 'stop', 'g', 'path', 'text']);
  assert.equal(find(svg, 'icon-body').fill, 'url(#paint)');
});
test('part styling overrides inline styles without changing sibling geometry or definitions', () => {
  const changed = editArtwork(svg, '1.0', {type:'property', name:'fill', value:'#ffcc00'}).svg;
  assert.equal(find(changed, 'icon-body').fill, '#ffcc00');
  assert.equal(find(changed, 'icon-body').stroke, '#000000');
  const document = artworkDocument(changed);
  assert.equal(document.querySelector('path').getAttribute('clip-path'), 'url(#clip)');
  assert.equal(document.querySelector('text').textContent, 'Label');
  assert.equal(document.querySelectorAll('stop').length, 2);
});
test('dragging changes only the local parent offset and keeps rotated or scaled geometry', () => {
  const before = artworkMatrix('translate(10 20) rotate(90 2 3) scale(2 -1)');
  assert.deepEqual(artworkMatrix('translate(10 20) scale(2)'), [2,0,0,2,10,20]);
  const changed = editArtwork(svg, '1', {type:'move', x:15, y:-10}).svg;
  assert.deepEqual(artworkMatrix(artworkDocument(changed).querySelector('g').getAttribute('transform')), [2,0,0,2,25,10]);
  assert.ok(before.every(Number.isFinite));
  const scaled = editArtwork(changed, '1', {type:'scale', x:2, y:3, center:[5,5]}).svg;
  assert.deepEqual(artworkMatrix(artworkDocument(scaled).querySelector('g').getAttribute('transform')), [4,0,0,6,15,-10]);
});
test('repeated movement remains bounded, and invalid or active edits fail closed', () => {
  let draft = svg;
  for (let i=0;i<60;i++) draft = editArtwork(draft, '1', {type:'move', x:1, y:1}).svg;
  assert.ok(artworkDocument(draft).querySelector('g').getAttribute('transform').length < 50);
  for (const operation of [
    {type:'property',name:'fill',value:'url(https://example.com)'},
    {type:'property',name:'d',value:'M0 0 L'},
    {type:'property',name:'onclick',value:'alert(1)'},
    {type:'move',x:Infinity,y:0},
    {type:'move',x:1,y:0,extra:true},
    {type:'scale',x:0,y:1,center:[0,0]},
  ]) assert.throws(() => editArtwork(svg, '1.0', operation));
  assert.equal(find(svg, 'icon-body').fill, 'url(#paint)');
  assert.throws(() => editArtwork(svg, '0.1.0', {type:'delete'}), /editable/);
});
test('duplicating IDs preserves shared gradient and clip references and supports order changes', () => {
  const copy = editArtwork(svg, '1.0', {type:'duplicate'});
  const doc = artworkDocument(copy.svg);
  const paths = doc.querySelectorAll('path');
  assert.equal(copy.key, '1.1');
  assert.notEqual(paths[0].id, paths[1].id);
  assert.equal(paths[1].getAttribute('clip-path'), 'url(#clip)');
  assert.equal(find(copy.svg, paths[1].id).fill, 'url(#paint)');
  const raised = editArtwork(copy.svg, copy.key, {type:'raise'});
  assert.equal(raised.key, '1.2');
  const removed = editArtwork(raised.svg, raised.key, {type:'delete'});
  assert.equal(artworkDocument(removed.svg).querySelectorAll('path').length, 1);
});
test('duplicate subtree renews definitions and internal references together', () => {
  const nested = '<svg xmlns="http://www.w3.org/2000/svg"><g id="outer"><defs><linearGradient id="p"><stop offset="0" stop-color="red"/></linearGradient></defs><rect id="r" width="10" height="10" fill="url(#p)"/></g></svg>';
  const copy = artworkDocument(editArtwork(nested, '0', {type:'duplicate'}).svg);
  const groups = copy.querySelectorAll('g');
  assert.equal(groups[0].querySelector('rect').getAttribute('fill'), 'url(#p)');
  assert.equal(groups[1].querySelector('rect').getAttribute('fill'), `url(#${groups[1].querySelector('linearGradient').id})`);
});
test('labels are XML text, styled spans are preserved, and new parts are editable', () => {
  const changed = editArtwork(svg, '1.1', {type:'text',value:'<script>alert(1)</script> & label'}).svg;
  assert.equal(artworkDocument(changed).querySelector('script'), null);
  assert.equal(artworkDocument(changed).querySelector('text').textContent, '<script>alert(1)</script> & label');
  const spans = '<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>Preserved</tspan></text></svg>';
  assert.throws(() => editArtwork(spans, '0', {type:'text',value:'Lost formatting'}), /structure is preserved/);
  const added = editArtwork(svg, null, {type:'add',shape:'ellipse',center:[50,50],size:20});
  assert.equal(added.key, '2');
  assert.equal(artworkDocument(added.svg).querySelector('ellipse').getAttribute('rx'), '10');
});
test('opening a recolored icon bakes its current appearance into editable parts', () => {
  const painted = bakeArtworkPaint(svg, '#ff00ff', '#112233');
  assert.equal(find(painted, 'icon-body').fill, '#ff00ff');
  assert.equal(find(painted, 'icon-body').stroke, '#112233');
  assert.equal(artworkParts(artworkDocument(painted).documentElement).find(p => p.tag === 'text').fill, '#ff00ff');
});
test('group color edits reach painted descendants, preserve no-fill geometry, and hidden parts can be shown', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="10" height="10" fill="red"/><path d="M0 0 L10 10" fill="none" stroke="blue" visibility="hidden"/></g></svg>';
  const colored = editArtwork(source, '0', {type:'property',name:'fill',value:'#ffcc00'}).svg;
  const parts = artworkParts(artworkDocument(colored).documentElement);
  assert.equal(parts[1].fill, '#ffcc00'); assert.equal(parts[2].fill, 'none');
  const shown = editArtwork(colored, '0.1', {type:'hide'}).svg;
  assert.equal(artworkParts(artworkDocument(shown).documentElement)[2].hidden, false);
});
test('an edited copy preserves attribution and original asset through strict portable round trip', () => {
  const {file, integrity, evidence, ...asset} = pack[0];
  const original = structuredClone(asset);
  const variant = createArtworkVariant(asset, editArtwork(svg, '1.0', {type:'property',name:'fill',value:'red'}).svg);
  assert.notEqual(variant.id, asset.id);
  assert.equal(variant.verified, false);
  assert.equal(variant.attribution.modified, true);
  assert.deepEqual(variant.source, asset.source);
  assert.deepEqual(variant.creator, asset.creator);
  assert.deepEqual(variant.license, asset.license);
  assert.deepEqual(asset, original);
  const project = createProject(); project.assets = [asset, variant];
  const reopened = parseProject(JSON.parse(JSON.stringify(project)));
  assert.equal(reopened.assets[0].svg, asset.svg);
  assert.equal(reopened.assets[1].verified, false);
  assert.match(reopened.assets[1].attribution.modificationNotes, /Artwork parts edited/);
  assert.equal(find(reopened.assets[1].svg, 'icon-body').fill, 'red');
});
