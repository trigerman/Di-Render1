// Development-only: review every changed primitive before accepting regenerated snapshots.
import '../register-source.mjs';
import '../dom-environment.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dataFixture, fixtureSpec } from '../data-helpers.mjs';
import { PLOT_TYPES } from '../../app/src/domain/plots/spec.ts';
import { buildPlotScene } from '../../app/src/domain/plots/scene.ts';
const fixture = dataFixture(), directory = 'tests/fixtures/plots';
await mkdir(directory, {recursive: true});
for (const type of PLOT_TYPES) {
  const scene = buildPlotScene(fixture.source, fixture.dataset, fixtureSpec(fixture.dataset, type), 520, 380);
  await writeFile(`${directory}/${type}.json`, JSON.stringify({primitives:scene.primitives, notices:scene.notices, error:scene.error}, null, 2) + '\n');
}
