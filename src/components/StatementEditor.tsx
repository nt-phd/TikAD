import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Box,
  Button,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import AdjustRoundedIcon from '@mui/icons-material/AdjustRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import { RichTreeView, TreeItem, useRichTreeViewApiRef } from '@mui/x-tree-view';
import { TreeItemLabel } from '@mui/x-tree-view/TreeItem';
import type { TreeItemProps } from '@mui/x-tree-view/TreeItem';
import { useTreeItemModel, useTreeItemUtils } from '@mui/x-tree-view/hooks';
import type { UseTreeItemLabelInputSlotOwnProps, UseTreeItemLabelSlotOwnProps } from '@mui/x-tree-view/useTreeItem';
import type { SelectChangeEvent } from '@mui/material/Select';
import statementEditorSchemaJson from '../data/statementEditorSchema.json';
import optionDbRaw from '../data/circuitikz-option-db.raw.json';
import { registry } from '../definitions/ComponentRegistry';
import {
  getBipoleVariantCodePrefix,
  getDefaultBipoleVariantToken,
  statementPropertySchema,
  type BipoleValuePropertyId,
  type StatementPropertyDefinition,
} from '../data/statementPropertySchema';
import type { EditableStatement, TerminalMark } from '../types';
import { splitOptions } from '../codegen/TikzStatementSyntax';

const MONOSPACE_FONT = '"Roboto Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const CODE_TOKEN_SX = {
  backgroundColor: 'action.hover',
  borderRadius: 0.5,
  display: 'inline-block',
  px: 0.5,
} as const;

function cloneEditableStatement(model: EditableStatement): EditableStatement {
  return {
    ...model,
    positionTexts: [...model.positionTexts],
    segments: model.segments.map((segment) => {
      if (segment.kind === 'connection') return { ...segment };
      if (segment.kind === 'bipole') return { ...segment, props: { ...segment.props }, variantTokens: { ...segment.variantTokens } };
      if (segment.kind === 'node') return { ...segment };
      return { ...segment };
    }),
  };
}

function editableStatementsEqual(a: EditableStatement, b: EditableStatement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type StatementTreeField =
  | 'add-property'
  | 'annotation'
  | 'annotation-style'
  | 'command'
  | 'current'
  | 'current-style'
  | 'end-node'
  | 'label'
  | 'label-style'
  | 'row-options'
  | 'start-node'
  | 'object'
  | 'options'
  | 'position'
  | 'raw'
  | 'text'
  | 'unparsed-options'
  | 'voltage'
  | 'voltage-style'
  | 'flow'
  | 'flow-style';

type StatementTreeControl = 'select' | 'text';

type StatementTreeFieldSchema = {
  control: StatementTreeControl;
  label: string;
  options?: Array<{ label: string; value: string; description?: string | null }>;
};

type StatementTreeNodeSchema = {
  field?: StatementTreeField;
  id?: string;
  idTemplate?: string;
  kind?: 'components';
  positionIndex?: number;
  positionIndexFromSegmentOffset?: number;
  scope: 'root' | 'segment';
  showForSegmentKinds?: Array<'bipole' | 'connection' | 'node' | 'raw' | 'package'>;
  showWhen?: 'not-top-level-node' | 'position-exists';
};

type PackageOptionGroup = { key: string; label: string; variants: Array<{ label: string; value: string; description?: string }> };

type StatementTreeSchema = {
  componentChildren: StatementTreeNodeSchema[];
  fields: Record<StatementTreeField, StatementTreeFieldSchema>;
  packages?: Array<{ label: string; value: string }>;
  packageOptions?: Record<string, PackageOptionGroup[]>;
  rootChildren: StatementTreeNodeSchema[];
  rootField: StatementTreeField;
  rootId: string;
  rootKind: 'row';
};

type StatementTreeItemModel = {
  children?: StatementTreeItemModel[];
  control?: StatementTreeControl;
  editable?: boolean;
  field?: StatementTreeField;
  id: string;
  kind: 'add' | 'component' | 'field' | 'position' | 'row';
  label: string;
  options?: Array<{ label: string; value: string; description?: string | null }>;
  propertyId?: string;
  optionKey?: string;
  tokenEditor?: {
    mode: 'compound';
    options: Array<{
      description?: string;
      label: string;
      prefix: string;
      value: string;
    }>;
    prefix: string;
    value: string;
  };
  title: string;
  value: string;
  positionIndex?: number;
  segmentIndex?: number;
};

const statementTreeSchema = statementEditorSchemaJson.statementTree as unknown as StatementTreeSchema;
const environmentTreeSchema = statementEditorSchemaJson.environmentTree as unknown as StatementTreeSchema | undefined;
const routeOptions = (statementEditorSchemaJson.statementTree as { routeOptions?: Array<{ label: string; value: string; description?: string | null }> }).routeOptions ?? [];
const commonComponentOptions = (statementEditorSchemaJson.commonComponentOptions ?? []) as Array<{ label: string; value: string; description?: string | null }>;
const flatPackageOptions = (statementEditorSchemaJson.packageOptions ?? {}) as Record<string, Array<{ label: string; value: string; description?: string | null }>>;

export type PositionPick = {
  id: number;
  options: Array<{ label: string; value: string }>;
  value: string;
};

type OptionDbComponent = {
  tag: string;
  kind?: string;
  sourceFiles?: string[];
};

type OptionDbDefinition = {
  key: string;
  description?: string | null;
  section?: string | null;
  files?: string[];
  scope?: string;
};

const optionDb = optionDbRaw as {
  components: OptionDbComponent[];
  optionDefinitions: OptionDbDefinition[];
};

const optionDbComponentFiles = new Map(
  (optionDb.components ?? [])
    .filter((entry) => entry.tag)
    .map((entry) => [entry.tag, entry.sourceFiles ?? []]),
);

function getNodeOptionDefinitions(tikzName?: string): OptionDbDefinition[] {
  if (!tikzName) return [];
  const sourceFiles = optionDbComponentFiles.get(tikzName);
  if (!sourceFiles || sourceFiles.length === 0) return [];
  const sourceSet = new Set(sourceFiles);
  const lowerTag = tikzName.toLowerCase();
  const familyPrefixes = new Set<string>([
    `tripoles/${tikzName}/`,
    `quadpoles/${tikzName}/`,
    `multipoles/${tikzName}/`,
    `nodes/${tikzName}/`,
    `logic ports/${tikzName}/`,
    `transistors/${tikzName}/`,
  ]);
  const allowGlobalSection = (entry: OptionDbDefinition): boolean => {
    const section = (entry.section ?? entry.description ?? '').toLowerCase();
    if (!section) return false;
    if (lowerTag.includes('op amp') || lowerTag.includes('amp')) {
      return section.includes('polarity');
    }
    return false;
  };

  return (optionDb.optionDefinitions ?? [])
    .filter((entry) => entry.key && (entry.scope === 'global' || entry.scope === 'tikz' || entry.scope === 'component-family'))
    .filter((entry) => (entry.files ?? []).some((file) => sourceSet.has(file)))
    .filter((entry) => {
      if (entry.key.includes('/')) {
        return [...familyPrefixes].some((prefix) => entry.key.startsWith(prefix));
      }
      return allowGlobalSection(entry);
    });
}

function matchesOptionToken(token: string, option: { value: string }): boolean {
  return option.value.endsWith('=') ? token.startsWith(option.value) : token === option.value;
}

function getCommonOptionDefinitions(): Array<{ label: string; value: string; description?: string | null }> {
  return commonComponentOptions;
}

function getPackageOptionGroups(packageName: string): PackageOptionGroup[] {
  return environmentTreeSchema?.packageOptions?.[packageName] ?? [];
}

function getPackageOptionDefinitions(packageName: string): Array<{ label: string; value: string; description?: string | null }> {
  return flatPackageOptions[packageName] ?? [];
}

function getPackageGroupVariants(
  packageName: string,
  groupKey: string,
): Array<{ label: string; value: string; description?: string | null }> {
  const group = getPackageOptionGroups(packageName).find((entry) => entry.key === groupKey);
  return group?.variants ?? [];
}

function getPropertyPrefixes(property: StatementPropertyDefinition): Array<{
  description?: string;
  label: string;
  prefix: string;
  value: string;
}> {
  if (property.variants && property.variants.length > 0) {
    return property.variants.map((variant) => ({
      description: variant.description,
      label: variant.label,
      prefix: variant.code.endsWith('=') ? variant.code.slice(0, -1) : variant.code,
      value: variant.token,
    }));
  }
  return property.patterns
    .filter((pattern) => pattern.code.endsWith('='))
    .map((pattern) => {
      const prefix = pattern.code.slice(0, -1);
      return {
        description: pattern.description,
        label: pattern.label,
        prefix,
        value: prefix,
      };
    });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchOptionPatternToken(optionsText: string | undefined, property: StatementPropertyDefinition): { prefix: string; tokenValue: string; value: string } | null {
  const tokens = splitOptions(optionsText ?? '');
  const prefixes = getPropertyPrefixes(property);
  for (const token of tokens) {
    const trimmed = token.trim();
    for (const prefix of prefixes) {
      const pattern = new RegExp(`^${escapeRegex(prefix.prefix)}\\s*=\\s*([\\s\\S]+)$`);
      const match = trimmed.match(pattern);
      if (match) {
        return {
          prefix: prefix.prefix,
          tokenValue: prefix.value,
          value: match[1].trim(),
        };
      }
    }
  }
  return null;
}

function patchOptionPatternText(
  optionsText: string | undefined,
  property: StatementPropertyDefinition,
  nextPrefix: string,
  nextValue: string,
): string | undefined {
  const tokens = splitOptions(optionsText ?? '');
  const prefixes = getPropertyPrefixes(property);
  const matchers = prefixes.map((prefix) => new RegExp(`^${escapeRegex(prefix.prefix)}\\s*=`));
  const indices = tokens
    .map((token, index) => (matchers.some((matcher) => matcher.test(token.trim())) ? index : -1))
    .filter((index) => index >= 0);

  if (!nextValue) {
    for (let i = indices.length - 1; i >= 0; i -= 1) tokens.splice(indices[i], 1);
    return tokens.join(', ').trim() || undefined;
  }

  const replacement = `${nextPrefix}=${nextValue}`;
  if (indices.length === 0) {
    tokens.push(replacement);
  } else {
    tokens[indices[0]] = replacement;
    for (let i = indices.length - 1; i >= 1; i -= 1) tokens.splice(indices[i], 1);
  }
  return tokens.join(', ').trim() || undefined;
}

function getResidualOptionsText(
  optionsText: string | undefined,
  properties: StatementPropertyDefinition[],
): string | undefined {
  const tokens = splitOptions(optionsText ?? '');
  const filtered = tokens.filter((token) => {
    const trimmed = token.trim();
    return !properties.some((property) => {
      if (property.storage.kind !== 'options-pattern') return false;
      return getPropertyPrefixes(property).some((prefix) => new RegExp(`^${escapeRegex(prefix.prefix)}\\s*=`).test(trimmed));
    });
  });
  return filtered.join(', ').trim() || undefined;
}

function getResidualNodeOptionsText(
  optionsText: string | undefined,
  properties: StatementPropertyDefinition[],
  optionDefs: Array<{ value: string }>,
): string | undefined {
  const tokens = splitOptions(optionsText ?? '');
  const filtered = tokens.filter((token) => {
    const trimmed = token.trim();
    if (optionDefs.some((entry) => matchesOptionToken(trimmed, entry))) return false;
    return !properties.some((property) => {
      if (property.storage.kind !== 'options-pattern') return false;
      return getPropertyPrefixes(property).some((prefix) => new RegExp(`^${escapeRegex(prefix.prefix)}\\s*=`).test(trimmed));
    });
  });
  return filtered.join(', ').trim() || undefined;
}

function getMappedOptionsText(
  optionsText: string | undefined,
  properties: StatementPropertyDefinition[],
): string | undefined {
  const tokens = splitOptions(optionsText ?? '');
  const filtered = tokens.filter((token) => {
    const trimmed = token.trim();
    return properties.some((property) => {
      if (property.storage.kind !== 'options-pattern') return false;
      return getPropertyPrefixes(property).some((prefix) => new RegExp(`^${escapeRegex(prefix.prefix)}\\s*=`).test(trimmed));
    });
  });
  return filtered.join(', ').trim() || undefined;
}

function getSegmentDisplayName(segment: EditableStatement['segments'][number]): string {
  if (segment.kind === 'raw') return 'Raw';
  if (segment.kind === 'package') return 'Package';
  if (segment.kind === 'connection') return 'Route';
  const def = registry.getAll().find((entry) =>
    entry.tikzName === segment.tikzName
      && (segment.kind === 'bipole' ? entry.placementType === 'bipole' : entry.placementType !== 'bipole'));
  return def?.displayName ?? segment.tikzName ?? 'Component';
}

function getStatementTreeFieldSchema(schema: StatementTreeSchema, field: StatementTreeField): StatementTreeFieldSchema {
  if (field === 'label-style' || field === 'annotation-style' || field === 'voltage-style' || field === 'current-style' || field === 'flow-style') {
    const propertyId = field.replace(/-style$/, '') as BipoleValuePropertyId;
    const property = statementPropertySchema.segmentKinds.bipole.properties.find((entry) => entry.id === propertyId);
    return {
      control: 'select',
      label: 'Style',
      options: (property?.variants ?? []).map((variant) => ({
        label: variant.label,
        value: variant.token,
      })),
    };
  }
  return schema.fields[field];
}

function statementTreeLabelValue(value: string): string {
  return value === '' ? ' ' : value;
}

function encodeCompoundTreeValue(style: string, value: string): string {
  return JSON.stringify({ style, value });
}

function decodeCompoundTreeValue(payload: string): { style: string; value: string } | null {
  try {
    const parsed = JSON.parse(payload) as { style?: unknown; value?: unknown };
    if (typeof parsed?.style !== 'string' || typeof parsed?.value !== 'string') return null;
    return { style: parsed.style, value: parsed.value };
  } catch {
    return null;
  }
}

function isCompoundBipoleField(item: StatementTreeItemModel): item is StatementTreeItemModel & {
  tokenEditor: NonNullable<StatementTreeItemModel['tokenEditor']>;
} {
  return item.kind === 'field' && item.tokenEditor?.mode === 'compound';
}

function hasStructuredBipoleProperty(
  segment: EditableStatement['segments'][number],
  propertyId: string,
): boolean {
  if (segment?.kind !== 'bipole') return false;
  if (propertyId === 'label') return Boolean(segment.props.label);
  if (propertyId === 'annotation') return Boolean(segment.props.annotation);
  if (propertyId === 'voltage') return Boolean(segment.props.voltage);
  if (propertyId === 'current') return Boolean(segment.props.current);
  if (propertyId === 'flow') return Boolean(segment.props.flow);
  if (propertyId === 'start-node') return Boolean(segment.props.startTerminal && segment.props.startTerminal !== 'none');
  if (propertyId === 'end-node') return Boolean(segment.props.endTerminal && segment.props.endTerminal !== 'none');
  return false;
}

function hasStructuredProperty(
  segment: EditableStatement['segments'][number],
  property: StatementPropertyDefinition,
): boolean {
  if (segment.kind === 'bipole') return hasStructuredBipoleProperty(segment, property.id);
  if (segment.kind === 'node') {
    if (property.storage.kind === 'segment' && property.storage.key === 'text') return true;
    if (property.storage.kind === 'options-pattern') return Boolean(matchOptionPatternToken(segment.optionsText, property));
  }
  return false;
}

function isTerminalMarkValue(value: string): value is TerminalMark {
  return value === 'circ' || value === 'diamondpole' || value === 'none' || value === 'ocirc' || value === 'rectjoinfill';
}

function fromBipoleStyleField(field: StatementTreeField): BipoleValuePropertyId | null {
  if (field === 'annotation-style') return 'annotation';
  if (field === 'current-style') return 'current';
  if (field === 'flow-style') return 'flow';
  if (field === 'label-style') return 'label';
  if (field === 'voltage-style') return 'voltage';
  return null;
}

function formatBipoleViewValue(item: StatementTreeItemModel): string {
  if (!isCompoundBipoleField(item)) return item.value || '\u00A0';
  return `${item.tokenEditor.prefix}=${item.value}` || '\u00A0';
}

function renderStatementSelectOption({
  description,
  primary,
}: {
  description?: string;
  primary: string;
}) {
  return (
    <Box sx={{ alignItems: 'baseline', display: 'flex', gap: 1.25, minWidth: 0 }}>
      <Typography sx={{ fontFamily: MONOSPACE_FONT, whiteSpace: 'nowrap' }} variant="body2">
        {primary}
      </Typography>
      {description ? (
        <Typography
          color="text.secondary"
          sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          variant="caption"
        >
          {description}
        </Typography>
      ) : null}
    </Box>
  );
}

const StyledStatementLabelInput = styled('input')(({ theme }) => ({
  ...theme.typography.body2,
  backgroundColor: (theme.vars || theme).palette.background.paper,
  border: 'none',
  borderRadius: Number(theme.shape.borderRadius) || 6,
  boxSizing: 'border-box',
  color: (theme.vars || theme).palette.text.primary,
  flex: '1 1 0',
  fontFamily: MONOSPACE_FONT,
  minWidth: 0,
  padding: '0 2px',
  width: 100,
  '&:focus': {
    outline: `1px solid ${(theme.vars || theme).palette.primary.main}`,
  },
}));

const STATEMENT_TREE_SELECT_SX = {
  flex: '1 1 0',
  minWidth: 0,
  '& .MuiSelect-select': {
    fontFamily: MONOSPACE_FONT,
    minHeight: 'unset',
    padding: '0 18px 0 2px',
  },
  '&::before': {
    display: 'none',
  },
  '&::after': {
    display: 'none',
  },
} as const;

const STATEMENT_TREE_SELECT_MENU_PROPS = {
  disablePortal: true,
  PaperProps: {
    sx: {
      maxWidth: 420,
    },
  },
} as const;

const PositionIcon = AdjustRoundedIcon;
const RouteIcon = ShowChartRoundedIcon;

function StatementTreeLabel({
  children,
  editable,
  itemId,
  onAddProperty,
  onRemoveProperty,
  onStartEditing,
  startEditing,
  ...other
}: UseTreeItemLabelSlotOwnProps & {
  editable?: boolean;
  itemId: string;
  onAddProperty: (segmentIndex: number, propertyId: string) => void;
  onRemoveProperty: (item: StatementTreeItemModel) => void;
  onStartEditing: (item: StatementTreeItemModel) => void;
  startEditing: () => void;
}) {
  const item = useTreeItemModel<StatementTreeItemModel>(itemId);
  const [addAnchorEl, setAddAnchorEl] = useState<HTMLElement | null>(null);
  if (!item) return <TreeItemLabel {...other}>{children}</TreeItemLabel>;
  const value = item.kind === 'add'
    ? item.title
    : (typeof children === 'string' ? children : item.value);
  const addOpen = Boolean(addAnchorEl);

  return (
    <TreeItemLabel
      {...other}
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1,
        justifyContent: 'space-between',
        minHeight: 30,
        py: 0.125,
      }}
    >
      <Typography
        sx={{
          color: item.kind === 'field' ? 'text.secondary' : 'text.primary',
          flex: '0 0 auto',
          fontSize: 13,
          fontWeight: item.kind === 'field' ? 500 : 600,
          minWidth: 0,
        }}
        variant="body2"
      >
        {item.title}
      </Typography>
      {item.kind === 'add' ? (
        <>
          <IconButton
            onClick={(event) => {
              event.stopPropagation();
              setAddAnchorEl(event.currentTarget);
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            size="small"
            sx={{ flex: '0 0 auto', ml: 0.5 }}
          >
            <AddOutlinedIcon fontSize="inherit" />
          </IconButton>
          <Menu
            anchorEl={addAnchorEl}
            disablePortal
            onClose={() => setAddAnchorEl(null)}
            open={addOpen}
            slotProps={{
              paper: {
                sx: {
                  maxWidth: 420,
                },
              },
            }}
          >
            {(item.options ?? []).map((option, i) =>
              option.value ? (
                <MenuItem
                  key={option.value}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddProperty(item.segmentIndex ?? -1, option.value);
                    setAddAnchorEl(null);
                  }}
                >
                  {renderStatementSelectOption({ primary: option.label, description: option.description ?? undefined })}
                </MenuItem>
              ) : (
                <ListSubheader key={`subheader-${i}`}>{option.label}</ListSubheader>
              )
            )}
          </Menu>
        </>
      ) : editable ? (
        <Box
          onClick={(event) => {
            event.stopPropagation();
            startEditing();
            onStartEditing(item);
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          sx={{
            alignItems: 'center',
            color: value ? 'text.primary' : 'text.disabled',
            display: 'flex',
            flex: '1 1 0',
            gap: 1,
            minWidth: 0,
          }}
        >
          {isCompoundBipoleField(item) ? (
            <Typography
              sx={{
                color: value ? 'text.primary' : 'text.disabled',
                flex: '1 1 0',
                fontFamily: MONOSPACE_FONT,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...CODE_TOKEN_SX,
              }}
              variant="body2"
            >
              {formatBipoleViewValue(item)}
            </Typography>
          ) : (
            <Typography
              sx={{
                color: value ? 'text.primary' : 'text.disabled',
                flex: '1 1 0',
                fontFamily: MONOSPACE_FONT,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...CODE_TOKEN_SX,
              }}
              variant="body2"
            >
              {value || '\u00A0'}
            </Typography>
          )}
        </Box>
      ) : item.value ? (
        <Typography
          sx={{
            color: 'text.primary',
            flex: '1 1 0',
            fontFamily: MONOSPACE_FONT,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...CODE_TOKEN_SX,
          }}
          variant="body2"
        >
          {item.value}
        </Typography>
      ) : null}
    </TreeItemLabel>
  );
}

function StatementTreeLabelInput({
  handleCancelItemLabelEditing,
  handleSaveItemLabel,
  itemId,
  isPositionActive,
  isPositionMenuOpen,
  onCommitValue,
  onFinishEditing,
  onRemoveProperty,
  setPositionMenuOpen,
  ...props
}: UseTreeItemLabelInputSlotOwnProps & {
  handleCancelItemLabelEditing: (event: React.SyntheticEvent) => void;
  handleSaveItemLabel: (event: React.SyntheticEvent, label: string) => void;
  itemId: string;
  isPositionActive: boolean;
  isPositionMenuOpen: boolean;
  onCommitValue: (item: StatementTreeItemModel, value: string) => void;
  onFinishEditing: (item: StatementTreeItemModel) => void;
  onRemoveProperty: (item: StatementTreeItemModel) => void;
  setPositionMenuOpen: (open: boolean) => void;
}) {
  const item = useTreeItemModel<StatementTreeItemModel>(itemId);
  const [value, setValue] = useState(item?.value ?? '');
  const [styleValue, setStyleValue] = useState(item?.tokenEditor?.value ?? '');

  useEffect(() => {
    setValue(item?.value ?? '');
    setStyleValue(item?.tokenEditor?.value ?? '');
  }, [item?.tokenEditor?.value, item?.value]);

  if (!item) return null;


  const commitCurrentValue = (event: React.SyntheticEvent) => {
    if (isCompoundBipoleField(item)) {
      handleSaveItemLabel(event, encodeCompoundTreeValue(styleValue, value));
      onFinishEditing(item);
      return;
    }
    handleSaveItemLabel(event, statementTreeLabelValue(value));
    onFinishEditing(item);
  };

  const handleBlurWithin = (event: React.FocusEvent<HTMLElement>) => {
    const currentTarget = event.currentTarget;
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement && currentTarget.contains(activeElement)) return;
      commitCurrentValue(event);
    });
  };

  return (
    <TreeItemLabel
      onBlur={handleBlurWithin}
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1,
        justifyContent: 'space-between',
        minHeight: 30,
        py: 0.125,
      }}
    >
      <Typography
        sx={{
          color: item.kind === 'field' ? 'text.secondary' : 'text.primary',
          flex: '0 0 auto',
          fontSize: 13,
          fontWeight: 500,
          minWidth: 0,
        }}
        variant="body2"
      >
        {item.title}
      </Typography>
      {item.kind === 'component' && item.propertyId ? (
        <Typography
          sx={{
            color: 'text.primary',
            flex: '1 1 0',
            fontFamily: MONOSPACE_FONT,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...CODE_TOKEN_SX,
          }}
          variant="body2"
        >
          {item.value}
        </Typography>
      ) : isCompoundBipoleField(item) ? (
        <Fragment>
          <Select
            autoFocus
            disableUnderline
            MenuProps={STATEMENT_TREE_SELECT_MENU_PROPS}
            onChange={(event: SelectChangeEvent<string>) => setStyleValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                handleCancelItemLabelEditing(event);
                onFinishEditing(item);
                return;
              }
              if (event.key === 'Enter') {
                (event.currentTarget as HTMLElement).blur();
              }
            }}
            renderValue={(selected) => {
              const option = item.tokenEditor.options.find((entry) => entry.value === selected);
              return `${option?.prefix ?? selected}=`;
            }}
            size="small"
            sx={{ ...STATEMENT_TREE_SELECT_SX, flex: '0 0 auto', width: 'auto' }}
            variant="standard"
            value={styleValue}
          >
            {item.tokenEditor.options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {renderStatementSelectOption({
                  description: option.label,
                  primary: `${option.prefix}=`,
                })}
              </MenuItem>
            ))}
          </Select>
          <StyledStatementLabelInput
            {...props}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                (event.currentTarget as HTMLInputElement).blur();
                return;
              }
              if (event.key === 'Escape') {
                handleCancelItemLabelEditing(event);
                onFinishEditing(item);
              }
            }}
            value={value}
          />
        </Fragment>
      ) : item.field === 'position' ? (
        <Fragment>
          <StyledStatementLabelInput
            {...props}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                (event.currentTarget as HTMLInputElement).blur();
                return;
              }
              if (event.key === 'Escape') {
                handleCancelItemLabelEditing(event);
                onFinishEditing(item);
              }
            }}
            value={value}
          />
          {item.options && item.options.length > 0 ? (
            <Select
              autoFocus={false}
              disableUnderline
              MenuProps={STATEMENT_TREE_SELECT_MENU_PROPS}
              IconComponent={ArrowDropDownIcon}
              onChange={(event: SelectChangeEvent<string>) => {
                const nextValue = event.target.value;
                setValue(nextValue);
                onCommitValue(item, nextValue);
                setPositionMenuOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  handleCancelItemLabelEditing(event);
                  onFinishEditing(item);
                  return;
                }
              }}
              onClose={() => setPositionMenuOpen(false)}
              open={isPositionMenuOpen}
              renderValue={() => ''}
              size="small"
              sx={{
                ...STATEMENT_TREE_SELECT_SX,
                flex: '0 0 auto',
                width: 18,
                ml: 0.5,
                '& .MuiSelect-icon': {
                  transform: isPositionMenuOpen ? 'rotate(180deg)' : undefined,
                },
              }}
              variant="standard"
              value=""
            >
              {(item.options ?? []).map((option, index) => (
                <MenuItem key={`${option.value}-${index}`} value={option.value}>
                  {renderStatementSelectOption({ primary: option.label })}
                </MenuItem>
              ))}
            </Select>
          ) : null}
        </Fragment>
      ) : item.control === 'select' ? (
        <Select
          autoFocus
          disableUnderline
          MenuProps={STATEMENT_TREE_SELECT_MENU_PROPS}
          onChange={(event: SelectChangeEvent<string>) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              handleCancelItemLabelEditing(event);
              onFinishEditing(item);
              return;
            }
            if (event.key === 'Enter') {
              (event.currentTarget as HTMLElement).blur();
            }
          }}
          renderValue={(selected) => item.options?.find((option) => option.value === selected)?.label ?? `${selected}`}
          size="small"
          sx={STATEMENT_TREE_SELECT_SX}
          variant="standard"
          value={value}
        >
          {(item.options ?? []).map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {renderStatementSelectOption({
                primary: option.label,
                description: option.description ?? undefined,
              })}
            </MenuItem>
          ))}
        </Select>
      ) : (
        <StyledStatementLabelInput
          {...props}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              (event.currentTarget as HTMLInputElement).blur();
              return;
            }
            if (event.key === 'Escape') {
              handleCancelItemLabelEditing(event);
              onFinishEditing(item);
            }
          }}
          value={value}
        />
      )}
      {((item.kind === 'field' && item.field !== 'text') || item.kind === 'component') && item.propertyId ? (
        <IconButton
          onClick={(event) => {
            event.stopPropagation();
            onRemoveProperty(item);
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          size="small"
          sx={{ flex: '0 0 auto', ml: 0.5 }}
        >
          <DeleteOutlineRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : null}
    </TreeItemLabel>
  );
}

export function StatementEditor({
  onCommit,
  model,
  positionPick,
  onPositionEditChange,
  stopShortcutPropagation,
}: {
  onCommit: (statement: EditableStatement) => void;
  model: EditableStatement;
  positionPick?: PositionPick | null;
  onPositionEditChange?: (active: boolean) => void;
  stopShortcutPropagation: (e: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const treeSchema = model.mode === 'environment' && environmentTreeSchema ? environmentTreeSchema : statementTreeSchema;
  const [draft, setDraft] = useState<EditableStatement>(() => cloneEditableStatement(model));
  const [addedBipolePropertyIds, setAddedBipolePropertyIds] = useState<Record<number, string[]>>({});
  const [activePositionItemId, setActivePositionItemId] = useState<string | null>(null);
  const [activePositionIndex, setActivePositionIndex] = useState<number | null>(null);
  const [positionDropdown, setPositionDropdown] = useState<{
    positionIndex: number;
    options: Array<{ label: string; value: string }>;
  } | null>(null);
  const [positionMenuOpen, setPositionMenuOpen] = useState(false);
  const lastPositionPickId = useRef<number | null>(null);
  const treeApiRef = useRichTreeViewApiRef();

  useEffect(() => {
    setDraft(cloneEditableStatement(model));
    setAddedBipolePropertyIds({});
    setActivePositionItemId(null);
    setActivePositionIndex(null);
    setPositionDropdown(null);
    setPositionMenuOpen(false);
    lastPositionPickId.current = null;
    treeApiRef.current?.setEditedItem(null);
    onPositionEditChange?.(false);
  }, [model.rawStatementText, model.sourceLineIndex, model.sourceSubIndex]);

  useEffect(() => {
    if (!positionPick || activePositionIndex == null || !activePositionItemId) return;
    if (lastPositionPickId.current === positionPick.id) return;
    lastPositionPickId.current = positionPick.id;
    setPositionDropdown({ positionIndex: activePositionIndex, options: positionPick.options });
    setPositionMenuOpen(positionPick.options.length > 0);
    treeApiRef.current?.setEditedItem(activePositionItemId);
  }, [activePositionIndex, activePositionItemId, onCommit, positionPick, treeApiRef]);

  useEffect(() => {
    if (activePositionItemId) return;
    if (positionMenuOpen) setPositionMenuOpen(false);
    if (positionDropdown) setPositionDropdown(null);
  }, [activePositionItemId, positionDropdown, positionMenuOpen]);

  const topLevelNodeSegment = draft.command === 'node' && draft.segments[0]?.kind === 'node'
    ? draft.segments[0]
    : null;
  const bipolePropertyGroup = statementPropertySchema.segmentKinds.bipole;

  const treeItems = useMemo<StatementTreeItemModel[]>(() => {
    const createFieldItem = ({
      field,
      id,
      positionIndex,
      segmentIndex,
      tokenEditor,
      value,
    }: {
      field: StatementTreeField;
      id: string;
      positionIndex?: number;
      segmentIndex?: number;
      tokenEditor?: StatementTreeItemModel['tokenEditor'];
      value: string;
    }): StatementTreeItemModel => {
      const config = getStatementTreeFieldSchema(treeSchema, field);
      const isPositionDropdown = field === 'position'
        && positionIndex != null
        && positionDropdown?.positionIndex === positionIndex;
      return {
        control: isPositionDropdown ? 'select' : config.control,
        editable: true,
        field,
        id,
        kind: field === 'position' || field === 'object' ? 'component' : 'field',
        label: statementTreeLabelValue(value),
        options: isPositionDropdown ? positionDropdown?.options : config.options,
        positionIndex,
        segmentIndex,
        tokenEditor,
        title: config.label,
        value,
      };
    };

    const resolveFieldValue = ({
      field,
      positionIndex,
      segment,
    }: {
      field: StatementTreeField;
      positionIndex?: number;
      segment?: EditableStatement['segments'][number];
    }): string | null => {
      if (field === 'command') return draft.command;
      if (field === 'row-options') return draft.commandOptionsText ?? '';
      if (field === 'position' && positionIndex != null) {
        return draft.positionTexts[positionIndex] ?? null;
      }
      if (!segment) return null;
      if (segment.kind === 'package') {
        if (field === 'object') return segment.name;
        if (field === 'options') return segment.optionsText ?? '';
        return null;
      }
      if (field === 'label' && segment.kind === 'node') {
        const property = statementPropertySchema.segmentKinds.node.properties.find((entry) => entry.id === 'label');
        return property ? (matchOptionPatternToken(segment.optionsText, property)?.value ?? '') : '';
      }
      if (field === 'label') return segment.kind === 'bipole' ? (segment.props.label ?? '') : null;
      if (field === 'annotation') return segment.kind === 'bipole' ? (segment.props.annotation ?? '') : null;
      if (field === 'voltage') return segment.kind === 'bipole' ? (segment.props.voltage ?? '') : null;
      if (field === 'current') return segment.kind === 'bipole' ? (segment.props.current ?? '') : null;
      if (field === 'flow') return segment.kind === 'bipole' ? (segment.props.flow ?? '') : null;
      const stylePropertyId = fromBipoleStyleField(field);
      if (stylePropertyId && segment.kind === 'bipole') {
        return segment.variantTokens?.[stylePropertyId] ?? getDefaultBipoleVariantToken(stylePropertyId);
      }
      if (field === 'options') {
        return segment.kind === 'bipole' || segment.kind === 'node' ? (segment.optionsText ?? '') : null;
      }
      if (field === 'unparsed-options') {
        return segment.kind === 'bipole' || segment.kind === 'node' ? (segment.optionsText ?? '') : null;
      }
      if (field === 'add-property') return '';
      if (field === 'start-node') {
        return segment.kind === 'bipole'
          ? (segment.props.startTerminal === 'none' ? '' : (segment.props.startTerminal ?? ''))
          : null;
      }
      if (field === 'end-node') {
        return segment.kind === 'bipole'
          ? (segment.props.endTerminal === 'none' ? '' : (segment.props.endTerminal ?? ''))
          : null;
      }
      if (field === 'text') return segment.kind === 'node' ? (segment.text ?? '') : null;
      if (field === 'raw') return segment.kind === 'raw' ? segment.rawText : null;
      return null;
    };

    const shouldShowNode = ({
      node,
      positionIndex,
      segment,
    }: {
      node: StatementTreeNodeSchema;
      positionIndex?: number;
      segment?: EditableStatement['segments'][number];
    }): boolean => {
      if (node.showWhen === 'not-top-level-node' && topLevelNodeSegment) return false;
      if (node.showWhen === 'position-exists' && positionIndex != null) {
        return draft.positionTexts[positionIndex] != null;
      }
      if (node.showForSegmentKinds && segment) {
        return node.showForSegmentKinds.includes(segment.kind);
      }
      if (node.showForSegmentKinds && !segment) return false;
      return true;
    };

    const buildNodeFromSchema = ({
      node,
      index,
      segment,
    }: {
      node: StatementTreeNodeSchema;
      index?: number;
      segment?: EditableStatement['segments'][number];
    }): StatementTreeItemModel | null => {
      if (node.kind === 'components') return null;
      if (!node.field || !node.id) return null;
      const positionIndex = node.positionIndex ?? (index != null && node.positionIndexFromSegmentOffset != null
        ? index + node.positionIndexFromSegmentOffset
        : undefined);
      if (!shouldShowNode({ node, positionIndex, segment })) return null;
      const value = resolveFieldValue({ field: node.field, positionIndex, segment });
      if (value == null) return null;
      return createFieldItem({
        field: node.field,
        id: node.id.replace('{index}', String(index ?? '')),
        positionIndex,
        segmentIndex: index,
        value,
      });
    };

    const pairCount = Math.max(draft.positionTexts.length, draft.segments.length);
    const componentItems: StatementTreeItemModel[] = [];
    for (let index = 0; index < pairCount; index += 1) {
      const segment = draft.segments[index];
      if (segment) {
        const objectField = getStatementTreeFieldSchema(treeSchema, 'object');
        let children: StatementTreeItemModel[];
        if (segment.kind === 'bipole') {
          const commonOptions = getCommonOptionDefinitions();
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const commonOptionItems: StatementTreeItemModel[] = commonOptions
            .filter((option) => optionTokens.some((token) => matchesOptionToken(token, option)))
            .map((option) => {
              const token = optionTokens.find((entry) => matchesOptionToken(entry, option)) ?? option.value;
              return {
                control: 'text',
                editable: true,
                field: 'options',
                id: `segment-${index}-common-opt-${option.value}`,
                kind: 'field',
                label: statementTreeLabelValue(token),
                optionKey: token,
                propertyId: `common-option:${option.value}`,
                segmentIndex: index,
                title: 'Option',
                value: token,
              };
            });
          const availableCommonOptions = commonOptions
            .filter((option) => !optionTokens.some((token) => matchesOptionToken(token, option)))
            .map((option) => ({
              label: option.label,
              value: option.value,
              description: option.description ?? undefined,
            }));
          const addedIds = addedBipolePropertyIds[index] ?? [];
          const visiblePropertyIds = bipolePropertyGroup.properties
            .map((property) => property.id)
            .filter((propertyId) => addedIds.includes(propertyId) || hasStructuredBipoleProperty(segment, propertyId));
          const structuredChildren: StatementTreeItemModel[] = bipolePropertyGroup.properties
            .filter((property) => visiblePropertyIds.includes(property.id))
            .map((property) => {
              const field = property.id as StatementTreeField;
              const config = getStatementTreeFieldSchema(treeSchema, field);
              const value = resolveFieldValue({ field, segment }) ?? '';
              return {
                control: property.valueType === 'enum' ? 'select' : config?.control ?? 'text',
                editable: true,
                field,
                id: `segment-${index}-${property.id}`,
                kind: 'field',
                label: statementTreeLabelValue(value),
                options: property.options ?? config?.options,
                propertyId: property.id,
                segmentIndex: index,
                tokenEditor: property.valueType !== 'enum' && property.variants && property.variants.length > 1
                  ? (() => {
                    const currentToken = segment.variantTokens?.[property.id as BipoleValuePropertyId]
                      ?? getDefaultBipoleVariantToken(property.id as BipoleValuePropertyId);
                    return {
                      mode: 'compound' as const,
                      options: property.variants.map((variant) => ({
                        description: variant.description,
                        label: variant.label,
                        prefix: getBipoleVariantCodePrefix(property.id as BipoleValuePropertyId, variant.token),
                        value: variant.token,
                      })),
                      prefix: getBipoleVariantCodePrefix(property.id as BipoleValuePropertyId, currentToken),
                      value: currentToken,
                    };
                  })()
                  : undefined,
                title: property.label,
                value,
              };
            });
          const remainingProperties = bipolePropertyGroup.properties.filter((property) => !visiblePropertyIds.includes(property.id));
          const addItem: StatementTreeItemModel | null = remainingProperties.length > 0 || availableCommonOptions.length > 0 ? {
            control: 'select',
            editable: false,
            field: 'add-property',
            id: `segment-${index}-add-property`,
            kind: 'add',
            label: ' ',
            options: [
              { label: bipolePropertyGroup.addMenuLabel, value: '' },
              ...remainingProperties.map((property) => ({ label: property.label, value: property.id })),
              ...availableCommonOptions,
            ],
            segmentIndex: index,
            title: bipolePropertyGroup.addMenuLabel,
            value: '',
          } : null;
          const bipoleFallbackItem = segment.optionsText ? createFieldItem({
            field: 'unparsed-options',
            id: `segment-${index}-unparsed-options`,
            segmentIndex: index,
            value: segment.optionsText,
          }) : null;
          children = [
            ...structuredChildren,
            ...commonOptionItems,
            ...(addItem ? [addItem] : []),
            ...(bipoleFallbackItem ? [bipoleFallbackItem] : []),
          ];
        } else if (segment.kind === 'node') {
          const nodePropertyGroup = statementPropertySchema.segmentKinds.node;
          const addedIds = addedBipolePropertyIds[index] ?? [];
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const nodeOptionDefs = [
            ...getCommonOptionDefinitions(),
            ...getNodeOptionDefinitions(segment.tikzName).map((entry) => ({
              label: entry.key,
              value: entry.key,
              description: entry.description ?? entry.section ?? undefined,
            })),
          ];
          const nodeOptionItems: StatementTreeItemModel[] = nodeOptionDefs
            .filter((entry) => optionTokens.some((token) => matchesOptionToken(token, entry)))
            .map((entry) => {
              const token = optionTokens.find((token) => matchesOptionToken(token, entry)) ?? entry.value;
              return {
                control: 'text',
                editable: true,
                field: 'options',
                id: `segment-${index}-node-opt-${entry.value}`,
                kind: 'field',
                label: statementTreeLabelValue(token),
                optionKey: token,
                propertyId: `common-option:${entry.value}`,
                segmentIndex: index,
                title: 'Option',
                value: token,
              };
            });
          const visiblePropertyIds = nodePropertyGroup.properties
            .map((property) => property.id)
            .filter((propertyId) => {
              const property = nodePropertyGroup.properties.find((entry) => entry.id === propertyId);
              if (!property) return false;
              return addedIds.includes(propertyId) || hasStructuredProperty(segment, property);
            });
          const structuredChildren: StatementTreeItemModel[] = nodePropertyGroup.properties
            .filter((property) => visiblePropertyIds.includes(property.id))
            .map((property) => {
              const field = property.id as StatementTreeField;
              const config = getStatementTreeFieldSchema(treeSchema, field);
              const value = resolveFieldValue({ field, segment }) ?? '';
              const currentMatch = property.storage.kind === 'options-pattern'
                ? matchOptionPatternToken(segment.optionsText, property)
                : null;
              const prefixOptions = getPropertyPrefixes(property);
              return {
                control: property.valueType === 'enum' ? 'select' : config?.control ?? 'text',
                editable: true,
                field,
                id: `segment-${index}-${property.id}`,
                kind: 'field',
                label: statementTreeLabelValue(value),
                options: property.options ?? config?.options,
                propertyId: property.id,
                segmentIndex: index,
                tokenEditor: property.storage.kind === 'options-pattern' && prefixOptions.length > 0
                  ? {
                    mode: 'compound' as const,
                    options: prefixOptions,
                    prefix: currentMatch?.prefix ?? prefixOptions[0].prefix,
                    value: currentMatch?.tokenValue ?? prefixOptions[0].value,
                  }
                  : undefined,
                title: property.label,
                value,
              };
            });
          const remainingProperties = nodePropertyGroup.properties.filter((property) => !visiblePropertyIds.includes(property.id));
          const availableNodeOptions = nodeOptionDefs
            .filter((entry) => !optionTokens.some((token) => matchesOptionToken(token, entry)))
            .map((entry) => ({
              label: entry.label,
              value: entry.value,
              description: entry.description ?? undefined,
            }));
          const addItem: StatementTreeItemModel | null = (remainingProperties.length > 0 || availableNodeOptions.length > 0) ? {
            control: 'select',
            editable: false,
            field: 'add-property',
            id: `segment-${index}-add-property`,
          kind: 'add',
          label: ' ',
          options: [
            { label: nodePropertyGroup.addMenuLabel, value: '' },
            ...remainingProperties.map((property) => ({ label: property.label, value: property.id })),
            ...availableNodeOptions,
          ],
          segmentIndex: index,
          title: nodePropertyGroup.addMenuLabel,
          value: '',
          } : null;
          const residualOptionsText = getResidualNodeOptionsText(
            segment.optionsText,
            nodePropertyGroup.properties,
            nodeOptionDefs,
          );
          const fallbackItem = residualOptionsText ? createFieldItem({
            field: 'unparsed-options',
            id: `segment-${index}-unparsed-options`,
            segmentIndex: index,
            value: residualOptionsText,
          }) : null;
          children = [
            ...structuredChildren,
            ...nodeOptionItems,
            ...(addItem ? [addItem] : []),
            ...(fallbackItem ? [fallbackItem] : []),
          ];
        } else if (segment.kind === 'package') {
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const groupDefs = getPackageOptionGroups(segment.name);
          const flatDefs = groupDefs.length === 0 ? getPackageOptionDefinitions(segment.name) : [];
          const optionItems: StatementTreeItemModel[] = [];
          const addOptions: Array<{ label: string; value: string; description?: string }> = [];
          const matchedTokens = new Set<string>();

          if (groupDefs.length > 0) {
            groupDefs.forEach((group) => {
              const variants = group.variants ?? [];
              const token = optionTokens.find((entry) =>
                variants.some((variant) => matchesOptionToken(entry, variant)));
              if (token) {
                matchedTokens.add(token);
                optionItems.push({
                  control: 'select',
                  editable: true,
                  field: 'options',
                  id: `segment-${index}-package-group-${group.key}`,
                  kind: 'field',
                  label: statementTreeLabelValue(token),
                  optionKey: token,
                  options: variants.map((variant) => ({
                    label: variant.label,
                    value: variant.value,
                    description: variant.description ?? undefined,
                  })),
                  propertyId: `package-group:${group.key}`,
                  segmentIndex: index,
                  title: group.label,
                  value: token,
                });
              } else {
                addOptions.push({ label: group.label, value: '' });
                variants.forEach((variant) => {
                  addOptions.push({
                    label: variant.label,
                    value: variant.value,
                    description: variant.description ?? undefined,
                  });
                });
              }
            });
          } else {
            flatDefs
              .filter((option) => optionTokens.some((token) => matchesOptionToken(token, option)))
              .forEach((option) => {
                const token = optionTokens.find((token) => matchesOptionToken(token, option)) ?? option.value;
                matchedTokens.add(token);
                optionItems.push({
                  control: 'text',
                  editable: true,
                  field: 'options',
                  id: `segment-${index}-package-opt-${option.value}`,
                  kind: 'field',
                  label: statementTreeLabelValue(token),
                  optionKey: token,
                  propertyId: `package-option:${option.value}`,
                  segmentIndex: index,
                  title: 'Option',
                  value: token,
                });
              });
            flatDefs
              .filter((option) => !optionTokens.some((token) => matchesOptionToken(token, option)))
              .forEach((option) => {
                addOptions.push({
                  label: option.label,
                  value: option.value,
                  description: option.description ?? undefined,
                });
              });
          }

          const addItem: StatementTreeItemModel | null = addOptions.length > 0 ? {
            control: 'select',
            editable: false,
            field: 'add-property',
            id: `segment-${index}-add-package-option`,
            kind: 'add',
            label: ' ',
            options: [
              { label: 'Add', value: '' },
              ...addOptions,
            ],
            segmentIndex: index,
            title: 'Add',
            value: '',
          } : null;

          const residual = optionTokens.filter((token) => !matchedTokens.has(token));
          const fallbackItem = residual.length > 0 ? createFieldItem({
            field: 'unparsed-options',
            id: `segment-${index}-package-unparsed`,
            segmentIndex: index,
            value: residual.join(', '),
          }) : null;

          children = [
            ...optionItems,
            ...(addItem ? [addItem] : []),
            ...(fallbackItem ? [fallbackItem] : []),
          ];
        } else {
          children = treeSchema.componentChildren
            .map((node) => buildNodeFromSchema({ index, node: { ...node, id: node.idTemplate ?? node.id }, segment }))
            .filter((child): child is StatementTreeItemModel => Boolean(child));
        }
        componentItems.push({
          children,
          control: segment.kind === 'connection' && routeOptions.length > 0 ? 'select' : objectField.control,
          editable: segment.kind !== 'raw',
          field: segment.kind === 'raw' ? undefined : 'object',
          id: `segment-${index}`,
          kind: 'component',
          label: statementTreeLabelValue(
            segment.kind === 'raw'
              ? 'raw'
              : segment.kind === 'connection'
                ? segment.operator
                : segment.kind === 'package'
                  ? segment.name
                  : (segment.kind === 'bipole' && segment.tikzValue !== undefined ? `${segment.tikzName}=${segment.tikzValue}` : segment.tikzName) ?? '',
          ),
          options: segment.kind === 'connection' && routeOptions.length > 0 ? routeOptions : objectField.options,
          propertyId: segment.kind === 'package' ? `package:${segment.name}` : undefined,
          title: getSegmentDisplayName(segment),
          value:
            segment.kind === 'raw'
              ? 'raw'
              : segment.kind === 'connection'
                ? segment.operator
                : segment.kind === 'package'
                  ? segment.name
                  : (segment.kind === 'bipole' && segment.tikzValue !== undefined ? `${segment.tikzName}=${segment.tikzValue}` : segment.tikzName) ?? '',
          segmentIndex: index,
        });
      }
    }

    const rootField = getStatementTreeFieldSchema(treeSchema, treeSchema.rootField);
    const positionItems: StatementTreeItemModel[] = [];
    for (let index = 0; index < draft.positionTexts.length; index += 1) {
      const value = resolveFieldValue({ field: 'position', positionIndex: index });
      if (value == null) continue;
      positionItems.push(createFieldItem({
        field: 'position',
        id: `position-${index}`,
        positionIndex: index,
        value,
      }));
    }

    const interleavedChildren: StatementTreeItemModel[] = [];
    for (let index = 0; index < positionItems.length; index += 1) {
      interleavedChildren.push(positionItems[index]);
      if (componentItems[index]) interleavedChildren.push(componentItems[index]);
    }
    if (componentItems.length > positionItems.length) {
      interleavedChildren.push(...componentItems.slice(positionItems.length));
    }

    if (treeSchema === statementTreeSchema) {
      const rootChildren = treeSchema.rootChildren.flatMap((node) => {
        const child = buildNodeFromSchema({ node });
        return child ? [child] : [];
      });
      rootChildren.push(...interleavedChildren);
      return [{
        children: rootChildren,
        control: rootField.control,
        editable: true,
        field: treeSchema.rootField,
        id: treeSchema.rootId,
        kind: treeSchema.rootKind,
        label: statementTreeLabelValue(draft.command),
        options: rootField.options,
        title: rootField.label,
        value: draft.command,
      }];
    }

    // Environment tree: two group nodes — Preamble and Environment
    const existingPackageNames = new Set(
      draft.segments.filter((s) => s.kind === 'package').map((s) => s.name),
    );
    const availablePackages = (treeSchema.packages ?? []).filter((pkg) => !existingPackageNames.has(pkg.value));
    const preambleChildren: StatementTreeItemModel[] = [
      ...componentItems,
      ...(availablePackages.length > 0 ? [{
        control: 'select' as const,
        editable: false,
        field: 'add-property' as StatementTreeField,
        id: 'environment-add-package',
        kind: 'add' as const,
        label: ' ',
        options: availablePackages,
        title: 'Add',
        value: '',
      }] : []),
    ];

    const envOptionChildren = treeSchema.rootChildren.flatMap((node) => {
      const child = buildNodeFromSchema({ node });
      return child ? [child] : [];
    });

    const environmentChildren: StatementTreeItemModel[] = [...envOptionChildren];

    return [
      {
        children: preambleChildren,
        control: undefined,
        editable: false,
        field: undefined,
        id: 'environment-group-preamble',
        kind: 'component' as const,
        label: ' ',
        title: 'Preamble',
        value: '',
      },
      {
        children: environmentChildren,
        control: rootField.control,
        editable: true,
        field: treeSchema.rootField,
        id: 'environment-group-env',
        kind: 'component' as const,
        label: statementTreeLabelValue(draft.command),
        options: rootField.options,
        title: 'Environment',
        value: draft.command,
      },
    ];
  }, [addedBipolePropertyIds, bipolePropertyGroup.properties, draft.command, draft.commandOptionsText, draft.positionTexts, draft.segments, positionDropdown, topLevelNodeSegment, treeSchema]);

  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const lastSchemaRootId = useRef<string | null>(null);

  const expandedItems = useMemo(() => expandedIds, [expandedIds]);

  useEffect(() => {
    if (lastSchemaRootId.current === treeSchema.rootId) return;
    lastSchemaRootId.current = treeSchema.rootId;
    if (treeSchema === statementTreeSchema) {
      setExpandedIds([treeSchema.rootId]);
      return;
    }
    setExpandedIds(treeItems.map((item) => item.id));
  }, [treeItems, treeSchema]);


  const treeItemsById = useMemo(() => {
    const map = new Map<string, StatementTreeItemModel>();
    const visit = (item: StatementTreeItemModel) => {
      map.set(item.id, item);
      item.children?.forEach(visit);
    };
    treeItems.forEach(visit);
    return map;
  }, [treeItems]);

  const addBipoleProperty = (segmentIndex: number, propertyId: string) => {
    if (!propertyId) return;
    if (segmentIndex === -1) {
      if (treeSchema === statementTreeSchema) return;
      setDraft((prev) => {
        if (prev.segments.some((segment) => segment.kind === 'package' && segment.name === propertyId)) return prev;
        const next = cloneEditableStatement(prev);
        next.segments = [
          ...next.segments,
          { kind: 'package', name: propertyId },
        ];
        next.editIntent = { field: 'object', segmentIndex: next.segments.length - 1 };
        if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
        return next;
      });
      return;
    }

    const segment = draft.segments[segmentIndex];
    if (!segment) return;
    if (segment.kind === 'package') {
      setDraft((prev) => {
        const next = cloneEditableStatement(prev);
        const target = next.segments[segmentIndex];
        if (!target || target.kind !== 'package') return prev;
        const tokens = splitOptions(target.optionsText ?? '');
        if (!tokens.includes(propertyId)) tokens.push(propertyId);
        next.segments[segmentIndex] = { ...target, optionsText: tokens.join(', ') || undefined };
        next.editIntent = { field: 'options', segmentIndex };
        if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
        return next;
      });
      return;
    }
    if (segment.kind !== 'node' && segment.kind !== 'bipole') return;
    const isBipoleProperty = bipolePropertyGroup.properties.some((property) => property.id === propertyId);
    if (isBipoleProperty) {
      setAddedBipolePropertyIds((prev) => {
        const current = prev[segmentIndex] ?? [];
        if (current.includes(propertyId)) return prev;
        return {
          ...prev,
          [segmentIndex]: [...current, propertyId],
        };
      });
      return;
    }
    setDraft((prev) => {
      const next = cloneEditableStatement(prev);
      const target = next.segments[segmentIndex];
      if (!target || (target.kind !== 'node' && target.kind !== 'bipole')) return prev;
      const tokens = splitOptions(target.optionsText ?? '');
      if (!tokens.includes(propertyId)) tokens.push(propertyId);
      next.segments[segmentIndex] = { ...target, optionsText: tokens.join(', ') || undefined };
      next.editIntent = { field: 'options', segmentIndex };
      if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
      return next;
    });
  };

  const removeTreeItem = (item: StatementTreeItemModel) => {
    if (item.segmentIndex == null || !item.propertyId) return;
    const segmentIndex = item.segmentIndex;
    const propertyId = item.propertyId;
    setAddedBipolePropertyIds((prev) => {
      const current = prev[segmentIndex] ?? [];
      if (!current.includes(propertyId)) return prev;
      const nextValues = current.filter((entry: string) => entry !== propertyId);
      if (nextValues.length === 0) {
        const next = { ...prev };
        delete next[segmentIndex];
        return next;
      }
      return {
        ...prev,
        [segmentIndex]: nextValues,
      };
    });
    setDraft((prev) => {
      const next = cloneEditableStatement(prev);
      const segment = next.segments[segmentIndex];
      if (!segment) return prev;
      if (segment.kind === 'bipole' && (propertyId === 'label' || propertyId === 'annotation' || propertyId === 'voltage' || propertyId === 'current' || propertyId === 'flow')) {
        const variantTokens = { ...(segment.variantTokens ?? {}) };
        delete variantTokens[propertyId];
        next.segments[segmentIndex] = {
          ...segment,
          props: {
            ...segment.props,
            [propertyId]: undefined,
          },
          variantTokens,
        };
        next.editIntent = { field: propertyId, segmentIndex };
      } else if (segment.kind === 'bipole' && propertyId === 'start-node') {
        next.segments[segmentIndex] = {
          ...segment,
          props: {
            ...segment.props,
            startTerminal: undefined,
          },
        };
        next.editIntent = { field: 'start-node', segmentIndex };
      } else if (segment.kind === 'bipole' && propertyId === 'end-node') {
        next.segments[segmentIndex] = {
          ...segment,
          props: {
            ...segment.props,
            endTerminal: undefined,
          },
        };
        next.editIntent = { field: 'end-node', segmentIndex };
    } else if (segment.kind === 'node' && propertyId === 'label') {
      const property = statementPropertySchema.segmentKinds.node.properties.find((entry) => entry.id === 'label');
      if (!property) return prev;
      next.segments[segmentIndex] = {
        ...segment,
        optionsText: patchOptionPatternText(segment.optionsText, property, getPropertyPrefixes(property)[0]?.prefix ?? 'label', ''),
      };
      next.editIntent = { field: 'label', segmentIndex };
    } else if ((segment.kind === 'node' || segment.kind === 'bipole') && propertyId.startsWith('common-option:')) {
      const optionKey = item.optionKey ?? propertyId.slice('common-option:'.length);
      const tokens = splitOptions(segment.optionsText ?? '').filter((token) => token !== optionKey);
      next.segments[segmentIndex] = {
        ...segment,
        optionsText: tokens.join(', ') || undefined,
      };
      next.editIntent = { field: 'options', segmentIndex };
    } else if (propertyId.startsWith('package:')) {
      next.segments = next.segments.filter((_, i) => i !== segmentIndex);
      next.editIntent = { field: 'object', segmentIndex };
    } else if (segment.kind === 'package' && propertyId.startsWith('package-group:')) {
      const groupKey = propertyId.slice('package-group:'.length);
      const variants = getPackageGroupVariants(segment.name, groupKey);
      const tokens = splitOptions(segment.optionsText ?? '').filter(
        (token) => !variants.some((variant) => matchesOptionToken(token, variant)),
      );
      next.segments[segmentIndex] = {
        ...segment,
        optionsText: tokens.join(', ') || undefined,
      };
      next.editIntent = { field: 'options', segmentIndex };
    } else if (segment.kind === 'package' && propertyId.startsWith('package-option:')) {
      const optionKey = item.optionKey ?? propertyId.slice('package-option:'.length);
      const tokens = splitOptions(segment.optionsText ?? '').filter((token) => token !== optionKey);
      next.segments[segmentIndex] = {
        ...segment,
        optionsText: tokens.join(', ') || undefined,
      };
      next.editIntent = { field: 'options', segmentIndex };
    } else {
      return prev;
    }
      if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
      return next;
    });
  };

  const updateTreeItemValue = (item: StatementTreeItemModel, value: string) => {
    if (item.field === 'add-property' && item.segmentIndex == null && treeSchema !== statementTreeSchema) {
      if (!value) return;
      setDraft((prev) => {
        if (prev.segments.some((segment) => segment.kind === 'package' && segment.name === value)) return prev;
        const next = cloneEditableStatement(prev);
        next.segments = [
          ...next.segments,
          { kind: 'package', name: value },
        ];
        next.editIntent = { field: 'object', segmentIndex: next.segments.length - 1 };
        if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
        return next;
      });
      return;
    }
    if (item.field === 'add-property' && item.segmentIndex != null) {
      if (!value) return;
      const segment = draft.segments[item.segmentIndex];
      const isBipoleProperty = bipolePropertyGroup.properties.some((property) => property.id === value);
      if (segment && (segment.kind === 'node' || segment.kind === 'bipole') && !isBipoleProperty) {
        setDraft((prev) => {
          const next = cloneEditableStatement(prev);
          const target = next.segments[item.segmentIndex!];
          if (!target || (target.kind !== 'node' && target.kind !== 'bipole')) return prev;
          const tokens = splitOptions(target.optionsText ?? '');
          if (!tokens.includes(value)) tokens.push(value);
          next.segments[item.segmentIndex!] = { ...target, optionsText: tokens.join(', ') || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex! };
          if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
          return next;
        });
        return;
      }
      addBipoleProperty(item.segmentIndex, value);
      return;
    }
    setDraft((prev) => {
      const next = cloneEditableStatement(prev);
      if (item.field === 'command') {
        if (treeSchema === statementTreeSchema) {
          if (value !== 'draw' && value !== 'path' && value !== 'node' && value !== 'ctikzset') return prev;
        } else {
          if (value !== 'tikzpicture' && value !== 'circuitikz') return prev;
        }
        next.command = value;
        next.editIntent = { field: 'command' };
      } else if (item.field === 'row-options') {
        next.commandOptionsText = value || undefined;
        next.editIntent = { field: 'row-options' };
      } else if (item.field === 'position' && item.positionIndex != null) {
        next.positionTexts[item.positionIndex] = value;
        next.editIntent = { field: item.field, positionIndex: item.positionIndex };
      } else if (item.segmentIndex != null) {
        const segment = next.segments[item.segmentIndex];
        if (!segment) return prev;
        const compoundValue = decodeCompoundTreeValue(value);
        if (item.propertyId?.startsWith('common-option:') && (segment.kind === 'node' || segment.kind === 'bipole')) {
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const currentKey = item.optionKey ?? item.propertyId.slice('common-option:'.length);
          const filtered = optionTokens.filter((token) => token !== currentKey);
          if (value) filtered.push(value);
          next.segments[item.segmentIndex] = { ...segment, optionsText: filtered.join(', ') || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex };
        }
        if (item.propertyId?.startsWith('package-group:') && segment.kind === 'package') {
          const groupKey = item.propertyId.slice('package-group:'.length);
          const variants = getPackageGroupVariants(segment.name, groupKey);
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const filtered = optionTokens.filter(
            (token) => !variants.some((variant) => matchesOptionToken(token, variant)),
          );
          if (value) filtered.push(value);
          next.segments[item.segmentIndex] = { ...segment, optionsText: filtered.join(', ') || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex };
        }
        if (item.propertyId?.startsWith('package-option:') && segment.kind === 'package') {
          const optionTokens = splitOptions(segment.optionsText ?? '');
          const currentKey = item.optionKey ?? item.propertyId.slice('package-option:'.length);
          const filtered = optionTokens.filter((token) => token !== currentKey);
          if (value) filtered.push(value);
          next.segments[item.segmentIndex] = { ...segment, optionsText: filtered.join(', ') || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'object') {
          if (segment.kind === 'package') {
            next.segments[item.segmentIndex] = { ...segment, name: value };
          }
          if (segment.kind === 'connection') {
            if (value !== '--' && value !== '|-' && value !== '-|') return prev;
            next.segments[item.segmentIndex] = { ...segment, operator: value };
          }
          if (segment.kind === 'bipole') {
            const eqIdx = value.indexOf('=');
            const newTikzName = eqIdx >= 0 ? value.slice(0, eqIdx).trim() : value;
            const newTikzValue = eqIdx >= 0 ? value.slice(eqIdx + 1).trim() : undefined;
            next.segments[item.segmentIndex] = { ...segment, tikzName: newTikzName, tikzValue: newTikzValue };
          }
          if (segment.kind === 'node') next.segments[item.segmentIndex] = { ...segment, tikzName: value || undefined };
          next.editIntent = { field: 'object', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'label' && segment.kind === 'bipole') {
          next.segments[item.segmentIndex] = {
            ...segment,
            props: { ...segment.props, label: (compoundValue?.value ?? value) || undefined },
            variantTokens: compoundValue
              ? { ...segment.variantTokens, label: compoundValue.style }
              : segment.variantTokens,
          };
          next.editIntent = { field: 'label', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'label' && segment.kind === 'node') {
          const property = statementPropertySchema.segmentKinds.node.properties.find((entry) => entry.id === 'label');
          if (!property) return prev;
          const prefixOptions = getPropertyPrefixes(property);
          const nextPrefix = compoundValue?.style
            ?? matchOptionPatternToken(segment.optionsText, property)?.prefix
            ?? prefixOptions[0]?.prefix
            ?? 'label';
          next.segments[item.segmentIndex] = {
            ...segment,
            optionsText: patchOptionPatternText(segment.optionsText, property, nextPrefix, compoundValue?.value ?? value),
          };
          next.editIntent = { field: 'label', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'annotation' && segment.kind === 'bipole') {
          next.segments[item.segmentIndex] = {
            ...segment,
            props: { ...segment.props, annotation: (compoundValue?.value ?? value) || undefined },
            variantTokens: compoundValue
              ? { ...segment.variantTokens, annotation: compoundValue.style }
              : segment.variantTokens,
          };
          next.editIntent = { field: 'annotation', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'voltage' && segment.kind === 'bipole') {
          next.segments[item.segmentIndex] = {
            ...segment,
            props: { ...segment.props, voltage: (compoundValue?.value ?? value) || undefined },
            variantTokens: compoundValue
              ? { ...segment.variantTokens, voltage: compoundValue.style }
              : segment.variantTokens,
          };
          next.editIntent = { field: 'voltage', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'current' && segment.kind === 'bipole') {
          next.segments[item.segmentIndex] = {
            ...segment,
            props: { ...segment.props, current: (compoundValue?.value ?? value) || undefined },
            variantTokens: compoundValue
              ? { ...segment.variantTokens, current: compoundValue.style }
              : segment.variantTokens,
          };
          next.editIntent = { field: 'current', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'flow' && segment.kind === 'bipole') {
          next.segments[item.segmentIndex] = {
            ...segment,
            props: { ...segment.props, flow: (compoundValue?.value ?? value) || undefined },
            variantTokens: compoundValue
              ? { ...segment.variantTokens, flow: compoundValue.style }
              : segment.variantTokens,
          };
          next.editIntent = { field: 'flow', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'options' && (segment.kind === 'bipole' || segment.kind === 'node')) {
          next.segments[item.segmentIndex] = { ...segment, optionsText: value || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'options' && segment.kind === 'package') {
          next.segments[item.segmentIndex] = { ...segment, optionsText: value || undefined };
          next.editIntent = { field: 'options', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'unparsed-options' && (segment.kind === 'bipole' || segment.kind === 'node')) {
          const optionsText = segment.kind === 'node'
            ? (() => {
              const properties = statementPropertySchema.segmentKinds.node.properties;
              const mapped = getMappedOptionsText(segment.optionsText, properties);
              const pieces = [mapped, value || undefined].filter(Boolean);
              return pieces.join(', ').trim() || undefined;
            })()
            : (value || undefined);
          next.segments[item.segmentIndex] = { ...segment, optionsText };
          next.editIntent = { field: 'unparsed-options', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'start-node' && segment.kind === 'bipole') {
          const terminalValue: TerminalMark | undefined =
            value === '' ? undefined : isTerminalMarkValue(value) ? value : undefined;
          next.segments[item.segmentIndex] = {
            ...segment,
            props: {
              ...segment.props,
              startTerminal: terminalValue,
            },
          };
          next.editIntent = { field: 'start-node', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'end-node' && segment.kind === 'bipole') {
          const terminalValue: TerminalMark | undefined =
            value === '' ? undefined : isTerminalMarkValue(value) ? value : undefined;
          next.segments[item.segmentIndex] = {
            ...segment,
            props: {
              ...segment.props,
              endTerminal: terminalValue,
            },
          };
          next.editIntent = { field: 'end-node', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'text' && segment.kind === 'node') {
          next.segments[item.segmentIndex] = { ...segment, text: value || undefined };
          next.editIntent = { field: 'text', segmentIndex: item.segmentIndex };
        }
        if (item.field === 'raw' && segment.kind === 'raw') {
          next.segments[item.segmentIndex] = { ...segment, rawText: value };
          next.editIntent = { field: 'raw', segmentIndex: item.segmentIndex };
        }
      }
      if (!editableStatementsEqual(next, prev)) onCommit(cloneEditableStatement(next));
      return next;
    });
  };

  const handleStartEditing = (item: StatementTreeItemModel) => {
    if (item.field === 'position' && item.positionIndex != null) {
      setActivePositionItemId(item.id);
      setActivePositionIndex(item.positionIndex);
      onPositionEditChange?.(true);
      return;
    }
    setActivePositionItemId(null);
    setActivePositionIndex(null);
    setPositionDropdown(null);
    onPositionEditChange?.(false);
  };

  const handleFinishEditing = (item: StatementTreeItemModel) => {
    if (item.field === 'position') return;
    if (activePositionItemId && item.id === activePositionItemId) {
      setActivePositionItemId(null);
      setActivePositionIndex(null);
      setPositionDropdown(null);
      setPositionMenuOpen(false);
      onPositionEditChange?.(false);
    }
  };

  const StatementTreeItem = React.forwardRef<HTMLLIElement, TreeItemProps>(function StatementTreeItem(props, ref) {
    const item = useTreeItemModel<StatementTreeItemModel>(props.itemId);
    const { interactions } = useTreeItemUtils({
      children: props.children,
      itemId: props.itemId,
    });
    if (!item) return <TreeItem {...props} ref={ref} />;

    const slots = item.field === 'position'
      ? {
        endIcon: PositionIcon,
        label: StatementTreeLabel,
        labelInput: StatementTreeLabelInput,
      }
      : item.field === 'object' && item.value && ['--', '|-', '-|'].includes(item.value)
        ? {
          endIcon: RouteIcon,
          label: StatementTreeLabel,
          labelInput: StatementTreeLabelInput,
        }
      : {
        label: StatementTreeLabel,
        labelInput: StatementTreeLabelInput,
      };

    return (
      <TreeItem
        {...props}
        disableSelection
        label={item.value}
        ref={ref}
        slotProps={{
          label: {
            itemId: item.id,
            onAddProperty: addBipoleProperty,
            onRemoveProperty: removeTreeItem,
            onStartEditing: handleStartEditing,
            startEditing: interactions.toggleItemEditing,
          } as never,
          labelInput: {
            itemId: item.id,
            isPositionActive: item.id === activePositionItemId,
            isPositionMenuOpen: positionMenuOpen,
            onCommitValue: updateTreeItemValue,
            onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
              (event as React.FocusEvent<HTMLInputElement> & { defaultMuiPrevented?: boolean }).defaultMuiPrevented = true;
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
              (event as React.KeyboardEvent<HTMLInputElement> & { defaultMuiPrevented?: boolean }).defaultMuiPrevented = true;
              stopShortcutPropagation(event as unknown as ReactKeyboardEvent<HTMLElement>);
            },
            handleCancelItemLabelEditing: interactions.handleCancelItemLabelEditing,
            handleSaveItemLabel: interactions.handleSaveItemLabel,
            onFinishEditing: handleFinishEditing,
            onRemoveProperty: removeTreeItem,
            setPositionMenuOpen,
          } as never,
        }}
        slots={slots}
        sx={{
          '& .MuiTreeItem-groupTransition': {
            ml: 1,
          },
          '& .MuiTreeItem-label': {
            flex: 1,
            minWidth: 0,
          },
        }}
      />
    );
  });

  return (
    <RichTreeView
      apiRef={treeApiRef}
      expandedItems={expandedItems}
      getItemLabel={(item) => item.label}
      itemChildrenIndentation="0"
      items={treeItems}
      isItemEditable={(item) => Boolean(item.editable)}
      onItemExpansionToggle={(_event, itemId, isExpanded) => {
        setExpandedIds((prev) => isExpanded
          ? (prev.includes(itemId) ? prev : [...prev, itemId])
          : prev.filter((id) => id !== itemId));
      }}
      onItemLabelChange={(itemId, value) => {
        const item = treeItemsById.get(itemId);
        if (item) updateTreeItemValue(item, value === ' ' ? '' : value);
      }}
      slots={{ item: StatementTreeItem }}
      sx={{
        '& .MuiRichTreeView-root': {
          minWidth: 0,
        },
        '& .MuiTreeItem-root': {
          minWidth: 0,
        },
      }}
    />
  );
}
