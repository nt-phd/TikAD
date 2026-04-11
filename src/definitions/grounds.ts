import type { ComponentDef } from '../types';
import { registry } from './ComponentRegistry';

const ground: ComponentDef = {
  id: 'ground',
  displayName: 'Massa (GND)',
  category: 'ground',
  placementType: 'monopole',
  tikzName: 'ground',
  symbolId: 'node_ground',
  symbolPinSpan: 0,
  symbolRefX: 8.43034,
  symbolRefY: 0.2657,
  viewBox: '0 0 16.93673 22.00036',
  viewBoxW: 16.93673,
  viewBoxH: 22.00036,
  defaultProps: {},
};

const chassisGround: ComponentDef = {
  id: 'chassis-ground',
  displayName: 'Massa telaio',
  category: 'ground',
  placementType: 'monopole',
  tikzName: 'tlground',
  symbolId: 'node_tlground',
  symbolPinSpan: 0,
  symbolRefX: 8.43034,
  symbolRefY: 0.49332,
  viewBox: '0 0 16.93673 6.35391',
  viewBoxW: 16.93673,
  viewBoxH: 6.35391,
  defaultProps: {},
};

const vcc: ComponentDef = {
  id: 'vcc',
  displayName: 'VCC',
  category: 'ground',
  placementType: 'monopole',
  tikzName: 'vcc',
  symbolId: 'node_vcc',
  symbolPinSpan: 0,
  symbolRefX: 5.82259,
  symbolRefY: 21.43062,
  viewBox: '0 0 11.64513 21.69627',
  viewBoxW: 11.64513,
  viewBoxH: 21.69627,
  defaultProps: {},
};

const vee: ComponentDef = {
  id: 'vee',
  displayName: 'VEE',
  category: 'ground',
  placementType: 'monopole',
  tikzName: 'vee',
  symbolId: 'node_vee',
  symbolPinSpan: 0,
  symbolRefX: 5.82259,
  symbolRefY: 0.30373,
  viewBox: '0 0 11.64513 21.73431',
  viewBoxW: 11.64513,
  viewBoxH: 21.73431,
  defaultProps: {},
};

[ground, chassisGround, vcc, vee].forEach(d => registry.register(d));
