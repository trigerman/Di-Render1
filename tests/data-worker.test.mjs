import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, fixtureSpec } from './data-helpers.mjs';

test('live preview rejects an oversized scene before posting primitives to the UI', async () => {
  const fixture = dataFixture('X,Y\n' + Array.from({ length: 1500 }, (_, index) => `${index},${index % 100}`).join('\n'));
  const spec = fixtureSpec(fixture.dataset, 'line'); spec.roles = { x: 'c0', y: 'c1' }; spec.error = 'sem';
  const previous = globalThis.self;
  let response;
  const worker = { onmessage: null, postMessage: value => { response = value; } };
  try {
    globalThis.self = worker;
    await import('../app/src/workers/dataWorker.ts');
    worker.onmessage({ data: { kind: 'plot', source: fixture.source, dataset: fixture.dataset, spec, width: 520, height: 380 } });
    assert.equal(response.ok, false);
    assert.equal(response.code, 'plot_budget');
    assert.equal(Object.hasOwn(response, 'value'), false);
    assert.match(response.error, /plot export budget/);
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
});
