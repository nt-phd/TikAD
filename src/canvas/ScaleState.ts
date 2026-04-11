/**
 * ScaleState — single source of truth for the picture-environment scale factor.
 *
 * When the body contains \begin{tikzpicture}[scale=0.7] or
 * \begin{circuitikz}[scale=0.7], all canvas
 * coordinates must be multiplied by 0.7 to stay aligned with the
 * pdflatex-rendered SVG.
 *
 * effectiveGridSize = BASE_GRID_SIZE × tikzScale
 *
 * All canvas modules (ViewTransform, GhostRenderer, LatexCanvas grid)
 * read from this singleton instead of using the GRID_SIZE constant directly.
 */

import { GRID_SIZE } from '../constants';
import type { ComponentDef, ScaleFamily } from '../types';

export const scaleState = {
  tikzScale: 1.0,
  gridPitch: 0.5,
  majorGridEvery: 5,
  componentScales: {
    resistors: 1.0,
    capacitors: 1.0,
    inductors: 1.0,
    sources: 1.0,
    amplifiers: 1.0,
    nodes: 1.0,
    misc: 1.0,
  } as Record<ScaleFamily, number>,

  get effectiveGridSize(): number {
    return GRID_SIZE * this.tikzScale;
  },

  getFamilyScale(scaleFamily: ScaleFamily): number {
    return this.componentScales[scaleFamily] ?? 1.0;
  },

  getComponentScale(def: ComponentDef): number {
    return this.getFamilyScale(def.scaleFamily ?? 'misc');
  },
};

/**
 * Extract the scale= value from a supported picture environment options string.
 * Handles: [scale=0.7], [scale=1], [european, scale=0.5], etc.
 * Returns 1.0 if not found.
 */
export function extractTikzScale(body: string): number {
  const m = body.match(/\\begin\{(?:tikzpicture|circuitikz)\}\s*\[([^\]]*)\]/);
  if (!m) return 1.0;
  const scaleMatch = m[1].match(/\bscale\s*=\s*([\d.]+)/);
  return scaleMatch ? parseFloat(scaleMatch[1]) : 1.0;
}

export function extractCtikzScales(source: string): Record<ScaleFamily, number> {
  const next = {
    resistors: 1.0,
    capacitors: 1.0,
    inductors: 1.0,
    sources: 1.0,
    amplifiers: 1.0,
    nodes: 1.0,
    misc: 1.0,
  } satisfies Record<ScaleFamily, number>;

  const ctikzRe = /\\ctikzset\s*\{([^}]*)\}/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = ctikzRe.exec(source))) {
    const block = blockMatch[1];
    const scaleRe = /([a-zA-Z][a-zA-Z-]*)\s*\/\s*scale\s*=\s*([0-9]*\.?[0-9]+)/g;
    let scaleMatch: RegExpExecArray | null;
    while ((scaleMatch = scaleRe.exec(block))) {
      const family = scaleMatch[1].toLowerCase() as ScaleFamily;
      if (family in next) next[family] = parseFloat(scaleMatch[2]);
    }
  }
  return next;
}
