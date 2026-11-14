import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_LIMITS, parseBoundedJson, preflightValue, assertByteLimit, assertFileSize, assertPngDimensions } from '../app/src/domain/security/input.ts';

test('JSON nesting is bounded before parsing; brackets inside escaped text are inert', () => {
  assert.throws(() => parseBoundedJson('['.repeat(65) + '0' + ']'.repeat(65)), /nesting/);
  assert.equal(parseBoundedJson(JSON.stringify({ label: '["\\'.repeat(100) })).label.length, 300);
});
test('UTF-8 bytes and File.size are enforced independently', () => {
  assertByteLimit('αα', 4);
  assert.throws(() => assertByteLimit('ααα', 4), /byte limit/);
  assert.throws(() => assertFileSize(51 * 1_048_576, INPUT_LIMITS.projectBytes), /byte limit/);
  assert.throws(() => assertFileSize(NaN, 100), /byte limit/);
});
test('invalid JSON, reserved keys and non-finite values fail with bounded messages', () => {
  assert.throws(() => parseBoundedJson('{"private-label"'), /^InputError: The file is not valid project JSON\.$/);
  for (const key of ['__proto__', 'constructor', 'prototype'])
    assert.throws(() => parseBoundedJson(`{"${key}":{}}`), /reserved/);
  assert.throws(() => parseBoundedJson('{"x":1e999}'), /finite/);
});
test('recovery objects cannot contain cycles, prototypes or getter execution', () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => preflightValue(cyclic), /acyclic/);
  let executed = false;
  const accessor = Object.defineProperty({}, 'svg', { get() { executed = true; return ''; }, enumerable: true });
  assert.throws(() => preflightValue(accessor), /accessors/);
  assert.equal(executed, false);
  assert.throws(() => preflightValue(new Date()), /plain JSON/);
});
test('per-field, cumulative text, vector bytes and node limits apply to stored data', () => {
  assert.throws(() => preflightValue({ label: 'x'.repeat(10_001) }), /text/);
  assert.throws(() => preflightValue(Array(101).fill('x'.repeat(10_000))), /text/);
  assert.throws(() => preflightValue({ svg: 'α'.repeat(1_000_001) }), /byte limit/);
  assert.throws(() => preflightValue(Array(200_001).fill(0)), /complexity/);
  preflightValue({ svg: 'x'.repeat(10_001), text: 'α β Δ μ H₂O Ca²⁺' });
});
test('PNG allocation is denied before creating an oversized canvas', () => {
  assertPngDimensions(8_000, 8_000, 1);
  for (const [w,h,s] of [[8_001,8_001,1],[16_385,1,1],[100,100,Infinity],[100,100,-1]])
    assert.throws(() => assertPngDimensions(w,h,s), /export budget/);
});
