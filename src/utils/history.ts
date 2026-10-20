/**
 * Linear edit history with undo, redo and jump-to-any-step. Each entry holds the
 * state after a change and a label for the history list. Rapid changes with the
 * same label (typing, dragging a slider) coalesce into one entry.
 */
export interface HistoryEntry<T> {
  label: string;
  at: number;
  state: T;
}

export interface History<T> {
  entries: HistoryEntry<T>[];
  /** index of the entry that matches the current state */
  index: number;
}

export const HISTORY_MAX = 120;

export function initHistory<T>(state: T, label: string, at = Date.now()): History<T> {
  return { entries: [{ label, at, state }], index: 0 };
}

export function pushHistory<T>(h: History<T>, state: T, label: string, at = Date.now(), coalesceMs = 1200): History<T> {
  const current = h.entries[h.index];
  if (current && current.state === state) return h;
  const kept = h.entries.slice(0, h.index + 1);
  const last = kept[kept.length - 1];
  const atTip = h.index === h.entries.length - 1;
  if (last && atTip && last.label === label && at - last.at < coalesceMs && kept.length > 1) {
    kept[kept.length - 1] = { label, at, state };
  } else {
    kept.push({ label, at, state });
  }
  while (kept.length > HISTORY_MAX) kept.shift();
  return { entries: kept, index: kept.length - 1 };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.index > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.index < h.entries.length - 1;
}

export function jumpHistory<T>(h: History<T>, index: number): History<T> {
  if (index < 0 || index >= h.entries.length || index === h.index) return h;
  return { ...h, index };
}

export function undoHistory<T>(h: History<T>): History<T> {
  return jumpHistory(h, h.index - 1);
}

export function redoHistory<T>(h: History<T>): History<T> {
  return jumpHistory(h, h.index + 1);
}

export function currentState<T>(h: History<T>): T {
  return h.entries[h.index].state;
}
