import type { ComponentInstance, ComponentDef, ConnectionRef, GridPoint, SymbolPin } from '../types';
import { componentProbeService, pickPrimaryPin } from './ComponentProbeService';
import { getPlacedComponentMetrics } from './ComponentGeometry';
import { scaleState } from './ScaleState';

function getSemanticPins(def: ComponentDef): SymbolPin[] {
  const pins = [...(def.symbolPins ?? [])];
  if (def.scaleFamily === 'amplifiers' && !pins.some((pin) => pin.name === 'out')) {
    const bboxX = def.shapeBBoxX ?? 0;
    const bboxW = def.shapeBBoxW ?? def.viewBoxW;
    pins.push({
      name: 'out',
      x: bboxX + bboxW - def.symbolRefX,
      y: 0,
    });
  }
  return pins;
}

function getStaticAnchorPoints(comp: ComponentInstance, def: ComponentDef): Array<{ point: GridPoint; ref?: ConnectionRef }> {
  if (comp.type === 'bipole') {
    return [
      { point: comp.start },
      { point: comp.end },
    ];
  }

  const pins = getSemanticPins(def);
  if (pins.length === 0) {
    return [{
      point: comp.position,
      ref: comp.nodeName ? { componentId: comp.id, nodeName: comp.nodeName, anchor: 'reference' } : undefined,
    }];
  }

  const { scale } = getPlacedComponentMetrics(def, scaleState.effectiveGridSize);
  const gridScale = scale / scaleState.effectiveGridSize;
  const angle = (comp.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return pins.map((pin) => {
    const localX = pin.x * gridScale;
    const localY = pin.y * gridScale;
    return {
      point: {
        x: comp.position.x + localX * cos - localY * sin,
        y: comp.position.y + localX * sin + localY * cos,
      },
      ref: comp.nodeName ? { componentId: comp.id, nodeName: comp.nodeName, anchor: pin.name } : undefined,
    };
  });
}

export function getComponentAnchorPoints(comp: ComponentInstance, def: ComponentDef): Array<{ point: GridPoint; ref?: ConnectionRef }> {
  if (comp.type === 'bipole') {
    return [
      { point: comp.start },
      { point: comp.end },
    ];
  }

  const probe = componentProbeService.getSelectionProbe(comp.id, comp, def, () => {});
  if (!probe) return getStaticAnchorPoints(comp, def);
  if (probe.pinOffsets.length === 0) {
    return [{
      point: comp.position,
      ref: comp.nodeName ? { componentId: comp.id, nodeName: comp.nodeName, anchor: 'reference' } : undefined,
    }];
  }
  return probe.pinOffsets.map((pin) => ({
    point: {
      x: comp.position.x + pin.x / scaleState.effectiveGridSize,
      y: comp.position.y + pin.y / scaleState.effectiveGridSize,
    },
    ref: comp.nodeName ? { componentId: comp.id, nodeName: comp.nodeName, anchor: pin.name } : undefined,
  }));
}

export function getPrimaryAnchorRef(comp: ComponentInstance, def: ComponentDef): ConnectionRef | null {
  if (comp.type === 'bipole' || !comp.nodeName) return null;
  const nodeName = comp.nodeName;
  const pins = getSemanticPins(def);
  const primary = pickPrimaryPin(pins);
  return primary
    ? { componentId: comp.id, nodeName, anchor: primary.name }
    : { componentId: comp.id, nodeName, anchor: 'reference' };
}
