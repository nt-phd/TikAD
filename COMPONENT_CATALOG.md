# Component Catalog Pipeline

This repo now has a dedicated pipeline for building a controlled component catalog from two sources:

- official CircuitikZ TeX files installed through TeX Live
- local `symbols.svg` metadata vendored from CircuiTikZ-Designer

The goal is to keep the runtime library independent from raw SVG ordering and let us curate:

- visible tags
- aliases
- groups
- search terms
- preview bindings
- manual ordering overrides

## Files

- `scripts/extract-circuitikz-catalog.mjs`
  Extracts raw component and package-option data from official CircuitikZ sources and enriches it with `symbols.svg` metadata.

- `src/data/component-catalog.raw.json`
  Generated raw extraction output.

- `src/data/component-catalog.overrides.json`
  Manual editorial overrides. This is where we can force `displayName`, `group`, `order`, `aliases`, `previewDefId`, and search terms.

- `scripts/build-component-catalog.mjs`
  Merges the raw extraction and overrides into the final catalog used by the app.

- `src/data/component-catalog.json`
  Generated final catalog, sorted by:
  1. explicit `order`
  2. tag length
  3. alphabetical order

- `scripts/render-component-catalog-previews.mjs`
  Renders our own SVG previews from the final catalog through LaTeX.

- `public/component-catalog-previews.json`
  Generated preview cache keyed by component tag.

## Commands

```bash
npm run extract:component-catalog
npm run build:component-catalog
npm run generate:component-catalog-previews
```

Or all at once:

```bash
npm run refresh:component-catalog
```

## Notes

- The raw extractor uses the locally installed official CircuitikZ files resolved with `kpsewhich`.
- The overrides file is the intended place for editorial control.
- The preview generator renders from the final catalog, so it is independent from `symbols.svg` ordering.
