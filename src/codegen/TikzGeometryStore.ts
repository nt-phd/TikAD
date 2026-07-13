import type { ComponentDef, ComponentInstance, GridPoint, PositionSequencePreview } from '../types';

const NODE_NAME_RE = /^[A-Za-z][\w-]*$/;

export interface TikzGeometryState {
  statementPositions: Map<string, Array<PositionSequencePreview | null>>;
  symbolPoints: Map<string, GridPoint>;
}

export function createTikzGeometryState(): TikzGeometryState {
  return {
    statementPositions: new Map(),
    symbolPoints: new Map(),
  };
}

export function geometryStoreKey(nodeName: string, anchor?: string): string {
  return anchor && anchor !== 'reference' ? `${nodeName}.${anchor}` : nodeName;
}

export function setGeometryStorePoint(
  store: TikzGeometryState,
  nodeName: string,
  point: GridPoint,
  anchor?: string,
): void {
  if (!NODE_NAME_RE.test(nodeName)) return;
  store.symbolPoints.set(geometryStoreKey(nodeName, anchor), { ...point });
}

export function getGeometryStorePoint(
  store: TikzGeometryState,
  nodeName: string,
  anchor?: string,
): GridPoint | undefined {
  return store.symbolPoints.get(geometryStoreKey(nodeName, anchor))
    ?? (anchor === 'reference' ? store.symbolPoints.get(nodeName) : undefined);
}

export function setStatementGeometry(
  store: TikzGeometryState,
  statementId: string,
  positions: Array<PositionSequencePreview | null>,
): void {
  store.statementPositions.set(statementId, positions);
}

export function getStatementGeometry(
  store: TikzGeometryState,
  statementId: string,
): Array<PositionSequencePreview | null> | undefined {
  return store.statementPositions.get(statementId);
}

export function registerNamedReference(
  store: TikzGeometryState,
  nodeName: string | undefined,
  point: GridPoint,
): void {
  if (!nodeName) return;
  setGeometryStorePoint(store, nodeName, point, 'reference');
}

export function registerComponentGeometry(
  store: TikzGeometryState,
  comp: ComponentInstance,
  def: ComponentDef,
): void {
  void def;
  if (comp.type === 'bipole' || !comp.nodeName) return;
  setGeometryStorePoint(store, comp.nodeName, comp.position, 'reference');
}
