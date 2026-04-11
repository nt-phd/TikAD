/**
 * Populates the ComponentRegistry from the loaded SymbolsDB.
 * This replaces the hand-coded bipoles/grounds/sources definition files.
 */
import type { ComponentDef, PlacementType, ScaleFamily } from '../types';
import type { ComponentRegistry } from './ComponentRegistry';
import type { SymbolsDB } from '../data/symbolsDB';
import { componentCatalog } from '../data/componentCatalog';

// Internal CircuiTikZ shape aliases that are not valid \draw to[...] commands
const INVALID_TIKZ_NAMES = new Set(['generic', 'xgeneric', 'sgeneric', 'tgeneric', 'ageneric']);

// Map symbolsDB group names → our category names
const GROUP_TO_CATEGORY: Record<string, ComponentDef['category']> = {
  'Resistive bipoles':              'passive',
  'Capacitive and dynamic bipoles': 'passive',
  'Inductors':                      'passive',
  'Mechanical':                     'passive',
  'Diodes':                         'diode',
  'Sources and generators':         'source',
  'Switches, buttons and jumpers':  'switch',
  'Grounds and supply voltages':    'ground',
  'Amplifiers':                     'amplifier',
  'Block diagram':                  'amplifier',
  'Logic gates':                    'logic',
  'RF components':                  'misc',
  'Wiring':                         'misc',
  'Instruments':                    'misc',
  'Miscellaneous':                  'misc',
  'Tubes':                          'misc',
};

function inferScaleFamily(entry: { class: string; group: string; type: 'path' | 'node' }, placementType: PlacementType): ScaleFamily {
  const cls = entry.class.toLowerCase();
  if (cls.includes('resistor')) return 'resistors';
  if (cls.includes('capacitor')) return 'capacitors';
  if (cls.includes('inductor')) return 'inductors';
  if (cls.includes('source')) return 'sources';
  if (cls.includes('amplifier') || cls.includes('opamp')) return 'amplifiers';
  if (placementType === 'node' || placementType === 'monopole' || entry.type === 'node') return 'nodes';
  return 'misc';
}

export function populateRegistryFromSymbolsDB(
  registry: ComponentRegistry,
  db: SymbolsDB,
): void {
  const defsByTikzName = new Map<string, ComponentDef>();
  const defsById = new Map<string, ComponentDef>();

  for (const entry of db.getAllComponents()) {
    const v = entry.defaultVariant;
    if (!v.symbolId) continue;
    if (INVALID_TIKZ_NAMES.has(entry.tikz)) continue;

    // Determine START and END pins for bipoles
    const startPin = v.pins.find(p => p.name === 'START');
    const endPin   = v.pins.find(p => p.name === 'END');

    // placementType
    let placementType: PlacementType;
    if (entry.type === 'path' && startPin && endPin) {
      placementType = 'bipole';
    } else if (entry.type === 'node') {
      placementType = 'monopole';
    } else {
      continue; // skip path symbols without clear pins
    }

    const category: ComponentDef['category'] =
      GROUP_TO_CATEGORY[entry.group] ?? 'misc';
    const scaleFamily = inferScaleFamily(entry, placementType);

    // For bipoles: pin START absolute x = refX + pinStart.x
    // (pins in symbolsDB are stored as offsets from refX)
    const symbolPinSpan = placementType === 'bipole'
      ? (v.refX + endPin!.x) - (v.refX + startPin!.x)   // = endPin.x - startPin.x
      : 0;

    const def: ComponentDef = {
      id: v.symbolId,
      displayName: entry.display,
      category,
      placementType,
      tikzName: entry.tikz,
      symbolId: v.symbolId,
      symbolPinSpan,
      symbolRefX: v.refX,
      symbolRefY: v.refY,
      symbolPins: v.pins.map((pin) => ({ name: pin.name, x: pin.x, y: pin.y })),
      shapeBBoxX: v.bboxX,
      shapeBBoxY: v.bboxY,
      shapeBBoxW: v.bboxWidth,
      shapeBBoxH: v.bboxHeight,
      viewBox: v.viewBox,
      viewBoxW: v.viewBoxWidth,
      viewBoxH: v.viewBoxHeight,
      defaultProps: {},
      scaleFamily,
      group: entry.group,
    };

    registry.register(def);
    defsByTikzName.set(def.tikzName, def);
    defsById.set(def.id, def);
  }

  const registerAlias = (sourceDef: ComponentDef, aliasTikzName: string, aliasDisplayName: string, group?: string) => {
    if (defsByTikzName.has(aliasTikzName)) return;
    const aliasDef: ComponentDef = {
      ...sourceDef,
      id: `${sourceDef.id}__alias__${aliasTikzName.replace(/\s+/g, '-')}`,
      displayName: aliasDisplayName,
      group: group ?? sourceDef.group,
      tikzName: aliasTikzName,
    };
    registry.register(aliasDef);
    defsByTikzName.set(aliasDef.tikzName, aliasDef);
    defsById.set(aliasDef.id, aliasDef);
  };

  const registerAliasByTikzName = (sourceTikzName: string, aliasTikzName: string, aliasDisplayName: string, group?: string) => {
    const source = defsByTikzName.get(sourceTikzName);
    if (!source) return;
    registerAlias(source, aliasTikzName, aliasDisplayName, group);
  };

  registerAliasByTikzName('american resistor', 'R', 'Resistor', 'Resistive bipoles');
  registerAliasByTikzName('american resistor', 'resistor', 'Resistor', 'Resistive bipoles');
  registerAliasByTikzName('capacitor', 'C', 'Capacitor', 'Capacitive and dynamic bipoles');

  for (const entry of componentCatalog.components) {
    if (entry.hidden) continue;
    if (defsByTikzName.has(entry.tag)) continue;
    const source = entry.previewDefId ? defsById.get(entry.previewDefId) : undefined;
    if (!source) continue;
    registerAlias(source, entry.tag, entry.displayName, entry.group || source.group);
  }
}
