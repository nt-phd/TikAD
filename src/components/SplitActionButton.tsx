import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  ButtonGroup,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';

export type SplitActionOption = {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
};

export function SplitActionButton({
  actionLabel,
  defaultActionId,
  mainAriaLabel,
  mainIcon,
  options,
  showActionLabel = true,
  showMainLabel = true,
  storageKey,
}: {
  actionLabel: string;
  defaultActionId: string;
  mainAriaLabel?: string;
  mainIcon?: ReactNode;
  options: SplitActionOption[];
  showActionLabel?: boolean;
  showMainLabel?: boolean;
  storageKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const storedId = storageKey ? window.localStorage.getItem(storageKey) : null;
    const preferredId = storedId ?? defaultActionId;
    const defaultIndex = options.findIndex((option) => option.id === preferredId);
    return defaultIndex >= 0 ? defaultIndex : 0;
  });
  const selectedOption = options[selectedIndex];

  const handleMainClick = () => {
    void selectedOption.run();
  };

  const handleToggle = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    setOpen((prev) => !prev);
  };

  const handleClose = () => {
    setOpen(false);
    setAnchorEl(null);
  };

  const handleMenuItemClick = (index: number) => {
    setSelectedIndex(index);
    if (storageKey) {
      window.localStorage.setItem(storageKey, options[index].id);
    }
    handleClose();
  };

  return (
    <Stack alignItems="center" direction="row" spacing={0.75}>
      {showActionLabel ? (
        <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
          {actionLabel}
        </Typography>
      ) : null}
      <ButtonGroup
        aria-label={`${actionLabel} actions`}
        color="inherit"
        size="small"
        sx={{
          '& .MuiButtonGroup-grouped': {
            borderColor: 'divider',
          },
          '& .MuiButtonGroup-grouped:hover': {
            borderColor: 'divider',
          },
          '& .MuiButton-root': {
            alignSelf: 'center',
            color: 'text.primary',
            fontSize: 13,
            height: 30,
            minHeight: 30,
            minWidth: 30,
            px: 0.75,
            py: 0.25,
            textTransform: 'none',
          },
          '& .MuiSvgIcon-root': {
            fontSize: 18,
          },
        }}
        variant="outlined"
      >
        <Tooltip title={actionLabel}>
          <Button aria-label={mainAriaLabel ?? actionLabel} onClick={handleMainClick} startIcon={showMainLabel ? selectedOption.icon : undefined}>
            {showMainLabel ? selectedOption.label : mainIcon}
          </Button>
        </Tooltip>
        <Button
          aria-controls={open ? `${actionLabel.toLowerCase()}-actions-menu` : undefined}
          aria-expanded={open ? 'true' : undefined}
          aria-label={`Select ${actionLabel.toLowerCase()} action`}
          aria-haspopup="menu"
          onClick={handleToggle}
          sx={{ gap: 0.25 }}
        >
          {selectedOption.icon}
          <ArrowDropDownRoundedIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        disablePortal
        MenuListProps={{
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
            '& .MuiSvgIcon-root': {
              fontSize: 18,
            },
          },
        }}
        onClose={handleClose}
        open={open}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        {options.map((option, index) => (
          <MenuItem
            key={option.id}
            onClick={() => handleMenuItemClick(index)}
            selected={index === selectedIndex}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}
