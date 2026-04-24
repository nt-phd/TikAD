import type {
  EditableStatement,
} from '../types';
import { lineIndexFromId } from './CircuiTikZParser';
import { parseStructuredNodeStatement, parseStructuredStatementBody } from './TikzStructuredStatement';

function lineIndexFromLineId(id: string): number {
  const m = id.match(/^line:(\d+)$/);
  return m ? Number.parseInt(m[1], 10) : -1;
}

function extractStatementSource(body: string, id: string): { sourceLineIndex: number; sourceSubIndex: number | null; text: string } | null {
  const lineIndex = lineIndexFromLineId(id);
  const sourceLineIndex = lineIndex >= 0 ? lineIndex : lineIndexFromId(id);
  if (sourceLineIndex < 0) return null;
  const lines = body.split('\n');
  if (sourceLineIndex >= lines.length) return null;
  const selectedLineTrimmed = lines[sourceLineIndex].replace(/%.*$/, '').trim();
  if (!selectedLineTrimmed) return null;

  if ((selectedLineTrimmed.startsWith('(') || selectedLineTrimmed.startsWith('node')) && !selectedLineTrimmed.startsWith('\\')) {
    let commandLineIndex = -1;
    for (let i = sourceLineIndex - 1; i >= 0; i--) {
      const trimmed = lines[i].replace(/%.*$/, '').trim();
      if (!trimmed) continue;
      if (trimmed === ';') break;
      if (/^\\(draw|path)(?:\[([\s\S]*?)\])?\s*$/.test(trimmed)) {
        commandLineIndex = i;
        break;
      }
      if (trimmed.startsWith('\\')) break;
    }
    if (commandLineIndex >= 0) {
      const commandLineMatch = lines[commandLineIndex].trim().match(/^\\(draw|path)(?:\[([\s\S]*?)\])?\s*$/);
      if (commandLineMatch) {
        const entityLines: string[] = [];
        let subIndex = -1;
        for (let i = commandLineIndex + 1; i < lines.length; i++) {
          const stripped = lines[i].replace(/%.*$/, '').trim();
          if (!stripped) continue;
          if (stripped === ';') break;
          if (stripped.startsWith('\\')) break;
          entityLines.push(stripped);
          if (i === sourceLineIndex) subIndex = entityLines.length - 1;
        }
        if (subIndex >= 0) {
          const commandPrefix = `\\${commandLineMatch[1]}${commandLineMatch[2]?.trim() ? `[${commandLineMatch[2].trim()}]` : ''}`;
          return {
            sourceLineIndex: commandLineIndex,
            sourceSubIndex: subIndex,
            text: `${commandPrefix} ${entityLines[subIndex]}`,
          };
        }
      }
    }
  }

  let collected = '';
  for (let i = sourceLineIndex; i < lines.length; i++) {
    const stripped = lines[i].replace(/%.*$/, '').trim();
    if (!stripped && !collected) continue;
    collected += (collected ? '\n' : '') + stripped;
    if (stripped.includes(';')) break;
  }
  const statementText = collected.split(';')[0]?.trim() ?? '';
  if (!statementText) return null;
  return { sourceLineIndex, sourceSubIndex: null, text: statementText };
}

export function getEditableStatementModel(body: string, id: string): EditableStatement | null {
  const extracted = extractStatementSource(body, id);
  if (!extracted) return null;
  const drawPathMatch = extracted.text.match(/^\\(draw|path)(?:\[([\s\S]*?)\])?\s+([\s\S]+)$/);
  if (drawPathMatch) {
    const command = drawPathMatch[1] as EditableStatement['command'];
    const commandOptionsText = drawPathMatch[2]?.trim() || undefined;
    const statementBody = drawPathMatch[3].trim();

    const structured = parseStructuredStatementBody(statementBody);
    if (structured) {
      return {
        command,
        commandOptionsText,
        positionTexts: structured.positionTexts,
        rawStatementText: extracted.text,
        segments: structured.segments,
        sourceLineIndex: extracted.sourceLineIndex,
        sourceSubIndex: extracted.sourceSubIndex ?? undefined,
        selectedId: id,
      };
    }

    return {
      command,
      commandOptionsText,
      positionTexts: [],
      rawStatementText: extracted.text,
      segments: [{ kind: 'raw', rawText: statementBody }],
      sourceLineIndex: extracted.sourceLineIndex,
      sourceSubIndex: extracted.sourceSubIndex ?? undefined,
      selectedId: id,
    };
  }

  const nodeMatch = extracted.text.match(/^\\node\b[\s\S]*$/);
  if (!nodeMatch) return null;
  const structured = parseStructuredNodeStatement(extracted.text.slice('\\'.length));
  if (structured) {
    return {
      command: 'node',
      commandOptionsText: undefined,
      positionTexts: structured.positionTexts,
      rawStatementText: extracted.text,
      segments: structured.segments,
      sourceLineIndex: extracted.sourceLineIndex,
      sourceSubIndex: extracted.sourceSubIndex ?? undefined,
      selectedId: id,
    };
  }
  return null;
}
