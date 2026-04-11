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
\\usepackage[american, siunitx, cuteinductors]{circuitikz}`;

export const DEFAULT_BODY = `\\begin{tikzpicture}

  \\node[op amp, noinv input up] (N1) at (5,0) {$U_1$};
  \\node[sground] (N4) at (3,-6) {};

  \\path
    (N1.+) ++(-1,0) node[ocirc, label=left:$v_i$] (N2) {}
    (N1.out) ++(1.5,0) node[ocirc, label=right:$v_o$] (N3) {}
    (5,-2) node[circ] {}
    (3,-2) node[circ] {}
    (5,-3.5) node[circ] {}
    (3,-3.5) node[circ] {}
    (7,-2) node[circ] {}
    (7,0) node[circ] {}
    ;

  \\draw
    (3,-2) to[R, l={$R_1$}] (5,-2) to[R, l={$R_2$}] (7,-2)
    (5,-3.5) -- ++(0,1.5)
    (3,-3.5) to[C, l={$C_1$}] (5,-3.5) to[C, l={$C_2$}] (7,-3.5) |- ++(0,3.5)
    (3,-4) |- (N1.-)
    (3,-4) to[R, l={$R_0$}] (N4)
    (N1.out) -- (N3)
    (N2) -- (N1.+)
    ;

  \\node[npn, rotate=+90, transform shape, label=$Q_1$] (Q1) at (0,0) {};
  \\node[ocirc, label=west:$V_i$] (Vi) at ($(Q1.C)+(-2.5,0)$) {};
  \\node[ocirc, label=east:$V_o$] (Vo) at ($(Q1.C)+(+2.5,0)$) {};
  \\node[sground](V0) at (-2.5,-4.5) {};

  \\draw (-2.5,0) to[resistor=$R_1$] (-2.5,-2.5) to[empty Zener diode=$D_1$, v<=$V_Z$, voltage=straight, invert, i>^=$I_Z$] (V0);
  \\draw (-2.5,-2.5) -| (0,-2) to[short, i=$I_B$] (Q1.B);
  \\draw (Q1.E) to[short, i=$I_o$]  (Vo);
  \\draw (Vi) --(-1.5,0) to[short, i=$I_C$] (Q1.C);
  \\draw (Q1.B) to[open, v=$V_{BE}$, voltage=european] (Q1.E);
  \\node[circ] at (-2.5,0) {};
  \\node[circ] at (-2.5,-2.5) {};

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
