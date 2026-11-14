# Icon sources

Di-Render ships **4,827 verified drawings**. Each one has a manifest record in
`app/src/assets/packs/library-manifest.json` with its creator, source URL, upstream
revision, licence, credit line and two hashes: the original file's integrity
and the normalized file's integrity. Library SVGs are named by SHA-256 and checked
again when they load.

| Source | Items | Licence | Pinned upstream |
|---|---:|---|---|
| Reactome Icon Library | 1,651 | CC BY 4.0 | [reactome/reactome_illustrations](https://github.com/reactome/reactome_illustrations) @ `f3d331c4c292` |
| Servier Medical Art (vector edition via Bioicons) | 1,370 | CC BY 3.0 | [duerrsimon/bioicons](https://github.com/duerrsimon/bioicons) @ `d29e766ea758` |
| Bioicons | 918 | CC0, CC BY 3.0/4.0, CC BY-SA 3.0/4.0, MIT (per item) | same |
| NIH BioArt Source | 706 | Public domain (5 items CC BY 4.0) | bioart.niaid.nih.gov (curated by OpenBRender/DrawPlotia) |
| BioDraws | 182 | CC BY-SA 4.0 | [biodraws/biodraws](https://github.com/biodraws/biodraws) @ `14a1b0a44598` |

The 2,665 Bioicons, Servier and NIH records from OpenBRender 0.1.0 are unchanged.
Di-Render 0.2.0 added the Reactome and BioDraws drawings, plus Bioicons drawings
that weren't in the upstream set.

## Admission rules

A drawing is admitted only if **all** of these pass, using the app's own code in a real browser:

1. `scripts/normalize-library-svg.mjs` normalizes it: class styles are expanded and editor metadata removed. Geometry is never changed.
2. `sanitizeSvg` (the strict runtime grammar in `app/src/domain/assets/strictSvg.ts`) accepts it.
3. Fabric.js (`loadDrawingParts`) builds visible geometry from it.
4. The licence is one of: CC0, public domain, CC BY 3.0/4.0, CC BY-SA 3.0/4.0, MIT.

In the 0.2.0 ingestion, 1,196 candidate files were rejected. Most use SVG masks or
`<use>` references, which the canvas engine can't edit. Others embed raster images,
or hit the size and complexity limits.

## Re-running or extending ingestion

```sh
git clone --depth 1 https://github.com/duerrsimon/bioicons /tmp/bioicons
git clone --depth 1 https://github.com/reactome/reactome_illustrations /tmp/reactome_illustrations
git clone --depth 1 https://github.com/biodraws/biodraws /tmp/biodraws
npx esbuild scripts/ingest/browser-entry.ts --bundle --format=iife \
  --alias:dompurify=./vendor/dompurify/purify.cjs --alias:fabric=./vendor/fabric/dist/index.min.mjs \
  --outfile=/tmp/ingest-bundle.js
pip install playwright && python -m playwright install chromium
python3 scripts/ingest/ingest_extra_packs.py   # idempotent: existing ids are skipped
npm test                                        # tests/library.test.mjs re-verifies every record
```

To add a new source, write a `candidates()` block in `ingest_extra_packs.py`. It should
yield name, category (one listed in `app/src/domain/assets/taxonomy.ts`), creator,
licence, credit line and pinned HTTPS source URLs.

## Not bundled, but importable

These sources aren't distributed through a public repository that can be pinned, so they
aren't bundled. Users can import them at runtime with **Plugins → My library**, which applies
the same strict grammar and records the licence chosen in its preset:

- The full Servier Medical Art site (smart.servier.com). Its newer releases are CC BY 4.0.
- The full NIH BioArt Source collection (public domain).
- SciDraw (scidraw.io): CC BY 4.0 or CC0, per item.
- Open Science Art (openscienceart.com): CC0.
- Images exported from Protein Imager (3dproteinimaging.com). Check its terms; the built-in Protein plugin is a fully open alternative.
