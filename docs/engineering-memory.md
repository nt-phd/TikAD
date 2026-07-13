# Engineering Memory

This file is the compact, operational memory of decisions that must not regress.

## 2026-04-24

### Geometry pipeline and render

- Full-canvas render is the runtime geometry source for canvas behavior.
- Runtime geometry uses operational points only:
  - `reference`
  - `terminal`
  - `bounds`
- Components without explicit terminals use `reference` as operational snap point.
- Marker semantics are exclusive:
  - `cross` = grid-only anonymous point
  - `ring` = structured/snappable point
- Bounds and points are preserved across reparses; no silent wipe on parse refresh.
- Geometry convergence can schedule a second render pass when named-node geometry signature changes.

### Render server strategy

- `/render` now uses a single compile pass per request.
- Diagnostic anchor markers are injected into the same document with `opacity=0` and measured from the same SVG.
- No separate `anchors.tex` compile pass.
- Two `render_success` logs after one user action now mean two client render passes (normal + convergence), not main+diagnostic double compile.

### Catalog and semantic anchors

- CircuitikZ TeX is the semantic source; `symbols.svg` is product/preview only.
- Compact catalog keeps grouped anchor definitions by semantic equivalence (`normalizedBody` grouping in catalog build stage).
- Runtime should consume grouped names per point; avoid raw alias duplication in UI/ghost.
- Logic ports with numbered inputs must respect effective `number inputs` at runtime when building anchor probes.
  - resolved from node options first
  - then from in-scope `\ctikzset{number inputs=...}`
  - normalized to CircuitikZ behavior (`0`/`<2` => `2`)

### Snap and source update rules

- If snap mode is enabled and a snap ref exists, committed source position must be symbolic (`(Node.anchor)`), not numeric coordinates.
- If no snap ref exists, committed source position is numeric grid coordinate.
- Wire creation stores per-point `ref` (not only start/end), and emission uses per-point refs.
- Dragging and commit use current snap ref, not stale original ref.

### Legacy cleanup

- Removed legacy single-component probe path from canvas runtime behavior.
- `ComponentProbeService` removed from runtime path; library uses static previews.
- `Measured Geometry` debug block removed from Properties UI.

### UI simplifications

- Library search is debounced before filtering.
- Library visible-count badge is initialized to real catalog count (not `0` when closed).
- Upper-right panel now has two tabs:
  - `Environment`
  - `Properties`
- Default active tab is `Properties`.
- Blank line in code editor now yields no editable statement model (no accidental fallback to next line).

## Anti-regression checklist

- Do not reintroduce parser/ghost geometry fallbacks parallel to render-derived runtime geometry.
- Do not derive semantic anchor names from `symbols.svg`.
- Do not emit illegal numbered logic-port anchors beyond effective input count.
- Do not convert symbolic snapped endpoints to fractional numeric coordinates on commit.
- Do not show statement properties for blank source lines.
