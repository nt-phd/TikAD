export interface ParserFixtureExpectation {
  components: number;
  drawings: number;
  wires: number;
}

export interface ParserFixture {
  expectation: ParserFixtureExpectation;
  id: string;
  note: string;
  source: string;
}

// Read-mode parser fixtures. These codify the minimum syntax surface that
// must keep working for selection and canvas projection, even before
// write-back/emission reaches full fidelity.
export const PARSER_FIXTURES: ParserFixture[] = [
  {
    id: 'named-node-with-inline-text',
    note: 'Component node with node name and inline text payload.',
    expectation: { components: 1, drawings: 0, wires: 0 },
    source: String.raw`\node[op amp, noinv input up] (N1) at (3,3) {$U_1$};`,
  },
  {
    id: 'text-node-anchored-on-reference',
    note: 'Pure text node placed on another node reference.',
    expectation: { components: 0, drawings: 1, wires: 0 },
    source: String.raw`\node[anchor=east] at (N2) {$v_i$};`,
  },
  {
    id: 'path-node-placement-with-relative-step',
    note: 'Read-only support for path-based placement using ++ relative coordinates.',
    expectation: { components: 1, drawings: 0, wires: 0 },
    source: String.raw`\path (N1.+) ++(-1,0) node[ocirc] (N2) {};`,
  },
  {
    id: 'path-text-placement',
    note: 'Text node emitted from a path statement should be read as drawing text.',
    expectation: { components: 0, drawings: 1, wires: 0 },
    source: String.raw`\path (N3) node[anchor=west] {$v_o$};`,
  },
  {
    id: 'draw-bipole-with-symbolic-endpoint',
    note: 'Bipole endpoints may resolve against symbolic anchors like (N1.D).',
    expectation: { components: 1, drawings: 0, wires: 0 },
    source: String.raw`\draw (2.5,5) to[R] (N1.D);`,
  },
  {
    id: 'draw-wire-with-reference-endpoints',
    note: 'Wire path should survive symbolic endpoints without degrading to plain coordinates in read mode.',
    expectation: { components: 0, drawings: 0, wires: 1 },
    source: String.raw`\draw (1,-1) |- (N1.-);`,
  },
  {
    id: 'node-with-calc-coordinate',
    note: 'Structured node parsing must preserve calc coordinates verbatim in the position field.',
    expectation: { components: 0, drawings: 0, wires: 0 },
    source: String.raw`\node[circ] (NG) at ($(Q1.G)-(1,0)$) {};`,
  },
  {
    id: 'draw-with-calc-endpoint',
    note: 'Draw statements should resolve calc endpoints from previously known anchors.',
    expectation: { components: 0, drawings: 0, wires: 1 },
    source: String.raw`\draw (Q1.S) -- ($(Q1.S)+(1,2)$);`,
  },
];
