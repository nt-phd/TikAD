import type { ComponentDef } from '../types';
import { registry } from './ComponentRegistry';

const battery: ComponentDef = {
  id: 'battery',
  displayName: 'Batteria',
  category: 'source',
  placementType: 'bipole',
  tikzName: 'battery1',
  symbolId: 'path_battery1',
  symbolPinSpan: 15.87406,    // 7.93703 - (-7.93703)
  symbolRefX: 8.20272,
  symbolRefY: 16.40544,
  viewBox: '0 0 16.4054 32.81084',
  viewBoxW: 16.4054,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
  shortcut: 'b',
};

const vsourceDC: ComponentDef = {
  id: 'vsource-dc',
  displayName: 'Gen. tensione (EU)',
  category: 'source',
  placementType: 'bipole',
  tikzName: 'european voltage source',
  symbolId: 'path_european-voltage-source',
  symbolPinSpan: 31.74816,    // 15.87408 - (-15.87408)
  symbolRefX: 16.40544,
  symbolRefY: 16.40544,
  viewBox: '0 0 32.81084 32.81084',
  viewBoxW: 32.81084,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
  shortcut: 'v',
};

const vsourceAC: ComponentDef = {
  id: 'vsource-ac',
  displayName: 'Gen. tensione sinusoidale',
  category: 'source',
  placementType: 'bipole',
  tikzName: 'sinusoidal voltage source',
  symbolId: 'path_sinusoidal-voltage-source',
  symbolPinSpan: 31.74816,
  symbolRefX: 16.40544,
  symbolRefY: 16.40544,
  viewBox: '0 0 32.81084 32.81084',
  viewBoxW: 32.81084,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
};

const isourceDC: ComponentDef = {
  id: 'isource-dc',
  displayName: 'Gen. corrente (EU)',
  category: 'source',
  placementType: 'bipole',
  tikzName: 'european current source',
  symbolId: 'path_european-current-source',
  symbolPinSpan: 31.74816,
  symbolRefX: 16.40544,
  symbolRefY: 16.40544,
  viewBox: '0 0 32.81084 32.81084',
  viewBoxW: 32.81084,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
  shortcut: 'i',
};

const isourceAC: ComponentDef = {
  id: 'isource-ac',
  displayName: 'Gen. corrente sinusoidale',
  category: 'source',
  placementType: 'bipole',
  tikzName: 'sinusoidal current source',
  symbolId: 'path_sinusoidal-current-source',
  symbolPinSpan: 31.74816,
  symbolRefX: 16.40544,
  symbolRefY: 16.40544,
  viewBox: '0 0 32.81084 32.81084',
  viewBoxW: 32.81084,
  viewBoxH: 32.81084,
  defaultProps: { label: '' },
};

[battery, vsourceDC, vsourceAC, isourceDC, isourceAC].forEach(d => registry.register(d));
