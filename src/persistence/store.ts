import { type Project, VERSION, fromDocument, toDocument } from './document';

// Local-first storage (ADR 0006): every Project lives in the browser. Autosave writes here on every
// committed edit; Save/Open moves Projects between machines as files.

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface ProjectStore {
  list(): ProjectSummary[];
  load(id: string): Project | null;
  save(project: Project): void;
  remove(id: string): void;
}

const INDEX = 'renoplan:projects';
const key = (id: string) => `renoplan:project:${id}`;

/** A ProjectStore over Web Storage. Reads never throw: unreadable data reads as missing. */
export function webStore(storage: Storage): ProjectStore {
  const readIndex = (): ProjectSummary[] => {
    try {
      const v = JSON.parse(storage.getItem(INDEX) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (list: ProjectSummary[]) => storage.setItem(INDEX, JSON.stringify(list));
  return {
    list: () => [...readIndex()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    load(id) {
      try {
        const raw = storage.getItem(key(id));
        if (!raw) return null;
        const r = fromDocument(JSON.parse(raw));
        return r.ok ? r.project : null;
      } catch {
        return null;
      }
    },
    save(project) {
      storage.setItem(key(project.id), JSON.stringify(toDocument(project)));
      const summary = { id: project.id, name: project.name, updatedAt: project.updatedAt };
      writeIndex([summary, ...readIndex().filter((p) => p.id !== project.id)]);
    },
    remove(id) {
      storage.removeItem(key(id));
      writeIndex(readIndex().filter((p) => p.id !== id));
    }
  };
}

/** A Storage that keeps everything in memory: for tests, and when the browser refuses storage. */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v))
  };
}

export { VERSION };
