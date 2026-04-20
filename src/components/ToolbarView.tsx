import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  ButtonGroup,
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
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AdsClickRoundedIcon from '@mui/icons-material/AdsClickRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import Grid4x4RoundedIcon from '@mui/icons-material/Grid4x4Rounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import NavigationRoundedIcon from '@mui/icons-material/NavigationRounded';
import OpenWithRoundedIcon from '@mui/icons-material/OpenWithRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import RouteSharpIcon from '@mui/icons-material/RouteSharp';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import EastRoundedIcon from '@mui/icons-material/EastRounded';
import SubdirectoryArrowLeftRoundedIcon from '@mui/icons-material/SubdirectoryArrowLeftRounded';
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import WebAssetRoundedIcon from '@mui/icons-material/WebAssetRounded';
import type { ToolType, WireRoutingMode } from '../types';

export type WorkspaceLayoutMode = 'bottom-code' | 'right-code';

const TOOLBAR_HEIGHT = 34;

const TOOL_LABELS: Array<{ activeWhen: ToolType; icon: ReactNode; id: ToolType; label: string }> = [
  { id: 'select', activeWhen: 'select', label: 'Select', icon: <NavigationRoundedIcon fontSize="small" /> },
  { id: 'wire', activeWhen: 'wire', label: 'Wire', icon: <RouteSharpIcon fontSize="small" /> },
  { id: 'delete', activeWhen: 'delete', label: 'Delete', icon: <DeleteOutlineRoundedIcon fontSize="small" /> },
];

const DRAW_TOOLS: Array<{ icon: ReactNode; label: string; tool: ToolType }> = [
  { tool: 'draw-text', label: 'Text', icon: <TextFieldsRoundedIcon fontSize="small" /> },
  { tool: 'draw-rectangle', label: 'Rectangle', icon: <CropSquareRoundedIcon fontSize="small" /> },
  { tool: 'draw-circle', label: 'Circle', icon: <CircleOutlinedIcon fontSize="small" /> },
  { tool: 'draw-bezier', label: 'Bezier', icon: <RouteRoundedIcon fontSize="small" /> },
];

const WIRE_ROUTING_OPTIONS: Array<{ icon: ReactNode; label: string; value: WireRoutingMode }> = [
  { value: 'auto', label: 'Auto', icon: <InsightsRoundedIcon fontSize="small" /> },
  { value: '--', label: 'Straight', icon: <EastRoundedIcon fontSize="small" /> },
  { value: '|-', label: 'Vertical then horizontal', icon: <SubdirectoryArrowRightRoundedIcon fontSize="small" /> },
  {
    value: '-|',
    label: 'Horizontal then vertical',
    icon: <SubdirectoryArrowLeftRoundedIcon fontSize="small" sx={{ transform: 'rotate(-90deg)' }} />,
  },
];

function isEditTool(tool: ToolType): tool is 'select' | 'wire' | 'delete' {
  return tool === 'select' || tool === 'wire' || tool === 'delete';
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
  gridPitch,
  gridVisible,
  onClear,
  onCopySelection,
  onCutSelection,
  onDeleteSelection,
  onDownloadTex,
  onFitToScreen,
  onGridPitchChange,
  onLayoutModeChange,
  onNewDocument,
  onOpenTexUpload,
  onPasteSelection,
  onRedo,
  onSelectTool,
  onToggleGridVisible,
  onTogglePinSnap,
  onThemeModeChange,
  onUndo,
  onWireRoutingModeChange,
  onZoomIn,
  onZoomOut,
  pinSnapEnabled,
  selectedIds,
  workspaceLayoutMode,
  themeMode,
  wireRoutingMode,
}: {
  currentTool: ToolType;
  gridPitch: number;
  gridVisible: boolean;
  onClear: () => void;
  onCopySelection: () => void;
  onCutSelection: () => void;
  onDeleteSelection: () => void;
  onDownloadTex: () => void;
  onFitToScreen: () => void;
  onGridPitchChange: (value: number) => void;
  onLayoutModeChange: (mode: WorkspaceLayoutMode) => void;
  onNewDocument: () => void;
  onOpenTexUpload: () => void;
  onPasteSelection: () => void;
  onRedo: () => void;
  onSelectTool: (tool: ToolType) => void;
  onToggleGridVisible: (checked: boolean) => void;
  onTogglePinSnap: (checked: boolean) => void;
  onThemeModeChange: (mode: 'light' | 'dark') => void;
  onUndo: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pinSnapEnabled: boolean;
  selectedIds: string[];
  workspaceLayoutMode: WorkspaceLayoutMode;
  themeMode: 'light' | 'dark';
  wireRoutingMode: WireRoutingMode;
}) {
  const [menuAnchor, setMenuAnchor] = useState<{ id: 'file' | 'edit' | 'view'; el: HTMLElement } | null>(null);
  const [gridPitchMenuAnchor, setGridPitchMenuAnchor] = useState<HTMLElement | null>(null);
  const gridOptions = [0.125, 0.25, 0.5, 1, 2];
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
  const toolbarToggleSx = {
    alignSelf: 'stretch',
    borderRadius: 0,
    minHeight: 0,
    minWidth: 32,
    px: 0.75,
    py: 0,
    textTransform: 'none',
  } as const;
  const toolbarButtonSx = {
    alignSelf: 'stretch',
    borderRadius: 0,
    minHeight: 0,
    minWidth: 32,
    px: 0.75,
    py: 0,
  } as const;

  const openMenu = (id: 'file' | 'edit' | 'view') => (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchor({ id, el: event.currentTarget });
  };
  const closeMenu = () => setMenuAnchor(null);
  const closeGridPitchMenu = () => setGridPitchMenuAnchor(null);
  const run = (fn: () => void) => {
    fn();
    closeMenu();
  };
  const runGridPitch = (fn: () => void) => {
    fn();
    closeGridPitchMenu();
  };

  return (
    <AppBar
      color="default"
      elevation={0}
      position="static"
      sx={{ borderBottom: 1, borderColor: 'divider', gridArea: 'toolbar' }}
    >
      <Toolbar variant="dense" sx={{ alignItems: 'stretch', gap: 0.5, minHeight: `${TOOLBAR_HEIGHT}px !important`, px: 0.75 }}>
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
          <MenuItem onClick={() => run(onDownloadTex)}>
            <MenuIcon><DownloadRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Save</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={menuAnchor?.id === 'edit' ? menuAnchor.el : null}
          disablePortal
          id="edit-menu"
          MenuListProps={denseMenuProps}
          onClose={closeMenu}
          open={menuAnchor?.id === 'edit'}
        >
          <MenuItem onClick={() => run(onUndo)}>
            <MenuIcon><UndoRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Undo</ListItemText>
            <MenuShortcut>Ctrl+Z</MenuShortcut>
          </MenuItem>
          <MenuItem onClick={() => run(onRedo)}>
            <MenuIcon><RedoRoundedIcon fontSize="small" /></MenuIcon>
            <ListItemText>Redo</ListItemText>
            <MenuShortcut>Ctrl+Y</MenuShortcut>
          </MenuItem>
          <Divider />
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
          <Divider />
          <ListSubheader>Draw</ListSubheader>
          {DRAW_TOOLS.map(({ icon, label, tool }) => (
            <MenuItem key={tool} onClick={() => run(() => onSelectTool(tool))} selected={currentTool === tool}>
              <MenuIcon>{icon}</MenuIcon>
              <ListItemText>{label}</ListItemText>
            </MenuItem>
          ))}
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
          <ListSubheader>Layout</ListSubheader>
          <MenuItem onClick={() => run(() => onLayoutModeChange('bottom-code'))} selected={workspaceLayoutMode === 'bottom-code'}>
            <MenuIcon><WebAssetRoundedIcon fontSize="small" sx={{ transform: 'rotate(180deg)' }} /></MenuIcon>
            <ListItemText>Code at bottom</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => run(() => onLayoutModeChange('right-code'))} selected={workspaceLayoutMode === 'right-code'}>
            <MenuIcon><WebAssetRoundedIcon fontSize="small" sx={{ transform: 'rotate(90deg)' }} /></MenuIcon>
            <ListItemText>Code at right</ListItemText>
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

        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <ToggleButtonGroup
          exclusive
          onChange={(_event, value: ToolType | null) => {
            if (value) onSelectTool(value);
          }}
          size="small"
          sx={{ alignSelf: 'stretch', '& .MuiToggleButton-root': toolbarToggleSx }}
          value={isEditTool(currentTool) ? currentTool : null}
        >
          {TOOL_LABELS.map(({ activeWhen, icon, id, label }) => (
            <Tooltip
              key={`${id}-${label}`}
              title={
                label === 'Select'
                  ? 'Select and edit'
                  : label === 'Wire'
                    ? 'Draw wire'
                    : 'Delete by click'
              }
            >
              <ToggleButton aria-label={label} value={activeWhen}>
                {icon}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
        {currentTool === 'wire' ? (
          <ToggleButtonGroup
            exclusive
            onChange={(_event, value: WireRoutingMode | null) => {
              if (value) onWireRoutingModeChange(value);
            }}
            size="small"
            sx={{ alignSelf: 'stretch', '& .MuiToggleButton-root': toolbarToggleSx }}
            value={wireRoutingMode}
          >
            {WIRE_ROUTING_OPTIONS.map(({ icon, label, value }) => (
              <Tooltip key={value} title={`Wire routing: ${label.toLowerCase()}`}>
                <ToggleButton aria-label={`Wire routing ${label.toLowerCase()}`} value={value}>
                  {icon}
                </ToggleButton>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
        ) : null}
        <Box sx={{ ml: 'auto' }} />
        <Tooltip title="Snap wire to pins">
          <ToggleButton
            aria-label="Pin snap"
            onClick={() => onTogglePinSnap(!pinSnapEnabled)}
            selected={pinSnapEnabled}
            size="small"
            sx={toolbarToggleSx}
            value="pin-snap"
          >
            <AdsClickRoundedIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <ButtonGroup
          color="inherit"
          size="small"
          sx={{ alignSelf: 'stretch', '& .MuiButton-root': toolbarButtonSx }}
          variant="outlined"
        >
          <Tooltip title={gridVisible ? 'Hide grid' : 'Show grid'}>
            <Button
              aria-label={gridVisible ? 'Hide grid' : 'Show grid'}
              color="inherit"
              onClick={() => onToggleGridVisible(!gridVisible)}
              sx={gridVisible ? { bgcolor: 'action.selected' } : undefined}
            >
              <Grid4x4RoundedIcon fontSize="small" />
            </Button>
          </Tooltip>
          <Tooltip title="Grid pitch">
            <Button
              aria-controls={gridPitchMenuAnchor ? 'grid-pitch-menu' : undefined}
              aria-expanded={gridPitchMenuAnchor ? 'true' : undefined}
              aria-haspopup="menu"
              aria-label="Grid pitch"
              color="inherit"
              endIcon={<ArrowDropDownRoundedIcon fontSize="small" />}
              onClick={(event) => setGridPitchMenuAnchor(event.currentTarget)}
            >
              <Typography sx={{ fontSize: 12 }} variant="caption">
                {gridPitch}
              </Typography>
            </Button>
          </Tooltip>
        </ButtonGroup>
        <Menu
          anchorEl={gridPitchMenuAnchor}
          disablePortal
          id="grid-pitch-menu"
          MenuListProps={denseMenuProps}
          onClose={closeGridPitchMenu}
          open={Boolean(gridPitchMenuAnchor)}
        >
          {gridOptions.map((value) => (
            <MenuItem key={value} onClick={() => runGridPitch(() => onGridPitchChange(value))} selected={value === gridPitch}>
              <MenuIcon><Grid4x4RoundedIcon fontSize="small" /></MenuIcon>
              <ListItemText>{value}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
