# TikAD

**TikAD** is a free, open-source CAD-style editor for creating publication-quality circuit diagrams and scientific figures using TikZ and CircuitikZ — directly in the browser, with no registration required.

Draw visually like in a CAD tool, then export clean **LaTeX** code or razor-sharp **SVG** graphics ready for papers, theses, slides, Word documents, and websites.

> **Live app:** [tikad.bsproj.it](https://tikad.bsproj.it) &nbsp;·&nbsp; **Landing page:** [tikad.app](https://tikad.app)

---

## Features

- **CircuitikZ support** — hundreds of electronic symbols from the CircuitikZ library, rendered with full LaTeX fidelity
- **CAD-like editing** — place, move, rotate, and wire components with snapping and alignment
- **Real-time LaTeX preview** — the canvas is powered by a server-side LaTeX render, so what you see is exactly what compiles
- **SVG export** — resolution-independent vector output, usable in Word, PowerPoint, web pages, and documentation
- **Clean code output** — the generated TikZ/CircuitikZ code is readable and directly pasteable into any LaTeX document
- **No account required** — open the app and start drawing immediately
- **Fully open source** — every line of code is public on GitHub

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| UI components | MUI (Material UI) v7 |
| Code editor | CodeMirror 6 |
| Render server | Node.js + Tectonic (LaTeX engine) |
| Component catalog | Built from the CircuitikZ package |

## Development

Install dependencies and start both the app and the render server:

```bash
npm install

# Start everything (render server + Vite dev server)
npm run dev:all

# Or start them separately
npm run dev          # Vite frontend only
npm run dev:render   # LaTeX render server only
```

The render server requires [Tectonic](https://tectonic-typesetting.github.io/) to be installed and available on `PATH`.

## Build

```bash
npm run build        # Build the main app
npm run build:landing  # Build the landing page
```

## Component catalog

The component catalog is extracted directly from the CircuitikZ LaTeX package and pre-rendered as SVG previews.

```bash
# Full refresh: extract → build → render previews
npm run refresh:component-catalog

# Individual steps
npm run extract:component-catalog   # Parse CircuitikZ source
npm run build:component-catalog     # Assemble catalog JSON
npm run generate:component-catalog-previews  # Render SVG previews
```

## Deploy

See [DEPLOY_VPS.md](DEPLOY_VPS.md) for VPS deployment instructions.

The landing page is deployed to Cloudflare Pages via `./deploy/deploy-landing-cloudflare.sh`.

## License

[MIT](LICENSE)
