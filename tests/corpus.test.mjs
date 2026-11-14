import './dom-environment.mjs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg } from '../app/src/domain/assets/sanitize.ts';
import { FORMAT_VERSION, parseProject } from '../app/src/domain/project/schema.ts';
import { migrateProject } from '../app/src/domain/project/migrations.ts';
const directory = new URL('./fixtures/svg/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
for (const fixture of manifest) test('structural corpus: ' + fixture.file, async () => {
  const bytes = await readFile(new URL(fixture.file, directory), 'utf8');
  if (fixture.accepted) {
    const accepted = sanitizeSvg(bytes);
    assert.equal(sanitizeSvg(accepted.svg).svg, accepted.svg);
  } else assert.throws(() => sanitizeSvg(bytes));
});
for (const name of ['sample-processing','cell-signaling','cell-schematic','graphical-abstract','schematic-with-plot'])
  test('reference document: ' + name, async () => {
    const project = JSON.parse(await readFile(new URL('../examples/' + name + '.obf.json', import.meta.url), 'utf8'));
    const migrated = migrateProject(project);
    assert.equal(migrated.formatVersion, FORMAT_VERSION);
    assert.deepEqual(migrated.dataSources, []);
    assert.deepEqual(migrated.datasets, []);
    assert.deepEqual(parseProject(migrated), migrated);
  });
