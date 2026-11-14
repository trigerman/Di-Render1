# Di-Render

**A free, open-source scientific figure editor — a BioRender alternative that runs in your browser.**

Di-Render combines an editable vector canvas, a verified library of **4,827 open-licence scientific drawings**, data plots with statistics, and plugins for **protein structures**, **chemical structures** and **bulk icon import**. Everything runs locally in the browser; nothing is uploaded.

> Di-Render is a fork of [OpenBRender / DrawPlotia](https://github.com/GPTchatly/DrawPlotia) (Apache-2.0), itself adapted from [OpenBioFigure](https://github.com/Voldigoade/openbiofigure). See [NOTICE](NOTICE).

## Features

| Area | What you get |
|---|---|
| **Canvas** | Text, shapes, arrows and connectors, layers, groups, alignment, undo/redo, an SVG artwork editor (recolour or edit any part of a drawing), and figure templates such as pathway, workflow and graphical abstract |
| **Icon library** | 4,827 drawings in 43 categories: Reactome (1,651), Servier Medical Art (1,370), Bioicons (918), NIH BioArt (706), BioDraws (182). Every item carries its creator, source, licence and credit line |
| **Licensing** | A Licensing tab lists the credits each figure needs and flags any artwork with an unknown licence |
| **Data & plots** | CSV/TSV import and 15 editable vector plot types. Statistics: t-tests, ANOVA with Tukey, and Kruskal–Wallis with Dunn, shown as plot brackets |
| **Protein plugin** | Load a PDB ID, an AlphaFold UniProt ID or a `.pdb/.cif` file. Style it as cartoon, surface or illustrative (outlined) in [Mol\*](https://molstar.org/), then insert a transparent PNG |
| **Molecule plugin** | Draw a structure from SMILES as an editable vector ([SmilesDrawer](https://github.com/reymond-group/smilesDrawer)). About 30 common molecules are built in |
| **My library** | Bulk-import SVG/PNG files, folders, `.zip`, `.tgz` or PowerPoint kits, with licence presets for Servier, NIH BioArt, SciDraw, BioDraws and others |
| **Integrations** | A small plugin API: load external plugins from a URL, or register them with `window.DiRender.registerPlugin`. See [docs/PLUGINS.md](docs/PLUGINS.md) |
| **Export** | SVG with editable vectors, PNG at 1–4×, vector PDF through the print dialog, and portable project files |

## Host it on GitHub Pages (5 minutes)

1. Create a new GitHub repository (for example `di-render`) and push this folder to its `main` branch:
   ```sh
   git init && git add . && git commit -m "Di-Render 0.2.0"
   git branch -M main
   git remote add origin https://github.com/<you>/di-render.git
   git push -u origin main
   ```
2. On GitHub, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow builds the app and publishes it at `https://<you>.github.io/di-render/`. It sets the sub-path and your repository link automatically.

The first push uploads about 300 MB of artwork (small SVG files). Later pushes are quick.

## Run locally

You need Node.js 24.11 or newer.

```sh
npm --prefix app install
npm --prefix app run dev        # http://127.0.0.1:5173 with hot reload
# or a production build:
npm --prefix app run build && npm start   # serves app/dist at http://127.0.0.1:4173
```

The first `install` updates `app/package-lock.json` for the newly added plugin libraries. Commit that file so CI stays reproducible.

## Tests

```sh
npm ci --ignore-scripts && npm test          # domain tests: library manifest, SVG grammar, stats, projects
npm --prefix app run typecheck
npm --prefix app exec -- playwright install chromium
npm run build && npm start &                 # then, in another terminal:
npm run test:browser                         # plus the other test:*-browser suites in package.json
```

## Project layout

```
app/                      React 19 + TypeScript + Vite application
  src/editor/             Fabric.js canvas engine wrapper
  src/domain/             project schema, SVG security grammar, stats, storage, export
  src/features/           library panel, plots, data import, licensing, artwork editor
  src/plugins/            plugin host, registry, UI and built-in plugins
    builtin/protein/      Mol* protein renderer
    builtin/molecule/     SMILES → vector structure
    builtin/library/      bulk icon import + "My library" storage
  src/assets/packs/       verified library manifest (provenance for every drawing)
  public-browser/artwork/ library SVGs, named by SHA-256 and integrity-checked at load
scripts/
  ingest/                 maintainer pipeline that adds icon packs to the verified library
  vendor-sync.mjs         copies Mol* and SmilesDrawer into the build so they are self-hosted
vendor/                   pinned Fabric.js, DOMPurify and Apache POI shape geometry
docs/                     plugin API, icon sources, data analysis, security notes
.github/workflows/        GitHub Pages deploy + CI
```

## Adding more icon libraries

Built-in drawings must pass the editor's strict SVG grammar and load in Fabric.js. Every library item is integrity-checked, so a drawing can't be swapped after review. To add a source, extend `scripts/ingest/ingest_extra_packs.py` and follow [docs/ICON_SOURCES.md](docs/ICON_SOURCES.md). Users can also import any icon pack at runtime with **Plugins → My library**.

## Licence

The code is licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Each drawing keeps its own licence (CC0, public domain, CC BY 3.0/4.0, CC BY-SA 3.0/4.0 or MIT), recorded per item in `app/src/assets/packs/library-manifest.json`. Mol\* (MIT) and SmilesDrawer (MIT) are loaded on demand. Di-Render tracks licence metadata but does not give legal advice; check the terms of anything you publish.
