import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const rawDbPath = path.join(repoRoot, 'src/data/circuitikz-bipole-token-db.json');
const outputPath = path.join(repoRoot, 'src/data/statementPropertySchema.generated.json');

const lineCommands = [
  {
    value: 'node',
    label: '\\node',
    description: 'Create or edit a standalone node statement.',
    icon: 'SubjectRounded',
  },
  {
    value: 'draw',
    label: '\\draw',
    description: 'Create or edit a drawing/path statement that renders geometry.',
    icon: 'DrawRounded',
  },
  {
    value: 'path',
    label: '\\path',
    description: 'Create or edit a path statement without drawing by default.',
    icon: 'RouteRounded',
  },
  {
    value: 'ctikzset',
    label: '\\ctikzset',
    description: 'Edit CircuitikZ configuration keys.',
    icon: 'TuneRounded',
  },
];

const supportedBipoleProperties = {
  label: {
    icon: 'LabelRounded',
    valueType: 'latex-text',
    storage: { kind: 'prop', key: 'label' },
  },
  annotation: {
    icon: 'SpeakerNotesRounded',
    valueType: 'latex-text',
    storage: { kind: 'prop', key: 'annotation' },
  },
  voltage: {
    icon: 'BoltRounded',
    valueType: 'latex-text',
    storage: { kind: 'prop', key: 'voltage' },
  },
  current: {
    icon: 'TrendingFlatRounded',
    valueType: 'latex-text',
    storage: { kind: 'prop', key: 'current' },
  },
  flow: {
    icon: 'AirRounded',
    valueType: 'latex-text',
    storage: { kind: 'prop', key: 'flow' },
  },
};

const terminalMarkMeta = {
  circ: {
    label: 'Filled circle',
    value: 'circ',
  },
  diamondpole: {
    label: 'Diamond',
    value: 'diamondpole',
  },
  none: {
    label: 'None',
    value: '',
  },
  ocirc: {
    label: 'Open circle',
    value: 'ocirc',
  },
  rectjoinfill: {
    label: 'Square join',
    value: 'rectjoinfill',
  },
};

const nodeProperties = [
  {
    id: 'text',
    label: 'Text',
    icon: 'TitleRounded',
    valueType: 'latex-text',
    storage: { kind: 'segment', key: 'text' },
    patterns: [
      {
        code: '{...}',
        label: 'Node text',
        description: 'Content inside the node braces.',
      },
    ],
  },
  {
    id: 'label',
    label: 'Label',
    icon: 'LabelRounded',
    valueType: 'latex-text',
    storage: { kind: 'options-pattern', key: 'label' },
    patterns: [
      {
        code: 'label=',
        label: 'Node label',
        description: 'Standard TikZ label option.',
      },
    ],
  },
];

function titleCaseWords(input) {
  return input
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildVariantLabel(propertyLabel, semantics, token) {
  const parts = [propertyLabel];
  if (semantics.verticalPosition === 'above') parts.push('above');
  if (semantics.verticalPosition === 'below') parts.push('below');
  if (semantics.direction === 'forward') parts.push('forward');
  if (semantics.direction === 'backward') parts.push('backward');
  if (semantics.horizontalPosition === 'before') parts.push('before');
  if (semantics.horizontalPosition === 'after') parts.push('after');
  if (parts.length === 1 && token !== token.replace(/\s+/g, '')) {
    return titleCaseWords(token);
  }
  return titleCaseWords(parts.join(' '));
}

function buildPropertyDescription(property, tokenEntry) {
  if (tokenEntry.description) return tokenEntry.description;
  if (property.id === 'label') return 'Component label placed along the bipole.';
  if (property.id === 'annotation') return 'Secondary annotation attached to the bipole.';
  if (property.id === 'voltage') return 'Voltage annotation on the bipole.';
  if (property.id === 'current') return 'Current annotation on the bipole.';
  if (property.id === 'flow') return 'Flow annotation on the bipole.';
  return `${property.label} token from official CircuitikZ sources.`;
}

function toPatternCode(token) {
  return `${token}=`;
}

function buildDerivedBipoleProperties(rawDb) {
  const rawPropertiesById = new Map(rawDb.properties.map((property) => [property.id, property]));
  return Object.entries(supportedBipoleProperties).map(([propertyId, meta]) => {
    const rawProperty = rawPropertiesById.get(propertyId);
    if (!rawProperty) {
      throw new Error(`Missing raw bipole property "${propertyId}" in ${rawDbPath}`);
    }
    const variants = rawProperty.tokens.map((tokenEntry) => ({
      assignments: tokenEntry.assignments,
      code: toPatternCode(tokenEntry.token),
      description: buildPropertyDescription(rawProperty, tokenEntry),
      file: tokenEntry.file,
      label: buildVariantLabel(rawProperty.label, tokenEntry.semantics, tokenEntry.token),
      operator: tokenEntry.operator,
      section: tokenEntry.section,
      semantics: tokenEntry.semantics,
      token: tokenEntry.token,
    }));

    return {
      id: propertyId,
      icon: meta.icon,
      label: rawProperty.label,
      patterns: variants.map((variant) => ({
        code: variant.code,
        description: variant.description,
        label: variant.label,
      })),
      provenance: {
        extractedFrom: 'circuitikz-bipole-token-db',
      },
      storage: meta.storage,
      valueType: meta.valueType,
      variants,
    };
  });
}

function buildTerminalProperty(rawDb, side) {
  const terminalStyles = rawDb.terminalStyles ?? [];
  const sideKey = side === 'start' ? 'left' : 'right';
  const oppositeKey = side === 'start' ? 'right' : 'left';
  const singletonStyles = terminalStyles.filter((style) => style[oppositeKey] === 'none');
  const kindOrder = ['none', 'circ', 'ocirc', 'diamondpole', 'rectjoinfill'];
  const options = kindOrder
    .filter((kind) => singletonStyles.some((style) => style[sideKey] === kind) || kind === 'none')
    .map((kind) => terminalMarkMeta[kind])
    .filter(Boolean)
    .map((entry) => ({ label: entry.label, value: entry.value }));
  const variants = singletonStyles
    .filter((style) => style[sideKey] !== 'none')
    .map((style) => ({
      code: style.token,
      description: `${terminalMarkMeta[style[sideKey]]?.label ?? style[sideKey]} terminal mark on the ${side} side.`,
      file: style.file,
      label: `${terminalMarkMeta[style[sideKey]]?.label ?? style[sideKey]} ${side} node`,
      token: style.token,
    }));

  return {
    id: side === 'start' ? 'start-node' : 'end-node',
    icon: side === 'start' ? 'FiberManualRecordRounded' : 'TripOriginRounded',
    label: side === 'start' ? 'Start node' : 'End node',
    options,
    patterns: variants.map((variant) => ({
      code: variant.code,
      description: variant.description,
      label: variant.label,
    })),
    provenance: {
      extractedFrom: 'circuitikz-bipole-token-db',
    },
    storage: {
      kind: 'terminal',
      key: side === 'start' ? 'startTerminal' : 'endTerminal',
    },
    valueType: 'enum',
    variants,
  };
}

async function main() {
  const rawDb = JSON.parse(await fs.readFile(rawDbPath, 'utf8'));
  const derivedBipoleProperties = buildDerivedBipoleProperties(rawDb);
  const terminalProperties = [
    buildTerminalProperty(rawDb, 'start'),
    buildTerminalProperty(rawDb, 'end'),
  ];

  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: {
      type: 'generated',
      rawBipoleTokenDb: './circuitikz-bipole-token-db.json',
      officialSourcePaths: rawDb.officialSourcePaths,
    },
    lineCommands,
    segmentKinds: {
      bipole: {
        label: 'Bipole',
        addMenuLabel: 'Add',
        description: 'Structured CircuitikZ path component with supported official modifiers.',
        properties: [...derivedBipoleProperties, ...terminalProperties],
        fallback: {
          id: 'unparsed-options',
          label: 'Unparsed options',
          description: 'Residual options not yet mapped to structured properties.',
          storage: {
            kind: 'segment',
            key: 'optionsText',
          },
        },
        availableRawPropertyIds: rawDb.properties.map((property) => property.id),
      },
      node: {
        label: 'Node',
        addMenuLabel: 'Add',
        description: 'Structured TikZ node segment.',
        properties: nodeProperties,
        fallback: {
          id: 'unparsed-options',
          label: 'Unparsed options',
          description: 'Residual node options not yet mapped to structured properties.',
          storage: {
            kind: 'segment',
            key: 'optionsText',
          },
        },
      },
      connection: {
        label: 'Connection',
        addMenuLabel: 'Add',
        description: 'Plain path operator segment.',
        properties: [],
      },
      raw: {
        label: 'Raw',
        addMenuLabel: 'Add',
        description: 'Unstructured statement fragment.',
        properties: [],
      },
    },
  };

  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
