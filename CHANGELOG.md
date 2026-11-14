# Changelog

## 0.3.0 — templates and Servier kits

- **13 new figure templates** (19 in total): cell signaling, in vivo study design, cell culture assay, virus life cycle,
  adaptive immune response, CRISPR gene editing, randomized clinical trial, western blot, drug mechanism of action,
  gene expression, organoid drug screen, six-panel figure and research poster.
- Templates can place real library drawings (`artwork` in `templates.ts`). They load through the verified catalog,
  so licensing credits are complete, and a template still opens if a drawing can't load.
- "Illustrated" and "Layout" tags on template cards, plus preview styles for panel and poster layouts.
- Maintainer pipeline to convert Servier Medical Art PowerPoint kits into verified library SVGs
  (`scripts/ingest/servier_split_kits.py`, `servier_ingest.py`), with 12 new library categories.

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
