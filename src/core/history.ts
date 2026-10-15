// Snapshot undo/redo. Plans are immutable values, so a snapshot is just a reference.

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

export const LIMIT = 300;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Records a new present. Committing the present itself is a no-op, so no-op commands leave no undo step. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}
