import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Group, setEnv } from '../vendor/fabric/dist/index.min.mjs';
import { sanitizeSvg } from '../app/src/domain/assets/sanitize.ts';
import { drawingGroup, loadDrawingParts } from '../app/src/editor/svgDrawing.ts';

const dom = new JSDOM('<!doctype html>');
setEnv({ document: dom.window.document, window: dom.window, isTouchSupported: false, WebGLProbe: {}, dispose() {} });
const svg = body => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="clip"><rect width="50" height="50"/></clipPath>' +
  '<clipPath id="inner"><rect width="20" height="20"/></clipPath></defs>' + body + '</svg>').svg;
const square = fill => '<rect width="40" height="40" fill="' + fill + '"/>';
const shade = '<path d="M0 0H30V30Z" fill="#bfbebe" style="mix-blend-mode:multiply"/>';

test('blended shapes and groups composite inside an isolated drawing and export their blending', async () => {
  const parts = await loadDrawingParts(svg(square('#82a0c4') + shade + '<g style="mix-blend-mode:overlay">' + square('#fff') + square('#000') + '</g>'));
  assert.deepEqual(parts.map(part => part.globalCompositeOperation), ['source-over', 'multiply', 'overlay']);
  // The overlay applies to its group as one layer, not to each shape in it.
  assert.ok(parts[2] instanceof Group);
  assert.deepEqual(parts[2].getObjects().map(part => part.globalCompositeOperation), ['source-over', 'source-over']);
  const drawing = drawingGroup(parts);
  assert.equal(drawing.needsItsOwnCache(), true);
  const exported = drawing.toSVG();
  assert.match(exported, /<g style="mix-blend-mode: multiply;">/);
  assert.match(exported, /<g style="mix-blend-mode: overlay; isolation: isolate;">/);
  assert.match(exported, /<g style="isolation: isolate;">/);
  assert.doesNotThrow(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg">' + exported + '</svg>'));
});

test('a clipped or translucent group isolates blending inside it, and only then', async () => {
  const parts = await loadDrawingParts(svg(square('#82a0c4') + '<g clip-path="url(#clip)">' + shade + '</g><g opacity="0.5">' + shade + '</g><g clip-path="url(#clip)">' + square('#000') + '</g>'));
  assert.equal(parts.length, 4);
  for (const isolated of [parts[1], parts[2]]) {
    assert.ok(isolated instanceof Group);
    assert.equal(isolated.getObjects()[0].globalCompositeOperation, 'multiply');
  }
  assert.ok(!(parts[3] instanceof Group));
  assert.equal(drawingGroup([parts[0], parts[3]]).needsItsOwnCache(), false);
});

test('a clipped group with clipped content is clipped once as a group and keeps each inner clip', async () => {
  const [group, ...rest] = await loadDrawingParts(svg('<g clip-path="url(#clip)">' + square('#f00') + '<g clip-path="url(#inner)">' + square('#0f0') + '</g></g>'));
  assert.equal(rest.length, 0);
  assert.ok(group instanceof Group);
  const [outerOnly, inner] = group.getObjects();
  assert.equal(outerOnly.clipPath, undefined);
  assert.equal(inner.clipPath.width, 20);
  // The 50 x 50 clip at the origin, relative to the center of the 40 x 40 group.
  assert.equal(group.clipPath.width, 50);
  const center = group.clipPath.getCenterPoint();
  assert.deepEqual([center.x, center.y].map(Math.round), [5, 5]);
});
