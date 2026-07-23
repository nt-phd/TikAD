import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Box, useTheme } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import CodeMirror from '@uiw/react-codemirror';
import type { EditorView } from '@codemirror/view';
import { lineNumbers } from '@codemirror/view';
import { createCodeMirrorTheme, latexLanguage } from './ui/codeMirrorTheme';

export function DocumentEditor({
  body,
  commitPendingLatexEdits,
  documentEditorRef,
  emitCaretSelection,
  markLatexDirty,
  sx,
  setBody,
}: {
  body: string;
  commitPendingLatexEdits: () => void;
  documentEditorRef: MutableRefObject<EditorView | null>;
  emitCaretSelection: (lineIndices: number[]) => void;
  markLatexDirty: () => void;
  sx?: SxProps<Theme>;
  setBody: (value: string) => void;
}) {
  const activeLineRef = useRef<number | null>(null);
  const theme = useTheme();
  const codeMirrorTheme = useMemo(() => createCodeMirrorTheme(theme), [theme]);

  return (
    <Box id="document-panel" sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, p: 2, ...sx }}>
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
          '& > .cm-theme': {
            height: '100%',
            minWidth: 0,
          },
          '& .cm-editor': {
            backgroundColor: 'background.paper',
            color: 'text.primary',
            fontFamily: '"Roboto Mono", monospace',
            fontSize: 12,
            height: '100%',
            minWidth: 0,
          },
          '& .cm-focused': {
            outline: 'none',
          },
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
            paddingBottom: '48px',
            whiteSpace: 'pre',
            width: 'max-content',
            minWidth: '100%',
          },
          '& .cm-line': {
            whiteSpace: 'pre',
          },
          '& .cm-activeLineGutter': {
            backgroundColor: 'action.hover',
          },
          '& .cm-activeLine': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <CodeMirror
          basicSetup={{
            foldGutter: false,
            highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
          extensions={[lineNumbers(), latexLanguage, ...codeMirrorTheme]}
          height="100%"
          onChange={(value) => {
            markLatexDirty();
            setBody(value);
          }}
          onCreateEditor={(view) => {
            documentEditorRef.current = view;
          }}
          onUpdate={(update) => {
            if (!(update.selectionSet || update.docChanged || update.focusChanged)) return;
            const lineIndex = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
            const previousLineIndex = activeLineRef.current;
            const hasFocus = update.view.hasFocus;
            // Commit only on user-driven line changes (editor has focus) or on focus loss.
            // Programmatic selection changes from canvas drag must not trigger a commit.
            const lineChanged = hasFocus && previousLineIndex !== null && previousLineIndex !== lineIndex;
            const lostFocus = update.focusChanged && !hasFocus;
            if (lineChanged || lostFocus) commitPendingLatexEdits();
            activeLineRef.current = lineIndex;
            if (!hasFocus) return;
            // Ctrl/Cmd+Click adds a range to the selection (CodeMirror's clickAddsSelectionRange
            // default) — surface every range's line so multi-entity selection reaches the canvas.
            const lineIndices = [...new Set(
              update.state.selection.ranges.map((range) => update.state.doc.lineAt(range.head).number - 1),
            )];
            emitCaretSelection(lineIndices);
          }}
          style={{ height: '100%' }}
          value={body}
        />
      </Box>
    </Box>
  );
}
