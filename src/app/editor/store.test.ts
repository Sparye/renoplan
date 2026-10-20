import { describe, expect, test } from 'vitest';
import { type Plan, addOutline, addRoom, derive, emptyPlan, renameRoom, setRoomSize } from '@/core';
import { type Project, memoryStorage, webStore } from '@/persistence';
import { actions } from './actions';
import { activeApplied, comparedApplied, createEditor, currentPlan, fitView } from './store';

/** Outline 10 × 8 m; Kitchen and Dining side by side sharing a Wall at x = 4250. */
function house() {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const k = addRoom(p, { name: 'Kitchen', w: 4000, l: 3800, x: 200, y: 200 });
  const d = addRoom(k.plan, { name: 'Dining', w: 3000, l: 3800, x: 4300, y: 200 });
  p = d.plan;
  const shared = Object.keys(p.walls).find((w) => p.walls[w]!.neg === k.id && p.walls[w]!.pos === d.id)!;
  return { p, k: k.id!, d: d.id!, shared };
}

function editor(plan: Plan) {
  const store = webStore(memoryStorage());
  const now = new Date().toISOString();
  const project: Project = {
    id: 'p1',
    name: 'Home',
    createdAt: now,
    updatedAt: now,
    existingPlan: plan,
    scenarios: []
  };
  store.save(project);
  let n = 0;
  const useEditor = createEditor(project, store, () => `s${++n}`);
  return { useEditor, store, act: actions(useEditor), st: () => useEditor.getState() };
}

describe('Scenario Mode', () => {
  test('a new Scenario opens empty, and its edits are recorded as Changes, not in the Existing Plan', () => {
    const { p, k, d, shared } = house();
    const { st, act, store } = editor(p);
    st().addScenario();
    expect(st().mode).toEqual({ kind: 'scenario', id: 's1' });
    expect(st().project.scenarios.map((s) => s.name)).toEqual(['Option A']);
    act.removeWall(shared);
    const plan = currentPlan(st());
    expect(Object.keys(plan.rooms)).toHaveLength(1);
    expect(st().history.present).toBe(p);
    expect(st().project.scenarios[0]!.changes.map((c) => c.op)).toEqual(['demolishWall']);
    // Autosaved, with the Change.
    expect(store.load('p1')!.scenarios[0]!.changes).toHaveLength(1);
    // The merged Room is selected.
    expect(st().selection).toEqual({ kind: 'room', id: plan.rooms[k] ? k : d });
  });

  test('undo is per Mode: the Scenario and the Existing Plan each have their own history', () => {
    const { p, k, shared } = house();
    const { st, act } = editor(p);
    st().commit(renameRoom(p, k, 'Galley'));
    st().addScenario();
    act.removeWall(shared);
    st().undo();
    expect(st().project.scenarios[0]!.changes).toEqual([]);
    expect(st().history.present.rooms[k]!.name).toBe('Galley');
    st().redo();
    expect(st().project.scenarios[0]!.changes).toHaveLength(1);
    st().setMode({ kind: 'existing' });
    st().undo();
    expect(st().history.present).toBe(p);
    expect(st().project.scenarios[0]!.changes).toHaveLength(1);
  });

  test('a correction to the Existing Plan flows into the Scenario', () => {
    const { p, k, d, shared } = house();
    const { st, act } = editor(p);
    st().addScenario();
    act.pushWall(shared, 500, 2000);
    expect(derive(currentPlan(st())).rooms[d]!.bounds).toMatchObject({ x0: 4800 });
    st().setMode({ kind: 'existing' });
    st().commit(setRoomSize(st().history.present, k, 4000, 3500));
    st().setMode({ kind: 'scenario', id: 's1' });
    const r = activeApplied(st())!;
    expect(r.conflicts).toEqual([]);
    expect(derive(r.plan).rooms[k]!.bounds).toMatchObject({ y1: 3700 });
  });

  test('Existing Plan edits are refused in a Scenario', () => {
    const { p, k } = house();
    const { st } = editor(p);
    st().addScenario();
    st().commit(setRoomSize(p, k, 3000, 3000));
    expect(st().history.present).toBe(p);
  });

  test('a gesture that changes nothing records nothing', () => {
    const { p, shared } = house();
    const { st, act } = editor(p);
    st().addScenario();
    act.pushWall(shared, 0, 2000);
    expect(st().project.scenarios[0]!.changes).toEqual([]);
    expect(st().scenarios.s1!.past).toEqual([]);
  });

  test('rename, duplicate, remove a Change, delete', () => {
    const { p, shared } = house();
    const { st, act, store } = editor(p);
    st().addScenario();
    act.removeWall(shared);
    st().renameScenario('s1', 'Open plan');
    st().undo();
    // A name is not undone with the edits.
    expect(st().project.scenarios[0]!.name).toBe('Open plan');
    st().redo();
    st().duplicateScenario('s1');
    expect(st().mode).toEqual({ kind: 'scenario', id: 's2' });
    expect(st().project.scenarios.map((s) => [s.name, s.changes.length])).toEqual([
      ['Open plan', 1],
      ['Open plan copy', 1]
    ]);
    st().removeChange(st().project.scenarios[1]!.changes[0]!.id);
    expect(st().project.scenarios[1]!.changes).toEqual([]);
    st().deleteScenario('s2');
    expect(st().mode).toEqual({ kind: 'existing' });
    expect(store.load('p1')!.scenarios.map((s) => s.name)).toEqual(['Open plan']);
    st().addScenario();
    expect(st().project.scenarios.map((s) => s.name)).toEqual(['Open plan', 'Option A']);
  });

  test('Draw Wall and naming the space it closes off', () => {
    const { p, k } = house();
    const { st, act } = editor(p);
    st().addScenario();
    // A Wall across the Kitchen at x = 1200 cuts off 950 mm.
    expect(act.drawWall({ x: 1200, y: 100 }, { x: 1200, y: 4050 })).toBe(true);
    const D = derive(currentPlan(st()));
    expect(D.rooms[k]!.bounds).toMatchObject({ x0: 1250 });
    expect(st().selection).toMatchObject({ kind: 'wall' });
    act.nameSpace(700, 2000, 'Pantry');
    const plan = currentPlan(st());
    const pantry = Object.keys(plan.rooms).find((r) => plan.rooms[r]!.name === 'Pantry')!;
    expect(st().selection).toEqual({ kind: 'room', id: pantry });
    expect(activeApplied(st())!.statuses.rooms[pantry]).toBe('new');
  });

  test('Draw Room and naming it are one Change and one undo step', () => {
    const { p } = house();
    const { st, act } = editor(p);
    st().addScenario();
    expect(act.drawRoom({ x0: 7000, y0: 5000, x1: 9900, y1: 7900 })).toBe(true);
    const sel = st().selection;
    expect(sel?.kind).toBe('room');
    act.renameRoom((sel as { id: string }).id, 'Study');
    expect(st().project.scenarios[0]!.changes).toMatchObject([{ op: 'drawRoom', name: 'Study' }]);
    st().undo();
    expect(st().project.scenarios[0]!.changes).toEqual([]);
  });

  test('deleting a Room turns it into Unlabelled Space, selected; the Existing Plan keeps it', () => {
    const { p, d } = house();
    const { st, act } = editor(p);
    st().addScenario();
    act.removeRoom(d);
    const plan = currentPlan(st());
    expect(plan.rooms[d]).toBeUndefined();
    expect(Object.keys(plan.walls)).toHaveLength(Object.keys(p.walls).length);
    expect(st().history.present.rooms[d]).toBeDefined();
    expect(st().project.scenarios[0]!.changes.map((c) => c.op)).toEqual(['removeRoom']);
    const sel = st().selection;
    expect(sel?.kind).toBe('space');
    const { x, y } = sel as { x: number; y: number };
    expect(derive(plan).spaceAt(x, y)).toBeGreaterThanOrEqual(0);
  });
});

describe('Comparison', () => {
  test('opens on the Existing Plan against the open Scenario, and Done returns to that Mode', () => {
    const { p, shared } = house();
    const { st, act } = editor(p);
    st().addScenario();
    st().addScenario();
    act.removeWall(shared);
    const view = st().view;
    st().openCompare();
    expect(st().compare).toMatchObject({ left: { kind: 'existing' }, right: { kind: 'scenario', id: 's2' } });
    expect(comparedApplied(st(), st().compare!.left)).toBeNull();
    expect(Object.keys(comparedApplied(st(), st().compare!.right)!.plan.rooms)).toHaveLength(1);

    // One shared view, separate from the editor's.
    st().setCompareView((v) => ({ ...v, tx: v.tx + 40 }));
    expect(st().compare!.view.tx).toBe(view.tx + 40);
    expect(st().view).toBe(view);

    st().closeCompare();
    expect(st().compare).toBeNull();
    expect(st().mode).toEqual({ kind: 'scenario', id: 's2' });
    expect(st().view).toBe(view);
  });

  test('from the Existing Plan, it opens on the first Scenario; sides can be any Scenario', () => {
    const { p } = house();
    const { st } = editor(p);
    st().addScenario();
    st().addScenario();
    st().setMode({ kind: 'existing' });
    st().openCompare();
    expect(st().compare!.right).toEqual({ kind: 'scenario', id: 's1' });
    st().setCompareSide('left', { kind: 'scenario', id: 's2' });
    expect(st().compare!.left).toEqual({ kind: 'scenario', id: 's2' });
    st().setCompareSide('left', { kind: 'scenario', id: 'nope' });
    expect(st().compare!.left).toEqual({ kind: 'scenario', id: 's2' });
    st().deleteScenario('s2');
    expect(st().compare!.left).toEqual({ kind: 'existing' });
  });

  test('fit shows both sides in a pane', () => {
    const { p } = house();
    const { st } = editor(p);
    st().addScenario();
    st().openCompare();
    st().setCompareSize({ w: 500, h: 600 });
    st().fitCompare();
    expect(st().compare!.view).toEqual(fitView(p, { w: 500, h: 600 }));
  });
});
