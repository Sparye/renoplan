import { create } from 'zustand';
import {
  type Applied,
  type ChangeId,
  type Clearance,
  type Gesture,
  type Guide,
  type History,
  type Mm,
  type OpeningId,
  type Plan,
  type Rect,
  type RoomId,
  type Scenario,
  type WallId,
  applyScenario,
  commit as commitHistory,
  derive,
  emptyScenario,
  planBounds,
  recordChange,
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

/** The editor's two Modes (CONTEXT.md): the Existing Plan, or one Scenario. */
export type Mode = { kind: 'existing' } | { kind: 'scenario'; id: string };

export type Tool = 'select' | 'drawWall' | 'drawRoom';

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
  /** A Wall being drawn, for its live length. */
  measure?: { a: { x: Mm; y: Mm }; b: { x: Mm; y: Mm } };
  /** A Room being drawn: the rectangle dragged out, and the Room it makes (null if it closes nothing off). */
  drawing?: { rect: Rect; room: Rect | null };
}

export interface EditorState {
  project: Project;
  /** The Existing Plan's undo history. */
  history: History<Plan>;
  /** Each Scenario's own undo history (session only), by Scenario id. */
  scenarios: Record<string, History<Scenario>>;
  mode: Mode;
  tool: Tool;
  /** Scenarios whose Show Changes toggle is off. It is on by default and not stored (ADR 0010). */
  changesHidden: Record<string, boolean>;
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
  /** Commits an edit to the Existing Plan. */
  commit(plan: Plan, selection?: Selection): void;
  /**
   * Records a gesture as a Change in the open Scenario. `select` picks the selection in the Scenario's new
   * plan. Returns false if the gesture changes nothing.
   */
  record(gesture: Gesture, select?: (plan: Plan) => Selection): boolean;
  /** Removes a Change from the open Scenario (undoable). */
  removeChange(id: ChangeId): void;
  undo(): void;
  redo(): void;
  select(selection: Selection): void;
  setPreview(preview: Preview | null): void;
  setView(view: View | ((v: View) => View)): void;
  setSnapStep(step: Mm): void;
  setMode(mode: Mode): void;
  setTool(tool: Tool): void;
  toggleChanges(): void;
  rename(name: string): void;
  /** Starts a new, empty Scenario and opens it. */
  addScenario(): void;
  renameScenario(id: string, name: string): void;
  duplicateScenario(id: string): void;
  deleteScenario(id: string): void;
}

/** Drops a selection whose target no longer exists (after an undo, say). */
function live(plan: Plan, s: Selection): Selection {
  if (!s) return null;
  if (s.kind === 'room') return plan.rooms[s.id] ? s : null;
  if (s.kind === 'wall') return plan.walls[s.id] ? s : null;
  if (s.kind === 'opening') return plan.openings[s.id] ? s : null;
  return derive(plan).spaceAt(s.x, s.y) >= 0 ? s : null;
}

/** The open Scenario, or null in the Existing Plan. */
export function activeScenario(s: Pick<EditorState, 'mode' | 'scenarios'>): Scenario | null {
  return s.mode.kind === 'scenario' ? (s.scenarios[s.mode.id]?.present ?? null) : null;
}

const appliedCache = new WeakMap<Plan, WeakMap<Scenario, Applied>>();

/** A Scenario over the Existing Plan, memoised per pair so selectors return stable values. */
export function applied(existing: Plan, scenario: Scenario): Applied {
  let m = appliedCache.get(existing);
  if (!m) appliedCache.set(existing, (m = new WeakMap()));
  let a = m.get(scenario);
  if (!a) m.set(scenario, (a = applyScenario(existing, scenario)));
  return a;
}

/** The open Scenario applied to the Existing Plan, or null in the Existing Plan. */
export function activeApplied(s: Pick<EditorState, 'mode' | 'scenarios' | 'history'>): Applied | null {
  const sc = activeScenario(s);
  return sc ? applied(s.history.present, sc) : null;
}

/** The plan being edited: the Existing Plan, or the open Scenario's plan. */
export const currentPlan = (s: Pick<EditorState, 'mode' | 'scenarios' | 'history'>): Plan =>
  activeApplied(s)?.plan ?? s.history.present;

/** The plan on screen: the drag preview while dragging, the current plan otherwise. */
export const shownPlan = (s: EditorState): Plan => s.preview?.plan ?? currentPlan(s);

/** "Option A", "Option B", … the first letter not taken. */
function nextName(scenarios: readonly Scenario[]): string {
  const taken = new Set(scenarios.map((s) => s.name));
  for (let i = 0; ; i++) {
    const letter = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
    if (!taken.has(`Option ${letter}`)) return `Option ${letter}`;
  }
}

/** One editor per open Project. Every committed edit autosaves to the store (ADR 0006). */
export function createEditor(project: Project, store: ProjectStore, newId: () => string) {
  const save = (p: Project) => store.save(p);
  return create<EditorState>()((set, get) => {
    const stamp = (p: Partial<Project>): Project => ({
      ...get().project,
      ...p,
      updatedAt: new Date().toISOString()
    });
    /** Saves the Project with the Scenarios as their histories stand, in the Project's order. */
    const withScenarios = (histories: Record<string, History<Scenario>>, order = get().project.scenarios) =>
      stamp({ scenarios: order.filter((s) => histories[s.id]).map((s) => histories[s.id]!.present) });

    const recordExisting = (history: History<Plan>, selection: Selection) => {
      const project = stamp({ existingPlan: history.present });
      save(project);
      set({ history, project, preview: null });
      set({ selection: live(currentPlan(get()), selection) });
    };
    const recordScenario = (id: string, h: History<Scenario>, selection: Selection) => {
      const scenarios = { ...get().scenarios, [id]: h };
      const project = withScenarios(scenarios);
      save(project);
      set({ scenarios, project, preview: null });
      set({ selection: live(currentPlan(get()), selection) });
    };

    return {
      project,
      history: startHistory(project.existingPlan),
      scenarios: Object.fromEntries(project.scenarios.map((s) => [s.id, startHistory(s)])),
      mode: { kind: 'existing' },
      tool: 'select',
      changesHidden: {},
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
        if (get().mode.kind !== 'existing') return;
        const h = get().history;
        const next = commitHistory(h, plan);
        const sel = selection === undefined ? get().selection : selection;
        if (next === h) return set({ preview: null, selection: live(plan, sel) });
        recordExisting(next, sel);
      },
      record(gesture, select) {
        const { mode, history } = get();
        const sc = activeScenario(get());
        if (mode.kind !== 'scenario' || !sc) return false;
        const r = recordChange(history.present, sc, gesture);
        if (!r) {
          set({ preview: null });
          return false;
        }
        const h0 = get().scenarios[mode.id]!;
        // A gesture folded into the last Change (naming a Room just drawn) is part of that undo step.
        const folded = r.scenario.changes.length === sc.changes.length;
        const h = folded ? { ...h0, present: r.scenario, future: [] } : commitHistory(h0, r.scenario);
        const plan = applied(history.present, r.scenario).plan;
        recordScenario(mode.id, h, select ? select(plan) : get().selection);
        return true;
      },
      removeChange(id) {
        const { mode } = get();
        const sc = activeScenario(get());
        if (mode.kind !== 'scenario' || !sc) return;
        const next = { ...sc, changes: sc.changes.filter((c) => c.id !== id) };
        recordScenario(mode.id, commitHistory(get().scenarios[mode.id]!, next), get().selection);
      },
      undo() {
        const { mode } = get();
        if (mode.kind === 'scenario') {
          const h = get().scenarios[mode.id];
          if (h?.past.length) recordScenario(mode.id, undoHistory(h), get().selection);
          return;
        }
        const h = get().history;
        if (h.past.length) recordExisting(undoHistory(h), get().selection);
      },
      redo() {
        const { mode } = get();
        if (mode.kind === 'scenario') {
          const h = get().scenarios[mode.id];
          if (h?.future.length) recordScenario(mode.id, redoHistory(h), get().selection);
          return;
        }
        const h = get().history;
        if (h.future.length) recordExisting(redoHistory(h), get().selection);
      },
      select: (selection) => set({ selection }),
      setPreview: (preview) => set({ preview }),
      setView: (view) => set((s) => ({ view: typeof view === 'function' ? view(s.view) : view })),
      setSnapStep: (snapStep) => set({ snapStep }),
      setMode(mode) {
        if (mode.kind === 'scenario' && !get().scenarios[mode.id]) return;
        set({ mode, selection: null, preview: null, tool: 'select' });
      },
      setTool: (tool) => set({ tool, preview: null }),
      toggleChanges() {
        const { mode, changesHidden } = get();
        if (mode.kind !== 'scenario') return;
        set({ changesHidden: { ...changesHidden, [mode.id]: !changesHidden[mode.id] } });
      },
      rename(name) {
        const n = name.trim();
        if (!n || n === get().project.name) return;
        const project = stamp({ name: n });
        save(project);
        set({ project });
      },
      addScenario() {
        const s = emptyScenario(newId(), nextName(get().project.scenarios));
        const scenarios = { ...get().scenarios, [s.id]: startHistory(s) };
        const project = withScenarios(scenarios, [...get().project.scenarios, s]);
        save(project);
        set({ scenarios, project });
        get().setMode({ kind: 'scenario', id: s.id });
      },
      renameScenario(id, name) {
        const n = name.trim();
        const h = get().scenarios[id];
        if (!n || !h || n === h.present.name) return;
        // A name is not an edit to undo: every snapshot takes it.
        const named = (s: Scenario) => ({ ...s, name: n });
        const scenarios = {
          ...get().scenarios,
          [id]: { past: h.past.map(named), present: named(h.present), future: h.future.map(named) }
        };
        const project = withScenarios(scenarios);
        save(project);
        set({ scenarios, project });
      },
      duplicateScenario(id) {
        const h = get().scenarios[id];
        if (!h) return;
        const order = get().project.scenarios;
        const copy: Scenario = { ...structuredClone(h.present), id: newId(), name: `${h.present.name} copy` };
        const i = order.findIndex((s) => s.id === id);
        const scenarios = { ...get().scenarios, [copy.id]: startHistory(copy) };
        const project = withScenarios(scenarios, [...order.slice(0, i + 1), copy, ...order.slice(i + 1)]);
        save(project);
        set({ scenarios, project });
        get().setMode({ kind: 'scenario', id: copy.id });
      },
      deleteScenario(id) {
        if (!get().scenarios[id]) return;
        const scenarios = { ...get().scenarios };
        delete scenarios[id];
        const project = withScenarios(scenarios);
        save(project);
        set({ scenarios, project });
        const { mode } = get();
        if (mode.kind === 'scenario' && mode.id === id) get().setMode({ kind: 'existing' });
      }
    };
  });
}

export type EditorStore = ReturnType<typeof createEditor>;
