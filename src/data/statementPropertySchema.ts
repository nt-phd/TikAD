import statementPropertySchemaJson from './statementPropertySchema.generated.json';

type StatementPropertyValueType = 'enum' | 'latex-text';
type StatementPropertyStorageKind = 'options-pattern' | 'prop' | 'segment' | 'terminal';
type StatementSegmentKind = 'bipole' | 'connection' | 'node' | 'raw';

export type StatementPropertyPattern = {
  code: string;
  description: string;
  label: string;
};

export type StatementPropertyDefinition = {
  icon: string;
  id: string;
  label: string;
  options?: Array<{ label: string; value: string }>;
  patterns: StatementPropertyPattern[];
  provenance?: {
    extractedFrom: string;
  };
  storage: {
    key: string;
    kind: StatementPropertyStorageKind;
  };
  valueType: StatementPropertyValueType;
  variants?: Array<{
    assignments?: Array<{ key: string; value: string }>;
    code: string;
    description: string;
    file?: string;
    label: string;
    operator?: string;
    section?: string | null;
    semantics?: {
      direction?: string | null;
      horizontalPosition?: string | null;
      rawSuffix?: string | null;
      verticalPosition?: string | null;
    };
    token: string;
  }>;
};

export type BipoleValuePropertyId = 'annotation' | 'current' | 'flow' | 'label' | 'voltage';
export type BipoleTerminalPropertyId = 'end-node' | 'start-node';
export type BipolePropertyId = BipoleTerminalPropertyId | BipoleValuePropertyId;

export type StatementPropertyFallback = {
  description: string;
  id: string;
  label: string;
  storage: {
    key: string;
    kind: StatementPropertyStorageKind;
  };
};

export type StatementSegmentPropertyGroup = {
  addMenuLabel: string;
  description: string;
  fallback?: StatementPropertyFallback;
  label: string;
  properties: StatementPropertyDefinition[];
};

export type StatementPropertySchema = {
  lineCommands: Array<{
    description: string;
    icon: string;
    label: string;
    value: string;
  }>;
  segmentKinds: Record<StatementSegmentKind, StatementSegmentPropertyGroup>;
  version: number;
};

export const statementPropertySchema = statementPropertySchemaJson as StatementPropertySchema;

export function getBipolePropertyDefinition(propertyId: BipolePropertyId): StatementPropertyDefinition | undefined {
  return statementPropertySchema.segmentKinds.bipole.properties.find((property) => property.id === propertyId);
}

export function getBipolePropertyVariants(propertyId: BipoleValuePropertyId) {
  return getBipolePropertyDefinition(propertyId)?.variants ?? [];
}

export function getDefaultBipoleVariantToken(propertyId: BipoleValuePropertyId): string {
  return getBipolePropertyVariants(propertyId)[0]?.token ?? propertyId[0];
}

export function findBipoleVariantByToken(propertyId: BipoleValuePropertyId, token: string) {
  return getBipolePropertyVariants(propertyId).find((variant) => variant.token === token);
}

export function findBipoleVariantByCodePrefix(propertyId: BipoleValuePropertyId, codePrefix: string) {
  return getBipolePropertyVariants(propertyId).find((variant) => variant.code.slice(0, -1) === codePrefix);
}

export function getBipoleVariantCodePrefix(propertyId: BipoleValuePropertyId, token: string): string {
  return findBipoleVariantByToken(propertyId, token)?.code.slice(0, -1) ?? `${token}`;
}
