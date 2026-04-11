import rawCatalog from './component-catalog.json';

export interface ComponentCatalogEntry {
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
  anchors: string[];
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

export const componentCatalog = rawCatalog as ComponentCatalogData;
