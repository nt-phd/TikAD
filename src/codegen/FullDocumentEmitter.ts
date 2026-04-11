/**
 * Wraps a picture body into a complete compilable LaTeX document.
 * The preamble is shown verbatim in the CodePanel and sent as-is to pdflatex.
 */

import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { CircuiTikZEmitter } from './CircuiTikZEmitter';

export const DEFAULT_PREAMBLE = `\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}

\\usepackage{tikz}
\\usepackage{circuitikz}

\\ctikzset{resistors/scale=0.6}
\\ctikzset{inductors/scale=0.8}
\\ctikzset{capacitors/scale=0.6}
\\ctikzset{sources/scale=0.6}
\\ctikzset{amplifiers/scale=0.7}`;

export class FullDocumentEmitter {
  private tikzEmitter: CircuiTikZEmitter;

  constructor(registry: ComponentRegistry) {
    this.tikzEmitter = new CircuiTikZEmitter(registry);
  }

  /**
   * Emit the full LaTeX document, keeping the given preamble block unchanged.
   * Only the picture block is regenerated from the model.
   */
  emit(doc: CircuitDocument, preamble: string = DEFAULT_PREAMBLE): string {
    const tikzBody = this.tikzEmitter.emit(doc);
    return [
      `\\documentclass[tikz,border=2pt]{standalone}`,
      preamble,
      `\\begin{document}`,
      tikzBody,
      `\\end{document}`,
    ].join('\n');
  }

  /** Extract the preamble block from a full document source (between \documentclass and \begin{document}). */
  static extractPreamble(source: string): string {
    const m = source.match(/\\documentclass[^\n]*\n([\s\S]*?)\\begin\{document\}/);
    return m ? m[1].trim() : DEFAULT_PREAMBLE;
  }

  /** Extract the supported picture block from a full document source. */
  static extractTikzBody(source: string): string {
    const m = source.match(/(\\begin\{(?:tikzpicture|circuitikz)\}[\s\S]*?\\end\{(?:tikzpicture|circuitikz)\})/);
    return m ? m[1] : '';
  }
}
