import './dom-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createProject} from '../app/src/domain/project/factory.ts';
import {parseProject} from '../app/src/domain/project/schema.ts';
import {migrateProject} from '../app/src/domain/project/migrations.ts';
import {ProjectHistory} from '../app/src/domain/project/history.ts';
import {SHAPE_DEFINITIONS, shapePath} from '../app/src/domain/shapes/registry.ts';
import {inspectImage} from '../app/src/domain/media/images.ts';
import {sanitizeSvg} from '../app/src/domain/assets/sanitize.ts';
import {buildSvgExport} from '../app/src/domain/export/exporters.ts';

const base = (id, kind) => ({id, kind, name: kind, x: 100, y: 100, width: 100, height: 100,
  scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true, locked: false,
  fill: '#dff4f5', stroke: '#066f79', strokeWidth: 2});

function samplePng() {
  const crc = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit=0; bit<8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    body.copy(output, 4);
    output.writeUInt32BE(crc(body), 8 + data.length);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const bytes = samplePng();
const image = {id: 'image-' + createHash('sha256').update(bytes).digest('hex'), name: 'sample.png',
  mimeType: 'image/png', data: bytes.toString('base64'), width: 1, height: 1};

test('every native preset has bounded, sanitizable vector geometry', () => {
  assert.ok(SHAPE_DEFINITIONS.length >= 40);
  assert.equal(new Set(SHAPE_DEFINITIONS.map(shape => shape.id)).size, SHAPE_DEFINITIONS.length);
  for (const shape of SHAPE_DEFINITIONS) for (const adjustment of [0.15, 0.4, 0.85]) {
    const path = shapePath(shape.id, adjustment);
    assert.match(path, /^M /, shape.id);
    assert.doesNotMatch(path, /NaN|Infinity|<|>/, shape.id);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="#dff4f5"/></svg>`;
    assert.match(sanitizeSvg(svg).svg, /<path/, shape.id);
  }
});

test('version 1 projects migrate; shapes, images and connector references round trip in the current format', () => {
  const old = createProject(); delete old.media; delete old.dataSources; delete old.datasets; old.formatVersion = '1.0.0';
  assert.deepEqual(migrateProject(old).media, []);
  const project = createProject();
  project.media = [image];
  project.objects = [
    {...base('shape-a', 'shape'), shapeId: 'right-arrow', adjustment: 0.5, label: 'A'},
    {...base('image-a', 'image'), mediaId: image.id, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, flipX: false, flipY: false},
    {...base('connector-a', 'connector'), fill: null, points: [-40, 0, 40, 0],
      start: {objectId: 'shape-a', site: 'right'}, end: {objectId: 'image-a', site: 'left'}, routing: 'elbow'},
  ];
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))), project);
  const badReference = structuredClone(project);
  badReference.objects[2].end.objectId = 'missing';
  assert.throws(() => parseProject(badReference), /missing object/);
  const badCrop = structuredClone(project);
  badCrop.objects[1].cropX = 1;
  assert.throws(() => parseProject(badCrop), /crop is invalid/);
  const badBytes = structuredClone(project);
  badBytes.media[0].data = Buffer.from('not a png').toString('base64');
  assert.throws(() => parseProject(badBytes), /PNG or JPEG/);
  assert.deepEqual(inspectImage(bytes), {mimeType:'image/png', width:1, height:1});
});

test('history retains image bytes across object edits and undo without losing references', () => {
  const project = createProject();
  project.media = [image];
  project.objects = [{...base('image-a','image'), mediaId:image.id, cropX:0,cropY:0,cropWidth:1,cropHeight:1,flipX:false,flipY:false}];
  const history = new ProjectHistory(parseProject(project), 2);
  for (let index=0; index<3; index++) {
    const next = history.current;
    next.objects[0].x += 10;
    history.push(next);
  }
  assert.equal(history.current.media[0].data, image.data);
  assert.equal(history.undo().objects[0].x, 120);
  assert.equal(history.undo().objects[0].x, 110);
  assert.equal(history.redo().media[0].id, image.id);
});

test('SVG export permits only validated project-owned raster data', () => {
  const project = createProject(); project.media = [image];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
    `<image x="0" y="0" width="1" height="1" xlink:href="data:image/png;base64,${image.data}"/></svg>`;
  const exported = buildSvgExport(svg, project);
  assert.match(exported, /<image/);
  assert.match(exported, /data:image\/png;base64,/);
  assert.throws(() => buildSvgExport(svg.replace(image.data, 'AA=='), project), /not present/);
  assert.throws(() => sanitizeSvg(svg), /unsupported|image/i);
});
