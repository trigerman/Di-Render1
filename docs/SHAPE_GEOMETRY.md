# Native shape geometry

The 2026-10-09 appearance revision replaces the hand-authored standard-shape
outlines with DrawingML presets from **Apache POI 5.4.1**, under **Apache-2.0**.
44 gallery entries map to 43 upstream definitions; the remaining entry is the
scientific inhibition T-bar, composed of two open strokes. Existing project IDs
remain valid. Older native shapes adopt the new outlines when reopened; their
saved position, dimensions, paint, adjustment and label remain project data.

## Source and license

- Repository: https://github.com/apache/poi
- Release: `REL_5_4_1`
- Commit: `4554f204cbbf00ecbcaed134fe57e43a1779a612`
- Definitions: `poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml`
- Git blob: `f3c3f2ca33263e5bc4127409bab72675ca77780d`
- License: https://github.com/apache/poi/blob/4554f204cbbf00ecbcaed134fe57e43a1779a612/legal/LICENSE

The unmodified XML, full upstream LICENSE and NOTICE, and SHA-256/Git blob hashes
are retained in `vendor/poi-shapes/`. The static app ships copies of both legal
files in `app/public-browser/licenses/poi-shapes-*.txt`. No Java runtime or POI
dependency is needed by the application. No geometry is downloaded at runtime.

`node scripts/generate-shape-presets.mjs` checks the upstream file hashes and
mechanically extracts only the admitted presets into
`app/src/domain/shapes/presetData.ts`. Regenerate that file instead of drawing or
editing its paths by hand. The extraction retains adjustment formulas, text
rectangles, path coordinate spaces, and separate fill/stroke flags.

## Rendering and adaptations

`drawingml.ts` evaluates the finite set of numeric DrawingML operations used by
the bundled data. It does not evaluate JavaScript, load user-defined formulas,
or accept raw shape markup. Elliptical arcs are converted from DrawingML's
radial angles, including full circles and reversed arcs.

`registry.ts` maps stable IDs to the upstream presets. The curved arrow uses
Office's `swooshArrow`, the split arrow uses `leftRightUpArrow`, and the thought
bubble uses `cloudCallout`. The speech bubble shares the rounded callout preset
with its tail on the right. The circular arrow uses a longer sweep, and the brace
uses a larger curvature adjustment appropriate for a narrow frame. The arc is
an open semicircle. Braces and brackets are open outlines. Callout frames reserve
vertical space for the tail; native labels use the upstream text rectangle.
These are preset selections and documented parameter/style adaptations, not
edits to the upstream definitions.

Gallery previews and canvas objects use the same geometry at each shape's
intended aspect ratio. New shapes use a restrained blue-gray fill and outline;
existing saved colors are respected. Vertical arrows start tall, horizontal
arrows start wide, stars start approximately square, and braces start narrow.

The Fabric adapter keeps a fixed object frame, lays out the geometry at the
displayed size, and uses a uniform outline. Resizing a native shape recalculates
its preset geometry on completion; changing width/height in the inspector does
the same immediately. This preserves circular corners and proportionate
arrowheads instead of stretching a square drawing. Labels stay in their text
region and fit within it down to an 8 px font size. Group-level transforms retain
the editor's existing transform semantics.

## Verification

- `node --import ./tests/register-source.mjs --test tests/shape-geometry.test.mjs tests/shapes-images.test.mjs`
- `node --import ./tests/register-source.mjs tests/shape-presets-browser.mjs`
- `node --import ./tests/register-source.mjs tests/shape-appearance-browser.mjs`
- `node tests/shapes-images-browser.mjs`

Browser scripts use the built application at `127.0.0.1:4173`. The appearance
test creates all 45 native shapes, exercises labels, resizing, recoloring,
rotation and adjustment, and checks pixel-identical save/reopen. Review
`reports/shapes-images/presets.png`, `canvas-shapes.png` and
`arrows-gallery.png` visually as well as checking automated results.

Local results on 2026-10-09: production build and domain typecheck passed; the
full unit suite passed 143/143 and Chromium regression checks passed 25/25.
The 45-preset contact sheet, 45-shape editor/export/reopen test and the existing
shape/image/connector browser test passed. After the final adjustment-range
refinement, the nine focused unit checks, build and both feature browser tests
passed again. The exported sheet and light/dark gallery screenshots were
visually inspected. No deployment or packaged-release publication was performed.
