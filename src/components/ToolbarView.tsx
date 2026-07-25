import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddOutlined';
import AdsClickRoundedIcon from '@mui/icons-material/AdsClickOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import ThreeSixtyRoundedIcon from '@mui/icons-material/ThreeSixtyRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyOutlined';
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutOutlined';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DownloadRoundedIcon from '@mui/icons-material/DownloadOutlined';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenOutlined';
import Grid4x4RoundedIcon from '@mui/icons-material/Grid4x4Outlined';
import LightModeRoundedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeOutlined';
import NavigationRoundedIcon from '@mui/icons-material/NearMeOutlined';
import OpenWithRoundedIcon from '@mui/icons-material/OpenWithOutlined';
import WebAssetOutlinedIcon from '@mui/icons-material/WebAssetOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import TurnSharpRightRoundedIcon from '@mui/icons-material/TurnSharpRightRounded';
import UTurnLeftRoundedIcon from '@mui/icons-material/UTurnLeftRounded';
import EastRoundedIcon from '@mui/icons-material/EastOutlined';
import SubdirectoryArrowLeftRoundedIcon from '@mui/icons-material/SubdirectoryArrowLeftOutlined';
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightOutlined';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsOutlined';
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareOutlined';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileOutlined';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInOutlined';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutOutlined';
import type { ToolType, WireRoutingMode } from '../types';
import capacitorIconSvg from './icons/toolbar/capacitor.svg?raw';
import circIconSvg from './icons/toolbar/circ.svg?raw';
import ocircIconSvg from './icons/toolbar/ocirc.svg?raw';
import openIconSvg from './icons/toolbar/open.svg?raw';
import resistorIconSvg from './icons/toolbar/resistor.svg?raw';
import shortIconSvg from './icons/toolbar/short.svg?raw';

const TOOLBAR_HEIGHT = 34;

const BUG_REPORT_ENABLED = true;

const TOOL_LABELS: Array<{ activeWhen: ToolType; icon: ReactNode; id: ToolType; label: string }> = [
  { id: 'select', activeWhen: 'select', label: 'Select', icon: <NavigationRoundedIcon fontSize="small" sx={{ transform: 'rotate(-90deg)' }} /> },
  { id: 'delete', activeWhen: 'delete', label: 'Delete', icon: <DeleteOutlineRoundedIcon fontSize="small" /> },
];

const SPLIT_PATH_TOOL: { activeWhen: ToolType; icon: ReactNode; id: ToolType; label: string } = {
  id: 'split-path',
  activeWhen: 'split-path',
  label: 'Split path',
  icon: <CallSplitRoundedIcon fontSize="small" />,
};

const DRAW_TOOLS: Array<{ icon: ReactNode; label: string; tool: ToolType }> = [
  { tool: 'draw-text', label: 'Text', icon: <TextFieldsRoundedIcon fontSize="small" /> },
  { tool: 'draw-rectangle', label: 'Rectangle', icon: <CropSquareRoundedIcon fontSize="small" /> },
  { tool: 'draw-circle', label: 'Circle', icon: <CircleOutlinedIcon fontSize="small" /> },
];

const WIRE_ROUTING_OPTIONS: Array<{ icon: ReactNode; label: string; value: WireRoutingMode }> = [
  { value: 'auto', label: 'Draw line (auto)', icon: <TurnSharpRightRoundedIcon fontSize="small" sx={{ transform: 'rotate(90deg)' }} /> },
  { value: '--', label: 'Draw line (straight)', icon: <EastRoundedIcon fontSize="small" /> },
  {
    value: '-|',
    label: 'Draw line (horizontal then vertical)',
    icon: <SubdirectoryArrowLeftRoundedIcon fontSize="small" sx={{ transform: 'rotate(-90deg)' }} />,
  },
  { value: '|-', label: 'Draw line (vertical then horizontal)', icon: <SubdirectoryArrowRightRoundedIcon fontSize="small" /> },
];

export type SymbolShortcutTikzName = 'circ' | 'ocirc' | 'open' | 'short' | 'R' | 'C';

const SYMBOL_SHORTCUTS: Array<{ icon: ReactNode; label: string; tikzName: SymbolShortcutTikzName }> = [
  { tikzName: 'short', label: 'Add short circuit', icon: <RailSvgIcon svg={shortIconSvg} /> },
  { tikzName: 'open', label: 'Add open circuit', icon: <RailSvgIcon svg={openIconSvg} /> },
  { tikzName: 'circ', label: 'Add filled connection dot', icon: <RailSvgIcon svg={circIconSvg} /> },
  { tikzName: 'ocirc', label: 'Add open connection dot', icon: <RailSvgIcon svg={ocircIconSvg} /> },
];

const COMMON_COMPONENT_SHORTCUTS: Array<{ icon: ReactNode; label: string; tikzName: SymbolShortcutTikzName }> = [
  { tikzName: 'R', label: 'Add resistor', icon: <RailSvgIcon svg={resistorIconSvg} /> },
  { tikzName: 'C', label: 'Add capacitor', icon: <RailSvgIcon svg={capacitorIconSvg} /> },
];

function RailSvgIcon({ svg }: { svg: string }) {
  return (
    <Box
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
      sx={(theme) => ({
        '--rail-icon-ink': theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.common.black,
        alignItems: 'center',
        display: 'flex',
        height: 28,
        justifyContent: 'center',
        opacity: theme.palette.mode === 'dark' ? 0.7 : 0.62,
        width: 28,
        '& svg': {
          display: 'block',
          height: 28,
          overflow: 'visible',
          transform: 'scale(1.08)',
          transformOrigin: 'center',
          width: 28,
        },
        '.Mui-selected &': {
          opacity: 1,
        },
      })}
    />
  );
}

function isEditTool(tool: ToolType): tool is 'select' | 'delete' | 'split-path' {
  return tool === 'select' || tool === 'delete' || tool === 'split-path';
}

function MenuShortcut({ children }: { children: ReactNode }) {
  return (
    <Typography color="text.secondary" sx={{ fontSize: 13, ml: 4 }} variant="body2">
      {children}
    </Typography>
  );
}

function MenuIcon({ children }: { children: ReactNode }) {
  return <ListItemIcon>{children}</ListItemIcon>;
}

export function ToolbarView({
  currentTool,
  librarySlot,
  onClear,
  onCopySelection,
  onCutSelection,
  onDeleteSelection,
  onDownloadSvg,
  onDownloadSvgPlus,
  onDownloadTex,
  onFitToScreen,
  onNewDocument,
  onOpenBugReport,
  onOpenRecentDocument,
  onOpenTexUpload,
  onPasteSelection,
  onRedo,
  onSelectTool,
  onToggleSidebar,
  onThemeModeChange,
  onUndo,
  onZoomIn,
  onZoomOut,
  recentDocuments,
  selectedIds,
  sidebarVisible,
  themeMode,
}: {
  currentTool: ToolType;
  librarySlot?: ReactNode;
  onClear: () => void;
  onCopySelection: () => void;
  onCutSelection: () => void;
  onDeleteSelection: () => void;
  onDownloadSvg: () => void;
  onDownloadSvgPlus: () => void;
  onDownloadTex: () => void;
  onFitToScreen: () => void;
  onNewDocument: () => void;
  onOpenBugReport: () => void;
  onOpenRecentDocument: (id: string) => void;
  onOpenTexUpload: () => void;
  onPasteSelection: () => void;
  onRedo: () => void;
  onSelectTool: (tool: ToolType) => void;
  onToggleSidebar: () => void;
  onThemeModeChange: (mode: 'light' | 'dark') => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  recentDocuments: { id: string; label: string }[];
  selectedIds: string[];
  sidebarVisible: boolean;
  themeMode: 'light' | 'dark';
}) {
  const [menuAnchor, setMenuAnchor] = useState<{ id: 'file' | 'edit' | 'view'; el: HTMLElement } | null>(null);
  const [recentMenuAnchor, setRecentMenuAnchor] = useState<HTMLElement | null>(null);
  const hasSelection = selectedIds.length > 0;
  const denseMenuProps = {
    dense: true,
    sx: {
      py: 0.25,
      '& .MuiMenuItem-root': {
        fontSize: 13,
        minHeight: 30,
        py: 0.25,
      },
      '& .MuiListItemText-primary': {
        fontSize: 13,
      },
      '& .MuiListItemIcon-root': {
        minWidth: 32,
      },
      '& .MuiListSubheader-root': {
        fontSize: 12,
        lineHeight: '28px',
      },
      '& .MuiSvgIcon-root': {
        fontSize: 18,
      },
    },
  } as const;
  const menuButtonSx = {
    alignSelf: 'stretch',
    borderRadius: 0,
    color: 'text.primary',
    fontSize: 13,
    minWidth: 0,
    px: 1,
    py: 0,
    textTransform: 'none',
  } as const;
  const openMenu = (id: 'file' | 'edit' | 'view') => (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor({ id, el: event.currentTarget });
  };
  const closeMenu = () => setMenuAnchor(null);
  const run = (fn: () => void) => {
    fn();
    closeMenu();
  };

  return (
    <AppBar
      color="default"
      elevation={0}
      position="static"
      sx={{ borderBottom: 1, borderColor: 'divider', gridArea: 'toolbar' }}
    >
      <Toolbar variant="dense" sx={{ alignItems: 'stretch', gap: 0.5, minHeight: `${TOOLBAR_HEIGHT}px !important`, position: 'relative', px: 0.75 }}>
        {librarySlot ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 0.5,
              left: '50%',
              maxWidth: '38vw',
              minWidth: 280,
              position: 'absolute',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 420,
              zIndex: 1,
            }}
          >
            <Tooltip title="Undo">
              <Button
                aria-label="Undo"
                onClick={onUndo}
                size="small"
                sx={{ color: 'text.primary', height: 26, minWidth: 28, p: 0 }}
                variant="text"
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </Button>
            </Tooltip>
            <Tooltip title="Redo">
              <Button
                aria-label="Redo"
                onClick={onRedo}
                size="small"
                sx={{ color: 'text.primary', height: 26, minWidth: 28, p: 0 }}
                variant="text"
              >
                <ArrowForwardRoundedIcon fontSize="small" />
              </Button>
            </Tooltip>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {librarySlot}
            </Box>
          </Box>
        ) : null}
        <Box sx={{ alignItems: 'center', alignSelf: 'stretch', display: 'flex', mr: 0.5 }}>
          <Box alt="logo" component="img" src="/favicon.svg" sx={{ display: 'block', height: 18, width: 'auto' }} />
          <Box
            alt="wordmark"
            component="img"
            src="/tikad-wordmark.svg"
            sx={(theme) => ({
              display: 'block',
              filter: theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
              height: 26,
              width: 'auto',
            })}
          />
        </Box>
        <Divider flexItem orientation="vertical" />
        {(['file', 'edit', 'view'] as const).map((id) => (
          <Button
            aria-controls={menuAnchor?.id === id ? `${id}-menu` : undefined}
            aria-expanded={menuAnchor?.id === id ? 'true' : undefined}
            aria-haspopup="menu"
            key={id}
            onClick={openMenu(id)}
            size="small"
            sx={menuButtonSx}
          >
            {id[0].toUpperCase() + id.slice(1)}
          </Button>
        ))}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {BUG_REPORT_ENABLED ? (
          <Box sx={{ alignItems: 'center', alignSelf: 'stretch', display: 'flex' }}>
            <Button
              onClick={onOpenBugReport}
              size="small"
              startIcon={<BugReportOutlinedIcon fontSize="small" />}
              sx={{
                bgcolor: 'transparent',
                color: 'text.primary',
                height: 26,
                px: 1,
                textTransform: 'none',
                '& .MuiButton-startIcon': {
                  mr: 0.5,
                },
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
              variant="text"
            >
              Hit a bug?
            </Button>
          </Box>
        ) : null}
        <Box sx={{ alignItems: 'center', alignSelf: 'stretch', display: 'flex' }}>
          <Tooltip title={sidebarVisible ? 'Hide side panel' : 'Show side panel'}>
          <Button
            aria-label={sidebarVisible ? 'Hide side panel' : 'Show side panel'}
            aria-pressed={sidebarVisible}
            onClick={onToggleSidebar}
            size="small"
            sx={{
              bgcolor: sidebarVisible ? 'action.selected' : 'transparent',
              color: 'text.primary',
              height: 26,
              minWidth: 28,
              p: 0,
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
            variant="text"
          >
              <WebAssetOutlinedIcon fontSize="small" sx={{ transform: 'rotate(90deg)' }} />
            </Button>
          </Tooltip>
        </Box>
        <Menu
          anchorEl={menuAnchor?.id === 'file' ? menuAnchor.el : null}
          disablePortal
          id="file-menu"
          MenuListProps={denseMenuProps}
          onClose={closeMenu}
          open={menuAnchor?.id === 'file'}
        >
          <MenuItem onClick={() => run(onNewDocument)}>
            <MenuIcon><AddRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>New</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onOpenTexUpload)}>
            <MenuIcon><UploadFileRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Open...</ListItemText>
          </MenuItem>
          <MenuItem
            disabled={recentDocuments.length === 0}
            onClick={(event) => setRecentMenuAnchor(event.currentTarget)}
          >
            <MenuIcon><WebAssetOutlinedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Recent</ListItemText>
            <MenuShortcut>{recentDocuments.length > 0 ? '›' : ''}</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run(onDownloadTex)}>
            <MenuIcon><DownloadRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Save TeX</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onDownloadSvgPlus)}>
            <MenuIcon><DownloadRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Save SVG+</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onDownloadSvg)}>
            <MenuIcon><DownloadRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Export clean SVG</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={recentMenuAnchor}
          disablePortal
          id="recent-menu"
          MenuListProps={denseMenuProps}
          onClose={() => setRecentMenuAnchor(null)}
          open={Boolean(recentMenuAnchor)}
        >
          {recentDocuments.length === 0 ? (
            <MenuItem disabled>
              <ListItemText>No recent documents</ListItemText>
            </MenuItem>
          ) : recentDocuments.map((doc) => (
            <MenuItem
              key={doc.id}
              onClick={() => {
                onOpenRecentDocument(doc.id);
                setRecentMenuAnchor(null);
                closeMenu();
              }}
            >
              <ListItemText>{doc.label}</ListItemText>
            </MenuItem>
          ))}
        </Menu>

        <Menu
          anchorEl={menuAnchor?.id === 'edit' ? menuAnchor.el : null}
          disablePortal
          id="edit-menu"
          MenuListProps={denseMenuProps}
          onClose={closeMenu}
          open={menuAnchor?.id === 'edit'}
        >
          <MenuItem disabled={!hasSelection} onClick={() => run(onCutSelection)}>
            <MenuIcon><ContentCutRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Cut</ListItemText>
            <MenuShortcut>Ctrl+X</MenuShortcut>
          </MenuItem>
          <MenuItem disabled={!hasSelection} onClick={() => run(onCopySelection)}>
            <MenuIcon><ContentCopyRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Copy</ListItemText>
            <MenuShortcut>Ctrl+C</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run(onPasteSelection)}>
            <MenuIcon><ContentPasteRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Paste</ListItemText>
            <MenuShortcut>Ctrl+V</MenuShortcut>
          </MenuItem>
          <MenuItem disabled={!hasSelection} onClick={() => run(onDeleteSelection)}>
            <MenuIcon><DeleteOutlineRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Delete selected</ListItemText>
            <MenuShortcut>Del</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run(onClear)}>
            <MenuIcon><DeleteSweepRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Delete all</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={menuAnchor?.id === 'view' ? menuAnchor.el : null}
          disablePortal
          id="view-menu"
          MenuListProps={denseMenuProps}
          onClose={closeMenu}
          open={menuAnchor?.id === 'view'}
        >
          <ListSubheader>Appearance</ListSubheader>
          <MenuItem onClick={() => run(() => onThemeModeChange('light'))} selected={themeMode === 'light'}>
            <MenuIcon><LightModeRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Light mode</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(() => onThemeModeChange('dark'))} selected={themeMode === 'dark'}>
            <MenuIcon><DarkModeRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Dark mode</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => run(() => onSelectTool('move'))} selected={currentTool === 'move'}>
            <MenuIcon><OpenWithRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Pan canvas</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onZoomIn)}>
            <MenuIcon><ZoomInRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Zoom in</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onFitToScreen)}>
            <MenuIcon><FitScreenRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Fit to screen</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(onZoomOut)}>
            <MenuIcon><ZoomOutRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Zoom out</ListItemText>
          </MenuItem>
        </Menu>

      </Toolbar>
    </AppBar>
  );
}

export function ToolRailView({
  canMergePaths,
  canReversePath,
  canSplitPath,
  currentDefTikzName,
  currentTool,
  gridPitch,
  gridVisible,
  onGridPitchChange,
  onMergePaths,
  onReversePath,
  onSelectTool,
  onToggleGridVisible,
  onTogglePinSnap,
  onSelectSymbolShortcut,
  onWireRoutingModeChange,
  pinSnapEnabled,
  wireRoutingMode,
}: {
  canMergePaths: boolean;
  canReversePath: boolean;
  canSplitPath: boolean;
  currentDefTikzName?: string;
  currentTool: ToolType;
  gridPitch: number;
  gridVisible: boolean;
  onGridPitchChange: (value: number) => void;
  onMergePaths: () => void;
  onReversePath: () => void;
  onSelectTool: (tool: ToolType) => void;
  onToggleGridVisible: (checked: boolean) => void;
  onTogglePinSnap: (checked: boolean) => void;
  onSelectSymbolShortcut: (tikzName: SymbolShortcutTikzName) => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  pinSnapEnabled: boolean;
  wireRoutingMode: WireRoutingMode;
}) {
  const [gridPitchMenuAnchor, setGridPitchMenuAnchor] = useState<HTMLElement | null>(null);
  const gridOptions = [0.125, 0.25, 0.5, 1, 2];
  const closeGridPitchMenu = () => setGridPitchMenuAnchor(null);
  const runGridPitch = (fn: () => void) => {
    fn();
    closeGridPitchMenu();
  };
  const railToggleSx = {
    border: 0,
    borderRadius: 1,
    height: 40,
    minWidth: 0,
    width: 40,
    p: 0,
    '&.Mui-disabled': { border: 0 },
  } as const;
  const selectLineRouting = (mode: WireRoutingMode) => {
    onWireRoutingModeChange(mode);
    if (currentTool !== 'wire') onSelectTool('wire');
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        bgcolor: 'background.default',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        gridArea: 'activitybar',
        minHeight: 0,
        overflowX: 'hidden',
        overflowY: 'auto',
        py: 0.5,
      }}
    >
      <ToggleButtonGroup
        exclusive
        orientation="vertical"
        onChange={(_event, value: ToolType | null) => {
          if (value) onSelectTool(value);
        }}
        size="small"
        sx={{ '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0.25 }, '& .MuiToggleButton-root': railToggleSx }}
        value={isEditTool(currentTool) ? currentTool : null}
      >
        {TOOL_LABELS.map(({ activeWhen, icon, id, label }) => (
          <Tooltip
            key={`${id}-${label}`}
            placement="right"
            title={label}
          >
            <ToggleButton aria-label={label} value={activeWhen}>
              {icon}
            </ToggleButton>
          </Tooltip>
        ))}
        <Tooltip placement="right" title="Split path">
          <span>
            <ToggleButton aria-label="Split path" disabled={!canSplitPath} value={SPLIT_PATH_TOOL.activeWhen}>
              {SPLIT_PATH_TOOL.icon}
            </ToggleButton>
          </span>
        </Tooltip>
      </ToggleButtonGroup>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: -0.25 }}>
        <Tooltip placement="right" title="Merge paths">
          <span>
            <ToggleButton
              aria-label="Merge paths"
              disabled={!canMergePaths}
              onClick={onMergePaths}
              sx={railToggleSx}
              value="merge-paths"
            >
              <CallMergeRoundedIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>
        <Tooltip placement="right" title="Reverse path">
          <span>
            <ToggleButton
              aria-label="Reverse path"
              disabled={!canReversePath}
              onClick={onReversePath}
              sx={railToggleSx}
              value="reverse-path"
            >
              <ThreeSixtyRoundedIcon fontSize="small" />
            </ToggleButton>
          </span>
        </Tooltip>
      </Box>

      <Divider flexItem sx={{ my: 0.5 }} />
      <ToggleButtonGroup
        exclusive
        orientation="vertical"
        size="small"
        sx={{ '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0.25 }, '& .MuiToggleButton-root': railToggleSx }}
        value={currentTool === 'wire'
          ? wireRoutingMode
          : (DRAW_TOOLS.some(({ tool }) => tool === currentTool) || currentTool === 'draw-bezier') ? currentTool : null}
      >
        {WIRE_ROUTING_OPTIONS.map(({ icon, label, value }) => (
          <Tooltip key={value} placement="right" title={label}>
            <ToggleButton aria-label={label} onClick={() => selectLineRouting(value)} value={value}>
              {icon}
            </ToggleButton>
          </Tooltip>
        ))}
        <Tooltip placement="right" title="Draw line (bezier)">
          <ToggleButton aria-label="Draw line (bezier)" onClick={() => onSelectTool('draw-bezier')} value="draw-bezier">
            <UTurnLeftRoundedIcon fontSize="small" sx={{ transform: 'rotate(-90deg)' }} />
          </ToggleButton>
        </Tooltip>
        {DRAW_TOOLS.map(({ icon, label, tool }) => (
          <Tooltip key={tool} placement="right" title={label}>
            <ToggleButton aria-label={label} onClick={() => onSelectTool(tool)} value={tool}>
              {icon}
            </ToggleButton>
          </Tooltip>
        ))}
      </ToggleButtonGroup>

      <Divider flexItem sx={{ my: 0.5 }} />
      <Box sx={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <ToggleButtonGroup
          orientation="vertical"
          size="small"
          sx={{ '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0.25 }, '& .MuiToggleButton-root': railToggleSx }}
        >
          {COMMON_COMPONENT_SHORTCUTS.map(({ icon, label, tikzName }) => (
            <Tooltip key={tikzName} placement="right" title={label}>
              <ToggleButton
                aria-label={label}
                onClick={() => onSelectSymbolShortcut(tikzName)}
                selected={currentDefTikzName === tikzName}
                value={tikzName}
              >
                {icon}
              </ToggleButton>
            </Tooltip>
          ))}
          {SYMBOL_SHORTCUTS.map(({ icon, label, tikzName }) => (
            <Tooltip key={tikzName} placement="right" title={label}>
              <ToggleButton
                aria-label={label}
                onClick={() => onSelectSymbolShortcut(tikzName)}
                selected={currentDefTikzName === tikzName}
                value={tikzName}
              >
                {icon}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Divider flexItem sx={{ my: 0.5 }} />
      <Box sx={{ flex: 1, minHeight: 0 }} />

      <ToggleButtonGroup
        orientation="vertical"
        size="small"
        sx={{ '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0.25 }, '& .MuiToggleButton-root': railToggleSx }}
      >
        <Tooltip placement="right" title="Snap wire to pins">
          <ToggleButton
            aria-label="Pin snap"
            onClick={() => onTogglePinSnap(!pinSnapEnabled)}
            selected={pinSnapEnabled}
            value="pin-snap"
          >
            <AdsClickRoundedIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip placement="right" title={gridVisible ? 'Hide grid' : 'Show grid'}>
          <ToggleButton
            aria-label={gridVisible ? 'Hide grid' : 'Show grid'}
            onClick={() => onToggleGridVisible(!gridVisible)}
            selected={gridVisible}
            value="grid-visible"
          >
            <Grid4x4RoundedIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <Tooltip placement="right" title="Grid pitch">
          <ToggleButton
            aria-controls={gridPitchMenuAnchor ? 'rail-grid-pitch-menu' : undefined}
            aria-expanded={gridPitchMenuAnchor ? 'true' : undefined}
            aria-haspopup="menu"
            aria-label="Grid pitch"
            onClick={(event) => setGridPitchMenuAnchor(event.currentTarget)}
            selected={Boolean(gridPitchMenuAnchor)}
            value="grid-pitch"
          >
            <Typography sx={{ fontSize: 11, lineHeight: 1 }} variant="caption">
              {gridPitch}
            </Typography>
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
      <Menu
        anchorEl={gridPitchMenuAnchor}
        disablePortal
        id="rail-grid-pitch-menu"
        MenuListProps={{ dense: true }}
        onClose={closeGridPitchMenu}
        open={Boolean(gridPitchMenuAnchor)}
        anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      >
        {gridOptions.map((value) => (
          <MenuItem key={value} onClick={() => runGridPitch(() => onGridPitchChange(value))} selected={value === gridPitch}>
            <MenuIcon><Grid4x4RoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>{value}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
