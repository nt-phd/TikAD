import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  Dispatch,
  SetStateAction,
} from 'react';
import {
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  ListSubheader,
  MenuItem,
  OutlinedInput,
  Pagination,
  PaginationItem,
  Paper,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
  useTheme,
} from '@mui/material';
import { RichTreeView, TreeItem, useRichTreeViewApiRef } from '@mui/x-tree-view';
import { TreeItemLabel } from '@mui/x-tree-view/TreeItem';
import type { TreeItemProps } from '@mui/x-tree-view/TreeItem';
import { useTreeItemModel } from '@mui/x-tree-view/hooks';
import type { UseTreeItemLabelSlotOwnProps } from '@mui/x-tree-view/useTreeItem';
import SearchRoundedIcon from '@mui/icons-material/SearchOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardOutlined';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadRoundedIcon from '@mui/icons-material/DownloadOutlined';
import RestoreRoundedIcon from '@mui/icons-material/RestoreOutlined';
import CodeMirror from '@uiw/react-codemirror';
import type { EditorView } from '@codemirror/view';
import { lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import type { ImperativeAppHandle } from './initImperativeApp';
import { initImperativeApp } from './initImperativeApp';
import { lineIndexFromId } from './codegen/CircuiTikZParser';
import { formatCoord } from './codegen/CoordFormatter';
import { formatEndpoint } from './codegen/TikzEndpointFormatter';
import { DocumentEditor } from './components/DocumentEditor';
import { PanelSection } from './components/PanelSection';
import { StatementEditor, type PositionPick } from './components/StatementEditor';
import { ToolbarView, ToolRailView, type SymbolShortcutTikzName } from './components/ToolbarView';
import { createCodeMirrorTheme, latexLanguage } from './components/ui/codeMirrorTheme';
import { DEFAULT_PREAMBLE } from './model/LatexDocument';
import type {
  ComponentDef,
  EditableStatement,
  GridPoint,
  ToolType,
} from './types';
import type { WireRoutingMode } from './types';
import { componentCatalog } from './data/componentCatalog';
import statementEditorSchemaJson from './data/statementEditorSchema.json';
type HistoryEntry = { ts: number; source: string };
type ThemeMode = 'light' | 'dark';

function CodePanelLayout({
  actions,
  children,
}: {
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', flex: '1 1 0', minHeight: 180, minWidth: 0, overflow: 'hidden', p: 2, pb: 1 }}>
        {children}
      </Box>
      <Box sx={{ alignItems: 'center', display: 'flex', flex: '0 0 auto', gap: 1.5, justifyContent: 'flex-end', px: 2, pb: 1.5, pt: 0.5 }}>
        {actions}
      </Box>
    </Box>
  );
}

const GROUP_ORDER = [
  'Resistive bipoles',
  'Capacitive and dynamic bipoles',
  'Inductors',
  'Diodes',
  'Sources and generators',
  'Switches, buttons and jumpers',
  'Grounds and supply voltages',
  'Amplifiers',
  'Block diagram',
  'Logic gates',
  'RF components',
  'Instruments',
  'Wiring',
  'Mechanical',
  'Miscellaneous',
  'Tubes',
] as const;

const DEFAULT_LIBRARY_VISIBLE_COUNT = componentCatalog.components
  .filter((entry) => !entry.hidden)
  .filter((entry) => entry.styleKind !== 'alias style')
  .length;

const DEFAULT_SIDEBAR_WIDTH = 480;
const MIN_SIDEBAR_WIDTH = 480;
const MAX_SIDEBAR_WIDTH = 760;
const SIDEBAR_RESPONSIVE_BREAKPOINT = 1000;

function shouldCollapseSidebarForViewport(): boolean {
  return window.innerWidth < SIDEBAR_RESPONSIVE_BREAKPOINT;
}

function readStoredThemeMode(): ThemeMode | null {
  const stored = window.localStorage.getItem('theme-mode');
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function readSystemThemeMode(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const MIN_CANVAS_WIDTH = 320;
const MONOSPACE_FONT = '"Roboto Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const PROPERTIES_FIELD_SX = {
  '& .MuiChip-label': {
    fontFamily: MONOSPACE_FONT,
  },
  '& .MuiInputBase-input': {
    fontFamily: MONOSPACE_FONT,
  },
  '& .MuiSelect-select': {
    fontFamily: MONOSPACE_FONT,
  },
} as const;
const PROPERTIES_MENU_PROPS = {
  PaperProps: {
    sx: {
      '& .MuiListSubheader-root': {
        fontFamily: MONOSPACE_FONT,
      },
      '& .MuiMenuItem-root': {
        fontFamily: MONOSPACE_FONT,
      },
    },
  },
} as const;

function buildPositionPickOptions(
  handle: ImperativeAppHandle,
  gridPt: GridPoint,
  gridPitch: number,
): { options: Array<{ label: string; value: string }>; value: string } {
  const baseValue = formatCoord(gridPt);
  const options: Array<{ label: string; value: string }> = [{ label: baseValue, value: baseValue }];
  const tolerance = gridPitch / 2;
  const refValues = new Set<string>();
  for (const [key, point] of handle.circuitDoc.getSnappableSymbolPoints().entries()) {
    if (Math.abs(point.x - gridPt.x) > tolerance) continue;
    if (Math.abs(point.y - gridPt.y) > tolerance) continue;
    const dotIndex = key.indexOf('.');
    const nodeName = dotIndex >= 0 ? key.slice(0, dotIndex) : key;
    const anchor = dotIndex >= 0 ? key.slice(dotIndex + 1) : 'reference';
    refValues.add(formatEndpoint(point, { componentId: '', nodeName, anchor }));
  }
  for (const refValue of refValues) {
    options.push({ label: refValue, value: refValue });
  }
  return { options, value: baseValue };
}

type VoltageStyle = 'europeanvoltages' | 'straightvoltages' | 'americanvoltages';
type GlobalStyle = 'european' | 'american';
type CurrentStyle = 'europeancurrents' | 'americancurrents';
type ResistorStyle = 'europeanresistors' | 'americanresistors';
type InductorStyle = 'europeaninductors' | 'americaninductors' | 'cuteinductors';
type PortStyle = 'americanports' | 'europeanports';
type GfsStyle = 'americangfsurgearrester' | 'europeangfsurgearrester';
type UnitStyle = 'siunitx' | 'nosiunitx';
type DiodeStyle = 'fulldiode' | 'strokediode' | 'emptydiode';
type MosArrowStyle = 'arrowmos' | 'noarrowmos';
type FetBodyDiodeStyle = 'fetbodydiode' | 'nofetbodydiode';
type FetSolderDotStyle = 'fetsolderdot' | 'nofetsolderdot';
type TransistorTextStyle = 'legacytransistorstext' | 'centertransistorstext';
type LabelStyle = 'straightlabels' | 'rotatelabels' | 'smartlabels';
type EnvironmentType = 'tikzpicture' | 'circuitikz';
type CompatibilityStyle = 'compatibility' | 'nocompatibility';
type OptionalStyle<T extends string> = T | '';

interface CircuitikzDocumentSettings {
  compatibilityStyle: OptionalStyle<CompatibilityStyle>;
  diodeStyle: OptionalStyle<DiodeStyle>;
  fetBodyDiode: OptionalStyle<FetBodyDiodeStyle>;
  fetSolderDot: OptionalStyle<FetSolderDotStyle>;
  gfsStyle: OptionalStyle<GfsStyle>;
  globalStyle: OptionalStyle<GlobalStyle>;
  currentStyle: OptionalStyle<CurrentStyle>;
  inductorStyle: OptionalStyle<InductorStyle>;
  labelStyle: OptionalStyle<LabelStyle>;
  lazyMos: boolean;
  mosArrowStyle: OptionalStyle<MosArrowStyle>;
  emptyPmosCircle: boolean;
  portStyle: OptionalStyle<PortStyle>;
  resistorStyle: OptionalStyle<ResistorStyle>;
  transistorTextStyle: OptionalStyle<TransistorTextStyle>;
  unitStyle: OptionalStyle<UnitStyle>;
  voltageStyle: OptionalStyle<VoltageStyle>;
}

const EMPTY_DOCUMENT_SETTINGS: CircuitikzDocumentSettings = {
  compatibilityStyle: '',
  currentStyle: '',
  diodeStyle: '',
  emptyPmosCircle: false,
  fetBodyDiode: '',
  fetSolderDot: '',
  gfsStyle: '',
  globalStyle: '',
  inductorStyle: '',
  labelStyle: '',
  lazyMos: false,
  mosArrowStyle: '',
  portStyle: '',
  resistorStyle: '',
  transistorTextStyle: '',
  unitStyle: '',
  voltageStyle: '',
};

const DEFAULT_DOCUMENT_SETTINGS: CircuitikzDocumentSettings = {
  ...EMPTY_DOCUMENT_SETTINGS,
  unitStyle: 'siunitx',
};

const BASE_PREAMBLE_PACKAGES = [
  '\\usepackage{amsmath}',
  '\\usepackage{amsfonts}',
  '\\usepackage{amssymb}',
  '\\usepackage{newpxtext}',
  '\\usepackage{newpxmath}',
  '\\usepackage{tikz}',
];

const MULTI_SELECT_MENU_PROPS = {
  PaperProps: {
    style: {
      maxHeight: 48 * 4.5 + 8,
      width: 260,
    },
  },
} as const;

function fallbackContentHash(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function contentHash(source: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return fallbackContentHash(source);
  }

  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDownloadFilename(source: string, extension: string): Promise<string> {
  return `tikad_${await contentHash(source)}.${extension}`;
}

function parsePreambleSettings(preamble: string): CircuitikzDocumentSettings {
  const next = { ...EMPTY_DOCUMENT_SETTINGS };
  const circuitikzMatch = preamble.match(/\\usepackage(?:\[([^\]]*)\])?\{circuitikz\}/);
  const options = circuitikzMatch?.[1]
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
  const has = (value: string) => options.includes(value);

  if (has('american')) {
    next.globalStyle = 'american';
  }
  if (has('european')) {
    next.globalStyle = 'european';
  }
  if (has('europeanvoltages')) next.voltageStyle = 'europeanvoltages';
  if (has('straightvoltages')) next.voltageStyle = 'straightvoltages';
  if (has('americanvoltages')) next.voltageStyle = 'americanvoltages';
  if (has('europeancurrents')) next.currentStyle = 'europeancurrents';
  if (has('americancurrents')) next.currentStyle = 'americancurrents';
  if (has('europeanresistors')) next.resistorStyle = 'europeanresistors';
  if (has('americanresistors')) next.resistorStyle = 'americanresistors';
  if (has('europeaninductors')) next.inductorStyle = 'europeaninductors';
  if (has('americaninductors')) next.inductorStyle = 'americaninductors';
  if (has('cuteinductors')) next.inductorStyle = 'cuteinductors';
  if (has('americanports')) next.portStyle = 'americanports';
  if (has('europeanports')) next.portStyle = 'europeanports';
  if (has('americangfsurgearrester')) next.gfsStyle = 'americangfsurgearrester';
  if (has('europeangfsurgearrester')) next.gfsStyle = 'europeangfsurgearrester';
  if (has('siunitx') || /\\usepackage\{siunitx\}/.test(preamble)) next.unitStyle = 'siunitx';
  if (has('nosiunitx')) next.unitStyle = 'nosiunitx';
  if (has('fulldiode')) next.diodeStyle = 'fulldiode';
  if (has('strokediode')) next.diodeStyle = 'strokediode';
  if (has('emptydiode')) next.diodeStyle = 'emptydiode';
  if (has('arrowmos')) next.mosArrowStyle = 'arrowmos';
  if (has('noarrowmos')) next.mosArrowStyle = 'noarrowmos';
  if (has('fetbodydiode')) next.fetBodyDiode = 'fetbodydiode';
  if (has('nofetbodydiode')) next.fetBodyDiode = 'nofetbodydiode';
  if (has('fetsolderdot')) next.fetSolderDot = 'fetsolderdot';
  if (has('nofetsolderdot')) next.fetSolderDot = 'nofetsolderdot';
  if (has('emptypmoscircle')) next.emptyPmosCircle = true;
  if (has('lazymos')) next.lazyMos = true;
  if (has('legacytransistorstext')) next.transistorTextStyle = 'legacytransistorstext';
  if (has('nolegacytransistorstext') || has('centertransistorstext')) next.transistorTextStyle = 'centertransistorstext';
  if (has('straightlabels')) next.labelStyle = 'straightlabels';
  if (has('rotatelabels')) next.labelStyle = 'rotatelabels';
  if (has('smartlabels')) next.labelStyle = 'smartlabels';
  if (has('compatibility')) next.compatibilityStyle = 'compatibility';
  if (has('nocompatibility')) next.compatibilityStyle = 'nocompatibility';
  return next;
}

function buildCircuitikzPreamble(settings: CircuitikzDocumentSettings): string {
  const options = collectCircuitikzOptions(settings);

  return [
    ...BASE_PREAMBLE_PACKAGES,
    ...(settings.unitStyle === 'siunitx' ? ['\\usepackage{siunitx}'] : []),
    options.length > 0 ? `\\usepackage[${options.join(', ')}]{circuitikz}` : '\\usepackage{circuitikz}',
  ].join('\n');
}

function parseEnvironmentSettings(body: string): { options: string; type: EnvironmentType } {
  const match = body.match(/^\s*\\begin\{(tikzpicture|circuitikz)\}(?:\[([^\]]*)\])?\s*$/m);
  return {
    type: (match?.[1] as EnvironmentType | undefined) ?? 'tikzpicture',
    options: match?.[2]?.trim() ?? '',
  };
}

function parsePreamblePackages(preamble: string): PreamblePackage[] {
  const packages: PreamblePackage[] = [];
  const regex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(preamble)) !== null) {
    const optionsText = match[1]?.trim() || undefined;
    const names = match[2]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    for (const name of names) {
      packages.push({ name, optionsText });
    }
  }
  return packages;
}

function emitPreamblePackage(pkg: PreamblePackage): string {
  const options = pkg.optionsText?.trim();
  return options ? `\\usepackage[${options}]{${pkg.name}}` : `\\usepackage{${pkg.name}}`;
}

function buildPreambleFromPackages(packages: PreamblePackage[]): string {
  return packages.map((pkg) => emitPreamblePackage(pkg)).join('\n');
}

function collectCircuitikzOptions(settings: CircuitikzDocumentSettings): string[] {
  return [
    settings.globalStyle,
    settings.currentStyle,
    settings.voltageStyle,
    settings.resistorStyle,
    settings.inductorStyle,
    settings.portStyle,
    settings.gfsStyle,
    settings.unitStyle,
    settings.diodeStyle,
    settings.mosArrowStyle,
    settings.fetBodyDiode,
    settings.fetSolderDot,
    settings.transistorTextStyle,
    settings.labelStyle,
    settings.compatibilityStyle,
    ...(settings.emptyPmosCircle ? ['emptypmoscircle'] : []),
    ...(settings.lazyMos ? ['lazymos'] : []),
  ].filter((value): value is string => Boolean(value));
}

function applyEnvironmentSettingsToBody(body: string, type: EnvironmentType, options: string): string {
  const lines = body.split('\n');
  const beginLine = `\\begin{${type}}${options.trim() ? `[${options.trim()}]` : ''}`;
  const endLine = `\\end{${type}}`;
  const beginIndex = lines.findIndex((line) => /^\s*\\begin\{(?:tikzpicture|circuitikz)\}(?:\[[^\]]*\])?\s*$/.test(line));
  const endIndex = [...lines].reverse().findIndex((line) => /^\s*\\end\{(?:tikzpicture|circuitikz)\}\s*$/.test(line));
  if (beginIndex >= 0 && endIndex >= 0) {
    const resolvedEndIndex = lines.length - 1 - endIndex;
    lines[beginIndex] = beginLine;
    lines[resolvedEndIndex] = endLine;
    return lines.join('\n');
  }
  const trimmedBody = body.trim();
  return trimmedBody
    ? `${beginLine}\n\n${trimmedBody}\n\n${endLine}`
    : `${beginLine}\n\n${endLine}`;
}

function clampSidebarWidth(width: number): number {
  const viewportCap = typeof window === 'undefined'
    ? MAX_SIDEBAR_WIDTH
    : Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH - 10);
  return Math.min(Math.min(MAX_SIDEBAR_WIDTH, viewportCap), Math.max(MIN_SIDEBAR_WIDTH, width));
}

function resizerSx(axis: 'horizontal' | 'vertical') {
  const isVertical = axis === 'vertical';
  return {
    backgroundColor: 'transparent',
    border: 'none',
    cursor: isVertical ? 'col-resize' : 'row-resize',
    flex: '0 0 auto',
    opacity: 1,
    position: 'relative',
    '&::after': {
      backgroundColor: 'divider',
      borderRadius: 999,
      content: '""',
      inset: isVertical ? '12px 4px' : '4px 12px',
      position: 'absolute',
      transition: 'background-color 120ms ease',
    },
    '&:hover::after': {
      backgroundColor: 'primary.main',
    },
  } as const;
}

function toolForDef(def: ComponentDef): ToolType {
  return def.placementType === 'bipole'
    ? 'place-bipole'
    : def.placementType === 'monopole'
      ? 'place-monopole'
      : 'place-node';
}

function formatGridCoord(value: number, pitch: number): string {
  const snapped = Math.round(value / pitch) * pitch;
  const decimals = Number.isInteger(pitch) ? 0 : (String(pitch).split('.')[1]?.length ?? 0);
  return snapped.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatStatusCoord(value: number, pitch: number): string {
  const snapped = Math.round(value / pitch) * pitch;
  const decimals = Number.isInteger(pitch) ? 0 : (String(pitch).split('.')[1]?.length ?? 0);
  return snapped.toFixed(decimals);
}

function namespaceInlineSvg(markup: string, prefix: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return markup;
    const idMap = new Map<string, string>();
    for (const element of svg.querySelectorAll('[id]')) {
      const current = element.getAttribute('id');
      if (!current) continue;
      const next = `${prefix}-${current}`;
      idMap.set(current, next);
      element.setAttribute('id', next);
    }
    const attrs = ['href', 'xlink:href', 'clip-path', 'fill', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'mask', 'stroke'];
    for (const element of svg.querySelectorAll('*')) {
      for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        let next = value;
        for (const [from, to] of idMap) {
          next = next.replaceAll(`url(#${from})`, `url(#${to})`).replaceAll(`#${from}`, `#${to}`);
        }
        if (next !== value) element.setAttribute(attr, next);
      }
      const style = element.getAttribute('style');
      if (!style) continue;
      let nextStyle = style;
      for (const [from, to] of idMap) {
        nextStyle = nextStyle.replaceAll(`url(#${from})`, `url(#${to})`).replaceAll(`#${from}`, `#${to}`);
      }
      if (nextStyle !== style) element.setAttribute('style', nextStyle);
    }
    return svg.outerHTML;
  } catch {
    return markup;
  }
}

type LibraryTreeItemModel = {
  id: string;
  label: string;
  kind: 'group' | 'component';
  count?: number;
  defId?: string;
  def?: ComponentDef;
  codeLabel?: string;
  displayName?: string;
  staticSvg?: string | null;
  children?: LibraryTreeItemModel[];
};

type LibraryTreeLabelProps = UseTreeItemLabelSlotOwnProps & {
  item: LibraryTreeItemModel | undefined;
  isLoadingPreview: boolean;
};

function LibraryItemThumbnail({ def, staticSvg }: { def: ComponentDef; staticSvg: string | null }) {
  const markup = useMemo(() => {
    return staticSvg ? namespaceInlineSvg(staticSvg, `thumb-${def.id}`) : null;
  }, [def.id, staticSvg]);

  const SIZE = 36;
  return (
    <Paper
      elevation={0}
      sx={{ alignItems: 'center', bgcolor: 'common.white', display: 'flex', flexShrink: 0, height: SIZE, justifyContent: 'center', mr: 1, overflow: 'hidden', width: SIZE }}
      variant="outlined"
    >
      {markup ? (
        <Box
          dangerouslySetInnerHTML={{ __html: markup }}
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            width: '100%',
            '& svg': { display: 'block', height: 'auto', maxHeight: SIZE - 4, maxWidth: SIZE - 4, overflow: 'visible', width: 'auto' },
          }}
        />
      ) : null}
    </Paper>
  );
}

function LibraryTreeLabel({ children, item, isLoadingPreview, ...other }: LibraryTreeLabelProps) {
  if (!item) return <TreeItemLabel {...other}>{children}</TreeItemLabel>;

  if (item.kind === 'group') {
    return (
      <TreeItemLabel
        {...other}
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 0.75,
          minHeight: 30,
          minWidth: 0,
          py: 0.125,
        }}
      >
        <Typography
          sx={{
            flex: '0 1 auto',
            fontSize: 13,
            fontWeight: 600,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          variant="body2"
        >
          {item.label}
        </Typography>
        <Typography color="text.disabled" component="span" sx={{ flex: '0 0 auto', fontFamily: 'monospace', fontSize: 12 }} variant="caption">
          ({item.count})
        </Typography>
      </TreeItemLabel>
    );
  }

  return (
    <TreeItemLabel {...other}>
      <Tooltip
        arrow
        enterDelay={1000}
        placement="right"
        title={item.def ? (
          <LibraryTooltipContent
            codeLabel={item.codeLabel ?? ''}
            def={item.def}
            displayName={item.displayName ?? ''}
            isLoadingPreview={isLoadingPreview}
            staticSvg={item.staticSvg ?? null}
          />
        ) : null}
      >
        <Box sx={{ alignItems: 'center', display: 'flex', minWidth: 0, width: '100%' }}>
          {item.def ? (
            <LibraryItemThumbnail def={item.def} staticSvg={item.staticSvg ?? null} />
          ) : null}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ display: '-webkit-box', overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, wordBreak: 'break-word' }} variant="caption">
              {item.displayName}
            </Typography>
            <Typography color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} variant="caption">
              {item.codeLabel}
            </Typography>
          </Box>
        </Box>
      </Tooltip>
    </TreeItemLabel>
  );
}

function LibraryTooltipContent({
  codeLabel,
  def,
  displayName,
  isLoadingPreview,
  staticSvg,
}: {
  codeLabel: string;
  def: ComponentDef;
  displayName: string;
  isLoadingPreview: boolean;
  staticSvg: string | null;
}) {
  const previewMarkup = useMemo(
    () => {
      return staticSvg ? namespaceInlineSvg(staticSvg, `library-${def.id}`) : null;
    },
    [def.id, staticSvg],
  );
  const previewCanvasWidth = 220;
  const previewCanvasHeight = 140;

  return (
    <Box sx={{ maxWidth: 260, p: 0.5 }}>
      <Typography sx={{ fontWeight: 700 }} variant="body2">
        {displayName}
      </Typography>
      <Typography sx={{ opacity: 0.8 }} variant="caption">
        {codeLabel}
      </Typography>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'common.white',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          display: 'flex',
          justifyContent: 'center',
          height: previewCanvasHeight,
          mt: 1,
          overflow: 'hidden',
          px: 2,
          py: 1.5,
          width: previewCanvasWidth,
        }}
      >
        {previewMarkup ? (
          <Box
            dangerouslySetInnerHTML={{ __html: previewMarkup }}
            sx={{
              alignItems: 'center',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              width: '100%',
              '& svg': {
                display: 'block',
                height: 'auto',
                margin: 0,
                maxHeight: previewCanvasHeight - 24,
                maxWidth: previewCanvasWidth - 24,
                overflow: 'visible',
                transform: 'scale(2)',
                transformOrigin: 'center center',
                width: 'auto',
              },
            }}
          />
        ) : isLoadingPreview ? (
          <Typography color="text.secondary" variant="caption">
            Loading preview...
          </Typography>
        ) : (
          <Typography color="text.secondary" variant="caption">
            Preview unavailable
          </Typography>
        )}
      </Box>
      {def.group ? (
        <Typography sx={{ display: 'block', mt: 0.75, opacity: 0.75 }} variant="caption">
          {def.group}
        </Typography>
      ) : null}
    </Box>
  );
}

const LibraryTreeItem = React.forwardRef<HTMLLIElement, TreeItemProps>(function LibraryTreeItem(props, ref) {
  const item = useTreeItemModel<LibraryTreeItemModel>(props.itemId);
  const { isLoadingPreview } = React.useContext(LibraryTreeCtx);
  if (!item) return <TreeItem {...props} ref={ref} />;
  return (
    <TreeItem
      {...props}
      label={item.label}
      ref={ref}
      slots={{ label: LibraryTreeLabel }}
      slotProps={{ label: { item, isLoadingPreview } as never }}
    />
  );
});

type LibraryTreeContext = { isLoadingPreview: boolean };
const LibraryTreeCtx = React.createContext<LibraryTreeContext>({ isLoadingPreview: false });

type PreamblePackage = {
  name: string;
  optionsText?: string;
};

const environmentPackageOrder = (statementEditorSchemaJson.environmentTree?.packages ?? []).map((pkg) => pkg.value);
const environmentPackageOrderIndex = new Map(environmentPackageOrder.map((value, index) => [value, index]));

function sortPreamblePackages(packages: PreamblePackage[]): PreamblePackage[] {
  return [...packages]
    .map((pkg, idx) => ({
      pkg,
      order: environmentPackageOrderIndex.get(pkg.name) ?? Number.MAX_SAFE_INTEGER,
      idx,
    }))
    .sort((a, b) => (a.order - b.order) || (a.idx - b.idx))
    .map((entry) => entry.pkg);
}

function LibraryView({
  currentDefId,
  documentSettings,
  handle,
  hideSearchField = false,
  query: controlledQuery,
  onQueryChange,
  onVisibleCountChange,
  onSelectTool,
}: {
  currentDefId?: string;
  documentSettings: CircuitikzDocumentSettings;
  handle: ImperativeAppHandle | null;
  hideSearchField?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  onVisibleCountChange?: (count: number) => void;
  onSelectTool: (tool: ToolType, defId?: string) => void;
}) {
  const [internalQuery, setInternalQuery] = useState('');
  const query = controlledQuery ?? internalQuery;
  const setQuery = onQueryChange ?? setInternalQuery;
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['In use']);
  const treeApiRef = useRichTreeViewApiRef();
  const [inUseDefIds, setInUseDefIds] = useState<string[]>([]);
  const [staticPreviews, setStaticPreviews] = useState<Record<string, string>>({});
  const [catalogPreviews, setCatalogPreviews] = useState<Record<string, string>>({});
  const [catalogPreviewsLoaded, setCatalogPreviewsLoaded] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const defs = useMemo(() => handle?.registry.getAll() ?? [], [handle]);
  const defsByTikzName = useMemo(() => {
    const map = new Map<string, ComponentDef>();
    for (const def of defs) {
      if (!map.has(def.tikzName)) map.set(def.tikzName, def);
    }
    return map;
  }, [defs]);

  const effectiveSettings = useMemo(() => {
    const defaults = parsePreambleSettings(
      `\\usepackage[${(componentCatalog.packageOptions.defaults || []).join(', ')}]{circuitikz}`,
    );
    const resolveGroupedStyle = <T extends string>(
      explicitValue: T | '',
      fromAmerican: T | '',
      fromEuropean: T | '',
      defaultValue: T | '',
    ): T | '' => {
      if (explicitValue) return explicitValue;
      if (documentSettings.globalStyle === 'american') return fromAmerican;
      if (documentSettings.globalStyle === 'european') return fromEuropean;
      return defaultValue;
    };

    return {
      currentStyle: resolveGroupedStyle(documentSettings.currentStyle, 'americancurrents', 'europeancurrents', defaults.currentStyle),
      gfsStyle: resolveGroupedStyle(documentSettings.gfsStyle, 'americangfsurgearrester', 'europeangfsurgearrester', defaults.gfsStyle),
      inductorStyle: resolveGroupedStyle(documentSettings.inductorStyle, 'americaninductors', 'europeaninductors', defaults.inductorStyle),
      portStyle: resolveGroupedStyle(documentSettings.portStyle, 'americanports', 'europeanports', defaults.portStyle),
      resistorStyle: resolveGroupedStyle(documentSettings.resistorStyle, 'americanresistors', 'europeanresistors', defaults.resistorStyle),
      unitStyle: documentSettings.unitStyle || defaults.unitStyle,
      voltageStyle: resolveGroupedStyle(documentSettings.voltageStyle, 'americanvoltages', 'europeanvoltages', defaults.voltageStyle),
    };
  }, [documentSettings]);

  const resolveRepresentativeTag = (entry: typeof componentCatalog.components[number]) => {
    const pathInternal = entry.metadata?.pathInternal;
    if (!pathInternal) return entry.metadata?.representativeStyleTag || entry.tag;

    if (pathInternal === 'resistor') {
      if (effectiveSettings.resistorStyle === 'americanresistors') return 'american resistor';
      if (effectiveSettings.resistorStyle === 'europeanresistors') return 'european resistor';
    }
    if (pathInternal === 'vresistor') {
      if (effectiveSettings.resistorStyle === 'americanresistors') return 'variable american resistor';
      if (effectiveSettings.resistorStyle === 'europeanresistors') return 'variable european resistor';
    }
    if (pathInternal === 'resistivesens') {
      if (effectiveSettings.resistorStyle === 'americanresistors') return 'american resistive sensor';
      if (effectiveSettings.resistorStyle === 'europeanresistors') return 'european resistive sensor';
    }
    if (pathInternal === 'ldresistor') {
      if (effectiveSettings.resistorStyle === 'americanresistors') return 'american light dependent resistor';
      if (effectiveSettings.resistorStyle === 'europeanresistors') return 'european light dependent resistor';
    }
    if (pathInternal === 'potentiometer') {
      if (effectiveSettings.resistorStyle === 'americanresistors') return 'american potentiometer';
      if (effectiveSettings.resistorStyle === 'europeanresistors') return 'european potentiometer';
    }
    if (pathInternal === 'inductor') {
      if (effectiveSettings.inductorStyle === 'cuteinductors') return 'cute inductor';
      if (effectiveSettings.inductorStyle === 'americaninductors') return 'american inductor';
      if (effectiveSettings.inductorStyle === 'europeaninductors') return 'european inductor';
    }
    if (pathInternal === 'vinductor') {
      if (effectiveSettings.inductorStyle === 'cuteinductors') return 'variable cute inductor';
      if (effectiveSettings.inductorStyle === 'americaninductors') return 'variable american inductor';
      if (effectiveSettings.inductorStyle === 'europeaninductors') return 'variable european inductor';
    }
    if (pathInternal === 'inductivesens') {
      if (effectiveSettings.inductorStyle === 'cuteinductors') return 'cute inductive sensor';
      if (effectiveSettings.inductorStyle === 'americaninductors') return 'american inductive sensor';
      if (effectiveSettings.inductorStyle === 'europeaninductors') return 'european inductive sensor';
    }

    return entry.metadata?.representativeStyleTag || entry.tag;
  };

  const hasRenderablePreview = (entry: typeof componentCatalog.components[number]) => {
    const representativeTag = resolveRepresentativeTag(entry);
    const representativeEntry = componentCatalog.components.find((candidate) => candidate.tag === representativeTag);
    return Boolean(
      catalogPreviews[entry.tag] ||
      catalogPreviews[representativeTag] ||
      (entry.previewDefId && staticPreviews[entry.previewDefId]) ||
      (representativeEntry?.previewDefId && staticPreviews[representativeEntry.previewDefId]),
    );
  };

  const catalogItems = useMemo(() => {
    return componentCatalog.components
      .filter((entry) => !entry.hidden)
      .filter((entry) => entry.styleKind !== 'alias style')
      .map((entry) => {
        const def = defsByTikzName.get(entry.tag);
        return def ? { entry, def } : null;
      })
      .filter((item) => item ? hasRenderablePreview(item.entry) : false)
      .filter(Boolean) as Array<{ entry: typeof componentCatalog.components[number]; def: ComponentDef }>;
  }, [catalogPreviews, defsByTikzName, staticPreviews, effectiveSettings]);
  const aliasStyleLabelsByTarget = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of componentCatalog.components) {
      if (entry.styleKind !== 'alias style') continue;
      const targetTag = entry.metadata?.aliasOf;
      if (!targetTag) continue;
      const list = map.get(targetTag);
      if (list) list.push(entry.tag);
      else map.set(targetTag, [entry.tag]);
    }
    for (const [targetTag, aliases] of map) {
      map.set(targetTag, aliases.sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const queryLower = debouncedQuery.trim().toLowerCase();

  useEffect(() => {
    if (!handle) return;
    const syncInUse = () => setInUseDefIds(handle.getInUseDefIds());
    syncInUse();
    const unsubBody = handle.onBodyChange(syncInUse);
    const unsubDocument = handle.onDocumentChange(syncInUse);
    const unsubLatex = handle.onLatexEdited(syncInUse);
    return () => {
      unsubBody();
      unsubDocument();
      unsubLatex();
    };
  }, [handle]);

  useEffect(() => {
    let cancelled = false;
    fetch('/library-previews.json')
      .then((response) => response.ok ? response.json() : {})
      .then((data) => {
        if (!cancelled && data && typeof data === 'object') setStaticPreviews(data as Record<string, string>);
      })
      .catch(() => {});
    fetch('/component-catalog-previews.json')
      .then((response) => response.ok ? response.json() : {})
      .then((data) => {
        if (!cancelled && data && typeof data === 'object') setCatalogPreviews(data as Record<string, string>);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCatalogPreviewsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = queryLower
    ? catalogItems.filter(({ entry, def }) =>
        entry.displayName.toLowerCase().includes(queryLower) ||
        entry.tag.toLowerCase().includes(queryLower) ||
        (entry.group ?? def.group ?? '').toLowerCase().includes(queryLower) ||
        entry.searchTerms.some((term) => term.toLowerCase().includes(queryLower))
      )
    : catalogItems;

  useEffect(() => {
    onVisibleCountChange?.(filtered.length);
  }, [filtered.length, onVisibleCountChange]);

  const defsById = useMemo(() => new Map(defs.map((def) => [def.id, def])), [defs]);
  const inUseDefs = useMemo(
    () => inUseDefIds.map((id) => defsById.get(id)).filter(Boolean) as ComponentDef[],
    [defsById, inUseDefIds],
  );
  const catalogItemsByDefId = useMemo(() => {
    const map = new Map<string, { entry: typeof componentCatalog.components[number]; def: ComponentDef }>();
    for (const item of catalogItems) map.set(item.def.id, item);
    return map;
  }, [catalogItems]);
  const allCatalogItemsByDefId = useMemo(() => {
    const map = new Map<string, { entry: typeof componentCatalog.components[number]; def: ComponentDef }>();
    for (const entry of componentCatalog.components) {
      if (entry.hidden || entry.styleKind === 'alias style') continue;
      const def = defsByTikzName.get(entry.tag);
      if (def) map.set(def.id, { entry, def });
    }
    return map;
  }, [defsByTikzName]);
  const inUseItems = useMemo(() => {
    const seen = new Set<string>();
    const resolved: Array<{ entry: typeof componentCatalog.components[number]; def: ComponentDef }> = [];
    for (const def of inUseDefs) {
      const item = allCatalogItemsByDefId.get(def.id);
      if (!item || seen.has(item.entry.tag)) continue;
      seen.add(item.entry.tag);
      resolved.push(item);
    }
    return resolved;
  }, [allCatalogItemsByDefId, inUseDefs]);

  const groups = new Map<string, Array<{ entry: typeof componentCatalog.components[number]; def: ComponentDef }>>();
  for (const item of filtered) {
    const key = item.entry.group ?? item.def.group ?? 'Other';
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const orderedGroups = [
    ...GROUP_ORDER.filter((groupName) => groups.has(groupName)),
    ...[...groups.keys()].filter((groupName) => !GROUP_ORDER.includes(groupName as typeof GROUP_ORDER[number])),
  ];

  const buildComponentNode = (groupPrefix: string) => (item: { entry: typeof componentCatalog.components[number]; def: ComponentDef }): LibraryTreeItemModel => {
    const aliasLabels = aliasStyleLabelsByTarget.get(item.entry.tag) ?? [];
    const codeLabel = [item.entry.tag, ...aliasLabels].join(', ');
    const representativeTag = resolveRepresentativeTag(item.entry);
    const representativeEntry = componentCatalog.components.find((candidate) => candidate.tag === representativeTag);
    const prefersRepresentativePreview = Boolean(item.entry.metadata?.pathInternal);
    const staticSvg = prefersRepresentativePreview
      ? (catalogPreviews[representativeTag] ?? (representativeEntry?.previewDefId ? staticPreviews[representativeEntry.previewDefId] ?? null : null) ?? catalogPreviews[item.entry.tag] ?? (item.entry.previewDefId ? staticPreviews[item.entry.previewDefId] ?? null : null))
      : (catalogPreviews[item.entry.tag] ?? (item.entry.previewDefId ? staticPreviews[item.entry.previewDefId] ?? null : null) ?? catalogPreviews[representativeTag] ?? (representativeEntry?.previewDefId ? staticPreviews[representativeEntry.previewDefId] ?? null : null));
    return {
      id: `${groupPrefix}::${item.def.id}`,
      label: item.entry.displayName,
      kind: 'component',
      defId: item.def.id,
      def: item.def,
      codeLabel,
      displayName: item.entry.displayName,
      staticSvg,
    };
  };

  const treeItems = useMemo<LibraryTreeItemModel[]>(() => {
    const items: LibraryTreeItemModel[] = [];
    if (!queryLower && inUseItems.length > 0) {
      items.push({
        id: '__in-use__',
        label: 'In use',
        kind: 'group',
        count: inUseItems.length,
        children: inUseItems.map(buildComponentNode('__in-use__')),
      });
    }
    for (const groupName of orderedGroups) {
      const groupItems = groups.get(groupName) ?? [];
      items.push({
        id: `__group__${groupName}`,
        label: groupName,
        kind: 'group',
        count: groupItems.length,
        children: groupItems.map(buildComponentNode(`__group__${groupName}`)),
      });
    }
    return items;
  }, [inUseItems, orderedGroups, groups, catalogPreviews, staticPreviews, queryLower]);

  const expandedItems = useMemo(() => {
    if (queryLower) return treeItems.map((item) => item.id);
    return expandedGroups.map((name) => name === 'In use' ? '__in-use__' : `__group__${name}`);
  }, [queryLower, expandedGroups, treeItems]);

  return (
    <Box id="palette" sx={{ display: 'flex', flex: 1, flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden', p: 1 }}>
      {!hideSearchField ? (
        <TextField
          fullWidth
          InputProps={{
            startAdornment: <SearchRoundedIcon color="action" fontSize="small" sx={{ mr: 1 }} />,
          }}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search component…"
          value={query}
        />
      ) : null}
      {!catalogPreviewsLoaded ? (
        <Typography color="text.secondary" sx={{ px: 1, py: 1.5 }} variant="body2">
          Loading rendered library previews…
        </Typography>
      ) : null}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, flex: 1, minHeight: 0, mt: hideSearchField ? 0 : 1,  overflow: 'auto' }}>
        <LibraryTreeCtx.Provider value={{ isLoadingPreview: !catalogPreviewsLoaded }}>
          <RichTreeView
            sx={{m: 1}}
            apiRef={treeApiRef}
            expandedItems={expandedItems}
            getItemLabel={(item) => item.label}
            itemChildrenIndentation="0"
            items={treeItems}
            onItemClick={(_event, itemId) => {
              const node = treeItems.flatMap((g) => g.children ?? []).find((c) => c.id === itemId);
              if (node?.def) onSelectTool(toolForDef(node.def), node.def.id);
            }}
            onItemExpansionToggle={(_event, itemId, isExpanded) => {
              if (queryLower) return;
              const name = itemId === '__in-use__' ? 'In use' : itemId.replace('__group__', '');
              setExpandedGroups(isExpanded ? [name] : []);
              if (isExpanded) {
                setTimeout(() => {
                  treeApiRef.current?.getItemDOMElement(itemId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }, 0);
              }
            }}
            selectedItems={currentDefId
              ? treeItems.flatMap((g) => g.children ?? []).find((c) => c.defId === currentDefId)?.id ?? null
              : null}
            slots={{ item: LibraryTreeItem }}
          />
        </LibraryTreeCtx.Provider>
      </Box>
    </Box>
  );
}

function LibraryCommandView({
  currentDefId,
  documentSettings,
  handle,
  onSelectTool,
  visibleCount,
  onVisibleCountChange,
}: {
  currentDefId?: string;
  documentSettings: CircuitikzDocumentSettings;
  handle: ImperativeAppHandle | null;
  onSelectTool: (tool: ToolType, defId?: string) => void;
  visibleCount: number;
  onVisibleCountChange: (count: number) => void;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = () => setOpen(false);
  const selectTool = (tool: ToolType, defId?: string) => {
    onSelectTool(tool, defId);
    close();
  };

  return (
    <>
      <Box ref={anchorRef} sx={{ alignItems: 'center', display: 'flex', height: 26, width: '100%' }}>
        <OutlinedInput
          aria-controls={open ? 'library-popover' : undefined}
          aria-expanded={open ? 'true' : undefined}
          aria-haspopup="dialog"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
          placeholder="Add symbol..."
          size="small"
          startAdornment={<SearchRoundedIcon color="action" fontSize="small" sx={{ mr: 1 }} />}
          endAdornment={(
            <Typography color="text.disabled" component="span" sx={{ fontFamily: MONOSPACE_FONT, fontSize: 11, ml: 1 }} variant="caption">
              {visibleCount}
            </Typography>
          )}
          sx={{
            '& .MuiOutlinedInput-input': {
              fontSize: 13,
              py: 0,
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'divider',
            },
            bgcolor: 'background.paper',
            borderRadius: 1,
            fontSize: 13,
            height: 26,
            width: '100%',
          }}
          value={query}
        />
      </Box>
      <Popover
        anchorEl={anchorRef.current}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        id="library-popover"
        keepMounted
        onClose={close}
        open={open}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        slotProps={{
          paper: {
            sx: {
              display: 'flex',
              height: 'min(720px, calc(100vh - 96px))',
              mt: 0.5,
              overflow: 'hidden',
              width: anchorRef.current?.offsetWidth ?? 420,
            },
          },
        }}
      >
        <LibraryView
          currentDefId={currentDefId}
          documentSettings={documentSettings}
          hideSearchField
          handle={handle}
          onQueryChange={setQuery}
          onSelectTool={selectTool}
          onVisibleCountChange={onVisibleCountChange}
          query={query}
        />
      </Popover>
    </>
  );
}


function PropertiesView(props: {
  documentSettings: CircuitikzDocumentSettings;
  documentVersion: number;
  environmentOptions: string;
  environmentType: EnvironmentType;
  gridPitch: number;
  majorGridEvery: number;
  handle: ImperativeAppHandle | null;
  mode: 'environment' | 'properties';
  preamble: string;
  preamblePackages: PreamblePackage[];
  selectedIds: string[];
  setEnvironmentOptions: (value: string) => void;
  setEnvironmentType: (value: EnvironmentType) => void;
  setGridPitch: (value: number) => void;
  setMajorGridEvery: (value: number) => void;
  setPreamblePackages: (value: PreamblePackage[] | ((prev: PreamblePackage[]) => PreamblePackage[])) => void;
  stopShortcutPropagation: (e: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  if (!props.handle) return <Box id="props" sx={{ flex: 1 }} />;
  return <PropertiesViewInner {...props} handle={props.handle} />;
}

function PropertiesViewInner({
  documentSettings,
  documentVersion,
  environmentOptions,
  environmentType,
  gridPitch,
  majorGridEvery,
  handle,
  mode,
  preamble,
  preamblePackages,
  selectedIds,
  setEnvironmentOptions,
  setEnvironmentType,
  setGridPitch,
  setMajorGridEvery,
  setPreamblePackages,
  stopShortcutPropagation,
}: {
  documentSettings: CircuitikzDocumentSettings;
  documentVersion: number;
  environmentOptions: string;
  environmentType: EnvironmentType;
  gridPitch: number;
  majorGridEvery: number;
  handle: ImperativeAppHandle;
  mode: 'environment' | 'properties';
  preamble: string;
  preamblePackages: PreamblePackage[];
  selectedIds: string[];
  setEnvironmentOptions: (value: string) => void;
  setEnvironmentType: (value: EnvironmentType) => void;
  setGridPitch: (value: number) => void;
  setMajorGridEvery: (value: number) => void;
  setPreamblePackages: (value: PreamblePackage[] | ((prev: PreamblePackage[]) => PreamblePackage[])) => void;
  stopShortcutPropagation: (e: ReactKeyboardEvent<HTMLElement>) => void;
}) {

  const selectionId = selectedIds[0];
  const selectionCount = selectedIds.length;
  const selectedLineIndices = useMemo(
    () => [...new Set(selectedIds.map((id) => lineIndexFromId(id)).filter((lineIndex) => lineIndex >= 0))],
    [selectedIds],
  );
  const statementSelectionId = useMemo(() => {
    if (selectionCount === 1 && selectionId) return selectionId;
    if (selectedLineIndices.length === 1) return `line:${selectedLineIndices[0]}`;
    return null;
  }, [selectionCount, selectionId, selectedLineIndices]);
  const drawing = handle.getSelectedDrawing();
  const wire = handle.getSelectedWire();
  const statementModel = useMemo(
    () => (statementSelectionId ? handle.getEditableStatementModel(statementSelectionId) : null),
    [handle, statementSelectionId, documentVersion],
  );
  const resolvedStatementPositions = useMemo(
    () => (statementSelectionId ? handle.getResolvedStatementPositions(statementSelectionId) : []),
    [documentVersion, handle, statementSelectionId],
  );
  const [draftDrawingProps, setDraftDrawingProps] = useState({
    options: drawing?.props.options ?? '',
  });
  const [majorGridEveryDraft, setMajorGridEveryDraft] = useState(String(majorGridEvery));
  const [positionPick, setPositionPick] = useState<PositionPick | null>(null);
  const [positionEditActive, setPositionEditActive] = useState(false);
  const positionPickIdRef = useRef(0);
  const environmentStatement = useMemo<EditableStatement>(() => {
    const orderedPackages = sortPreamblePackages(preamblePackages);
    return ({
      mode: 'environment',
      command: environmentType,
      commandOptionsText: environmentOptions || undefined,
      positionTexts: [],
      rawStatementText: `\\begin{${environmentType}}${environmentOptions ? `[${environmentOptions}]` : ''}`,
      segments: orderedPackages.map((pkg) => ({
        kind: 'package',
        name: pkg.name,
        optionsText: pkg.optionsText,
      })),
      sourceLineIndex: -1,
    });
  }, [environmentOptions, environmentType, preamblePackages]);

  useEffect(() => {
    setDraftDrawingProps({
      options: drawing?.props.options ?? '',
    });
  }, [drawing?.id, drawing?.props.options, documentVersion]);

  useEffect(() => {
    setMajorGridEveryDraft(String(majorGridEvery));
  }, [majorGridEvery]);

  useEffect(() => {
    if (statementModel) return;
    setPositionEditActive(false);
    setPositionPick(null);
    handle?.setPositionPickMode(false);
  }, [handle, statementModel]);

  useEffect(() => {
    if (!handle || !positionEditActive || !statementModel) return;
    const unsub = handle.onCanvasClick((gridPt) => {
      const next = buildPositionPickOptions(handle, gridPt, gridPitch);
      positionPickIdRef.current += 1;
      setPositionPick({
        id: positionPickIdRef.current,
        options: next.options,
        value: next.value,
      });
    });
    return unsub;
  }, [gridPitch, handle, positionEditActive, statementModel]);

  const updateDrawingProps = (props: Record<string, string | undefined>) => {
    if (!selectionId) return;
    handle.updateDrawingProps(selectionId, props);
    handle.commitDocumentChange();
  };

  const commitDrawingProp = (key: keyof typeof draftDrawingProps) => {
    if (!drawing) return;
    const nextValue = draftDrawingProps[key] || undefined;
    const currentValue = drawing.props[key] ?? undefined;
    if (nextValue === currentValue) return;
    updateDrawingProps({ [key]: nextValue });
  };
  return (
    <Stack data-version={documentVersion} id="props" spacing={1.5} sx={{ ...PROPERTIES_FIELD_SX, flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
      {mode === 'environment' ? (
        <>
          <StatementEditor
            model={environmentStatement}
            onCommit={(statement) => {
              const nextType = statement.command === 'circuitikz' ? 'circuitikz' : 'tikzpicture';
              setEnvironmentType(nextType);
              setEnvironmentOptions(statement.commandOptionsText ?? '');
              const nextPackages = statement.segments
                .filter((segment) => segment.kind === 'package')
                .map((segment) => ({
                  name: segment.name,
                  optionsText: segment.optionsText,
                }));
              setPreamblePackages(sortPreamblePackages(nextPackages));
            }}
            stopShortcutPropagation={stopShortcutPropagation}
          />
        </>
      ) : (
        <>
          {selectionCount === 0 ? (
            <Typography color="text.secondary" sx={{ px: 0.5, py: 2, textAlign: 'center' }} variant="body2">
              Select a line or element to edit properties.
            </Typography>
          ) : null}

          {selectionCount > 1 && !statementModel ? (
            <Typography color="text.secondary" sx={{ px: 0.5, py: 2, textAlign: 'center' }} variant="body2">
              {selectionCount} elements selected
            </Typography>
          ) : null}

          {statementModel ? (
            <StatementEditor
              model={statementModel}
              onCommit={(statement) => handle.applyEditableStatement(statement)}
              positionPick={positionPick}
              resolvedPositions={resolvedStatementPositions}
              onPositionEditChange={(active: boolean) => {
                setPositionEditActive(active);
                handle.setPositionPickMode(active);
              }}
              stopShortcutPropagation={stopShortcutPropagation}
            />
          ) : null}

          {selectionCount === 1 && selectionId && !statementModel ? (
            <Typography color="warning.main" sx={{ px: 0.5, py: 1 }} variant="caption">
              Statement editor not available for this selection yet.
            </Typography>
          ) : null}

          {selectionCount === 1 && wire && !statementModel ? (
            <Typography color="text.secondary" sx={{ px: 0.5, py: 2, textAlign: 'center' }} variant="body2">
              Wire. Edit geometry from the canvas or source in Document.
            </Typography>
          ) : null}

          {selectionCount === 1 && drawing && !statementModel ? (
            <>
              {drawing.kind === 'circle' ? (
                <TextField
                  disabled
                  fullWidth
                  label="Radius"
                  sx={PROPERTIES_FIELD_SX}
                  value={String(drawing.radius)}
                />
              ) : null}
              <TextField
                fullWidth
                label="Options"
                onBlur={() => commitDrawingProp('options')}
                onChange={(event) => setDraftDrawingProps((prev) => ({ ...prev, options: event.target.value }))}
                onKeyDown={stopShortcutPropagation}
                placeholder={drawing.kind === 'arrow' ? '->, thick' : 'thin'}
                sx={PROPERTIES_FIELD_SX}
                value={draftDrawingProps.options}
              />
              <Typography color="text.secondary" variant="caption">
                Edit geometry directly on the canvas by selecting and dragging.
              </Typography>
            </>
          ) : null}
        </>
      )}
    </Stack>
  );
}

function useAppState(handle: ImperativeAppHandle | null) {
  const [documentSettings, setDocumentSettings] = useState<CircuitikzDocumentSettings>(DEFAULT_DOCUMENT_SETTINGS);
  const [preamblePackages, setPreamblePackages] = useState<PreamblePackage[]>(() => parsePreamblePackages(DEFAULT_PREAMBLE));
  const [body, setBody] = useState('');
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>('tikzpicture');
  const [environmentOptions, setEnvironmentOptions] = useState('');
  const [currentTool, setCurrentTool] = useState<ToolType>('move');
  const [currentDefId, setCurrentDefId] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridPitch, setGridPitch] = useState(0.5);
  const [majorGridEvery, setMajorGridEvery] = useState(5);
  const [pinSnapEnabled, setPinSnapEnabled] = useState(true);
  const [wireRoutingMode, setWireRoutingMode] = useState<WireRoutingMode>('auto');
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    const raw = localStorage.getItem('tikad-history');
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  });
  const documentEditorRef = useRef<EditorView | null>(null);
  const texUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingLatexCommitRef = useRef(false);
  const historyCursorRef = useRef<number | null>(null);
  const historyRef = useRef(history);
  const suppressHistoryRef = useRef(false);
  // Tracks the latest body text typed in the editor without triggering
  // a render on every keystroke. Only committed when commitPendingLatexEdits fires.
  const latestEditorBodyRef = useRef(body);

  const preamble = useMemo(() => buildPreambleFromPackages(preamblePackages), [preamblePackages]);

  useEffect(() => {
    historyRef.current = history;
    if (historyCursorRef.current === null || historyCursorRef.current >= history.length) {
      historyCursorRef.current = history.length > 0 ? history.length - 1 : null;
    }
  }, [history]);

  useEffect(() => {
    if (!handle) return;
    const currentToolState = handle.getCurrentTool();
    setCurrentTool(currentToolState.tool);
    setCurrentDefId(currentToolState.defId);
    setSelectedIds(handle.getSelectedIds());
    const initialPreamble = handle.getPreamble();
    setPreamblePackages(parsePreamblePackages(initialPreamble));
    setDocumentSettings(parsePreambleSettings(initialPreamble));
    const savedSource = localStorage.getItem('tikad-document');
    if (savedSource) {
      handle.resetInitialFit();
      handle.loadFullLatexSource(savedSource);
    }
    const initialBody = handle.getBody();
    latestEditorBodyRef.current = initialBody;
    setBody(initialBody);
    const initialEnvironment = parseEnvironmentSettings(handle.getBody());
    setEnvironmentType(initialEnvironment.type);
    setEnvironmentOptions(initialEnvironment.options);
    setGridVisible(handle.getGridVisible());
    setGridPitch(handle.getGridPitch());
    setMajorGridEvery(handle.getMajorGridEvery());
    setPinSnapEnabled(handle.getPinSnapEnabled());
    setWireRoutingMode(handle.getWireRoutingMode());

    const unsubBody = handle.onBodyChange(() => {
      const nextBody = handle.getBody();
      latestEditorBodyRef.current = nextBody;
      setBody(nextBody);
      const nextEnvironment = parseEnvironmentSettings(nextBody);
      setEnvironmentType(nextEnvironment.type);
      setEnvironmentOptions(nextEnvironment.options);
      setDocumentVersion((version) => version + 1);
      if (!suppressHistoryRef.current) {
        const source = handle.getFullLatexSource();
        setHistory((prev) => {
          const cursor = historyCursorRef.current;
          const base = cursor !== null && cursor < prev.length - 1
            ? prev.slice(0, cursor + 1)
            : prev;
          if (base.length > 0 && base[base.length - 1].source === source) {
            historyCursorRef.current = base.length - 1;
            if (base !== prev) {
              localStorage.setItem('tikad-history', JSON.stringify(base));
              historyRef.current = base;
            }
            return base;
          }
          const entry: HistoryEntry = { ts: Date.now(), source };
          const next = [...base, entry];
          if (next.length > 30) next.shift();
          historyCursorRef.current = next.length - 1;
          historyRef.current = next;
          localStorage.setItem('tikad-history', JSON.stringify(next));
          return next;
        });
      }
    });
    const unsubGeometry = handle.onGeometryChange(() => {
      setDocumentVersion((version) => version + 1);
    });
    const unsubLatex = handle.onLatexEdited(() => {
      const source = handle.getFullLatexSource();
      localStorage.setItem('tikad-document', source);
    });
    const unsubTool = handle.onToolChange((tool, defId) => {
      setCurrentTool(tool);
      setCurrentDefId(defId);
    });
    const unsubSelection = handle.onSelectionChange((nextSelectedIds) => {
      setSelectedIds(nextSelectedIds);
    });
    const unsubUndo = handle.onHistoryUndoRequest(() => {
      navigateHistory(-1);
    });
    const unsubRedo = handle.onHistoryRedoRequest(() => {
      navigateHistory(1);
    });

    return () => {
      unsubBody();
      unsubGeometry();
      unsubLatex();
      unsubTool();
      unsubSelection();
      unsubUndo();
      unsubRedo();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  useEffect(() => {
    const nextSettings = parsePreambleSettings(preamble);
    setDocumentSettings((prev) => (JSON.stringify(prev) === JSON.stringify(nextSettings) ? prev : nextSettings));
  }, [preamble]);

  useEffect(() => {
    const options = collectCircuitikzOptions(documentSettings);
    const circuitikzOptions = options.length > 0 ? options.join(', ') : undefined;
    setPreamblePackages((prev) => {
      const next = [...prev];
      const circuitIndex = next.findIndex((pkg) => pkg.name === 'circuitikz');
      if (circuitIndex >= 0) {
        next[circuitIndex] = { ...next[circuitIndex], optionsText: circuitikzOptions };
      } else {
        next.push({ name: 'circuitikz', optionsText: circuitikzOptions });
      }
      const siunitxIndex = next.findIndex((pkg) => pkg.name === 'siunitx');
      if (documentSettings.unitStyle === 'siunitx') {
        if (siunitxIndex < 0) next.splice(Math.max(0, circuitIndex), 0, { name: 'siunitx' });
      } else if (siunitxIndex >= 0) {
        next.splice(siunitxIndex, 1);
      }
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [documentSettings]);

  useEffect(() => {
    pendingLatexCommitRef.current = false;
  }, [documentVersion]);

  useEffect(() => {
    if (!handle) return;
    const unsub = handle.onSelectionChange((nextSelectedIds, source) => {
      if (source === 'code') return;
      if (nextSelectedIds.length === 0) return;
      const lineIndex = lineIndexFromId(nextSelectedIds[0]);
      if (lineIndex < 0) return;
      const view = documentEditorRef.current;
      if (!view) return;
      if (view.hasFocus) return;
      const docLine = view.state.doc.line(Math.min(lineIndex + 1, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: docLine.from, head: docLine.from },
        scrollIntoView: true,
      });
    });
    return unsub;
  }, [body, handle]);

  useEffect(() => {
    if (!handle) return;
    handle.setPreamble(preamble);
  }, [handle, preamble]);

  const stopShortcutPropagation = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const [caretLineIndex, setCaretLineIndex] = useState<number | null>(null);

  const emitCaretSelection = (lineIndex: number) => {
    if (!handle) return;
    setCaretLineIndex(lineIndex);
    handle.selectSourceLine(lineIndex);
  };

  const commitPendingLatexEdits = () => {
    if (!handle || !pendingLatexCommitRef.current) return;
    pendingLatexCommitRef.current = false;
    // Push the latest typed content to latexDoc.body before committing so that
    // commitLatexEdits operates on the current editor state, not a stale value.
    handle.setBody(latestEditorBodyRef.current);
    handle.commitLatexEdits();
  };

  const onCopyCommands = async () => {
    if (!handle) return;
    await navigator.clipboard.writeText(handle.getBody());
  };

  const onCopyPreamble = async () => {
    await navigator.clipboard.writeText(preamble);
  };

  const onCopyEnvironment = async () => {
    if (!handle) return;
    const body = handle.getBody().trim();
    const source = `\\begin{circuitikz}\n\n${body}\n\n\\end{circuitikz}`;
    await navigator.clipboard.writeText(source);
  };

  const onCopyDocument = async () => {
    if (!handle) return;
    await navigator.clipboard.writeText(handle.getFullLatexSource());
  };

  const onDownloadSvg = async () => {
    if (!handle) return;
    const svg = handle.getRenderedSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = await buildDownloadFilename(svg, 'svg');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onDownloadTex = async () => {
    if (!handle) return;
    const tex = handle.getFullLatexSource();
    const blob = new Blob([tex], { type: 'text/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = await buildDownloadFilename(tex, 'tex');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onOpenTexUpload = () => {
    texUploadInputRef.current?.click();
  };

  const onUploadTex = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!handle) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const source = await file.text();
    handle.loadFullLatexSource(source);
    setSelectedIds(handle.getSelectedIds());
    setDocumentSettings(parsePreambleSettings(handle.getPreamble()));
    const nextBody = handle.getBody();
    setBody(nextBody);
    const nextEnvironment = parseEnvironmentSettings(nextBody);
    setEnvironmentType(nextEnvironment.type);
    setEnvironmentOptions(nextEnvironment.options);
    setDocumentVersion((version) => version + 1);
    event.target.value = '';
  };

  const onSelectTool = (tool: ToolType, defId?: string) => {
    setCurrentTool(tool);
    setCurrentDefId(defId);
    handle?.setTool(tool, defId);
  };

  const onToggleGridVisible = (checked: boolean) => {
    setGridVisible(checked);
    handle?.setGridVisible(checked);
  };

  const onTogglePinSnap = (checked: boolean) => {
    setPinSnapEnabled(checked);
    handle?.setPinSnapEnabled(checked);
  };

  const onGridPitchChange = (value: number) => {
    setGridPitch(value);
    handle?.setGridPitch(value);
  };

  const onEnvironmentTypeChange = (value: EnvironmentType) => {
    setEnvironmentType(value);
    const nextBody = applyEnvironmentSettingsToBody(latestEditorBodyRef.current, value, environmentOptions);
    latestEditorBodyRef.current = nextBody;
    setBody(nextBody);
    handle?.setBody(nextBody);
    handle?.commitLatexEdits();
  };

  const onEnvironmentOptionsChange = (value: string) => {
    setEnvironmentOptions(value);
    const nextBody = applyEnvironmentSettingsToBody(latestEditorBodyRef.current, environmentType, value);
    latestEditorBodyRef.current = nextBody;
    setBody(nextBody);
    handle?.setBody(nextBody);
    handle?.commitLatexEdits();
  };

  const onMajorGridEveryChange = (value: number) => {
    setMajorGridEvery(value);
    handle?.setMajorGridEvery(value);
  };

  const restoreHistoryEntry = (entry: HistoryEntry, index: number) => {
    if (!handle) return;
    historyCursorRef.current = index;
    suppressHistoryRef.current = true;
    handle.loadFullLatexSource(entry.source);
    suppressHistoryRef.current = false;
    localStorage.setItem('tikad-document', entry.source);
    setSelectedIds(handle.getSelectedIds());
    setDocumentSettings(parsePreambleSettings(handle.getPreamble()));
    const nextBody = handle.getBody();
    latestEditorBodyRef.current = nextBody;
    setBody(nextBody);
    const nextEnvironment = parseEnvironmentSettings(nextBody);
    setEnvironmentType(nextEnvironment.type);
    setEnvironmentOptions(nextEnvironment.options);
    setDocumentVersion((version) => version + 1);
  };

  const currentHistoryIndex = (entries: HistoryEntry[]) => {
    if (!handle || entries.length === 0) return -1;
    const source = handle.getFullLatexSource();
    const cursor = historyCursorRef.current;
    if (cursor !== null && entries[cursor]?.source === source) return cursor;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index].source === source) return index;
    }
    return entries.length - 1;
  };

  const navigateHistory = (direction: -1 | 1) => {
    const entries = historyRef.current;
    if (!handle || entries.length === 0) return;
    const currentIndex = currentHistoryIndex(entries);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= entries.length) return;
    restoreHistoryEntry(entries[nextIndex], nextIndex);
  };

  const onUndo = () => {
    navigateHistory(-1);
  };

  const onRedo = () => {
    navigateHistory(1);
  };

  const onNewDocument = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const onCutSelection = () => {
    handle?.cutSelection();
  };

  const onCopySelection = () => {
    handle?.copySelection();
  };

  const onPasteSelection = () => {
    handle?.pasteSelection();
  };

  const onDeleteSelection = () => {
    handle?.deleteSelection();
  };

  const onZoomIn = () => {
    handle?.zoomIn();
  };

  const onZoomOut = () => {
    handle?.zoomOut();
  };

  const onFitToScreen = () => {
    handle?.fitToScreen();
  };

  const onWireRoutingModeChange = (mode: WireRoutingMode) => {
    setWireRoutingMode(mode);
    handle?.setWireRoutingMode(mode);
  };

  const onClear = () => {
    handle?.clearDocument();
  };

  const onRestoreHistory = (source: string) => {
    const index = historyRef.current.findIndex((entry) => entry.source === source);
    restoreHistoryEntry({ source, ts: Date.now() }, index >= 0 ? index : Math.max(0, historyRef.current.length - 1));
  };

  const markLatexDirty = () => {
    pendingLatexCommitRef.current = true;
  };

  // Called by the code editor's onChange; keeps the ref in sync so that
  // commitPendingLatexEdits can write the latest content without rendering on
  // every keystroke.
  const setEditorBody = (value: string) => {
    latestEditorBodyRef.current = value;
    setBody(value);
  };

  const setHistoryPreviewActive = (active: boolean) => {
    suppressHistoryRef.current = active;
  };

  return {
    body,
    caretLineIndex,
    currentDefId,
    currentTool,
    documentEditorRef,
    documentVersion,
    commitPendingLatexEdits,
    documentSettings,
    environmentOptions,
    environmentType,
    emitCaretSelection,
    gridVisible,
    gridPitch,
    history,
    majorGridEvery,
    markLatexDirty,
    onClear,
    onRestoreHistory,
    setHistoryPreviewActive,
    onCopyCommands,
    onCopyPreamble,
    onCopyDocument,
    onCopyEnvironment,
    onDownloadTex,
    onDownloadSvg,
    onEnvironmentOptionsChange,
    onEnvironmentTypeChange,
    onFitToScreen,
    onNewDocument,
    onCutSelection,
    onCopySelection,
    onDeleteSelection,
    onGridPitchChange,
    onMajorGridEveryChange,
    onOpenTexUpload,
    onPasteSelection,
    onSelectTool,
    onToggleGridVisible,
    onTogglePinSnap,
    onUndo,
    onRedo,
    onWireRoutingModeChange,
    onZoomIn,
    onZoomOut,
    pinSnapEnabled,
    preamblePackages,
    preamble,
    selectedIds,
    setEditorBody,
    setDocumentSettings,
    setPreamblePackages,
    stopShortcutPropagation,
    texUploadInputRef,
    onUploadTex,
    wireRoutingMode,
  };
}

function PreambleView({
  onCopyPreamble,
  preamble,
}: {
  onCopyPreamble: () => void;
  preamble: string;
}) {
  const theme = useTheme();
  const codeMirrorTheme = useMemo(() => createCodeMirrorTheme(theme), [theme]);

  return (
    <CodePanelLayout
      actions={(
        <Button
          color="inherit"
          onClick={onCopyPreamble}
          size="small"
          startIcon={<ContentCopyRoundedIcon fontSize="small" />}
          sx={PANEL_ACTION_BUTTON_SX}
          variant="outlined"
        >
          Preamble
        </Button>
      )}
    >
      <Box
        sx={{
          backgroundColor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          '& > .cm-theme': { height: '100%', minWidth: 0 },
          '& .cm-editor': { backgroundColor: 'background.paper', color: 'text.primary', fontFamily: '"Roboto Mono", monospace', fontSize: 12, height: '100%', minWidth: 0 },
          '& .cm-focused': { outline: 'none' },
          '& .cm-scroller': { fontFamily: '"Roboto Mono", monospace', height: '100%', minWidth: 0, lineHeight: 1.5, overflowX: 'auto', overflowY: 'auto', width: '100%' },
          '& .cm-gutters': { backgroundColor: 'background.paper', borderRightColor: 'divider' },
          '& .cm-content': { minHeight: '100%', paddingBottom: '48px', whiteSpace: 'pre', width: 'max-content', minWidth: '100%' },
          '& .cm-line': { whiteSpace: 'pre' },
          '& .cm-activeLineGutter': { backgroundColor: 'action.hover' },
          '& .cm-activeLine': { backgroundColor: 'action.hover' },
        }}
      >
        <CodeMirror
          basicSetup={{ foldGutter: false, highlightActiveLine: true, highlightActiveLineGutter: true }}
          extensions={[lineNumbers(), latexLanguage, ...codeMirrorTheme]}
          height="100%"
          editable={false}
          style={{ height: '100%' }}
          value={preamble}
        />
      </Box>
    </CodePanelLayout>
  );
}

function formatHistoryTimestamp(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

function extractDocumentBody(source: string): string {
  const match = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(source);
  return match ? match[1].trim() : source.trim();
}

const HISTORY_DIFF_SX = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  '& > .cm-theme': { height: '100%', minWidth: 0 },
  '& .cm-editor': {
    backgroundColor: 'background.paper',
    color: 'text.primary',
    fontFamily: '"Roboto Mono", monospace',
    fontSize: 12,
    height: '100%',
    minWidth: 0,
  },
  '& .cm-focused': { outline: 'none' },
  '& .cm-scroller': {
    fontFamily: '"Roboto Mono", monospace',
    height: '100%',
    minWidth: 0,
    lineHeight: 1.5,
    overflowX: 'auto',
    overflowY: 'auto',
    width: '100%',
  },
  '& .cm-gutters': {
    backgroundColor: 'background.paper',
    borderRightColor: 'divider',
  },
  '& .cm-content': {
    minHeight: '100%',
    whiteSpace: 'pre',
    width: 'max-content',
    minWidth: '100%',
  },
  '& .cm-line': { whiteSpace: 'pre' },
  '& .cm-deletedChunk': { backgroundColor: 'rgba(255,80,80,0.15)' },
  '& .cm-changedLine': { backgroundColor: 'rgba(255,200,0,0.1)' },
  '& .cm-insertedLine': { backgroundColor: 'rgba(80,200,80,0.12)' },
} as const;

const PANEL_ACTION_BUTTON_SX = {
  alignSelf: 'center',
  borderColor: 'divider',
  color: 'text.primary',
  textTransform: 'none',
  '&:hover': {
    backgroundColor: 'action.hover',
    borderColor: 'divider',
  },
  '& .MuiButton-startIcon': {
    mr: 0.5,
  },
  '& .MuiSvgIcon-root': {
    fontSize: 18,
  },
} as const;

const HISTORY_PAGINATION_SX = {
  '& .MuiPagination-ul': {
    flexWrap: 'nowrap',
  },
  '& .MuiPaginationItem-root': {
    color: 'text.primary',
  },
  '& .MuiPaginationItem-root.Mui-selected': {
    backgroundColor: 'action.selected',
  },
  '& .MuiPaginationItem-root.Mui-selected:hover': {
    backgroundColor: 'action.hover',
  },
} as const;

function HistoryView({
  currentSource,
  handle,
  history,
  onRestore,
  setHistoryPreviewActive,
}: {
  currentSource: string;
  handle: ImperativeAppHandle | null;
  history: HistoryEntry[];
  onRestore: (source: string) => void;
  setHistoryPreviewActive: (active: boolean) => void;
}) {
  const theme = useTheme();
  const codeMirrorTheme = useMemo(() => createCodeMirrorTheme(theme), [theme]);
  const entries = useMemo(() => [...history].reverse(), [history]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Keep selectedIndex within bounds when history grows
  useEffect(() => {
    if (selectedIndex >= entries.length) {
      setSelectedIndex(Math.max(0, entries.length - 1));
    }
  }, [entries.length, selectedIndex]);

  // Preview selected version on canvas; restore current source on unmount
  useEffect(() => {
    if (!handle || entries.length === 0) return;
    const entry = entries[selectedIndex];
    if (!entry) return;
    const isPreviewing = selectedIndex > 0;
    setHistoryPreviewActive(true);
    handle.loadFullLatexSource(entry.source);
    setHistoryPreviewActive(false);
    if (isPreviewing) {
      handle.showInfoBanner(`Version: ${formatHistoryTimestamp(entry.ts)}`);
    } else {
      handle.showInfoBanner(null);
    }
  }, [handle, selectedIndex, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!handle) return;
    return () => {
      handle.showInfoBanner(null);
      setHistoryPreviewActive(true);
      handle.loadFullLatexSource(currentSource);
      setHistoryPreviewActive(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const selected = entries[selectedIndex];
  const prev = entries[selectedIndex + 1];
  const bodyA = prev ? extractDocumentBody(prev.source) : '';
  const bodyB = selected ? extractDocumentBody(selected.source) : '';

  const diffExtensions = useMemo(
    () => [
      lineNumbers(),
      latexLanguage,
      EditorState.readOnly.of(true),
      ...codeMirrorTheme,
      unifiedMergeView({ original: bodyA, mergeControls: false }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIndex, codeMirrorTheme],
  );

  if (entries.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'text.secondary' }}>
        <Typography variant="body2">No history yet. Edit the document to create entries.</Typography>
      </Box>
    );
  }

  return (
    <CodePanelLayout
      actions={(
        <>
        <Box sx={{ minWidth: 0, overflowX: 'auto' }}>
          <Pagination
            boundaryCount={1}
            count={entries.length}
            onChange={(_event, page) => setSelectedIndex(page - 1)}
            page={selectedIndex + 1}
            renderItem={(item) => {
              const entry = item.type === 'page' && item.page ? entries[item.page - 1] : null;
              const title = entry
                ? `${formatHistoryTimestamp(entry.ts)}${item.page === 1 ? ' (latest)' : ''}`
                : item.type === 'previous'
                  ? 'Previous'
                  : item.type === 'next'
                    ? 'Next'
                    : item.type;
              const paginationItem = (
              <PaginationItem
                {...item}
                slots={{ previous: ArrowBackRoundedIcon, next: ArrowForwardRoundedIcon }}
              />
            );
            if (item.type === 'start-ellipsis' || item.type === 'end-ellipsis') {
              return paginationItem;
            }
            return (
                <Tooltip key={`${item.type}-${item.page ?? 0}`} placement="top" title={title}>
                <span>
                  {paginationItem}
                </span>
              </Tooltip>
            );
          }}
          shape="rounded"
          siblingCount={1}
          size="small"
          sx={HISTORY_PAGINATION_SX}
          />
        </Box>
        <Button
          color="inherit"
          onClick={() => selected && onRestore(selected.source)}
          size="small"
          startIcon={<RestoreRoundedIcon fontSize="small" />}
          sx={{ ...PANEL_ACTION_BUTTON_SX, flexShrink: 0 }}
          variant="outlined"
        >
          Restore
        </Button>
        </>
      )}
    >
      <Box sx={HISTORY_DIFF_SX}>
        <CodeMirror
          extensions={diffExtensions}
          height="100%"
          style={{ height: '100%' }}
          value={bodyB}
        />
      </Box>
    </CodePanelLayout>
  );
}

function EnvironmentTabs({
  appState,
  collapsed,
  handle,
  onToggleCollapsed,
}: {
  appState: ReturnType<typeof useAppState>;
  collapsed: boolean;
  handle: ImperativeAppHandle | null;
  onToggleCollapsed: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'document' | 'preamble' | 'history'>('document');
  const currentFullSource = handle?.getFullLatexSource() ?? appState.body;
  const tabHeader = (
    <Box
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      sx={{ flex: 1, minWidth: 0 }}
    >
      <Tabs
        onChange={(_event, value) => setActiveTab(value)}
        value={activeTab}
        variant="standard"
        sx={{
          minHeight: 36,
          '& .MuiTabs-flexContainer': {
            justifyContent: 'flex-start',
          },
        }}
      >
        <Tab
          label="Preamble"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            minHeight: 36,
            textTransform: 'uppercase',
          }}
          value="preamble"
        />
        <Tab
          label="Document"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            minHeight: 36,
            textTransform: 'uppercase',
          }}
          value="document"
        />
        <Tab
          label="History"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            minHeight: 36,
            textTransform: 'uppercase',
          }}
          value="history"
        />
      </Tabs>
    </Box>
  );

  return (
    <PanelSection
      expanded={!collapsed}
      grow
      onChange={onToggleCollapsed}
      title={tabHeader}
    >
      {activeTab === 'document' ? (
        <CodePanelLayout
          actions={(
            <>
              <Button
                color="inherit"
                onClick={appState.onCopyCommands}
                size="small"
                startIcon={<ContentCopyRoundedIcon fontSize="small" />}
                sx={PANEL_ACTION_BUTTON_SX}
                variant="outlined"
              >
                Code
              </Button>
              <Button
                color="inherit"
                onClick={appState.onDownloadSvg}
                size="small"
                startIcon={<DownloadRoundedIcon fontSize="small" />}
                sx={{ ...PANEL_ACTION_BUTTON_SX, ml: 1 }}
                variant="outlined"
              >
                SVG
              </Button>
            </>
          )}
        >
          <DocumentEditor
            body={appState.body}
            commitPendingLatexEdits={appState.commitPendingLatexEdits}
            documentEditorRef={appState.documentEditorRef}
            emitCaretSelection={appState.emitCaretSelection}
            markLatexDirty={appState.markLatexDirty}
            setBody={appState.setEditorBody}
            sx={{ p: 0 }}
          />
        </CodePanelLayout>
      ) : activeTab === 'history' ? (
        <HistoryView currentSource={currentFullSource} handle={handle} history={appState.history} onRestore={appState.onRestoreHistory} setHistoryPreviewActive={appState.setHistoryPreviewActive} />
      ) : (
        <PreambleView onCopyPreamble={appState.onCopyPreamble} preamble={appState.preamble} />
      )}
    </PanelSection>
  );
}

function PropertiesTabs({
  appState,
  collapsed,
  handle,
  onToggleCollapsed,
}: {
  appState: ReturnType<typeof useAppState>;
  collapsed: boolean;
  handle: ImperativeAppHandle | null;
  onToggleCollapsed: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'environment' | 'properties'>('properties');
  const tabHeader = (
    <Box
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      sx={{ flex: 1, minWidth: 0 }}
    >
      <Tabs
        onChange={(_event, value) => setActiveTab(value)}
        value={activeTab}
        variant="standard"
        sx={{
          minHeight: 36,
          '& .MuiTabs-flexContainer': {
            justifyContent: 'flex-start',
          },
        }}
      >
        <Tab
          label="Environment"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            minHeight: 36,
            textTransform: 'uppercase',
          }}
          value="environment"
        />
        <Tab
          label="Properties"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            minHeight: 36,
            textTransform: 'uppercase',
          }}
          value="properties"
        />
      </Tabs>
    </Box>
  );

  return (
    <PanelSection
      expanded={!collapsed}
      grow
      onChange={onToggleCollapsed}
      title={tabHeader}
    >
      <PropertiesView
        documentSettings={appState.documentSettings}
        documentVersion={appState.documentVersion}
        environmentOptions={appState.environmentOptions}
        environmentType={appState.environmentType}
        gridPitch={appState.gridPitch}
        majorGridEvery={appState.majorGridEvery}
        handle={handle}
        mode={activeTab}
        preamble={appState.preamble}
        preamblePackages={appState.preamblePackages}
        selectedIds={appState.selectedIds}
        setEnvironmentOptions={appState.onEnvironmentOptionsChange}
        setEnvironmentType={appState.onEnvironmentTypeChange}
        setGridPitch={appState.onGridPitchChange}
        setMajorGridEvery={appState.onMajorGridEveryChange}
        setPreamblePackages={appState.setPreamblePackages}
        stopShortcutPropagation={appState.stopShortcutPropagation}
      />
    </PanelSection>
  );
}


function CanvasViewport({
  onReady,
}: {
  onReady: (handle: ImperativeAppHandle) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void initImperativeApp(container).then((handle) => onReadyRef.current(handle));
  }, []);

  return <div className="canvas-container" id="canvas-container" ref={containerRef} />;
}

function StatusBarView({
  currentTool,
  gridVisible,
  gridPitch,
  handle,
  pinSnapEnabled,
}: {
  currentTool: ToolType;
  gridVisible: boolean;
  gridPitch: number;
  handle: ImperativeAppHandle | null;
  pinSnapEnabled: boolean;
}) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    if (!handle) return;
    const unsubMove = handle.onCursorGridChange((gridPt, nextZoomPercent) => {
      setCoords({ x: gridPt.x, y: -gridPt.y });
      setZoomPercent(nextZoomPercent);
    });
    const unsubLeave = handle.onCanvasMouseLeave(() => setCoords(null));
    return () => { unsubMove(); unsubLeave(); };
  }, [handle]);

  const toolLabel = currentTool === 'select'
    ? 'Select'
    : currentTool === 'move'
      ? 'Move'
    : currentTool === 'wire'
      ? 'Wire'
      : currentTool === 'delete'
        ? 'Delete'
        : 'Place component';
  const coordText = coords
    ? `(${formatStatusCoord(coords.x, gridPitch)},${formatStatusCoord(coords.y, gridPitch)})`
    : '(x,y)';

  return (
    <Paper
      elevation={0}
      square
      sx={{
        alignItems: 'center',
        borderTop: 1,
        borderColor: 'divider',
        boxSizing: 'border-box',
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 2,
        gridArea: 'status',
        minHeight: 28,
        maxWidth: '100%',
        minWidth: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        px: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      <Typography noWrap sx={{ flex: '0 0 auto' }} variant="caption">{`Grid: ${formatGridCoord(gridPitch, gridPitch)} ${gridVisible ? '' : '(hidden)'}`}</Typography>
      <Typography noWrap sx={{ flex: '0 0 auto' }} variant="caption">{`Pin snap: ${pinSnapEnabled ? 'On' : 'Off'}`}</Typography>
      <Typography noWrap sx={{ flex: '0 0 auto' }} variant="caption">{`Zoom: ${zoomPercent}%`}</Typography>
      <Typography noWrap sx={{ flex: '0 0 auto' }} variant="caption">{toolLabel}</Typography>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }} />
      <Typography color={coords ? 'text.primary' : 'text.secondary'} noWrap sx={{ flex: '0 0 auto', fontFamily: 'monospace' }} variant="caption">
        {coordText}
      </Typography>
    </Paper>
  );
}

function AppShell({
  collapsed,
  handle,
  onThemeModeChange,
  onToggleSidebar,
  themeMode,
  setCollapsed,
}: {
  collapsed: {
    document: boolean;
    props: boolean;
    sidebar: boolean;
  };
  handle: ImperativeAppHandle | null;
  onThemeModeChange: (mode: 'light' | 'dark') => void;
  onToggleSidebar: () => void;
  themeMode: 'light' | 'dark';
  setCollapsed: Dispatch<SetStateAction<{
    document: boolean;
    props: boolean;
    sidebar: boolean;
  }>>;
}) {
  const appState = useAppState(handle);
  const [libraryVisibleCount, setLibraryVisibleCount] = useState(DEFAULT_LIBRARY_VISIBLE_COUNT);

  const beginLineIndex = useMemo(() => {
    const lines = appState.body.split('\n');
    return lines.findIndex((line) => /^\s*\\begin\{(?:tikzpicture|circuitikz)\}/.test(line));
  }, [appState.body]);

  useEffect(() => {
    if (appState.caretLineIndex !== null && appState.caretLineIndex === beginLineIndex) {
      setCollapsed((prev) => prev.props ? { ...prev, props: false } : prev);
    }
  }, [appState.caretLineIndex, beginLineIndex, setCollapsed]);

  const propsFlex = collapsed.props ? '0 0 auto' : '1 1 0';
  const currentDefTikzName = appState.currentDefId ? handle?.registry.get(appState.currentDefId)?.tikzName : undefined;
  const selectSymbolShortcut = (tikzName: SymbolShortcutTikzName) => {
    const def = handle?.registry.getAll().find((candidate) => candidate.tikzName === tikzName);
    if (!def) return;
    appState.onSelectTool(toolForDef(def), def.id);
  };

  return (
    <>
      <ToolbarView
        currentTool={appState.currentTool}
        librarySlot={(
          <LibraryCommandView
            currentDefId={appState.currentDefId}
            documentSettings={appState.documentSettings}
            handle={handle}
            onSelectTool={appState.onSelectTool}
            onVisibleCountChange={setLibraryVisibleCount}
            visibleCount={libraryVisibleCount}
          />
        )}
        onClear={appState.onClear}
        onCopySelection={appState.onCopySelection}
        onCutSelection={appState.onCutSelection}
        onDeleteSelection={appState.onDeleteSelection}
        onDownloadTex={appState.onDownloadTex}
        onFitToScreen={appState.onFitToScreen}
        onNewDocument={appState.onNewDocument}
        onOpenTexUpload={appState.onOpenTexUpload}
        onPasteSelection={appState.onPasteSelection}
        onRedo={appState.onRedo}
        onSelectTool={appState.onSelectTool}
        onToggleSidebar={onToggleSidebar}
        onThemeModeChange={onThemeModeChange}
        onUndo={appState.onUndo}
        onZoomIn={appState.onZoomIn}
        onZoomOut={appState.onZoomOut}
        selectedIds={appState.selectedIds}
        sidebarVisible={!collapsed.sidebar}
        themeMode={themeMode}
      />

      <ToolRailView
        currentDefTikzName={currentDefTikzName}
        currentTool={appState.currentTool}
        gridPitch={appState.gridPitch}
        gridVisible={appState.gridVisible}
        onGridPitchChange={appState.onGridPitchChange}
        onSelectTool={appState.onSelectTool}
        onSelectSymbolShortcut={selectSymbolShortcut}
        onToggleGridVisible={appState.onToggleGridVisible}
        onTogglePinSnap={appState.onTogglePinSnap}
        onWireRoutingModeChange={appState.onWireRoutingModeChange}
        pinSnapEnabled={appState.pinSnapEnabled}
        wireRoutingMode={appState.wireRoutingMode}
      />

      {!collapsed.sidebar ? (
        <Box
          className="left-panel"
          id="left-panel"
          sx={{
            backgroundColor: 'background.default',
            borderLeft: 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            height: '100%',
            minWidth: 480,
            minHeight: 0,
            overflow: 'hidden',
            p: 1,
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flex: propsFlex,
              minHeight: 0,
              minWidth: 0,
              width: '100%',
            }}
          >
            <PropertiesTabs
              appState={appState}
              collapsed={collapsed.props}
              handle={handle}
              onToggleCollapsed={() => setCollapsed((prev) => ({ ...prev, props: !prev.props }))}
            />
          </Box>

          <Box
            sx={{
              display: 'flex',
              flex: collapsed.document ? '0 0 auto' : '1 1 0',
              minHeight: 0,
              minWidth: 0,
              width: '100%',
            }}
          >
            <EnvironmentTabs
              appState={appState}
              collapsed={collapsed.document}
              handle={handle}
              onToggleCollapsed={() => setCollapsed((prev) => ({ ...prev, document: !prev.document }))}
            />
          </Box>
        </Box>
      ) : null}

      <StatusBarView
        currentTool={appState.currentTool}
        gridVisible={appState.gridVisible}
        gridPitch={appState.gridPitch}
        handle={handle}
        pinSnapEnabled={appState.pinSnapEnabled}
      />
      <input
        accept=".tex,text/x-tex,text/plain"
        hidden
        onChange={appState.onUploadTex}
        ref={appState.texUploadInputRef}
        type="file"
      />
    </>
  );
}

export function App() {
  const [handle, setHandle] = useState<ImperativeAppHandle | null>(null);
  const hasStoredThemeModeRef = useRef(readStoredThemeMode() !== null);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    return readStoredThemeMode() ?? readSystemThemeMode();
  });
  const setThemeMode = useCallback((mode: ThemeMode) => {
    hasStoredThemeModeRef.current = true;
    setThemeModeState(mode);
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = window.localStorage.getItem('sidebar-width');
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_SIDEBAR_WIDTH;
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  });
  const [collapsed, setCollapsed] = useState({
    document: false,
    props: false,
    sidebar: shouldCollapseSidebarForViewport(),
  });
  const sidebarUserOverrideRef = useRef(false);
  const resizeStateRef = useRef<
    | { axis: 'x'; direction: -1 | 1; startPointer: number; startSize: number; kind: 'sidebar' }
    | null
  >(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', collapsed.sidebar ? '0px' : `${sidebarWidth}px`);
    document.documentElement.style.setProperty('--sidebar-resizer-width', collapsed.sidebar ? '0px' : '10px');
    window.localStorage.setItem('sidebar-width', String(sidebarWidth));
  }, [collapsed.sidebar, sidebarWidth]);

  useEffect(() => {
    const syncResponsiveSidebar = () => {
      if (sidebarUserOverrideRef.current) return;
      setCollapsed((prev) => {
        const sidebar = shouldCollapseSidebarForViewport();
        return prev.sidebar === sidebar ? prev : { ...prev, sidebar };
      });
    };
    syncResponsiveSidebar();
    window.addEventListener('resize', syncResponsiveSidebar);
    return () => window.removeEventListener('resize', syncResponsiveSidebar);
  }, []);

  const toggleSidebar = useCallback(() => {
    sidebarUserOverrideRef.current = true;
    setCollapsed((prev) => ({ ...prev, sidebar: !prev.sidebar }));
  }, []);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', themeMode === 'dark');
    if (hasStoredThemeModeRef.current) {
      window.localStorage.setItem('theme-mode', themeMode);
    }
    return () => {
      document.body.classList.remove('theme-dark');
    };
  }, [themeMode]);

  const theme = useMemo(() => createTheme({
    palette: { mode: themeMode },
    components: {
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiFormControl: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiSelect: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiOutlinedInput: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiTooltip: {
        defaultProps: {
          arrow: true,
        },
        styleOverrides: {
          tooltip: {
            fontSize: 12,
          },
        },
      },
    },
  }), [themeMode]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const pointer = resizeState.axis === 'x' ? event.clientX : event.clientY;
      const nextSize = resizeState.startSize + (pointer - resizeState.startPointer) * resizeState.direction;
      if (resizeState.kind === 'sidebar') {
        const nextWidth = nextSize;
        setSidebarWidth(clampSidebarWidth(nextWidth));
      }
    };

    const onResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current));
    };

    const onMouseUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.classList.remove('is-resizing-layout');
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      axis: 'x',
      direction: -1,
      kind: 'sidebar',
      startPointer: event.clientX,
      startSize: sidebarWidth,
    };
    document.body.classList.add('is-resizing-layout');
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <>
        <AppShell
          collapsed={collapsed}
          handle={handle}
          onThemeModeChange={setThemeMode}
          onToggleSidebar={toggleSidebar}
          setCollapsed={setCollapsed}
          themeMode={themeMode}
        />
        {!collapsed.sidebar ? (
          <Divider
            aria-label="Resize side panel"
            flexItem
            onMouseDown={startSidebarResize}
            orientation="vertical"
            role="separator"
            sx={{
              gridArea: 'resizer',
              ...resizerSx('vertical'),
            }}
          />
        ) : null}
        <CanvasViewport onReady={setHandle} />
      </>
    </ThemeProvider>
  );
}
