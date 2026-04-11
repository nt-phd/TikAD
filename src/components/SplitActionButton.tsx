import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  ButtonGroup,
  ClickAwayListener,
  Grow,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Stack,
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
  options,
}: {
  actionLabel: string;
  defaultActionId: string;
  options: SplitActionOption[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const defaultIndex = options.findIndex((option) => option.id === defaultActionId);
    return defaultIndex >= 0 ? defaultIndex : 0;
  });
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options[selectedIndex];

  const handleMainClick = () => {
    void selectedOption.run();
  };

  const handleToggle = () => {
    setOpen((prev) => !prev);
  };

  const handleClose = (event?: Event) => {
    if (event && anchorRef.current?.contains(event.target as Node)) return;
    setOpen(false);
  };

  const handleMenuItemClick = (index: number) => {
    setSelectedIndex(index);
    setOpen(false);
  };

  return (
    <Stack alignItems="center" direction="row" spacing={0.75}>
      <Typography color="text.secondary" sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }} variant="caption">
        {actionLabel}
      </Typography>
      <ButtonGroup
        aria-label={`${actionLabel} actions`}
        ref={anchorRef}
        size="small"
        sx={{
          '& .MuiButton-root': {
            alignSelf: 'center',
            height: 30,
            minHeight: 30,
            minWidth: 34,
            px: 0.75,
            py: 0.35,
            textTransform: 'none',
          },
        }}
        variant="outlined"
      >
        <Button onClick={handleMainClick} startIcon={selectedOption.icon}>
          {selectedOption.label}
        </Button>
        <Button
          aria-controls={open ? `${actionLabel.toLowerCase()}-actions-menu` : undefined}
          aria-expanded={open ? 'true' : undefined}
          aria-label={`Select ${actionLabel.toLowerCase()} action`}
          aria-haspopup="menu"
          onClick={handleToggle}
        >
          <ArrowDropDownRoundedIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Popper
        anchorEl={anchorRef.current}
        disablePortal
        open={open}
        placement="bottom-end"
        sx={{ zIndex: 1300 }}
        transition
      >
        {({ TransitionProps }) => (
          <Grow {...TransitionProps}>
            <Paper>
              <ClickAwayListener onClickAway={handleClose}>
                <MenuList autoFocusItem id={`${actionLabel.toLowerCase()}-actions-menu`}>
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
                </MenuList>
              </ClickAwayListener>
            </Paper>
          </Grow>
        )}
      </Popper>
    </Stack>
  );
}
