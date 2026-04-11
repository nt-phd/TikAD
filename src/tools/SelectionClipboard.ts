import type {
  BipoleInstance,
  ComponentInstance,
  ConnectionRef,
  DrawingInstance,
  GridPoint,
  MonopoleInstance,
  NodeInstance,
  PositionSequencePreview,
  WireInstance,
} from '../types';
import { lineIndexFromId } from '../codegen/CircuiTikZParser';
import type { CircuitDocument } from '../model/CircuitDocument';

export interface ClipboardPayload {
  anchor: GridPoint;
  entries: ClipboardEntry[];
}

export type ClipboardEntry =
  | { kind: 'component'; item: ComponentInstance }
  | { kind: 'wire'; item: WireInstance }
  | { kind: 'drawing'; item: DrawingInstance };

function clonePoint(point: GridPoint): GridPoint {
  return { ...point };
}

function cloneRef(ref?: ConnectionRef): ConnectionRef | undefined {
  return ref ? { ...ref } : undefined;
}

function cloneSequence(sequence?: PositionSequencePreview): PositionSequencePreview | undefined {
  if (!sequence) return undefined;
  return {
    point: clonePoint(sequence.point),
    ref: cloneRef(sequence.ref),
    corners: sequence.corners.map((corner) => ({
      kind: corner.kind,
      point: clonePoint(corner.point),
      ref: cloneRef(corner.ref),
      relativeFromIndex: corner.relativeFromIndex,
    })),
  };
}

function cloneComponent(component: ComponentInstance): ComponentInstance {
  if (component.type === 'bipole') {
    const clone: BipoleInstance = {
      ...component,
      props: { ...component.props },
      start: clonePoint(component.start),
      end: clonePoint(component.end),
      startRef: cloneRef(component.startRef),
      endRef: cloneRef(component.endRef),
      startSequence: cloneSequence(component.startSequence),
      endSequence: cloneSequence(component.endSequence),
    };
    return clone;
  }
  if (component.type === 'node') {
    const clone: NodeInstance = {
      ...component,
      props: { ...component.props },
      position: clonePoint(component.position),
    };
    return clone;
  }
  const clone: MonopoleInstance = {
    ...component,
    props: { ...component.props },
    position: clonePoint(component.position),
  };
  return clone;
}

function cloneDrawing(drawing: DrawingInstance): DrawingInstance {
  switch (drawing.kind) {
    case 'line':
    case 'arrow':
    case 'rectangle':
      return {
        ...drawing,
        props: { ...drawing.props },
        start: clonePoint(drawing.start),
        end: clonePoint(drawing.end),
      };
    case 'text':
      return {
        ...drawing,
        props: { ...drawing.props },
        position: clonePoint(drawing.position),
      };
    case 'circle':
      return {
        ...drawing,
        props: { ...drawing.props },
        center: clonePoint(drawing.center),
      };
    case 'bezier':
      return {
        ...drawing,
        props: { ...drawing.props },
        start: clonePoint(drawing.start),
        control1: clonePoint(drawing.control1),
        control2: clonePoint(drawing.control2),
        end: clonePoint(drawing.end),
      };
  }
}

function cloneWire(wire: WireInstance): WireInstance {
  return {
    ...wire,
    junctions: new Map(wire.junctions),
    points: wire.points.map(clonePoint),
    pathPoints: wire.pathPoints?.map(clonePoint),
    pathSequences: wire.pathSequences?.map(cloneSequence).filter((sequence): sequence is PositionSequencePreview => Boolean(sequence)),
    startRef: cloneRef(wire.startRef),
    endRef: cloneRef(wire.endRef),
    operators: wire.operators ? [...wire.operators] : undefined,
  };
}

function collectPoints(entry: ClipboardEntry): GridPoint[] {
  switch (entry.kind) {
    case 'component':
      if (entry.item.type === 'bipole') return [entry.item.start, entry.item.end];
      return [entry.item.position];
    case 'wire':
      return entry.item.points;
    case 'drawing':
      switch (entry.item.kind) {
        case 'line':
        case 'arrow':
        case 'rectangle':
          return [entry.item.start, entry.item.end];
        case 'text':
          return [entry.item.position];
        case 'circle':
          return [
            { x: entry.item.center.x - entry.item.radius, y: entry.item.center.y - entry.item.radius },
            { x: entry.item.center.x + entry.item.radius, y: entry.item.center.y + entry.item.radius },
          ];
        case 'bezier':
          return [entry.item.start, entry.item.control1, entry.item.control2, entry.item.end];
      }
  }
}

export function copySelectionToClipboard(doc: CircuitDocument, selectedIds: string[]): ClipboardPayload | null {
  const orderedIds = [...selectedIds].sort((a, b) => lineIndexFromId(a) - lineIndexFromId(b));
  const entries: ClipboardEntry[] = [];
  for (const id of orderedIds) {
    const component = doc.getComponent(id);
    if (component) {
      entries.push({ kind: 'component', item: cloneComponent(component) });
      continue;
    }
    const wire = doc.getWire(id);
    if (wire) {
      entries.push({ kind: 'wire', item: cloneWire(wire) });
      continue;
    }
    const drawing = doc.getDrawing(id);
    if (drawing) entries.push({ kind: 'drawing', item: cloneDrawing(drawing) });
  }
  if (entries.length === 0) return null;
  const points = entries.flatMap(collectPoints);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  return {
    anchor: { x: minX, y: minY },
    entries,
  };
}

function offsetRef(ref: ConnectionRef | undefined, nodeNameMap: Map<string, string>): ConnectionRef | undefined {
  if (!ref) return undefined;
  return {
    ...ref,
    componentId: '',
    nodeName: nodeNameMap.get(ref.nodeName) ?? ref.nodeName,
  };
}

function translatePoint(point: GridPoint, dx: number, dy: number): GridPoint {
  return { x: point.x + dx, y: point.y + dy };
}

export function previewClipboardAt(payload: ClipboardPayload, target: GridPoint): ClipboardEntry[] {
  const dx = target.x - payload.anchor.x;
  const dy = target.y - payload.anchor.y;
  return payload.entries.map((entry) => {
    if (entry.kind === 'component') {
      const component = cloneComponent(entry.item);
      if (component.type === 'bipole') {
        component.start = translatePoint(component.start, dx, dy);
        component.end = translatePoint(component.end, dx, dy);
        component.startSequence = cloneSequence(component.startSequence);
        component.endSequence = cloneSequence(component.endSequence);
        if (component.startSequence) {
          component.startSequence.point = translatePoint(component.startSequence.point, dx, dy);
          component.startSequence.corners = component.startSequence.corners.map((corner) => ({
            ...corner,
            point: translatePoint(corner.point, dx, dy),
          }));
        }
        if (component.endSequence) {
          component.endSequence.point = translatePoint(component.endSequence.point, dx, dy);
          component.endSequence.corners = component.endSequence.corners.map((corner) => ({
            ...corner,
            point: translatePoint(corner.point, dx, dy),
          }));
        }
      } else {
        component.position = translatePoint(component.position, dx, dy);
      }
      return { kind: 'component', item: component };
    }
    if (entry.kind === 'wire') {
      const wire = cloneWire(entry.item);
      wire.points = wire.points.map((point) => translatePoint(point, dx, dy));
      wire.pathPoints = wire.pathPoints?.map((point) => translatePoint(point, dx, dy));
      wire.pathSequences = wire.pathSequences?.map((sequence) => ({
        ...sequence,
        point: translatePoint(sequence.point, dx, dy),
        corners: sequence.corners.map((corner) => ({
          ...corner,
          point: translatePoint(corner.point, dx, dy),
        })),
      }));
      return { kind: 'wire', item: wire };
    }
    const drawing = cloneDrawing(entry.item);
    switch (drawing.kind) {
      case 'line':
      case 'arrow':
      case 'rectangle':
        drawing.start = translatePoint(drawing.start, dx, dy);
        drawing.end = translatePoint(drawing.end, dx, dy);
        break;
      case 'text':
        drawing.position = translatePoint(drawing.position, dx, dy);
        break;
      case 'circle':
        drawing.center = translatePoint(drawing.center, dx, dy);
        break;
      case 'bezier':
        drawing.start = translatePoint(drawing.start, dx, dy);
        drawing.control1 = translatePoint(drawing.control1, dx, dy);
        drawing.control2 = translatePoint(drawing.control2, dx, dy);
        drawing.end = translatePoint(drawing.end, dx, dy);
        break;
    }
    return { kind: 'drawing', item: drawing };
  });
}

export function materializeClipboardAt(
  payload: ClipboardPayload,
  target: GridPoint,
  nextNodeName: () => string,
): ClipboardEntry[] {
  const translated = previewClipboardAt(payload, target);
  const nodeNameMap = new Map<string, string>();
  for (const entry of translated) {
    if (entry.kind !== 'component') continue;
    const component = entry.item;
    if (component.type === 'bipole' || !component.nodeName) continue;
    nodeNameMap.set(component.nodeName, nextNodeName());
  }

  return translated.map((entry) => {
    if (entry.kind === 'component') {
      const component = cloneComponent(entry.item);
      if (component.type === 'bipole') {
        component.startRef = offsetRef(component.startRef, nodeNameMap);
        component.endRef = offsetRef(component.endRef, nodeNameMap);
      }
      if (component.type !== 'bipole' && component.nodeName) {
        component.nodeName = nodeNameMap.get(component.nodeName) ?? component.nodeName;
      }
      component.id = '';
      return { kind: 'component', item: component };
    }
    if (entry.kind === 'wire') {
      const wire = cloneWire(entry.item);
      wire.id = '';
      wire.startRef = offsetRef(wire.startRef, nodeNameMap);
      wire.endRef = offsetRef(wire.endRef, nodeNameMap);
      return { kind: 'wire', item: wire };
    }
    const drawing = cloneDrawing(entry.item);
    drawing.id = '';
    return { kind: 'drawing', item: drawing };
  });
}
