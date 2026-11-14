import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../app/src/domain/project/factory.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { migrateProject } from '../app/src/domain/project/migrations.ts';
import { createTemplateProject, FIGURE_TEMPLATES } from '../app/src/domain/templates/templates.ts';
import { checkPublication } from '../app/src/domain/licensing/attribution.ts';
import { buildProjectJson, buildSvgExport, safeFileStem } from '../app/src/domain/export/exporters.ts';
import { readFileSync } from 'node:fs';
import pack from '../app/src/assets/packs/local-cc0.json' with {type:'json'};

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>';
test('Fabric exports namespace repeated paint IDs by object scope without accepting duplicate private imports',()=>{
  const shape=color=>'<g id="path"><defs><linearGradient id="paint"><stop offset="0" stop-color="'+color+'"/></linearGradient></defs><path id="path" d="M0 0L10 10" fill="url(#paint)"/></g>';
  const raw='<svg xmlns="http://www.w3.org/2000/svg">'+shape('red')+shape('blue')+'</svg>';
  const output=buildSvgExport(raw,createProject());
  const doc=new DOMParser().parseFromString(output,'image/svg+xml');
  const ids=[...doc.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
  const paths=[...doc.querySelectorAll('path')];
  assert.deepEqual(paths.map(el=>doc.getElementById(el.getAttribute('fill').slice(5,-1)).querySelector('stop').getAttribute('stop-color')),['red','blue']);
  const privateProject=createProject();privateProject.assets=[{...pack[0],svg:raw}];
  delete privateProject.assets[0].file;delete privateProject.assets[0].integrity;delete privateProject.assets[0].evidence;
  assert.throws(()=>parseProject(privateProject),/duplicate identifiers/);
  assert.throws(()=>buildSvgExport('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"/><linearGradient id="paint"/></defs><path d="M0 0L1 1" fill="url(#paint)"/></svg>',createProject()),/ambiguous/);
});
test('real Fabric SVG declaration and text styles produce a safe standalone export',()=>{
  const raw=readFileSync(new URL('./fixtures/fabric-export.svg',import.meta.url),'utf8');
  const accepted=buildSvgExport(raw,createProject());
  assert.match(accepted,/Scientific label/);assert.match(accepted,/<metadata/);
  assert.doesNotMatch(accepted,/<!DOCTYPE|<\?xml|<script/);
});
test('approved artwork binds accepted bytes and provenance rather than a document flag',()=>{
  const {file,integrity,evidence,...approved}=pack[0];
  const project=createProject();project.assets=[{...approved,verified:false}];
  assert.equal(parseProject(project).assets[0].verified,true);
  const changed=structuredClone(project);changed.assets[0].creator.name='Forged creator';
  assert.equal(parseProject(changed).assets[0].verified,false);
  const changedArt=structuredClone(project);changedArt.assets[0].svg=svg;
  assert.equal(parseProject(changedArt).assets[0].verified,false);
});
const asset = () => ({
  id: 'private-asset', title: 'Private drawing', description: 'Schematic', keywords: ['cell'], category: 'Cells',
  source: { provider: 'Private import', sourceUrl: 'https://example.org/source', assetUrl: null, retrievedAt: '2026-10-07' },
  creator: { name: 'Researcher', url: null },
  license: { id: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true },
  attribution: { text: 'Private drawing by Researcher', modified: false, modificationNotes: null }, svg, verified: true,
});
const shape = (id = 'shape-a') => ({
  id, name: 'Shape', kind: 'rect', x: 10, y: 10, width: 20, height: 20, scaleX: 1, scaleY: 1, angle: 0,
  opacity: 1, visible: true, locked: false, fill: '#ffffff', stroke: '#263238', strokeWidth: 1,
});
test('all inherited editable templates survive strict parsing and portable round trips', () => {
  for (const template of FIGURE_TEMPLATES) {
    const project = createTemplateProject(template.id);
    assert.deepEqual(parseProject(JSON.parse(buildProjectJson(project))), project);
  }
});
test('unknown fields at every model boundary and future versions are rejected', () => {
  for (const location of ['root', 'metadata', 'document', 'settings', 'grid', 'object', 'asset', 'creator', 'license', 'source', 'attribution']) {
    const project = createProject(); project.objects = [shape()]; project.assets = [asset()];
    const targets = { root: project, metadata: project.metadata, document: project.document,
      settings: project.settings, grid: project.settings.grid, object: project.objects[0], asset: project.assets[0],
      creator: project.assets[0].creator, license: project.assets[0].license, source: project.assets[0].source, attribution: project.assets[0].attribution };
    targets[location].executable = 'untrusted';
    assert.throws(() => parseProject(project), /structure/);
  }
  assert.throws(() => migrateProject({ ...createProject(), formatVersion: '99.0.0' }), /unsupported/);
});
test('nested duplicate IDs, duplicate assets and missing asset references fail', () => {
  for (const objects of [
    [shape(), { ...shape('group'), kind: 'group', children: [shape()] }],
    [{ ...shape(), kind: 'svg', assetId: 'missing-asset' }],
  ]) { const project = createProject(); project.objects = objects; assert.throws(() => parseProject(project)); }
  const project = createProject(); project.assets = [asset(), asset()];
  assert.throws(() => parseProject(project), /unique/);
});
test('disclosed asset modifications are notes, not licensing warnings', () => {
  const project = createProject(); project.metadata.title = 'Membrane transport';
  project.assets = [{ ...asset(), attribution: { text: 'Private drawing by Researcher', modified: true, modificationNotes: 'Normalized' } }];
  project.objects = [{ ...shape(), kind: 'svg', assetId: 'private-asset' }];
  assert.deepEqual(checkPublication(project).warnings, []);
  assert.equal(checkPublication(project).notes.length, 2);
});
test('recovery and migration revalidate SVG and downgrade forged catalogue status', () => {
  const project = createProject(); project.assets = [asset()];
  project.objects = [{ ...shape(), kind: 'svg', assetId: 'private-asset' }];
  const before = structuredClone(project);
  const accepted = migrateProject(project);
  assert.equal(accepted.assets[0].verified, false);
  assert.equal(checkPublication(accepted).ready, false);
  assert.deepEqual(project, before);
  for (const hostile of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.invalid"/></svg>',
  ]) { const next = structuredClone(project); next.assets[0].svg = hostile; assert.throws(() => migrateProject(next)); }
  const legacy = migrateProject({ formatVersion: '0.1.0', title: 'Legacy', document: { width: 900, height: 600 } });
  assert.equal(legacy.document.width, 900);
  assert.throws(() => migrateProject({ formatVersion: 0, fetchUrl: 'https://tracker.invalid' }), /unsupported/);
});
test('extreme numeric transforms, paint URLs and unsafe provenance links fail', () => {
  for (const values of [{ x: Infinity }, { scaleX: 1e12 }, { width: 1e12 }, { fill: 'url(https://tracker.invalid)' }]) {
    const project = createProject(); project.objects = [{ ...shape(), ...values }];
    assert.throws(() => parseProject(project));
  }
  const project = createProject(); project.assets = [asset()]; project.assets[0].source.sourceUrl = 'javascript:steal()';
  assert.throws(() => parseProject(project));
});

test('embedded SVG normalization records modifications and remains idempotent', () => {
  const project = createProject(); project.assets = [asset()];
  project.assets[0].svg = '<svg xmlns="http://www.w3.org/2000/svg"><!-- original comment --><path d="M0 0L10 10"/></svg>';
  const original = structuredClone(project);
  const accepted = parseProject(project);
  assert.equal(accepted.assets[0].attribution.modified, true);
  assert.match(accepted.assets[0].attribution.modificationNotes, /comments/);
  assert.deepEqual(parseProject(accepted), accepted);
  assert.deepEqual(project, original);
});
test('repeated SVG instances are charged for expanded geometry', () => {
  const project = createProject(); project.assets = [asset()];
  project.assets[0].svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ' + 'L1 1 '.repeat(1000) + '"/></svg>';
  project.objects = Array.from({length: 500}, (_, i) => ({ ...shape('svg-' + i), kind: 'svg', assetId: 'private-asset' }));
  assert.throws(() => parseProject(project), /vector budget/);
});
test('standalone exports escape metadata and replacement strings, and reject active content', () => {
  const project = createProject(); project.metadata.title = '$& $1 </metadata><script>steal()</script>';
  const output = buildSvgExport(svg, project);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /\$&amp; \$1/);
  assert.doesNotMatch(output, /<script>/);
  assert.throws(() => buildSvgExport('<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"/>', project));
  assert.equal(safeFileStem('../'.repeat(100) + 'x'.repeat(500)).length, 80);
});
