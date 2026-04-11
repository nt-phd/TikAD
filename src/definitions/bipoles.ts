import type { ComponentDef } from '../types';
import { registry } from './ComponentRegistry';

// All values from symbols.svg metadata
// symbolPinSpan = |pinEND.x| + |pinSTART.x| = END - START

const resistorEU: ComponentDef = {
  id: 'resistor-eu',
  displayName: 'Resistore (EU)',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'european resistor',
  symbolId: 'path_european-resistor',
  symbolPinSpan: 42.33064,    // 21.16532 - (-21.16532)
  symbolRefX: 21.69667,
  symbolRefY: 8.46838,
  viewBox: '0 0 43.3933 16.93673',
  viewBoxW: 43.3933,
  viewBoxH: 16.93673,
  defaultProps: { label: '' },
  shortcut: 'r',
};

const resistorUS: ComponentDef = {
  id: 'resistor-us',
  displayName: 'Resistore (US)',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'american resistor',
  symbolId: 'path_american-resistor',
  symbolPinSpan: 42.33062,    // 21.16532 - (-21.16530)
  symbolRefX: 22.228,
  symbolRefY: 8.46838,
  viewBox: '0 0 44.45585 16.93673',
  viewBoxW: 44.45585,
  viewBoxH: 16.93673,
  defaultProps: { label: '' },
};

const capacitor: ComponentDef = {
  id: 'capacitor',
  displayName: 'Condensatore',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'capacitor',
  symbolId: 'path_capacitor',
  symbolPinSpan: 10.58243,    // 5.29121 - (-5.29122)
  symbolRefX: 5.82259,
  symbolRefY: 16.40544,
  viewBox: '0 0 11.64513 32.81084',
  viewBoxW: 11.64513,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
  shortcut: 'c',
};

const electrolytic: ComponentDef = {
  id: 'electrolytic',
  displayName: 'Condensatore elettrolitico',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'ecapacitor',
  symbolId: 'path_ecapacitor',
  symbolPinSpan: 10.58245,    // 5.29123 - (-5.29122)
  symbolRefX: 18.18917,
  symbolRefY: 13.75964,
  viewBox: '0 0 24.01172 27.51924',
  viewBoxW: 24.01172,
  viewBoxH: 27.51924,
  defaultProps: { label: '' },
};

const inductorEU: ComponentDef = {
  id: 'inductor-eu',
  displayName: 'Induttore (EU)',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'european inductor',
  symbolId: 'path_european-inductor',
  symbolPinSpan: 42.33064,
  symbolRefX: 21.69667,
  symbolRefY: 8.46838,
  viewBox: '0 0 43.3933 16.93673',
  viewBoxW: 43.3933,
  viewBoxH: 16.93673,
  defaultProps: { label: '' },
  shortcut: 'l',
};

const inductorUS: ComponentDef = {
  id: 'inductor-us',
  displayName: 'Induttore (US)',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'american inductor',
  symbolId: 'path_american-inductor',
  symbolPinSpan: 42.33062,
  symbolRefX: 22.228,
  symbolRefY: 8.25549,
  viewBox: '0 0 44.45593 8.99932',
  viewBoxW: 44.45593,
  viewBoxH: 8.99932,
  defaultProps: { label: '' },
};

const diode: ComponentDef = {
  id: 'diode',
  displayName: 'Diodo',
  category: 'diode',
  placementType: 'bipole',
  tikzName: 'full diode',
  symbolId: 'path_full-diode',
  symbolPinSpan: 21.16492,    // 10.58246 - (-10.58246)
  symbolRefX: 11.11382,
  symbolRefY: 13.75964,
  viewBox: '0 0 22.22761 27.51924',
  viewBoxW: 22.22761,
  viewBoxH: 27.51924,
  defaultProps: { label: '' },
  shortcut: 'd',
};

const led: ComponentDef = {
  id: 'led',
  displayName: 'LED',
  category: 'diode',
  placementType: 'bipole',
  tikzName: 'full led',
  symbolId: 'path_full-led',
  symbolPinSpan: 21.16492,
  symbolRefX: 11.11382,
  symbolRefY: 26.72226,
  viewBox: '0 0 24.07839 40.48186',
  viewBoxW: 24.07839,
  viewBoxH: 40.48186,
  defaultProps: { label: '' },
};

const zenerDiode: ComponentDef = {
  id: 'zener',
  displayName: 'Diodo Zener',
  category: 'diode',
  placementType: 'bipole',
  tikzName: 'full Zener diode',
  symbolId: 'path_full-Zener-diode',
  symbolPinSpan: 21.16492,
  symbolRefX: 11.11382,
  symbolRefY: 13.75964,
  viewBox: '0 0 22.22761 27.51924',
  viewBoxW: 22.22761,
  viewBoxH: 27.51924,
  defaultProps: { label: '' },
};

const fuse: ComponentDef = {
  id: 'fuse',
  displayName: 'Fusibile',
  category: 'passive',
  placementType: 'bipole',
  tikzName: 'fuse',
  symbolId: 'path_fuse',
  symbolPinSpan: 26.45656,    // 13.22828 - (-13.22828)
  symbolRefX: 13.75964,
  symbolRefY: 5.82259,
  viewBox: '0 0 27.51924 11.64513',
  viewBoxW: 27.51924,
  viewBoxH: 11.64513,
  defaultProps: { label: '' },
};

const switchNO: ComponentDef = {
  id: 'switch-no',
  displayName: 'Interruttore NA',
  category: 'switch',
  placementType: 'bipole',
  tikzName: 'normal open switch',
  symbolId: 'path_normal-open-switch',
  symbolPinSpan: 18.51991,    // 9.25997 - (-9.25994)
  symbolRefX: 9.7913,
  symbolRefY: 8.4684,
  viewBox: '0 0 19.31689 8.9997',
  viewBoxW: 19.31689,
  viewBoxH: 8.9997,
  defaultProps: { label: '' },
  shortcut: 's',
};

const switchNC: ComponentDef = {
  id: 'switch-nc',
  displayName: 'Interruttore NC',
  category: 'switch',
  placementType: 'bipole',
  tikzName: 'normal closed switch',
  symbolId: 'path_normal-closed-switch',
  symbolPinSpan: 18.51991,
  symbolRefX: 9.7913,
  symbolRefY: 9.79131,
  viewBox: '0 0 19.31689 10.32262',
  viewBoxW: 19.31689,
  viewBoxH: 10.32262,
  defaultProps: { label: '' },
};

[resistorEU, resistorUS, capacitor, electrolytic, inductorEU, inductorUS,
 diode, led, zenerDiode, fuse, switchNO, switchNC].forEach(d => registry.register(d));
