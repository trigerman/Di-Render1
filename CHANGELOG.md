# Changelog

## 0.3.0 — templates and Servier kits

- **13 new figure templates** (19 in total): cell signaling, in vivo study design, cell culture assay, virus life cycle,
  adaptive immune response, CRISPR gene editing, randomized clinical trial, western blot, drug mechanism of action,
  gene expression, organoid drug screen, six-panel figure and research poster.
- Templates can place real library drawings (`artwork` in `templates.ts`). They load through the verified catalog,
  so licensing credits are complete, and a template still opens if a drawing can't load.
- "Illustrated" and "Layout" tags on template cards, plus preview styles for panel and poster layouts.
- **All 49 Servier Medical Art kits** converted into **4,264** verified, editable vector drawings (CC BY 4.0),
  across 13 new categories (cardiovascular, musculoskeletal, digestive, respiratory, urinary, reproductive,
  endocrinology, dermatology, ENT and ophthalmology, medical equipment, drugs, nutrition, maps and more).
  The library grows from 4,827 to **9,087** drawings.
- Maintainer pipeline for the kits: `scripts/ingest/servier_split_kits.py` and `servier_ingest.py`.
- **Blossom theme**: a soft pink-and-white palette, now the default. Light, Dark and System remain in Settings.
  Figure paper stays white so exports are unaffected.
- Removed four duplicate drawings (three BioDraws, one Servier).
- **Publication licence check**: the License panel says whether a figure is ready for CC BY and
  subscription journals, flags CC BY-SA (ShareAlike) drawings, and gives a short legend to copy.
  Servier drawings are credited with one line, as Servier's FAQ suggests.
- Library: **Journal-safe (no ShareAlike)** licence filter and a BY-SA badge on ShareAlike drawings.
- Protein (PDB, AlphaFold DB) and molecule images now carry their data citation into the
  legend and ATTRIBUTIONS.md, instead of only copying it to the clipboard.
- New guide: [docs/PUBLISHING.md](docs/PUBLISHING.md), with each source's terms and links.
- Servier splitter rewritten to handle 60 MB slides in seconds; very large drawings are
  compacted to fit. Recovered the Arteries pathophysiology kit, which an interrupted run had skipped.

## 0.2.0 — Di-Render

- Renamed to **Di-Render**; forked from OpenBRender / DrawPlotia 0.1.0.
- **Plugins tab** with a stable host API, enable/disable, external plugins by URL and `window.DiRender.registerPlugin`.
- **Protein structure** plugin (Mol*): PDB IDs, AlphaFold DB, local `.pdb/.cif`. Illustrative, cartoon and surface styles, black outlines, transparent PNG insert, and a copied citation.
- **Molecule from SMILES** plugin: editable vector structures, about 30 common molecules, PNG fallback.
- **My library & icon import** plugin: files, folders, ZIP, TGZ and PPTX. Bioicons licence folders are detected, with licence presets per source, packs that can be exported and imported, and storage in the browser.
- Library grows from 2,665 to **4,827** verified drawings (Reactome, BioDraws, more Bioicons and Servier). Four new categories.
- GitHub Pages deployment (`DI_RENDER_BASE` sub-path support, `VITE_REPO_URL`) and CI workflows.
- Library thumbnails and help links work under a sub-path.
- The left sidebar fits four tabs on one row.
