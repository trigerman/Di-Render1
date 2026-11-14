# Public snapshot validation — 2026-10-11

The production app was built from this public source candidate after fresh locked
dependency installation. It ran on a separate loopback port in isolated Chromium
contexts. Tests did not change an existing user's browser documents.

## Results

- Domain tests: **493 passed, 0 failed**.
- Domain and browser TypeScript checks: passed.
- Production build: passed.
- Browser checks: **144 passed, 0 failed**, Chromium 153.0.8010.12.
- Native shape/image workflow: passed (gallery, connectors, PNG import, crop,
  Undo/Redo, portable reopen, reload and SVG/PNG/vector-PDF export).
- Local server boundary probes: **7 passed**, covering exact page bytes and
  security headers, HEAD, rejected POST, foreign Host, traversal/malformed paths,
  no-store errors and script MIME/cache headers.
- Browser reports recorded no uncaught errors or external application requests.

| Browser suite | Passed |
| --- | ---: |
| Editor | 25 |
| SVG dragging | 8 |
| Saved figures | 35 |
| Data plots | 21 |
| Workflow navigation | 13 |
| Column plots | 7 |
| Plot types | 6 |
| Statistical comparisons | 10 |
| Smart defaults | 13 |
| Long and wide statistics | 6 |

Real pointer drags were tested from both SVG thumbnails and card titles. A mixed
catalogue-ID/SVG-file payload inserted only verified artwork. PNG/JPEG file drops,
unknown IDs, malformed/hostile input, Undo/Redo, saving, reopening and exports were
checked. Figure switching checks exercised delayed startup, pending edits,
failed writes, recovery, overlapping requests and stale asynchronous completions.

Plot coverage included Back/Reset, automatic mappings, all 15 plot types,
SD defaults, specific paired comparisons with adjustment, ANOVA/Tukey,
Kruskal/Dunn, crowded annotations and long/wide data. The reported
Student_Status/Major/Grade example passed. Old-format example projects migrated.

## Build integrity

- Files: 2708
- index.html SHA-256: `f1a6ccd3aeac57a296a6fd81399de101324d51a598bc1eaa24e11b2dc8454125`
- Sorted file-manifest SHA-256: `5602f1a4c0675429bee259e36e9d550ba03f4fb26e601f4ce290a1b73b9ae674`

The manifest digest is SHA-256 of compact JSON containing sorted objects with
`path` and `sha256` keys for every file under `app/dist/`.
Nine browser reports include a build digest and matched the index above. The
saved-figure harness has no digest field; the serving page was checked against
the same unchanged build before and after the browser suites.

All 2,665 source drawings and their built copies matched their SHA-256 names.
Pinned shape source files and both copies of their licence notices matched the
upstream evidence in the Git index. Required byte-preserving Git attributes ship
with the release. See [the security review](RELEASE_SECURITY.md).

A separate clean Git checkout installed both pinned dependency sets, passed
domain typechecking and rebuilt all 2,708 production files byte-for-byte. Its
6,230 tracked release files were rechecked for forbidden content, and pinned
shape bytes survived checkout unchanged.

## Reproduce

From the repository root:

```sh
npm ci --ignore-scripts
npm --prefix app ci --ignore-scripts
npm test
npm run typecheck:domain
npm run build
npm start
```

With the app running, install the matching Playwright Chromium binary if needed
and run:

```sh
npm --prefix app exec -- playwright install chromium
npm run test:browser
npm run test:svg-drag-browser
npm run test:shapes-images-browser
node tests/figure-library-browser.mjs
node tests/data-plots-browser.mjs
node tests/plot-workflow-browser.mjs
node tests/column-plots-browser.mjs
node tests/plot-types-browser.mjs
node tests/analysis-browser.mjs
node tests/smart-plots-browser.mjs
node tests/long-stats-browser.mjs
```

Test reports and downloaded exports are generated under ignored `reports/`.
Use OPENRENDER_PORT consistently for the server and browser tests when choosing
another port. Validation covers the local Chromium application; Firefox, WebKit,
native installers and external infrastructure were not tested for this snapshot.
