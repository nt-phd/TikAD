// ============================================================
// GEOMETRY
// ============================================================

export interface GridPoint {
  x: number;
  y: number;
}

export interface ConnectionRef {
  anchor: string;
  componentId: string;
  nodeName: string;
}

export type PathCornerKind = 'absolute' | 'reference' | 'relative';

export interface PathCornerPreview {
  kind: PathCornerKind;
  point: GridPoint;
  ref?: ConnectionRef;
  relativeFromIndex?: number;
}

export interface PositionSequencePreview {
  corners: PathCornerPreview[];
  point: GridPoint;
  ref?: ConnectionRef;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;
export type Mirror = 'none' | 'horizontal' | 'vertical';

// ============================================================
// COMPONENT DEFINITIONS (static library)
// ============================================================

export type PlacementType = 'bipole' | 'node' | 'monopole';
export type ScaleFamily = 'resistors' | 'capacitors' | 'inductors' | 'sources' | 'amplifiers' | 'nodes' | 'misc';

export interface SymbolPin {
  name: string;
  x: number;
  y: number;
}

export interface ComponentDef {
  id: string;
  displayName: string;
  category: 'passive' | 'source' | 'switch' | 'diode' | 'ground' | 'transistor' | 'amplifier' | 'logic' | 'misc';
  placementType: PlacementType;
  /** CircuiTikZ key for code generation */
  tikzName: string;
  /** ID of the <symbol> in symbols.svg, e.g. "path_european-resistor" */
  symbolId: string;
  /**
   * For bipole (path) symbols: distance in symbol SVG units between START and END pins.
   * Used to compute the scale factor when rendering between two grid points.
   * = pin_END.x - pin_START.x  (always positive, in SVG pts)
   */
  symbolPinSpan: number;
  /**
   * For node/monopole symbols: the reference point (x,y) in SVG units
   * is where the component's electrical connection point sits.
   */
  symbolRefX: number;
  symbolRefY: number;
  symbolPins?: SymbolPin[];
  shapeBBoxX?: number;
  shapeBBoxY?: number;
  shapeBBoxW?: number;
  shapeBBoxH?: number;
  /** viewBox of the symbol */
  viewBox: string;
  viewBoxW: number;
  viewBoxH: number;
  defaultProps: ComponentProps;
  scaleFamily?: ScaleFamily;
  shortcut?: string;
  /** Original group from symbols.svg, e.g. "Resistive bipoles" */
  group?: string;
}

// ============================================================
// COMPONENT INSTANCES (runtime)
// ============================================================

export type TerminalMark = 'none' | 'circ' | 'ocirc' | 'diamondpole' | 'rectjoinfill';

export interface ComponentProps {
  annotation?: string;
  label?: string;
  value?: string;
  voltage?: string;
  current?: string;
  flow?: string;
  options?: string;
  text?: string;
  textAnchor?: string;
  startTerminal?: TerminalMark;
  endTerminal?: TerminalMark;
}

export interface BipoleInstance {
  id: string;
  defId: string;
  type: 'bipole';
  start: GridPoint;
  end: GridPoint;
  startRef?: ConnectionRef;
  endRef?: ConnectionRef;
  startSequence?: PositionSequencePreview;
  endSequence?: PositionSequencePreview;
  props: ComponentProps;
}

export interface NodeInstance {
  id: string;
  defId: string;
  type: 'node';
  nodeName?: string;
  position: GridPoint;
  positionSequence?: PositionSequencePreview;
  rotation: Rotation;
  mirror: Mirror;
  props: ComponentProps;
}

export interface MonopoleInstance {
  id: string;
  defId: string;
  type: 'monopole';
  nodeName?: string;
  position: GridPoint;
  positionSequence?: PositionSequencePreview;
  rotation: Rotation;
  props: ComponentProps;
}

export type ComponentInstance = BipoleInstance | NodeInstance | MonopoleInstance;

// ============================================================
// WIRES
// ============================================================

export interface WireInstance {
  endRef?: ConnectionRef;
  id: string;
  operators?: Array<'--' | '|-' | '-|'>;
  pathPoints?: GridPoint[];
  pathSequences?: PositionSequencePreview[];
  points: GridPoint[];
  startRef?: ConnectionRef;
  junctions: Map<number, TerminalMark>;
}

export type WireRoutingMode = 'auto' | '--' | '|-' | '-|';

// ============================================================
// DRAW PATHS (unified entity for \draw statements)
// ============================================================

export interface DrawPathSegment {
  kind: 'connection' | 'bipole';
  // for connection segments:
  operator?: '--' | '|-' | '-|';
  // for bipole segments:
  defId?: string;
  props?: ComponentProps;
}

/**
 * Represents a full \draw statement as a single entity.
 * positionSequences[i] are the N explicit positions (crosshairs).
 * segments[i] is the segment between positionSequences[i] and positionSequences[i+1].
 * points[] is the expanded point list for physical rendering (includes intermediate
 * corner points for -| and |- operators).
 */
export interface DrawPathInstance {
  id: string;
  positionSequences: PositionSequencePreview[];
  segments: DrawPathSegment[];
  points: GridPoint[];
  startRef?: ConnectionRef;
  endRef?: ConnectionRef;
  junctions: Map<number, TerminalMark>;
}

// ============================================================
// DRAWINGS
// ============================================================

export type DrawingKind = 'line' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'bezier';

export interface DrawingProps {
  anchor?: string;
  options?: string;
  rotation?: string;
  scale?: string;
  text?: string;
}

export interface LineDrawingInstance {
  id: string;
  kind: 'line' | 'arrow';
  start: GridPoint;
  end: GridPoint;
  props: DrawingProps;
}

export interface TextDrawingInstance {
  id: string;
  kind: 'text';
  position: GridPoint;
  props: DrawingProps;
}

export interface RectangleDrawingInstance {
  id: string;
  kind: 'rectangle';
  start: GridPoint;
  end: GridPoint;
  props: DrawingProps;
}

export interface CircleDrawingInstance {
  center: GridPoint;
  id: string;
  kind: 'circle';
  props: DrawingProps;
  radius: number;
}

export interface BezierDrawingInstance {
  control1: GridPoint;
  control2: GridPoint;
  end: GridPoint;
  id: string;
  kind: 'bezier';
  props: DrawingProps;
  start: GridPoint;
}

export type DrawingInstance =
  | LineDrawingInstance
  | TextDrawingInstance
  | RectangleDrawingInstance
  | CircleDrawingInstance
  | BezierDrawingInstance;

// ============================================================
// DOCUMENT
// ============================================================

export interface DocumentMetadata {
  style: 'european' | 'american';
  gridSize: number;
  snapSize: number;
  scale: number;
}

// ============================================================
// STRUCTURED STATEMENT EDITOR
// ============================================================

export type EditableStatementCommand = 'draw' | 'path' | 'node' | 'ctikzset' | 'tikzpicture' | 'circuitikz';
export type EditableConnectionOperator = '--' | '|-' | '-|';

export interface EditableConnectionSegment {
  kind: 'connection';
  endPositionText: string;
  operator: EditableConnectionOperator;
}

export interface EditableBipoleSegment {
  kind: 'bipole';
  endPositionText: string;
  optionsText?: string;
  tikzName: string;
  /** Inline value attached to the component name, e.g. "=$D_1$" in "empty Zener diode=$D_1$" */
  tikzValue?: string;
  props: Pick<ComponentProps, 'annotation' | 'current' | 'endTerminal' | 'flow' | 'label' | 'startTerminal' | 'voltage'>;
  variantTokens?: Partial<Record<'annotation' | 'current' | 'flow' | 'label' | 'voltage', string>>;
}

export interface EditableNodeSegment {
  kind: 'node';
  nodeName?: string;
  optionsText?: string;
  positionText: string;
  text?: string;
  tikzName?: string;
}

export interface EditableRawSegment {
  kind: 'raw';
  rawText: string;
}

export interface EditablePackageSegment {
  kind: 'package';
  name: string;
  optionsText?: string;
}

export type EditableSegment =
  | EditableConnectionSegment
  | EditableBipoleSegment
  | EditableNodeSegment
  | EditablePackageSegment
  | EditableRawSegment;

export type EditableStatementEditField =
  | 'annotation'
  | 'annotation-style'
  | 'command'
  | 'current'
  | 'current-style'
  | 'end-node'
  | 'end-position'
  | 'flow'
  | 'flow-style'
  | 'label'
  | 'label-style'
  | 'object'
  | 'options'
  | 'position'
  | 'raw'
  | 'row-options'
  | 'start-node'
  | 'text'
  | 'unparsed-options'
  | 'voltage'
  | 'voltage-style';

export interface EditableStatementEditIntent {
  field: EditableStatementEditField;
  positionIndex?: number;
  segmentIndex?: number;
}

export interface EditableStatement {
  mode?: 'statement' | 'environment';
  command: EditableStatementCommand;
  commandOptionsText?: string;
  editIntent?: EditableStatementEditIntent;
  positionTexts: string[];
  rawStatementText: string;
  segments: EditableSegment[];
  sourceLineIndex: number;
  sourceSubIndex?: number;
}

export interface SourceCoordinateTranslation {
  dx: number;
  dy: number;
  id: string;
  matchPoint?: GridPoint;
}

// ============================================================
// TOOLS
// ============================================================

export type ToolType =
  | 'move'
  | 'select'
  | 'place-bipole'
  | 'place-monopole'
  | 'place-node'
  | 'wire'
  | 'delete'
  | 'draw-text'
  | 'draw-rectangle'
  | 'draw-circle'
  | 'draw-bezier'
  | 'paste-selection';

// ============================================================
// EVENTS
// ============================================================

export type AppEvent =
  | { type: 'component-added'; component: ComponentInstance }
  | { type: 'component-removed'; id: string }
  | { type: 'component-moved'; id: string }
  | { type: 'component-props-changed'; id: string; props: Partial<ComponentProps> }
  | { type: 'wire-added'; wire: WireInstance }
  | { type: 'wire-removed'; id: string }
  | { type: 'drawing-added'; drawing: DrawingInstance }
  | { type: 'drawing-removed'; id: string }
  | { type: 'selection-changed'; selectedIds: string[]; source?: 'canvas' | 'code' | 'programmatic' }
  | { type: 'tool-changed'; tool: ToolType; defId?: string }
  | { type: 'style-changed'; style: 'european' | 'american' }
  | { type: 'document-changed'; sourceTranslations?: SourceCoordinateTranslation[] }
  /** Fired when a CAD tool updates LatexDocument.body — CodePanel syncs its textarea. */
  | { type: 'body-changed' }
  /** Fired by CodePanel after debounce when the user finishes editing LaTeX manually. */
  | { type: 'user-edited-latex' }
  /** Fired by CodePanel when the caret moves to another source line. */
  | { type: 'code-caret-changed'; lineIndex: number }
  | { type: 'cursor-grid-changed'; gridPt: GridPoint; zoomPercent: number }
  | { type: 'canvas-clicked'; gridPt: GridPoint };

// ============================================================
// VIEW
// ============================================================

export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}
