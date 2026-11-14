import './register-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sanitizeSvg } from '../app/src/domain/assets/sanitize.ts';

const dom = new JSDOM('<!doctype html>');
const svg = body => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + body + '</svg>';
const sanitize = text => sanitizeSvg(text, dom.window);
const hostile = {
  script: '<script>globalThis.stolen = true</script>',
  handler: '<rect onload="steal()" width="10" height="10"/>',
  mixedHandler: '<rect oNlOaD="steal()"/>',
  namespacedHandler: '<rect xmlns:e="urn:evil" e:onload="steal()"/>',
  foreignObject: '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
  animation: '<animate attributeName="href" values="https://tracker.invalid"/>',
  use: '<use href="https://tracker.invalid/x.svg#x"/>',
  localUse: '<use href="#x"/><rect id="x"/>',
  image: '<image href="data:image/svg+xml;base64,PHN2Zz4="/>',
  remoteStyle: '<path d="M0 0L1 1" style="fill:url(https://tracker.invalid/x)"/>',
  escapedStyle: '<path d="M0 0L1 1" style="fill:u\\72l(https://tracker.invalid/x)"/>',
  stylesheet: '<style>@import "https://tracker.invalid";</style>',
  xmlBase: '<g xml:base="https://tracker.invalid"/>',
  wrongNamespace: '<g xmlns="urn:evil"/>',
  duplicateId: '<rect id="same"/><circle id="same"/>',
  missingReference: '<rect fill="url(#missing)"/>',
  wrongReference: '<rect id="shape"/><rect fill="url(#shape)"/>',
  cyclicClip: '<defs><clipPath id="clip"><rect clip-path="url(#clip)"/></clipPath></defs>',
  extremeGeometry: '<path d="M0 0 L1e999 1"/>',
  unsupportedFilter: '<filter id="fx"><feGaussianBlur/></filter>',
  metadataMarkup: '<metadata><a href="javascript:steal()">link</a></metadata>',
};
for (const [name, payload] of Object.entries(hostile)) test('rejects ' + name + ' before rendering', () => {
  assert.throws(() => sanitize(svg(payload)));
  assert.equal(dom.window.stolen, undefined);
});
test('DTD, entities, processing instructions, malformed XML and wrong roots fail', () => {
  for (const input of ['<!DOCTYPE svg [<!ENTITY x "boom">]>' + svg('&x;'),
    '<?xml-stylesheet href="https://tracker.invalid"?>' + svg(''),
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', '<html/>',
    '<svg xmlns="urn:evil"/>'])
    assert.throws(() => sanitize(input));
});
test('scientific labels, paths, styles and local gradients remain vector data', () => {
  const input = svg('<defs><linearGradient id="color"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#066f79"/></linearGradient></defs>' +
    '<g transform="translate(10 10)"><path d="M0 0 10 10 L20 0 Z" fill="url(#color)"/>' +
    '<text x="2" y="30" style="font-family:STIX Two Text;font-size:12;fill:#263238;">α β Δ μ °C ± × H₂O Ca²⁺ &amp; &lt;label&gt;</text></g>');
  const result = sanitize(input);
  assert.equal(result.pathCommands, 4);
  assert.match(result.svg, /α β Δ μ/);
  assert.match(result.svg, /url\(#color\)/);
  assert.equal(sanitize(result.svg).svg, result.svg);
});
test('blending and isolation are accepted only as CSS declarations with known values', () => {
  const blended = svg('<g style="isolation:isolate"><rect width="10" height="10" fill="#f00"/><rect width="10" height="10" fill="#0f0" style="mix-blend-mode:multiply"/></g>');
  assert.match(sanitize(blended).svg, /mix-blend-mode:\s*multiply/);
  // Browsers ignore the attribute form, so the editor must not render it either.
  for (const input of [blended.replace('style="mix-blend-mode:multiply"', 'mix-blend-mode="multiply"'),
    blended.replace('multiply', 'plus-lighter'), blended.replace('isolation:isolate', 'isolation:url(#x)')])
    assert.throws(() => sanitize(input));
});
test('XML depth, element count, UTF-8 bytes and implicit path expansion are bounded', () => {
  for (const input of [svg('<g>'.repeat(32) + '</g>'.repeat(32)),
    svg('<rect/>'.repeat(10_001)), svg('<desc>' + 'α'.repeat(1_000_001) + '</desc>'),
    svg('<path d="M0 0 ' + '1 1 '.repeat(100_001) + '"/>')])
    assert.throws(() => sanitize(input));
});
