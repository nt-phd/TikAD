import type { AppEvent } from '../types';

type Listener = (event: AppEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(type: string, fn: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(event: AppEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const fn of listeners) fn(event);
    }
    // NOTE: no automatic cascade — each event is dispatched only to its own listeners.
    // This prevents unintended cross-event side effects (e.g. body-changed triggering
    // document-changed which overwrites latexDoc.body with the emitter output).
  }
}
