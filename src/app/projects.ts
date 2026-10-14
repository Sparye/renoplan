import { type ProjectStore, memoryStorage, webStore } from '@/persistence';

/** Browser storage, or memory when the browser refuses it (private windows, blocked site data). */
function storage(): Storage {
  try {
    const s = window.localStorage;
    s.setItem('renoplan:probe', '1');
    s.removeItem('renoplan:probe');
    return s;
  } catch {
    return memoryStorage();
  }
}

export const projects: ProjectStore = webStore(storage());

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
