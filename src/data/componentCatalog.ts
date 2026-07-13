import type {
  ComponentGeometryNameGroup,
  ComponentGeometryPointSpec,
  ComponentGeometryRule,
  ComponentGeometrySpec,
} from '../types';
import rawCatalog from './component-catalog.json';

type GeometryRole = 'terminal' | 'reference' | 'geometry' | 'text' | 'internal' | string;

interface RawAnchorDef {
  names: string[];
  normalizedBody: string;
  role: GeometryRole;
}

interface RawGeometrySpec {
  source: 'official-tex' | 'manual-override' | 'synthetic' | 'unresolved' | string;
  referenceName: string | null;
  points?: Array<{ name: string; role: GeometryRole }>;
  rules?: ComponentGeometryRule[];
}

interface RawComponentCatalogEntry {
  anchorDefs?: RawAnchorDef[];
  styleKind?: 'style' | 'alias style';
  styleType?: 'path-style' | 'node-style';
  tag: string;
  kind: string;
  family: string;
  displayName: string;
  group: string;
  className: string;
  previewDefId: string;
  fillable?: boolean;
  aliases: string[];
  geometry?: RawGeometrySpec;
  nodeOptions: string[];
  hidden: boolean;
  metadata?: {
    aliasOf?: string;
    backingStyleKind?: 'path' | 'node';
    baseNodeName?: string;
    basePathName?: string;
    fillable?: boolean;
    internalStyle?: string;
    isStrokedSymbol?: boolean;
    pathInternal?: string;
    representativeStyleTag?: string;
    [key: string]: unknown;
  };
  order: number | null;
  sourceFiles: string[];
  sourceKinds: string[];
  searchTerms: string[];
  notes: string;
}

export interface ComponentCatalogEntry {
  anchorDefs?: RawAnchorDef[];
  styleKind?: 'style' | 'alias style';
  styleType?: 'path-style' | 'node-style';
  tag: string;
  kind: string;
  family: string;
  displayName: string;
  group: string;
  className: string;
  previewDefId: string;
  fillable?: boolean;
  aliases: string[];
  geometry?: ComponentGeometrySpec;
  nodeOptions: string[];
  hidden: boolean;
  metadata?: RawComponentCatalogEntry['metadata'];
  order: number | null;
  sourceFiles: string[];
  sourceKinds: string[];
  searchTerms: string[];
  notes: string;
}

export interface ComponentCatalogData {
  generatedAt: string;
  sourceRawCatalog: string;
  sourceOverrides: string;
  packageOptions: {
    all: string[];
    defaults?: string[];
    nodeOptions?: string[];
    groups: Record<string, string[]>;
  };
  components: ComponentCatalogEntry[];
}

function pointSpec(def: RawAnchorDef, sourceKinds: string[]): ComponentGeometryPointSpec {
  return {
    name: def.names[0],
    tikz: def.names[0],
    role: def.role,
    required: true,
    snap: def.role === 'terminal',
    ghost: def.role === 'terminal',
    sources: [...sourceKinds],
  };
}

function expandAnchorDefs(anchorDefs: RawAnchorDef[] | undefined): Array<{ name: string; role: GeometryRole }> {
  const defs: Array<{ name: string; role: GeometryRole }> = [];
  for (const def of anchorDefs ?? []) {
    for (const name of def.names ?? []) defs.push({ name, role: def.role });
  }
  return defs;
}

function inflateGeometry(
  rawGeometry: RawGeometrySpec | undefined,
  anchorDefs: RawAnchorDef[] | undefined,
  sourceKinds: string[],
): ComponentGeometrySpec | undefined {
  if (!rawGeometry) return undefined;
  const defs = expandAnchorDefs(anchorDefs);
  const fallbackDefs = (rawGeometry.points ?? []).map((point) => ({ name: point.name, role: point.role }));
  const allDefs = defs.length > 0 ? defs : fallbackDefs;
  const referenceDef = rawGeometry.referenceName
    ? allDefs.find((def) => def.name === rawGeometry.referenceName)
    : undefined;
  const pins = allDefs
    .filter((def) => def.role === 'terminal')
    .map((def) => pointSpec({ names: [def.name], normalizedBody: '', role: def.role }, sourceKinds));
  const anchors = allDefs
    .filter((def) => def.role !== 'terminal' && def.role !== 'reference')
    .map((def) => pointSpec({ names: [def.name], normalizedBody: '', role: def.role }, sourceKinds));
  const hasExplicitTerminals = pins.length > 0;
  const reference = referenceDef
    ? {
        ...pointSpec({ names: [referenceDef.name], normalizedBody: '', role: referenceDef.role }, sourceKinds),
        role: 'reference' as const,
        snap: !hasExplicitTerminals,
        ghost: true,
      }
    : null;
  return {
    source: rawGeometry.source,
    reference,
    pinGroups: (anchorDefs ?? [])
      .filter((def) => def.role === 'terminal' && (def.names?.length ?? 0) > 1)
      .map((def) => ({
        names: [...def.names],
        role: def.role,
      })),
    pins,
    anchors,
    rules: (rawGeometry.rules ?? []).map((rule) => ({
      when: { ...rule.when },
      add: rule.add?.map((point) => ({
        ...point,
        sources: [...point.sources],
      })),
      remove: rule.remove ? [...rule.remove] : undefined,
    })),
  };
}

const raw = rawCatalog as Omit<ComponentCatalogData, 'components'> & {
  components: RawComponentCatalogEntry[];
};

export const componentCatalog: ComponentCatalogData = {
  ...raw,
  components: raw.components.map((entry) => ({
    tag: entry.tag,
    kind: entry.kind,
    styleType: entry.styleType,
    family: entry.family,
    displayName: entry.displayName,
    group: entry.group,
    className: entry.className,
    previewDefId: entry.previewDefId,
    fillable: entry.fillable,
    aliases: [...entry.aliases],
    anchorDefs: entry.anchorDefs?.map((def) => ({ ...def, names: [...def.names] })),
    geometry: inflateGeometry(entry.geometry, entry.anchorDefs, entry.sourceKinds),
    nodeOptions: [...entry.nodeOptions],
    hidden: entry.hidden,
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
    order: entry.order,
    sourceFiles: [...entry.sourceFiles],
    sourceKinds: [...entry.sourceKinds],
    searchTerms: [...entry.searchTerms],
    notes: entry.notes,
  })),
};
