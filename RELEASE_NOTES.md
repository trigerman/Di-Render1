# OpenBRender 0.1.0 (upstream snapshot, kept for reference) — open-source snapshot, 2026-10-11

This release updates the supported local browser editor's source, production
build, tests, examples and required licence notices. The application version
remains 0.1.0; the date identifies this snapshot.

## Changes since 2026-10-08

- Insert plot and the Data tab accept local CSV/TSV files, pasted tables and typed
  values. Back, earlier-step navigation and Reset support revising the draft.
- Fifteen editable vector plot types include ordinary and grouped columns,
  dot plots with a cross bar or column, lines, areas, boxes and violins.
- Initial mappings recognize column-header groups, mean values with SD error
  bars, numeric X values, and long or wide time series. Mappings stay editable.
- Independent and paired tests support explicit pairs, all pairs or a control.
  Pair choices apply automatically. Matching rules and exclusions are visible.
- One-way ANOVA supports Tukey HSD / Tukey–Kramer; Kruskal–Wallis supports Dunn
  comparisons. Overall-test annotations and comparison brackets can be displayed
  independently. Crowded brackets compact instead of blocking valid plots.
- Long, wide, replicate-column and separate-series data share the analysis
  engine. Statistical reference fixtures and browser regression checks ship
  with the source, including the previously missing root test harness.
- The Figures tab lists, reopens and deletes figures saved in this browser.
- Adjustable native shapes, attached connectors and local PNG/JPEG images with
  reversible crop, replace and flip travel with portable projects and exports.
- Dragging library SVG thumbnails inserts verified catalogue artwork, even when
  the browser also supplies a thumbnail file. External PNG/JPEG drops still work.
- The local server uses its own security-header configuration. The Source link
  points to this public project. The README, introductory GIF and existing
  artwork attribution are preserved.

## Compatibility and scope

The project format is 3.0.0. Older 1.0.0 and 2.0.0 projects migrate on opening;
the older app cannot read newly saved projects. Keep portable backups before
clearing browser data. Data, artwork and media remain in local browser storage.

One-way ANOVA here assumes independent groups; it is not repeated-measures or
two-way ANOVA. Scientific suitability and publication rights remain the figure
author's responsibility. PDF export uses the browser print dialog.

Only selected product source, tests, fixtures, examples, licences and user
documentation are distributed. Dependency installations, generated reports,
credentials, agent configuration, machine-specific helpers and previous archives
are excluded. Required third-party notices are retained.

See [the validation record](docs/RELEASE_VALIDATION.md) for checks on this
snapshot and [the local security policy](docs/LOCAL_SECURITY.md) for boundaries.
