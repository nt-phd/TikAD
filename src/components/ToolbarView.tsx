import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  ButtonGroup,
  Divider,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import RouteSharpIcon from '@mui/icons-material/RouteSharp';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Grid4x4RoundedIcon from '@mui/icons-material/Grid4x4Rounded';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import OpenWithRoundedIcon from '@mui/icons-material/OpenWithRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import NavigationRoundedIcon from '@mui/icons-material/NavigationRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import type { ToolType, WireRoutingMode } from '../types';
import { SplitActionButton } from './SplitActionButton';

const TOOL_LABELS: Array<{ activeWhen: ToolType; icon: ReactNode; id: ToolType; label: string }> = [
  { id: 'select', activeWhen: 'select', label: 'Select', icon: <NavigationRoundedIcon fontSize="small" /> },
  { id: 'wire', activeWhen: 'wire', label: 'Wire', icon: <RouteSharpIcon fontSize="small" /> },
  { id: 'delete', activeWhen: 'delete', label: 'Delete', icon: <DeleteOutlineRoundedIcon fontSize="small" /> },
];

function isEditTool(tool: ToolType): tool is 'select' | 'wire' | 'delete' {
  return tool === 'select' || tool === 'wire' || tool === 'delete';
}

export function ToolbarView({
  currentTool,
  gridPitch,
  gridVisible,
  onGridPitchChange,
  onToggleGridVisible,
  onTogglePinSnap,
  onToggleThemeMode,
  onWireRoutingModeChange,
  pinSnapEnabled,
  onClear,
  onDownloadTex,
  onFitToScreen,
  onOpenTexUpload,
  onSelectTool,
  onUndo,
  onZoomIn,
  onZoomOut,
  themeMode,
  wireRoutingMode,
}: {
  currentTool: ToolType;
  gridPitch: number;
  gridVisible: boolean;
  onGridPitchChange: (value: number) => void;
  onToggleGridVisible: (checked: boolean) => void;
  onTogglePinSnap: (checked: boolean) => void;
  onToggleThemeMode: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  pinSnapEnabled: boolean;
  onClear: () => void;
  onDownloadTex: () => void;
  onFitToScreen: () => void;
  onOpenTexUpload: () => void;
  onSelectTool: (tool: ToolType) => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  themeMode: 'light' | 'dark';
  wireRoutingMode: WireRoutingMode;
}) {
  const toolbarToggleSx = {
    alignSelf: 'center',
    height: 30,
    minHeight: 30,
    minWidth: 34,
    px: 0.75,
    py: 0.35,
    textTransform: 'none',
  } as const;
  const toolbarButtonSx = {
    alignSelf: 'center',
    height: 30,
    minHeight: 30,
    minWidth: 34,
    px: 0.75,
    py: 0.35,
  } as const;
  const [gridMenuAnchor, setGridMenuAnchor] = useState<HTMLElement | null>(null);
  const gridMenuOpen = Boolean(gridMenuAnchor);
  const gridOptions = [0.125, 0.25, 0.5, 1, 2];

  return (
    <AppBar
      color="default"
      elevation={0}
      position="static"
      sx={{ borderBottom: 1, borderColor: 'divider', gridArea: 'toolbar' }}
    >
      <Toolbar sx={{ gap: 1, minHeight: '40px !important', px: 1.5 }}>
        <Box sx={{ display: 'flex', mr: 1.5 }}>
          <Box alt="logo" component="img" src="/favicon.svg" sx={{ display: 'block', height: 20, width: 'auto' }} />
          <Box
            alt="wordmark"
            component="img"
            src="/tikad-wordmark.svg"
            sx={(theme) => ({
              display: 'block',
              filter: theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
              height: 24,
              width: 'auto',
            })}
          />
        </Box>
        <Divider flexItem orientation="vertical" />
        <SplitActionButton
          actionLabel="File"
          defaultActionId="save-tex"
          options={[
            {
              icon: <UploadFileRoundedIcon fontSize="small" />,
              id: 'open-tex',
              label: 'Open',
              run: onOpenTexUpload,
            },
            {
              icon: <DownloadRoundedIcon fontSize="small" />,
              id: 'save-tex',
              label: 'Save',
              run: onDownloadTex,
            },
          ]}
        />
        <Divider flexItem orientation="vertical" />
        <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
          Edit
        </Typography>
        <ToggleButtonGroup
          exclusive
          onChange={(_event, value: ToolType | null) => {
            if (value) onSelectTool(value);
          }}
          size="small"
          sx={{ alignSelf: 'center', '& .MuiToggleButton-root': toolbarToggleSx }}
          value={currentTool === 'move' ? null : isEditTool(currentTool) ? 'select' : currentTool}
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
        <Tooltip title="Undo last change">
          <Button aria-label="Undo" onClick={onUndo} size="small" sx={toolbarButtonSx} variant="outlined">
            <UndoRoundedIcon fontSize="small" />
          </Button>
        </Tooltip>
        <Divider flexItem orientation="vertical" />
        {isEditTool(currentTool) ? (
          <>
            <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
              Draw
            </Typography>
            <ToggleButtonGroup
              exclusive
              onChange={(_event, value: ToolType | null) => {
                onSelectTool(value ?? 'select');
              }}
              size="small"
              sx={{ alignSelf: 'center', '& .MuiToggleButton-root': toolbarToggleSx }}
              value={currentTool === 'select' ? null : currentTool}
            >
              {[
                ['draw-text', <TextFieldsRoundedIcon fontSize="small" />, 'Insert text'],
                ['draw-rectangle', <CropSquareRoundedIcon fontSize="small" />, 'Insert rectangle'],
                ['draw-circle', <CircleOutlinedIcon fontSize="small" />, 'Insert circle'],
                ['draw-bezier', <RouteRoundedIcon fontSize="small" />, 'Insert bezier curve'],
              ].map(([tool, icon, title]) => (
                <Tooltip key={String(tool)} title={String(title)}>
                  <ToggleButton aria-label={String(tool)} value={tool}>
                    {icon}
                  </ToggleButton>
                </Tooltip>
              ))}
            </ToggleButtonGroup>
            <Divider flexItem orientation="vertical" />
          </>
        ) : null}
        {currentTool === 'wire' ? (
          <>
            <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
              Routing
            </Typography>
            <ToggleButtonGroup
              exclusive
              onChange={(_event, value: WireRoutingMode | null) => {
                if (value) onWireRoutingModeChange(value);
              }}
              size="small"
              sx={{ alignSelf: 'center', '& .MuiToggleButton-root': toolbarToggleSx }}
              value={wireRoutingMode}
            >
              {(['auto', '--', '|-', '-|'] as const).map((mode) => (
                <Tooltip
                  key={mode}
                  title={
                    mode === 'auto'
                      ? 'Wire routing: Auto'
                      : mode === '--'
                        ? 'Wire routing: Straight'
                        : mode === '|-'
                          ? 'Wire routing: Vertical then horizontal'
                          : 'Wire routing: Horizontal then vertical'
                  }
                >
                  <ToggleButton aria-label={mode === 'auto' ? 'Routing auto' : `Routing ${mode}`} value={mode}>
                    <Typography sx={{ fontSize: 12 }} variant="caption">
                      {mode === 'auto' ? 'A' : mode}
                    </Typography>
                  </ToggleButton>
                </Tooltip>
              ))}
            </ToggleButtonGroup>
            <Tooltip title="Snap wire to pins">
              <ToggleButton
                aria-label="Pin snap"
                onClick={() => onTogglePinSnap(!pinSnapEnabled)}
                selected={pinSnapEnabled}
                size="small"
                sx={toolbarToggleSx}
                value="pin-snap"
              >
                <AccountTreeRoundedIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Divider flexItem orientation="vertical" />
          </>
        ) : null}
        <Box sx={{ ml: 'auto' }} />
        {currentTool === 'delete' ? (
          <>
            <Button color="error" onClick={onClear} size="small" startIcon={<DeleteSweepRoundedIcon fontSize="small" />} variant="outlined">
              Delete all
            </Button>
            <Divider flexItem orientation="vertical" />
          </>
        ) : null}
        <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
          View
        </Typography>
        <ToggleButtonGroup
          exclusive
          onChange={(_event, value: 'move' | null) => {
            if (value === 'move') onSelectTool('move');
          }}
          size="small"
          sx={{ alignSelf: 'center', '& .MuiToggleButton-root': toolbarToggleSx }}
          value={currentTool === 'move' ? 'move' : null}
        >
          <Tooltip title="Pan canvas">
            <ToggleButton aria-label="Pan canvas" value="move">
              <OpenWithRoundedIcon fontSize="small" />
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
        <ButtonGroup
          size="small"
          sx={{ alignSelf: 'center', '& .MuiButton-root': toolbarButtonSx }}
          variant="outlined"
        >
          <Tooltip title="Zoom in">
            <Button aria-label="Zoom in" onClick={onZoomIn}>
              <ZoomInRoundedIcon fontSize="small" />
            </Button>
          </Tooltip>
          <Tooltip title="Fit to screen">
            <Button aria-label="Fit to screen" onClick={onFitToScreen}>
              <FitScreenRoundedIcon fontSize="small" />
            </Button>
          </Tooltip>
          <Tooltip title="Zoom out">
            <Button aria-label="Zoom out" onClick={onZoomOut}>
              <ZoomOutRoundedIcon fontSize="small" />
            </Button>
          </Tooltip>
        </ButtonGroup>
        <ButtonGroup
          size="small"
          sx={{ alignSelf: 'center', '& .MuiButton-root': toolbarButtonSx }}
          variant="outlined"
        >
          <Tooltip title="Show grid">
            <Button
              aria-label="Show grid"
              onClick={() => onToggleGridVisible(!gridVisible)}
              sx={{
                minWidth: 34,
                ...(gridVisible ? { bgcolor: 'action.selected' } : null),
              }}
            >
              <Grid4x4RoundedIcon fontSize="small" />
            </Button>
          </Tooltip>
          <Button
            aria-label="Grid pitch"
            onClick={(event) => setGridMenuAnchor(event.currentTarget)}
          >
            <ArrowDropDownRoundedIcon fontSize="small" />
          </Button>
        </ButtonGroup>
        <Menu
          anchorEl={gridMenuAnchor}
          disablePortal
          onClose={() => setGridMenuAnchor(null)}
          open={gridMenuOpen}
        >
          {gridOptions.map((value) => (
            <MenuItem
              key={value}
              onClick={() => {
                onGridPitchChange(value);
                setGridMenuAnchor(null);
              }}
              selected={value === gridPitch}
            >
              {value}
            </MenuItem>
          ))}
        </Menu>
        <Tooltip title={themeMode === 'dark' ? 'Toggle dark mode' : 'Toggle light mode'}>
          <ToggleButton aria-label="Theme mode" onClick={onToggleThemeMode} selected={themeMode === 'dark'} size="small" sx={toolbarToggleSx} value="theme-mode">
            {themeMode === 'dark' ? <DarkModeRoundedIcon fontSize="small" /> : <LightModeRoundedIcon fontSize="small" />}
          </ToggleButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
