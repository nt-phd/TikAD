import { TIKZ_PT_PER_UNIT } from '../constants';
import type { ComponentDef } from '../types';
import { scaleState } from './ScaleState';

export function getSymbolScaleToWorld(def: ComponentDef, worldGridSize: number): number {
  return (worldGridSize / TIKZ_PT_PER_UNIT) * scaleState.getComponentScale(def);
}

export function getBipoleBodyMetrics(
  def: ComponentDef,
  worldGridSize: number,
  dist: number,
): {
  bodyHeight: number;
  bodyWidth: number;
  bodyX: number;
  bodyY: number;
  pinScale: number;
  pinStartAbsX: number;
} {
  const pinScale = getSymbolScaleToWorld(def, worldGridSize);
  const startPin = def.symbolPins?.find((pin) => pin.name === 'START');
  const endPin = def.symbolPins?.find((pin) => pin.name === 'END');
  const pinStartAbsX = def.symbolRefX + (startPin?.x ?? -(def.symbolPinSpan / 2));
  const pinEndAbsX = def.symbolRefX + (endPin?.x ?? (def.symbolPinSpan / 2));
  const pinMidAbsX = (pinStartAbsX + pinEndAbsX) / 2;
  const axisOffset = dist / 2 - pinMidAbsX * pinScale;
  const bboxX = def.shapeBBoxX ?? 0;
  const bboxY = def.shapeBBoxY ?? 0;
  const bboxW = def.shapeBBoxW ?? def.viewBoxW;
  const bboxH = def.shapeBBoxH ?? def.viewBoxH;
  return {
    bodyWidth: bboxW * pinScale,
    bodyHeight: bboxH * pinScale,
    bodyX: axisOffset + bboxX * pinScale,
    bodyY: (bboxY - def.symbolRefY) * pinScale,
    pinScale,
    pinStartAbsX,
  };
}

export function getPlacedComponentMetrics(
  def: ComponentDef,
  worldGridSize: number,
): {
  height: number;
  leftOffset: number;
  scale: number;
  topOffset: number;
  width: number;
} {
  const scale = getSymbolScaleToWorld(def, worldGridSize);
  const bboxX = def.shapeBBoxX ?? 0;
  const bboxY = def.shapeBBoxY ?? 0;
  const bboxW = def.shapeBBoxW ?? def.viewBoxW;
  const bboxH = def.shapeBBoxH ?? def.viewBoxH;
  return {
    width: bboxW * scale,
    height: bboxH * scale,
    leftOffset: (bboxX - def.symbolRefX) * scale,
    topOffset: (bboxY - def.symbolRefY) * scale,
    scale,
  };
}
