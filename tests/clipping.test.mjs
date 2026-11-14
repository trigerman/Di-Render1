import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadSVGFromString, setEnv, Path } from '../vendor/fabric/dist/index.min.mjs';
import { sanitizeSvg } from '../app/src/domain/assets/sanitize.ts';
import { loadDrawingParts } from '../app/src/editor/svgDrawing.ts';
import { createProject } from '../app/src/domain/project/factory.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { INPUT_LIMITS } from '../app/src/domain/security/input.ts';

const svg = (clip, drawables) => '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><clipPath id="clip">' + clip + '</clipPath></defs>' + drawables + '</svg>';
const rectangle = '<rect width="10" height="10"/>';
const clippedRectangle = '<rect width="10" height="10" clip-path="url(#clip)"/>';
const vectorLimit = error => error.code === 'vector_limit';

function projectWithSvg(artwork, instances = 1) {
  const project = createProject();
  project.assets = [{
    id: 'private-clip', title: 'Private clip', description: 'Clipping fixture', keywords: ['clip'], category: 'Private',
    source: { provider: 'Private import', sourceUrl: null, assetUrl: null, retrievedAt: '2026-10-07' },
    creator: { name: 'Researcher', url: null },
    license: { id: 'UNKNOWN', name: 'Unknown', url: null, attributionRequired: false },
    attribution: { text: 'Private fixture', modified: false, modificationNotes: null }, svg: artwork, verified: false,
  }];
  project.objects = Array.from({ length: instances }, (_, index) => ({
    id: 'clip-' + index, name: 'Clip', kind: 'svg', assetId: 'private-clip',
    x: 50, y: 50, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0,
    opacity: 1, visible: true, locked: false, fill: null, stroke: null, strokeWidth: 0,
  }));
  return project;
}

test('shared clipping above the vector budget is rejected before standalone or project rendering', () => {
  const artwork = svg(rectangle.repeat(300), clippedRectangle.repeat(350));
  assert.ok(Buffer.byteLength(artwork) < INPUT_LIMITS.svgBytes);
  assert.throws(() => sanitizeSvg(artwork), vectorLimit);
  assert.throws(() => parseProject(projectWithSvg(artwork)), vectorLimit);
});

test('clipping costs accumulate across otherwise valid placed artwork instances', () => {
  const artwork = svg(rectangle.repeat(100), clippedRectangle.repeat(150));
  assert.doesNotThrow(() => sanitizeSvg(artwork));
  assert.doesNotThrow(() => parseProject(projectWithSvg(artwork)));
  assert.throws(() => parseProject(projectWithSvg(artwork, 7)), vectorLimit);
});

test('shared clipping path commands are charged per reference before rendering', () => {
  const path = '<path d="M0 0 ' + 'L1 1 '.repeat(1000) + '"/>';
  assert.throws(() => sanitizeSvg(svg(path, clippedRectangle.repeat(501))), vectorLimit);
});

test('clipping inherited from a group cannot bypass the expanded vector limit', () => {
  const artwork = svg(rectangle.repeat(300), '<g style="clip-path:url(#clip)">' + rectangle.repeat(350) + '</g>');
  assert.throws(() => sanitizeSvg(artwork), vectorLimit);
});

const path = '<path d="M0 0L10 10"/>';
const variants = {
  attribute: clippedRectangle.repeat(3),
  style: '<rect width="10" height="10" style="clip-path:url(#clip)"/>'.repeat(3),
  'group attribute': '<g clip-path="url(#clip)"><g>' + rectangle.repeat(3) + '</g></g>',
  'group style': '<g style="clip-path:url(#clip)"><g>' + rectangle.repeat(3) + '</g></g>',
};
for (const [name, drawables] of Object.entries(variants)) test('accepted ' + name + ' clipping metrics cover actual Fabric objects and paths', async () => {
  const dom = new JSDOM('<!doctype html>');
  setEnv({ document: dom.window.document, window: dom.window, isTouchSupported: false, WebGLProbe: {}, dispose() {} });
  const accepted = sanitizeSvg(svg(rectangle + path, drawables));
  const loaded = await loadSVGFromString(accepted.svg);
  let objects = 0;
  let commands = 0;
  const visit = object => {
    objects++;
    if (object instanceof Path) commands += object.path.length;
    for (const child of object.getObjects?.() ?? []) visit(child);
    if (object.clipPath) visit(object.clipPath);
  };
  for (const object of loaded.objects.filter(Boolean)) visit(object);
  assert.equal(loaded.objects.filter(Boolean).length, 3);
  assert.equal(commands, 6);
  assert.ok(accepted.elements >= objects, 'budget must cover every renderer object, including clip groups');
  assert.ok(accepted.pathCommands >= commands, 'budget must cover every copied path command');
});

test('nested group clipping metrics cover the group clips the editor adds', async () => {
  const dom = new JSDOM('<!doctype html>');
  setEnv({ document: dom.window.document, window: dom.window, isTouchSupported: false, WebGLProbe: {}, dispose() {} });
  const accepted = sanitizeSvg(svg(rectangle + path, '<g clip-path="url(#clip)">' + rectangle + '<g clip-path="url(#clip)">' + rectangle.repeat(2) + '</g></g>'));
  let objects = 0;
  let commands = 0;
  const visit = object => {
    objects++;
    if (object instanceof Path) commands += object.path.length;
    for (const child of object.getObjects?.() ?? []) visit(child);
    if (object.clipPath) visit(object.clipPath);
  };
  for (const object of await loadDrawingParts(accepted.svg)) visit(object);
  assert.ok(accepted.elements >= objects, 'budget must cover every renderer object, including group clips');
  assert.ok(accepted.pathCommands >= commands, 'budget must cover every copied path command');
});
