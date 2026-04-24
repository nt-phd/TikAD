# Geometry And Ghosting Architecture

## Goal

Keep parsing, geometric inference, and ghost rendering strictly separated.

The system should work in three stages:

1. Parse LaTeX/TikZ source into structured statements.
2. Resolve structured positions into numeric geometry and store the result in the document.
3. Render ghosting and selection only from precomputed document geometry.

## Source Of Truth

There is one numeric source of truth for positions:

- [TikzGeometryEngine.ts](/home/nikit/TikAD/src/codegen/TikzGeometryEngine.ts)
- [TikzPositionResolver.ts](/home/nikit/TikAD/src/codegen/TikzPositionResolver.ts)
- [TikzGeometryStore.ts](/home/nikit/TikAD/src/codegen/TikzGeometryStore.ts)
- [CircuitDocument.ts](/home/nikit/TikAD/src/model/CircuitDocument.ts)

The parser may extract `positionTexts`, but it must not invent geometry locally.

The ghost renderer may display geometry, but it must not parse statements or resolve positions locally.

## Symbols.svg Boundary

`symbols.svg` is not a semantic geometry source.

It exists only to support:

- library thumbnails
- static previews
- approximate visual bounding boxes for preview rendering

It must not be used as the source of truth for:

- canonical CircuitikZ/TikZ anchor names
- semantic pin naming
- coordinate inference for the local geometry engine
- statement position resolution

In particular:

- if CircuitikZ documents anchors like `G`, `S`, `D`, the geometry layer must expose those names
- it is not acceptable to derive semantic anchor names from preview-only metadata such as `START`, `END`, `gate` found in `symbols.svg`

Preview metadata may help draw something on screen, but it must never define how the math works.

## Responsibilities

### 1. Parsing

Parsing lives in:

- [TikzStructuredStatement.ts](/home/nikit/TikAD/src/codegen/TikzStructuredStatement.ts)
- [TikzPointParser.ts](/home/nikit/TikAD/src/codegen/TikzPointParser.ts)
- [StatementEditorModel.ts](/home/nikit/TikAD/src/codegen/StatementEditorModel.ts)
- [CircuiTikZParser.ts](/home/nikit/TikAD/src/codegen/CircuiTikZParser.ts)

Rules:

- Parse statements into structured syntax.
- Preserve raw position text exactly.
- Do not duplicate coordinate math in parser branches.

### 2. Geometry

Geometry inference lives in:

- [TikzGeometryEngine.ts](/home/nikit/TikAD/src/codegen/TikzGeometryEngine.ts)
- [TikzPositionResolver.ts](/home/nikit/TikAD/src/codegen/TikzPositionResolver.ts)
- [TikzGeometryStore.ts](/home/nikit/TikAD/src/codegen/TikzGeometryStore.ts)
- [TikzComponentAnchors.ts](/home/nikit/TikAD/src/codegen/TikzComponentAnchors.ts)

Rules:

- Resolve positions sequentially, statement by statement.
- Update the symbol database incrementally.
- Register named references and derived anchors in the geometry store.
- Store resolved statement positions in the document so other systems can read them directly.
- Component terminals and references must come from the full-canvas geometry render.
- The semantic grouping source of truth is the catalog's `normalizedBody` consolidation, not ad hoc UI grouping.
- Do not recreate anchor grouping or coordinate derivation in canvas, hit testing, parser, or UI helpers.
- Do not fabricate semantic pins from static SVG metadata.
- If full geometry is not yet measured, only the operational `reference` may exist for components whose connection model is `reference`-only.

### 3. Ghosting

Ghosting lives in:

- [GhostRenderer.ts](/home/nikit/TikAD/src/canvas/GhostRenderer.ts)

Rules:

- Read only from `CircuitDocument`.
- Never call parsing helpers.
- Never resolve coordinates from source text.
- Never implement fallback geometry paths parallel to the geometry engine.

If a selected statement has no materialized geometry in the document, ghosting should show nothing.
That is intentional. It exposes missing geometry upstream instead of hiding it with fallback logic.

## Anti-Patterns

Do not reintroduce these:

- Parser-side coordinate resolution duplicated in ad hoc regex branches.
- Ghost renderer reading source text and reconstructing geometry.
- Fallback renderers that behave differently from document geometry.
- Multiple numeric stores for the same symbolic references.

## Expected Flow

1. Source changes.
2. Parser builds structured statements.
3. Geometry engine resolves positions and updates `CircuitDocument.geometry`.
4. Parser materializes runtime entities from resolved geometry.
5. Ghosting, selection, and debug UI read only the materialized geometry.

## Practical Rule

When adding a new TikZ construct, ask:

- Is this syntax parsing? Then update the structured parser.
- Is this coordinate semantics? Then update the geometry engine or resolver.
- Is this visual overlay behavior? Then update the ghost renderer.

If a change touches more than one of these layers, the interfaces are probably leaking.

## Database Structure

There are three distinct geometry-related data layers. They must not be merged conceptually.

### 1. Component Catalog

The component catalog is the semantic source of truth for legal names exposed by CircuitikZ.

It must be generated from the official CircuitikZ TeX sources:

```text
CircuitikZ TeX -> component catalog
CircuitikZ TeX -> SVG previews
```

Never the reverse.

`symbols.svg` is a product for preview rendering only. It must not define semantic pin names, anchor names, or geometry rules.

The compact catalog representation is:

```ts
anchorDefs: Array<{
  names: string[];
  normalizedBody: string;
  role: 'terminal' | 'reference' | 'geometry' | 'internal' | 'text' | string;
}>
```

Rules:

- `normalizedBody` is the source of truth for anchor-name equivalence.
- If two names in the same concrete component have the same `normalizedBody` and `role`, they belong to the same semantic point group.
- The catalog may keep all roles, including internal anchors, because it is the authoritative semantic database.
- The serialized catalog should stay compact:
  - grouped `names[]`
  - no duplicated raw anchor-name arrays
  - no duplicated derived point lists if they can be rebuilt at load time

### 2. Render-Operational Geometry Set

The render-operational set is the subset of catalog geometry actually needed by the canvas.

For the current canvas behavior, the required set is:

- `reference`
- `terminal`
- `bounds`

Not required in the normal render path:

- internal anchors
- generic geometry anchors such as `north`, `west`, `text`
- any other point that is not used by ghosting, snapping, or selection

This means the render request builder should only emit probes for points that are canvas-relevant.

That reduces:

- TeX instrumentation size
- SVG marker count
- DOM parsing work
- runtime geometry payload

### 3. Runtime Cartesian Geometry Database

The runtime cartesian database is the materialized geometry actually consumed by the canvas.

This database should not carry `normalizedBody`.

`normalizedBody` is needed to build the groups in the catalog, but once grouping is complete the runtime database should only keep:

```ts
{
  componentId: string;
  nodeName: string;
  role: string;
  names: string[];
  point: { x: number; y: number };
}
```

and for bounds:

```ts
{
  componentId: string;
  nodeName: string;
  left: number;
  top: number;
  width: number;
  height: number;
}
```

Preferred runtime organization:

```text
componentId + nodeName
  -> reference[]
  -> terminal[]
  -> bounds
```

where each terminal/reference entry is already grouped by semantic equivalence:

```ts
{
  names: ['G', 'gate', 'G1', 'gate1', 'B', 'base'],
  point: { x: -0.98, y: 0.27 },
  role: 'terminal',
}
```

The runtime may keep a secondary lookup index for convenience:

```text
nodeName.anchorName -> grouped point entry
```

but that index is secondary. The grouped point entry is the primary runtime object.

## Consolidation Rule

Consolidation must happen once, deterministically, from catalog semantics.

The rule is:

```text
same component + same role + same normalizedBody -> one semantic point group
```

## Components Without Explicit Terminals

Some CircuitikZ node components expose no explicit public terminal anchors in the TeX catalog, but still have a meaningful connection point.

Examples:

- `vcc`
- `ground` / `sground` / `nground`
- `circ`
- `ocirc`

For these components, the operational rule is:

1. Inspect the TeX-derived catalog.
2. If explicit public terminals exist, use them.
3. If no explicit public terminals exist, use the component `reference` as the operational snap point.
4. The runtime cartesian database must therefore contain a snappable `reference` point for that component.

This is not a visual fallback. It is the semantic operational model for components whose only meaningful connection point is their reference.

In other words:

```text
explicit terminals exist -> snap to terminals
no explicit terminals    -> snap to reference
```

The renderer must not invent a different point.

## Marker Semantics

The canvas uses exactly two marker semantics for point feedback:

- `cross` = anonymous grid point
- `ring` = structured/snappable semantic point

These are mutually exclusive states.

Therefore:

- a component snapped to a named terminal shows a `ring`
- a component snapped to a reference-only point shows a `ring`
- a free point on grid shows a `cross`

It is incorrect to show both `cross` and `ring` on the same point, because they encode different semantics.

## Runtime Completion Rule

The render-derived point set is primary, but the runtime database may complete it deterministically from document structure when the catalog semantics require it.

Current rule:

- if a component has `geometry.reference.snap = true`
- and no measured `reference` point was produced for that node
- the runtime database materializes the `reference` point from the component position

This completion is valid because:

- the component position is already the source of truth for its `reference`
- the catalog explicitly says that `reference` is the operational snap point
- no alternative semantic point is being invented

This keeps the system universal and deterministic without introducing a parallel geometry model.

That group:

- keeps all equivalent names in `names[]`
- is rendered once
- is stored once in the runtime cartesian database
- is shown once in the ghost/debug UI

The system must not re-discover equivalence at runtime from coincident coordinates.

Coordinate coincidence may be used for diagnostics, but never as the source of truth.

## Debug Views

Debug output should reflect the runtime grouped database, not raw expanded alias entries.

The default debug view should show:

- `componentId`
- `defId`
- `nodeName`
- `reference`
- `bounds`
- grouped `terminal` entries with `names[]` and `point`

Raw/internal anchors should only appear in an explicit diagnostic mode, not in the default canvas debug view.
