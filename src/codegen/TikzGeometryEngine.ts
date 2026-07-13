import type { ComponentInstance, ComponentDef, PositionSequencePreview } from '../types';
import type { CircuitDocument } from '../model/CircuitDocument';
import type { ComponentRegistry } from '../definitions/ComponentRegistry';
import { registerComponentGeometry, registerNamedReference } from './TikzGeometryStore';
import {
  resolvePositionSequencePreview,
} from './TikzPositionResolver';
import { splitNodePlacementText, type StructuredStatementBody } from './TikzStructuredStatement';

export interface StructuredStatementResolution {
  nodeSequences: Array<PositionSequencePreview | null>;
  positionSequences: Array<PositionSequencePreview | null>;
}

export class TikzGeometryEngine {
  constructor(
    private doc: CircuitDocument,
    private registry: ComponentRegistry,
  ) {}

  rememberNodePlacement(id: string, placementText: string | undefined): PositionSequencePreview | null {
    if (!placementText) {
      this.doc.setResolvedStatementPositions(id, []);
      return null;
    }
    const resolved = resolvePositionSequencePreview(
      splitNodePlacementText(placementText).positionText,
      this.doc,
      this.registry,
    );
    this.doc.setResolvedStatementPositions(id, [resolved]);
    return resolved;
  }

  rememberPositionSequence(id: string, positionText: string): PositionSequencePreview | null {
    const resolved = resolvePositionSequencePreview(positionText, this.doc, this.registry);
    this.doc.setResolvedStatementPositions(id, [resolved]);
    return resolved;
  }

  resolveStructuredStatement(id: string, structured: StructuredStatementBody): StructuredStatementResolution {
    const nodeSequences = structured.segments.map(() => null as PositionSequencePreview | null);
    if (structured.positionTexts.length === 0) {
      this.doc.setResolvedStatementPositions(id, []);
      return { nodeSequences, positionSequences: [] };
    }

    const positionSequences: Array<PositionSequencePreview | null> = [];
    const first = resolvePositionSequencePreview(structured.positionTexts[0], this.doc, this.registry);
    positionSequences.push(first);

    let currentPoint = first?.point ?? null;
    let currentRef = first?.ref;
    let positionIndex = 1;

    for (let segmentIndex = 0; segmentIndex < structured.segments.length; segmentIndex += 1) {
      const segment = structured.segments[segmentIndex];
      if (segment.kind === 'node') {
        const resolved = segment.positionText
          ? resolvePositionSequencePreview(segment.positionText, this.doc, this.registry, currentPoint, currentRef)
          : positionSequences[Math.max(positionIndex - 1, 0)] ?? first;
        nodeSequences[segmentIndex] = resolved;
        if (segment.positionText) {
          currentPoint = resolved?.point ?? null;
          currentRef = resolved?.ref;
        }
        continue;
      }

      const positionText = structured.positionTexts[positionIndex];
      if (!positionText) break;
      const resolved = resolvePositionSequencePreview(positionText, this.doc, this.registry, currentPoint, currentRef);
      positionSequences.push(resolved);
      currentPoint = resolved?.point ?? null;
      currentRef = resolved?.ref;
      positionIndex += 1;
    }

    while (positionIndex < structured.positionTexts.length) {
      const resolved = resolvePositionSequencePreview(
        structured.positionTexts[positionIndex],
        this.doc,
        this.registry,
        currentPoint,
        currentRef,
      );
      positionSequences.push(resolved);
      currentPoint = resolved?.point ?? null;
      currentRef = resolved?.ref;
      positionIndex += 1;
    }

    this.doc.setResolvedStatementPositions(id, positionSequences);
    return { nodeSequences, positionSequences };
  }
  registerNamedReference(nodeName: string | undefined, resolved: PositionSequencePreview | null): void {
    if (!resolved) return;
    registerNamedReference(this.doc.geometry, nodeName, resolved.point);
  }

  registerComponentGeometry(comp: ComponentInstance, def: ComponentDef | undefined): void {
    if (!def) return;
    registerComponentGeometry(this.doc.geometry, comp, def);
  }
}
