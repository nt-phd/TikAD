import type { ComponentDef, ComponentInstance, ConnectionRef, GridPoint } from '../types';
import { componentProbeService } from '../canvas/ComponentProbeService';
import { scaleState } from '../canvas/ScaleState';

export interface ComponentAnchorPoint {
  point: GridPoint;
  ref?: ConnectionRef;
}

function buildReferenceAnchor(comp: ComponentInstance): ComponentAnchorPoint {
  const nodeName = comp.type === 'bipole' ? undefined : comp.nodeName;
  return {
    point: comp.type === 'bipole' ? comp.start : comp.position,
    ref: nodeName
      ? { componentId: comp.id, nodeName, anchor: 'reference' }
      : undefined,
  };
}

export function getProbeDerivedComponentAnchorPoints(
  comp: ComponentInstance,
  def: ComponentDef,
  onResolved: () => void = () => {},
): ComponentAnchorPoint[] {
  if (comp.type === 'bipole') {
    return [
      { point: comp.start },
      { point: comp.end },
    ];
  }

  const probe = componentProbeService.getSelectionProbe(comp.id, comp, def, onResolved);
  if (!probe || probe.pinOffsets.length === 0) {
    return [buildReferenceAnchor(comp)];
  }

  return probe.pinOffsets.map((pin) => ({
    point: {
      x: comp.position.x + pin.x / scaleState.effectiveGridSize,
      y: comp.position.y + pin.y / scaleState.effectiveGridSize,
    },
    ref: comp.nodeName
      ? { componentId: comp.id, nodeName: comp.nodeName, anchor: pin.name }
      : undefined,
  }));
}
