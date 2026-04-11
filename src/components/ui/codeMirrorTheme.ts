import type { Theme } from '@mui/material/styles';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { stex } from '@codemirror/legacy-modes/mode/stex';

export const latexLanguage = StreamLanguage.define(stex);

export function createCodeMirrorTheme(theme: Theme): Extension[] {
  const dark = theme.palette.mode === 'dark';

  return [
    EditorView.theme({
      '&': {
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.primary,
      },
      '.cm-content': {
        caretColor: theme.palette.text.primary,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: theme.palette.text.primary,
      },
      '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: dark ? 'rgba(144, 202, 249, 0.28)' : 'rgba(25, 118, 210, 0.18)',
      },
      '.cm-gutters': {
        backgroundColor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`,
        color: theme.palette.text.secondary,
      },
      '.cm-activeLine': {
        backgroundColor: theme.palette.action.hover,
      },
      '.cm-activeLineGutter': {
        backgroundColor: theme.palette.action.hover,
      },
    }, { dark }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: [tags.keyword, tags.operatorKeyword], color: dark ? '#ffb86c' : '#8f4a00' },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color: dark ? '#8fbf8f' : '#5f7f5f' },
      { tag: [tags.string, tags.special(tags.string)], color: dark ? '#a5d6ff' : '#005f87' },
      { tag: [tags.number, tags.integer, tags.float], color: dark ? '#f78c6c' : '#b34d00' },
      { tag: [tags.brace, tags.squareBracket, tags.paren], color: theme.palette.text.primary },
      { tag: [tags.variableName, tags.name, tags.attributeName], color: dark ? '#c3e88d' : '#2e7d32' },
      { tag: [tags.atom, tags.bool, tags.null], color: dark ? '#c792ea' : '#6a1b9a' },
      { tag: [tags.meta, tags.processingInstruction], color: dark ? '#82aaff' : '#1565c0' },
    ])),
  ];
}
