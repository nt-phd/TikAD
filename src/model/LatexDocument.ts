/**
 * LatexDocument — the single source of truth for the editor.
 *
 * The document is just two strings:
 *   preamble  — everything between \documentclass and \begin{document}
 *   body      — the raw TikZ/LaTeX content inside \begin{document}…\end{document}
 *
 * The full compilable .tex is assembled by toFullSource().
 */

export const DEFAULT_PREAMBLE = `\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{siunitx}
\\usepackage{newpxtext}
\\usepackage{newpxmath}
\\usepackage{tikz}
\\usepackage[siunitx]{circuitikz}`;

export const DEFAULT_BODY = `\\begin{tikzpicture}

\\end{tikzpicture}`;

export class LatexDocument {
  preamble: string;
  body: string;

  constructor(preamble = DEFAULT_PREAMBLE, body = DEFAULT_BODY) {
    this.preamble = preamble;
    this.body = body;
  }

  /** Full compilable .tex source sent to pdflatex. */
  toFullSource(): string {
    return [
      `\\documentclass[tikz,border=2pt]{standalone}`,
      this.preamble,
      `\\begin{document}`,
      this.body,
      `\\end{document}`,
    ].join('\n');
  }

  /**
   * Parse a full .tex source and update preamble + body in place.
   * Tolerates missing sections gracefully.
   */
  loadFromSource(source: string): void {
    // Extract preamble (between \documentclass line and \begin{document})
    const preambleMatch = source.match(/\\documentclass[^\n]*\n([\s\S]*?)\\begin\{document\}/);
    if (preambleMatch) {
      this.preamble = preambleMatch[1].trim();
    }

    // Extract body (between \begin{document} and \end{document})
    const bodyMatch = source.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    if (bodyMatch) {
      this.body = bodyMatch[1].trim();
    } else {
      // No \begin{document}: treat whole source as body
      this.body = source.trim();
    }
  }
}
