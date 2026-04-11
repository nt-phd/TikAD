import type { ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';

export function PanelSection({
  actions,
  children,
  expanded,
  grow = false,
  onChange,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  expanded: boolean;
  grow?: boolean;
  onChange: () => void;
  title: ReactNode;
}) {
  return (
    <Box
      sx={{
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        display: 'flex',
        flexDirection: 'column',
        flex: expanded ? (grow ? '1 1 0' : '0 0 auto') : '0 0 auto',
        minHeight: expanded && grow ? 120 : 'auto',
        minWidth: 0,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Button
        fullWidth
        onClick={onChange}
        sx={{
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
          borderRadius: 0,
          color: 'text.primary',
          justifyContent: 'space-between',
          minHeight: 44,
          px: 1.5,
          py: 0.5,
          textTransform: 'none',
        }}
        variant="text"
      >
        <Stack alignItems="center" direction="row" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
          {typeof title === 'string' || typeof title === 'number' ? (
            <Typography
              component="div"
              sx={{
                color: 'text.secondary',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
              variant="subtitle2"
            >
              {title}
            </Typography>
          ) : (
            title
          )}
        </Stack>
        {actions ? (
          <Box
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            sx={{ ml: 'auto', mr: 1 }}
          >
            <Stack direction="row" spacing={0.75}>
              {actions}
            </Stack>
          </Box>
        ) : null}
        <ExpandMoreRoundedIcon
          fontSize="small"
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 160ms ease',
          }}
        />
      </Button>
      {expanded ? (
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          {children}
        </Box>
      ) : null}
    </Box>
  );
}
