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
- Component anchors must come from the live selection probe produced by the current render.
- The canonical bridge is [TikzComponentAnchors.ts](/home/nikit/TikAD/src/codegen/TikzComponentAnchors.ts).
- Do not recreate probe-to-anchor conversion in canvas, hit testing, parser, or UI helpers.
- Do not fabricate semantic pins from static metadata when the probe is not ready.
- If the probe is missing, only the node reference point may exist; semantic anchors remain unresolved until the probe arrives and the geometry pass runs again.

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
