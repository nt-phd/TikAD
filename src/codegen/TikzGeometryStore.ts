import type { ComponentDef, ComponentInstance, GridPoint, PositionSequencePreview } from '../types';
import { componentProbeService } from '../canvas/ComponentProbeService';
import { scaleState } from '../canvas/ScaleState';

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
  const nextPoint = { ...point };
  store.symbolPoints.set(geometryStoreKey(nodeName, anchor), nextPoint);
  if (!anchor || anchor === 'reference') {
    store.symbolPoints.set(`${nodeName}.reference`, nextPoint);
  }
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
  if (comp.type === 'bipole' || !comp.nodeName) return;
  const probe = componentProbeService.getPlacedGhostProbe(def, comp.rotation ?? 0, () => {});
  if (probe && probe.pinOffsets.length > 0) {
    for (const pin of probe.pinOffsets) {
      setGeometryStorePoint(store, comp.nodeName, {
        x: comp.position.x + pin.x / scaleState.effectiveGridSize,
        y: comp.position.y + pin.y / scaleState.effectiveGridSize,
      }, pin.name);
    }
  }
  setGeometryStorePoint(store, comp.nodeName, comp.position, 'reference');
}
