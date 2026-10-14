import { create } from 'zustand';
import {
  type Clearance,
  type Guide,
  type History,
  type Mm,
  type OpeningId,
  type Plan,
  type RoomId,
  type WallId,
  commit as commitHistory,
  derive,
  planBounds,
  redo as redoHistory,
  startHistory,
  undo as undoHistory
} from '@/core';
import type { Project, ProjectStore } from '@/persistence';

/** A view that shows the whole plan with a margin, or null for an empty plan. */
export function fitView(plan: Plan, size: { w: number; h: number }): View | null {
  const b = planBounds(plan);
  if (!b) return null;
  const margin = 1500;
  const w = b.x1 - b.x0 + 2 * margin;
  const h = b.y1 - b.y0 + 2 * margin;
  const s = Math.min(size.w / w, size.h / h);
  return {
    s,
    tx: (size.w - (b.x1 - b.x0) * s) / 2 - b.x0 * s,
    ty: (size.h - (b.y1 - b.y0) * s) / 2 - b.y0 * s
  };
}

export type Selection =
  | { kind: 'room'; id: RoomId }
  /** `at` is where along the Wall it was clicked: new Openings go there. */
  | { kind: 'wall'; id: WallId; at: Mm }
  | { kind: 'opening'; id: OpeningId }
  | { kind: 'space'; x: Mm; y: Mm }
  | null;

/** screen px = mm × s + t */
export interface View {
  s: number;
  tx: number;
  ty: number;
}

/** A drag in progress: what the plan would be if the pointer were released now. */
export interface Preview {
  plan: Plan;
  guides: Guide[];
  clearances: Clearance[];
}

interface EditorState {
  project: Project;
  history: History<Plan>;
  selection: Selection;
  preview: Preview | null;
  view: View;
  /** Snap step when nothing is near (ADR 0003). */
  snapStep: Mm;
  /** The canvas size in screen pixels. */
  size: { w: number; h: number };
  setSize(size: { w: number; h: number }): void;
  /** Fits the whole plan in view. */
  fit(): void;
  /** Fits the plan in view only if the rect (mm) is out of view. */
  reveal(r: { x0: number; y0: number; x1: number; y1: number }): void;
  commit(plan: Plan, selection?: Selection): void;
  undo(): void;
  redo(): void;
  select(selection: Selection): void;
  setPreview(preview: Preview | null): void;
  setView(view: View | ((v: View) => View)): void;
  setSnapStep(step: Mm): void;
  rename(name: string): void;
}

/** Drops a selection whose target no longer exists (after an undo, say). */
function live(plan: Plan, s: Selection): Selection {
  if (!s) return null;
  if (s.kind === 'room') return plan.rooms[s.id] ? s : null;
  if (s.kind === 'wall') return plan.walls[s.id] ? s : null;
  if (s.kind === 'opening') return plan.openings[s.id] ? s : null;
  return derive(plan).spaceAt(s.x, s.y) >= 0 ? s : null;
}

/** One editor per open Project. Every committed edit autosaves to the store (ADR 0006). */
export function createEditor(project: Project, store: ProjectStore) {
  const save = (p: Project) => store.save(p);
  return create<EditorState>()((set, get) => {
    const record = (history: History<Plan>, selection: Selection) => {
      const project = {
        ...get().project,
        existingPlan: history.present,
        updatedAt: new Date().toISOString()
      };
      save(project);
      set({ history, project, selection: live(history.present, selection), preview: null });
    };
    return {
      project,
      history: startHistory(project.existingPlan),
      selection: null,
      preview: null,
      view: { s: 0.05, tx: 80, ty: 80 },
      snapStep: 100,
      size: { w: 800, h: 600 },
      setSize: (size) => set({ size }),
      fit() {
        const v = fitView(shownPlan(get()), get().size);
        if (v) set({ view: v });
      },
      reveal(r) {
        const { view, size } = get();
        const sx0 = r.x0 * view.s + view.tx;
        const sy0 = r.y0 * view.s + view.ty;
        const sx1 = r.x1 * view.s + view.tx;
        const sy1 = r.y1 * view.s + view.ty;
        if (sx0 < 0 || sy0 < 0 || sx1 > size.w || sy1 > size.h) get().fit();
      },
      commit(plan, selection) {
        const h = get().history;
        const next = commitHistory(h, plan);
        if (next === h) return set({ preview: null, selection: live(plan, selection ?? get().selection) });
        record(next, selection === undefined ? get().selection : selection);
      },
      undo() {
        const h = get().history;
        if (h.past.length) record(undoHistory(h), get().selection);
      },
      redo() {
        const h = get().history;
        if (h.future.length) record(redoHistory(h), get().selection);
      },
      select: (selection) => set({ selection }),
      setPreview: (preview) => set({ preview }),
      setView: (view) => set((s) => ({ view: typeof view === 'function' ? view(s.view) : view })),
      setSnapStep: (snapStep) => set({ snapStep }),
      rename(name) {
        const n = name.trim();
        if (!n || n === get().project.name) return;
        const project = { ...get().project, name: n, updatedAt: new Date().toISOString() };
        save(project);
        set({ project });
      }
    };
  });
}

export type EditorStore = ReturnType<typeof createEditor>;

/** The plan on screen: the drag preview while dragging, the present otherwise. */
export const shownPlan = (s: EditorState): Plan => s.preview?.plan ?? s.history.present;
