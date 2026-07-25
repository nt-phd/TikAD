import { debounce } from '../utils/debounce';

export type HistoryEntry = { ts: number; source: string };

type PersistedShape = { version: 1; entries: HistoryEntry[]; cursor: number };

const DEFAULT_CAP = 30;
const DEFAULT_HISTORY_KEY = 'tikad-history';
const DEFAULT_DRAFT_KEY = 'tikad-draft';
const PERSIST_DEBOUNCE_MS = 400;
const LEGACY_DOCUMENT_KEY = 'tikad-document';

function isQuotaExceeded(err: unknown): boolean {
  return err instanceof DOMException
    && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
}

/**
 * Owns the document's undo/redo history and its persistence. `entries[cursor]` is always
 * the current document — there is no separate "current document" blob to fall out of sync.
 */
export class DocumentHistory {
  private entries: HistoryEntry[] = [];
  private cursor = -1;
  private episodeStart = 0;
  private readonly cap: number;
  private readonly historyKey: string;
  private readonly draftKey: string;
  private readonly schedulePersistDebounced: () => void;

  constructor(opts?: { cap?: number; historyKey?: string; draftKey?: string }) {
    this.cap = opts?.cap ?? DEFAULT_CAP;
    this.historyKey = opts?.historyKey ?? DEFAULT_HISTORY_KEY;
    this.draftKey = opts?.draftKey ?? DEFAULT_DRAFT_KEY;
    this.schedulePersistDebounced = debounce(() => this.flush(), PERSIST_DEBOUNCE_MS);
  }

  static loadFromStorage(opts?: { cap?: number; historyKey?: string; draftKey?: string }): DocumentHistory {
    const store = new DocumentHistory(opts);
    try {
      const raw = localStorage.getItem(store.historyKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isPersistedShape(parsed)) {
          store.entries = parsed.entries;
          store.cursor = Math.min(parsed.cursor, parsed.entries.length - 1);
          store.episodeStart = store.entries.length;
          return store;
        }
        if (Array.isArray(parsed) && parsed.every(isHistoryEntry)) {
          // Legacy schema: bare HistoryEntry[], no cursor, document tracked separately.
          store.entries = parsed;
          store.cursor = parsed.length - 1;
          const legacyDoc = safeGetItem(LEGACY_DOCUMENT_KEY);
          if (legacyDoc && legacyDoc !== parsed[parsed.length - 1]?.source) {
            store.entries = [...parsed, { ts: Date.now(), source: legacyDoc }];
            store.cursor = store.entries.length - 1;
          }
          store.episodeStart = store.entries.length;
          store.flush();
          localStorage.removeItem(LEGACY_DOCUMENT_KEY);
          return store;
        }
      }
    } catch (err) {
      console.warn('[DocumentHistory] failed to parse stored history, starting fresh:', err);
      // Overwrite the corrupted value directly (flush() would no-op on an empty store).
      store.writeWithQuotaRetry(() => localStorage.setItem(
        store.historyKey,
        JSON.stringify({ version: 1, entries: [], cursor: -1 } satisfies PersistedShape),
      ));
    }
    // No usable history key — a lone legacy document may still exist (pre-history installs).
    try {
      const legacyDoc = safeGetItem(LEGACY_DOCUMENT_KEY);
      if (legacyDoc) {
        store.entries = [{ ts: Date.now(), source: legacyDoc }];
        store.cursor = 0;
        store.episodeStart = 1;
        store.flush();
        localStorage.removeItem(LEGACY_DOCUMENT_KEY);
      }
    } catch (err) {
      console.warn('[DocumentHistory] failed to migrate legacy document:', err);
    }
    return store;
  }

  getEntries(): readonly HistoryEntry[] {
    return this.entries;
  }

  getCursor(): number {
    return this.cursor;
  }

  getCurrentSource(): string | null {
    return this.entries[this.cursor]?.source ?? null;
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  /** Records a confirmed document mutation. Dedupes no-ops and truncates any redo tail. */
  record(source: string): void {
    const base = this.cursor >= 0 && this.cursor < this.entries.length - 1
      ? this.entries.slice(0, this.cursor + 1)
      : this.entries;
    if (base.length > 0 && base[base.length - 1].source === source) {
      this.entries = base;
      this.cursor = base.length - 1;
      this.schedulePersistDebounced();
      return;
    }
    const next = [...base, { ts: Date.now(), source }];
    if (next.length > this.cap) {
      const dropped = next.length - this.cap;
      next.splice(0, dropped);
      this.episodeStart = Math.max(0, this.episodeStart - dropped);
    }
    this.entries = next;
    this.cursor = next.length - 1;
    this.clearDraft();
    this.schedulePersistDebounced();
  }

  undo(): HistoryEntry | null {
    if (!this.canUndo()) return null;
    this.cursor -= 1;
    this.schedulePersistDebounced();
    return this.entries[this.cursor];
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo()) return null;
    this.cursor += 1;
    this.schedulePersistDebounced();
    return this.entries[this.cursor];
  }

  /** Jumps the cursor to an explicit source (e.g. HistoryView "Restore"), recording it if new. */
  restore(source: string): HistoryEntry {
    const existingIndex = this.entries.findIndex((entry) => entry.source === source);
    if (existingIndex >= 0) {
      this.cursor = existingIndex;
      this.schedulePersistDebounced();
      return this.entries[existingIndex];
    }
    this.record(source);
    return this.entries[this.cursor];
  }

  sliceEpisode(): HistoryEntry[] {
    return this.entries.slice(this.episodeStart);
  }

  markEpisodeConsumed(): void {
    this.episodeStart = this.entries.length;
  }

  /** Synchronous, immediate write — used as the beforeunload/visibilitychange backstop. */
  flush(): void {
    // An empty in-memory store (nothing recorded this session) is never a legitimate reason
    // to blank out existing storage — e.g. it would otherwise clobber a fresh migration.
    if (this.entries.length === 0) return;
    const payload: PersistedShape = { version: 1, entries: this.entries, cursor: this.cursor };
    this.writeWithQuotaRetry(() => localStorage.setItem(this.historyKey, JSON.stringify(payload)));
  }

  /** Writes uncommitted editor text as a recovery draft. Only called from the unload backstop. */
  saveDraft(source: string): void {
    if (source === this.getCurrentSource()) {
      this.clearDraft();
      return;
    }
    const payload = { version: 1, source, ts: Date.now() };
    this.writeWithQuotaRetry(() => localStorage.setItem(this.draftKey, JSON.stringify(payload)));
  }

  loadDraft(): { source: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && typeof (parsed as { source?: unknown }).source === 'string') {
        return parsed as { source: string; ts: number };
      }
    } catch (err) {
      console.warn('[DocumentHistory] failed to parse draft, discarding:', err);
    }
    return null;
  }

  clearDraft(): void {
    try {
      localStorage.removeItem(this.draftKey);
    } catch {
      // best-effort
    }
  }

  private writeWithQuotaRetry(write: () => void): void {
    try {
      write();
    } catch (err) {
      if (isQuotaExceeded(err) && this.entries.length > 1) {
        const keep = Math.max(1, Math.floor(this.entries.length / 2));
        const dropped = this.entries.length - keep;
        this.entries = this.entries.slice(-keep);
        this.cursor = Math.max(0, this.cursor - dropped);
        this.episodeStart = Math.max(0, this.episodeStart - dropped);
        try {
          write();
        } catch (retryErr) {
          console.warn('[DocumentHistory] persist failed even after trimming:', retryErr);
        }
      } else {
        console.warn('[DocumentHistory] persist failed:', err);
      }
    }
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as HistoryEntry).ts === 'number'
    && typeof (value as HistoryEntry).source === 'string';
}

function isPersistedShape(value: unknown): value is PersistedShape {
  return Boolean(value) && typeof value === 'object'
    && (value as PersistedShape).version === 1
    && Array.isArray((value as PersistedShape).entries)
    && (value as PersistedShape).entries.every(isHistoryEntry)
    && typeof (value as PersistedShape).cursor === 'number';
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
