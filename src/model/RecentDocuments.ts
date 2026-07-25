export type RecentDoc = { id: string; ts: number };

type PersistedShape = { version: 1; docs: RecentDoc[] };

const DEFAULT_CAP = 20;
const DEFAULT_KEY = 'tikad-recent-docs';

/** Tracks which documents (by id) have been edited and when, for the "Open > Recent" menu. */
export class RecentDocuments {
  private docs: RecentDoc[] = [];
  private readonly cap: number;
  private readonly key: string;

  constructor(opts?: { cap?: number; key?: string }) {
    this.cap = opts?.cap ?? DEFAULT_CAP;
    this.key = opts?.key ?? DEFAULT_KEY;
  }

  static loadFromStorage(opts?: { cap?: number; key?: string }): RecentDocuments {
    const store = new RecentDocuments(opts);
    try {
      const raw = localStorage.getItem(store.key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isPersistedShape(parsed)) {
          store.docs = parsed.docs;
        }
      }
    } catch (err) {
      console.warn('[RecentDocuments] failed to parse stored list, starting fresh:', err);
    }
    return store;
  }

  list(): readonly RecentDoc[] {
    return this.docs;
  }

  /** Records that `id` was just edited, moving it to the top of the list. */
  touch(id: string): void {
    const next = [{ id, ts: Date.now() }, ...this.docs.filter((doc) => doc.id !== id)];
    if (next.length > this.cap) next.length = this.cap;
    this.docs = next;
    this.flush();
  }

  remove(id: string): void {
    this.docs = this.docs.filter((doc) => doc.id !== id);
    this.flush();
  }

  private flush(): void {
    try {
      const payload: PersistedShape = { version: 1, docs: this.docs };
      localStorage.setItem(this.key, JSON.stringify(payload));
    } catch (err) {
      console.warn('[RecentDocuments] persist failed:', err);
    }
  }
}

function isRecentDoc(value: unknown): value is RecentDoc {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as RecentDoc).id === 'string'
    && typeof (value as RecentDoc).ts === 'number';
}

function isPersistedShape(value: unknown): value is PersistedShape {
  return Boolean(value) && typeof value === 'object'
    && (value as PersistedShape).version === 1
    && Array.isArray((value as PersistedShape).docs)
    && (value as PersistedShape).docs.every(isRecentDoc);
}
