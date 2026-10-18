import { describe, expect, test } from 'vitest';
import {
  addOpening,
  addOutline,
  addRoom,
  deleteOpening,
  deleteRoom,
  mergeRooms,
  moveRoom,
  nameSpace,
  pushWall,
  renameRoom,
  setRoomSize,
  setWallThickness,
  updateOpening
} from '../commands';
import { derive } from '../derive';
import { normalizePlan } from '../normalize';
import { type Plan, type RoomId, type WallId, clonePlan, emptyPlan, wallLine } from '../plan';
import { valid } from '../test/helpers';
import { type Change, type Gesture, type Scenario, changeKind, emptyScenario } from './model';
import { resolveWall, wallRef } from './refs';
import { applyScenario, recordChange } from './replay';
import { type Stretch, union } from './status';

/**
 * Outline 10 × 8 m. Kitchen (4 × 3.8 m) and Dining (3 × 3.8 m) side by side along the top, sharing a Wall
 * at x = 4250; Bedroom (3 × 3 m) under the Kitchen, sharing a Wall at y = 4050.
 */
function house() {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const k = addRoom(p, { name: 'Kitchen', w: 4000, l: 3800, x: 200, y: 200 });
  const d = addRoom(k.plan, { name: 'Dining', w: 3000, l: 3800, x: 4300, y: 200 });
  const b = addRoom(d.plan, { name: 'Bedroom', w: 3000, l: 3000, x: 200, y: 4100 });
  p = valid(b.plan);
  return { p, k: k.id!, d: d.id!, b: b.id! };
}

/** The Wall with these Rooms on its faces. */
function between(p: Plan, neg: RoomId | null, pos: RoomId | null): WallId {
  const id = Object.keys(p.walls).find((w) => p.walls[w]!.neg === neg && p.walls[w]!.pos === pos);
  if (!id) throw new Error(`no wall ${neg}|${pos}`);
  return id;
}

/** A Wall on a centreline, if any. */
const wallOn = (p: Plan, axis: 'h' | 'v', c: number) =>
  Object.keys(p.walls).find((id) => {
    const l = wallLine(p, p.walls[id]!);
    return l.axis === axis && l.c === c;
  });

/** Records gestures in turn, each on the Scenario's plan as it stands. */
function scenario(existing: Plan, ...gestures: ((plan: Plan) => Gesture)[]): Scenario {
  let s = emptyScenario('s1', 'Option A');
  for (const g of gestures) {
    const r = recordChange(existing, s, g(applyScenario(existing, s).plan));
    if (!r) throw new Error(`gesture did nothing: ${JSON.stringify(g(applyScenario(existing, s).plan))}`);
    s = r.scenario;
  }
  return s;
}

/** Replays without the memo, as after reopening the Project. */
const fresh = (existing: Plan, s: Scenario) => applyScenario(clonePlan(existing), structuredClone(s));

const total = (s: readonly Stretch[]) => s.reduce((n, x) => n + x.t1 - x.t0, 0);
const demolishedLength = (r: ReturnType<typeof applyScenario>) =>
  Object.values(r.statuses.demolished).reduce((n, s) => n + total(s), 0);
const newLength = (r: ReturnType<typeof applyScenario>) =>
  Object.values(r.statuses.walls).reduce((n, s) => n + total(s.filter((x) => x.status === 'new')), 0);

describe('an empty Scenario', () => {
  test('is the Existing Plan, all Retained', () => {
    const { p } = house();
    const r = applyScenario(p, emptyScenario('s1', 'Nothing'));
    expect(r.plan).toBe(p);
    expect(r.conflicts).toEqual([]);
    expect(
      Object.values(r.statuses.walls)
        .flat()
        .every((s) => s.status === 'retained')
    ).toBe(true);
    expect(r.statuses.demolished).toEqual({});
    expect(Object.values(r.statuses.rooms).every((s) => s === 'retained')).toBe(true);
    expect(r.statuses.demolishedRooms).toEqual([]);
  });

  test('picks up Existing Plan corrections', () => {
    const { p, k } = house();
    const s = scenario(p, () => ({ op: 'drawWall', a: { x: 8000, y: 100 }, b: { x: 8000, y: 3000 } }));
    const fixed = renameRoom(p, k, 'Galley');
    expect(applyScenario(fixed, s).plan.rooms[k]!.name).toBe('Galley');
  });
});

describe('each gesture', () => {
  test('demolishing a Shared Wall merges the Rooms; the Wall is Demolished', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }));
    expect(s.changes[0]).toMatchObject({
      op: 'demolishWall',
      keep: k,
      wall: { axis: 'v', c: 4250, neg: k, pos: d }
    });
    expect(changeKind(s.changes[0]!)).toBe('demolished');
    const r = applyScenario(p, s);
    valid(r.plan);
    expect(r.plan.rooms[d]).toBeUndefined();
    expect(derive(r.plan).rooms[k]!.area).toBe(
      derive(p).rooms[k]!.area + derive(p).rooms[d]!.area + 100 * 3800
    );
    expect(r.statuses.demolishedRooms).toEqual([d]);
    expect(r.statuses.demolished[between(p, k, d)]).toEqual([{ t0: 100, t1: 4050 }]);
    expect(newLength(r)).toBe(0);
  });

  test('demolishing a drawn Wall removes just that stretch', () => {
    const { p } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8000, y: 100 }, b: { x: 8000, y: 7900 } }),
      (q) => ({ op: 'demolishWall', wall: wallOn(q, 'v', 8000)! })
    );
    const r = applyScenario(p, s);
    expect(r.conflicts).toEqual([]);
    expect(wallOn(r.plan, 'v', 8000)).toBeUndefined();
    expect(normalizePlan(r.plan)).toEqual(r.plan);
  });

  test("demolishing a Room's only boundary to open floor does nothing, so it is not recorded", () => {
    const { p, d } = house();
    const right = Object.keys(p.walls).find((id) => p.walls[id]!.neg === d && !p.walls[id]!.pos)!;
    expect(recordChange(p, emptyScenario('s', 'x'), { op: 'demolishWall', wall: right })).toBeNull();
  });

  test('drawing a Wall makes it New', () => {
    const { p } = house();
    const s = scenario(p, () => ({ op: 'drawWall', a: { x: 8000, y: 100 }, b: { x: 8000, y: 7900 } }));
    expect(changeKind(s.changes[0]!)).toBe('new');
    const r = applyScenario(p, s);
    valid(r.plan);
    const drawn = Object.keys(r.plan.walls).filter((id) => r.plan.walls[id]!.drawn);
    expect(drawn.length).toBeGreaterThan(0);
    for (const id of drawn) expect(r.statuses.walls[id]!.every((x) => x.status === 'new')).toBe(true);
    expect(newLength(r)).toBe(7800);
    expect(r.statuses.demolished).toEqual({});
  });

  test('pushing a Wall is Modified: Demolished where it was, New where it went', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'pushWall', wall: between(q, k, d), delta: 600 }));
    expect(changeKind(s.changes[0]!)).toBe('modified');
    const r = applyScenario(p, s);
    valid(r.plan);
    expect(wallOn(r.plan, 'v', 4850)).toBeDefined();
    expect(wallOn(r.plan, 'v', 4250)).toBeUndefined();
    expect(r.statuses.demolished[between(p, k, d)]).toEqual([{ t0: 100, t1: 4050 }]);
    expect(r.statuses.walls[wallOn(r.plan, 'v', 4850)!]).toEqual([{ t0: 100, t1: 4050, status: 'new' }]);
  });

  test('changing thickness is Modified', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'setThickness', wall: between(q, k, d), thickness: 200 }));
    const r = applyScenario(p, s);
    expect(r.plan.walls[wallOn(r.plan, 'v', 4250)!]!.thickness).toBe(200);
    expect(demolishedLength(r)).toBeGreaterThan(0);
  });

  test('adding, changing and removing Openings', () => {
    const { p, k, d } = house();
    const door = addOpening(p, between(p, k, d), 'door', 2000);
    const e = door.plan;
    const s = scenario(
      e,
      (q) => ({ op: 'addOpening', wall: between(q, k, null), kind: 'window', center: 2000 }),
      () => ({ op: 'removeOpening', opening: door.id! })
    );
    expect(s.changes.map(changeKind)).toEqual(['new', 'demolished']);
    const r = applyScenario(e, s);
    valid(r.plan);
    expect(r.plan.openings[door.id!]).toBeUndefined();
    expect(r.statuses.demolishedOpenings).toEqual([door.id!]);
    const [win] = Object.keys(r.plan.openings);
    expect(r.statuses.openings[win!]).toBe('new');

    const moved = scenario(e, () => ({
      op: 'modifyOpening',
      opening: door.id!,
      patch: { at: 900, width: 860 }
    }));
    expect(moved.changes[0]).toMatchObject({ opening: door.id! });
    const m = applyScenario(e, moved);
    expect(m.plan.openings[door.id!]).toMatchObject({ at: 900, width: 860 });
    expect(m.statuses.openings[door.id!]).toBe('new');
    expect(m.statuses.demolishedOpenings).toEqual([door.id!]);
  });

  test('naming a space makes a New Room; renaming and retyping are Modified', () => {
    const { p, d } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
      () => ({ op: 'nameSpace', x: 9200, y: 4000, name: 'Studio' }),
      () => ({ op: 'renameRoom', room: d, name: 'Library' }),
      () => ({ op: 'setRoomType', room: d, type: 'bedroom' })
    );
    expect(s.changes.map(changeKind)).toEqual(['new', 'new', 'modified', 'modified']);
    const r = applyScenario(p, s);
    valid(r.plan);
    const studio = Object.keys(r.plan.rooms).find((id) => r.plan.rooms[id]!.name === 'Studio')!;
    expect(r.statuses.rooms[studio]).toBe('new');
    expect(r.plan.rooms[d]).toEqual({ name: 'Library', type: 'bedroom' });
    expect(r.statuses.rooms[d]).toBe('retained');
  });

  test('a gesture that does nothing, or names nothing, is not recorded', () => {
    const { p, k } = house();
    const s0 = emptyScenario('s', 'x');
    expect(recordChange(p, s0, { op: 'renameRoom', room: k, name: 'Kitchen' })).toBeNull();
    expect(recordChange(p, s0, { op: 'renameRoom', room: 'r999', name: 'Nope' })).toBeNull();
    expect(recordChange(p, s0, { op: 'pushWall', wall: 'w999', delta: 100 })).toBeNull();
    expect(recordChange(p, s0, { op: 'removeOpening', opening: 'o999' })).toBeNull();
    expect(recordChange(p, s0, { op: 'nameSpace', x: -5000, y: -5000, name: 'Void' })).toBeNull();
    expect(recordChange(p, s0, { op: 'drawWall', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } })).toBeNull();
  });

  test('a gesture that only renumbers Walls is not recorded', () => {
    const { p, k, d } = house();
    // Pushing by nothing detaches and re-fuses the Rooms: new ids, nothing visible.
    expect(pushWall(p, between(p, k, d), 0)).not.toBe(p);
    expect(
      recordChange(p, emptyScenario('s', 'x'), { op: 'pushWall', wall: between(p, k, d), delta: 0 })
    ).toBeNull();
  });

  test('change ids are minted from the Scenario', () => {
    const { p, k } = house();
    const s = scenario(
      p,
      () => ({ op: 'renameRoom', room: k, name: 'A' }),
      () => ({ op: 'renameRoom', room: k, name: 'B' })
    );
    expect(s.changes.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(s.nextId).toBe(3);
  });
});

describe('Existing Plan edits that renumber Walls do not disturb a Scenario', () => {
  const demolishKD = (p: Plan, k: RoomId, d: RoomId) =>
    scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }));

  test('moving a Room by nothing', () => {
    const { p, k, d, b } = house();
    const s = demolishKD(p, k, d);
    const e = moveRoom(p, b, 0, 0);
    const before = applyScenario(p, s);
    const after = applyScenario(e, s);
    expect(after.conflicts).toEqual([]);
    expect(derive(after.plan).rooms[k]!.area).toBe(derive(before.plan).rooms[k]!.area);
  });

  test('resizing a neighbour rebuilds its Walls with new ids', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'pushWall', wall: between(q, k, d), delta: -500 }));
    const e = valid(setRoomSize(p, d, 3000, 3000));
    // The Dining Room's Walls were rebuilt: none of its old ids remain.
    const old = Object.keys(p.walls).filter((id) => p.walls[id]!.neg === d || p.walls[id]!.pos === d);
    expect(
      old.filter((id) => e.walls[id] && (e.walls[id]!.neg === d || e.walls[id]!.pos === d)).length
    ).toBeLessThan(old.length);
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(wallOn(r.plan, 'v', 3750)).toBeDefined();
  });

  test('a T-junction splitting the target Wall', () => {
    const { p, k, b } = house();
    const s = scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, b) }));
    // A second Room under the Kitchen meets the Kitchen|Bedroom Wall from below, splitting it.
    const e = valid(addRoom(p, { name: 'Bath', w: 900, l: 3000, x: 3300, y: 4100 }).plan);
    expect(Object.keys(e.walls).filter((id) => wallLine(e, e.walls[id]!).c === 4050).length).toBeGreaterThan(
      1
    );
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(r.plan.rooms[b]).toBeUndefined();
  });

  test('a corrected thickness', () => {
    const { p, k, d } = house();
    const s = demolishKD(p, k, d);
    const e = valid(setWallThickness(p, between(p, k, d), 150));
    expect(applyScenario(e, s).conflicts).toEqual([]);
  });
});

describe('a Wall that moved in the Existing Plan', () => {
  test('is followed, and a push stays relative', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'pushWall', wall: between(q, k, d), delta: 600 }));
    const e = valid(pushWall(p, between(p, k, d), 50));
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(wallOn(r.plan, 'v', 4900)).toBeDefined();
  });

  test('is followed by a demolition', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }));
    const e = valid(pushWall(p, between(p, k, d), -300));
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(r.plan.rooms[d]).toBeUndefined();
  });

  test("is followed when a Room's boundary leaves the measured Outline, which stays put", () => {
    const { p, k } = house();
    const top = (q: Plan) =>
      Object.keys(q.walls).find((id) => q.walls[id]!.pos === k && wallLine(q, q.walls[id]!).axis === 'h')!;
    const s = scenario(p, (q) => ({ op: 'pushWall', wall: top(q), delta: 300 }));
    // A correction: the Kitchen is 50 mm shorter. The exterior Wall stays; the Kitchen gets its own Wall.
    const e = valid(pushWall(p, top(p), 50));
    expect(wallOn(e, 'h', 100)).toBeDefined();
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    const b = derive(r.plan).rooms[k]!.bounds!;
    expect(b.y1 - b.y0).toBe(3800 - 50 - 300);
  });

  test('is ambiguous when more than one Wall could be it', () => {
    // A merged Room with a step on its right: two right-hand Walls, each with the Room on its left face.
    let p = emptyPlan();
    const a = addRoom(p, { name: 'A', w: 3000, l: 2000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 2000, x: 0, y: 2100 });
    p = valid(mergeRooms(b.plan, between(b.plan, a.id!, b.id!)).plan);
    const ref = { axis: 'v' as const, c: 2550, t0: 0, t1: 4100, neg: a.id!, pos: null };
    expect(resolveWall(p, ref, (t) => (typeof t === 'string' ? t : null))).toEqual({ conflict: 'ambiguous' });
  });

  test('has vanished when nothing on its line or bounding its Rooms is left', () => {
    const { p } = house();
    const parked = addRoom(p, { name: 'Shed', w: 2000, l: 2000 });
    const e0 = valid(parked.plan);
    const s = scenario(e0, (q) => ({ op: 'pushWall', wall: between(q, parked.id!, null), delta: 500 }));
    const e = valid(deleteRoom(e0, parked.id!));
    expect(applyScenario(e, s).conflicts).toEqual([{ change: 'c1', reason: 'vanished' }]);
  });
});

describe('an Opening added by a Scenario', () => {
  test('moves to the next piece when an Existing Plan edit cuts a sliver off where its centre was', () => {
    // Two Rooms side by side; the door goes at the top end of the Wall between them.
    const a = addRoom(emptyPlan(), { name: 'A', w: 600, l: 650, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 600, l: 600, x: 700, y: 0 });
    const p = valid(b.plan);
    const s = scenario(p, (q) => ({
      op: 'addOpening',
      wall: between(q, a.id!, b.id!),
      kind: 'door',
      center: -50
    }));
    // A's top Wall comes down 50 mm: the Wall between them is cut at A's new corner, leaving a sliver on top.
    const e = valid(pushWall(p, between(p, null, a.id!), 50));
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(Object.keys(r.plan.openings)).toHaveLength(1);
  });
});

describe('Conflicts', () => {
  test('a Change the Existing Plan has since made itself is satisfied, not a Conflict', () => {
    const { p, k, d } = house();
    const door = addOpening(p, between(p, k, d), 'door', 2000);
    const s = scenario(
      door.plan,
      () => ({ op: 'renameRoom', room: k, name: 'Galley' }),
      () => ({ op: 'modifyOpening', opening: door.id!, patch: { width: 710 } })
    );
    const e = updateOpening(renameRoom(door.plan, k, 'Galley'), door.id!, { width: 710 });
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(r.plan.rooms[k]!.name).toBe('Galley');
  });

  test('a Change that no longer makes anything is rejected; the rest still apply', () => {
    const { p, k, b } = house();
    const s = scenario(
      p,
      () => ({ op: 'nameSpace', x: 8500, y: 4000, name: 'Studio' }),
      (q) => ({ op: 'demolishWall', wall: between(q, k, b) })
    );
    const r = applyScenario(nameSpace(p, 8500, 4000, 'Porch').plan, s);
    expect(r.conflicts).toEqual([{ change: 'c1', reason: 'rejected' }]);
    expect(r.plan.rooms[b]).toBeUndefined();
  });

  test('a Room deleted from the Existing Plan makes its Changes vanish', () => {
    const { p, d } = house();
    const s = scenario(p, () => ({ op: 'renameRoom', room: d, name: 'Library' }));
    expect(applyScenario(deleteRoom(p, d), s).conflicts).toEqual([{ change: 'c1', reason: 'vanished' }]);
  });

  test('an Opening deleted from the Existing Plan makes its Changes vanish', () => {
    const { p, k, d } = house();
    const door = addOpening(p, between(p, k, d), 'door', 2000);
    const s = scenario(door.plan, () => ({ op: 'modifyOpening', opening: door.id!, patch: { width: 710 } }));
    expect(applyScenario(deleteOpening(door.plan, door.id!), s).conflicts).toEqual([
      { change: 'c1', reason: 'vanished' }
    ]);
  });

  test('a demolition whose Rooms no longer share the Wall is rejected', () => {
    const { p, k, d } = house();
    const s = scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }));
    expect(applyScenario(deleteRoom(p, d), s).conflicts).toEqual([{ change: 'c1', reason: 'rejected' }]);
  });

  test('cascade: a Change on something a Conflict would have created vanishes too', () => {
    const { p } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
      () => ({ op: 'nameSpace', x: 9200, y: 4000, name: 'Studio' }),
      (q) => ({
        op: 'setRoomType',
        room: Object.keys(q.rooms).find((id) => q.rooms[id]!.name === 'Studio')!,
        type: 'bedroom'
      })
    );
    expect(s.changes[2]).toMatchObject({ room: { created: 'c2' } });
    // The user captures a Room on that floor in the Existing Plan, so there is no Unlabelled Space to name.
    const e = valid(addRoom(p, { name: 'Den', w: 800, l: 1500, x: 8800, y: 3300 }).plan);
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([
      { change: 'c2', reason: 'rejected' },
      { change: 'c3', reason: 'vanished' }
    ]);
    valid(r.plan);
  });

  test('a Scenario of nonsense is all Conflicts and never throws', () => {
    const { p } = house();
    const ref = { axis: 'h' as const, c: -999, t0: 0, t1: 1, neg: 'r404', pos: { created: 'c404' } };
    const changes: Change[] = [
      { id: 'c1', op: 'demolishWall', wall: ref, keep: 'r404' },
      { id: 'c2', op: 'pushWall', wall: ref, delta: 10, outline: false },
      { id: 'c3', op: 'addOpening', wall: ref, kind: 'door', center: 0 },
      { id: 'c4', op: 'modifyOpening', opening: { created: 'c1' }, patch: { at: 3 } },
      { id: 'c5', op: 'renameRoom', room: 'r404', name: 'x' },
      { id: 'c6', op: 'drawWall', a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, thickness: 100 },
      { id: 'c7', op: 'nameSpace', x: 1e9, y: 1e9, name: 'x' }
    ];
    const r = applyScenario(p, { id: 's', name: 'junk', changes, nextId: 8 });
    expect(r.plan).toBe(p);
    expect(r.conflicts.map((c) => c.change)).toEqual(changes.map((c) => c.id));
  });
});

describe('ids minted during a replay', () => {
  test('drift with the Existing Plan, so Changes on created things point at the Change instead', () => {
    const { p } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
      (q) => ({ op: 'addOpening', wall: wallOn(q, 'v', 8500)!, kind: 'door', center: 3000 }),
      (q) => ({
        op: 'modifyOpening',
        opening: Object.keys(q.openings).find((id) => !p.openings[id])!,
        patch: { width: 710 }
      })
    );
    expect(s.changes[2]).toMatchObject({ opening: { created: 'c2' } });
    const before = applyScenario(p, s);
    // The user adds a Room and an Opening to the Existing Plan: its id counter moves on.
    let e = addRoom(p, { name: 'Shed', w: 2000, l: 2000 }).plan;
    e = addOpening(e, Object.keys(e.walls)[0]!, 'window', 500).plan;
    const after = applyScenario(e, s);
    expect(after.conflicts).toEqual([]);
    const created = (r: typeof before, q: Plan) =>
      Object.keys(r.plan.openings).filter((id) => !q.openings[id]);
    // The created door has a different id now, and is still the one that was narrowed.
    expect(created(after, e)).not.toEqual(created(before, p));
    expect(after.plan.openings[created(after, e)[0]!]!.width).toBe(710);
    // The Existing Plan's own new Opening is untouched.
    for (const id of Object.keys(e.openings)) expect(after.plan.openings[id]).toEqual(e.openings[id]);
  });

  test('a Room created by the Scenario keeps its Changes when the Existing Plan grows', () => {
    const { p } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
      () => ({ op: 'nameSpace', x: 9200, y: 4000, name: 'Studio' }),
      (q) => ({
        op: 'renameRoom',
        room: Object.keys(q.rooms).find((id) => q.rooms[id]!.name === 'Studio')!,
        name: 'Office'
      })
    );
    const e = addRoom(p, { name: 'Shed', w: 2000, l: 2000 }).plan;
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(Object.values(r.plan.rooms).map((x) => x.name)).toContain('Office');
    expect(r.plan.rooms[Object.keys(e.rooms).find((id) => e.rooms[id]!.name === 'Shed')!]!.name).toBe('Shed');
  });
});

describe('a demolition that merges Rooms', () => {
  test('keeps the Room it kept when recorded, even after a resize makes the other larger', () => {
    const { p, k, d } = house();
    const s = scenario(
      p,
      (q) => ({ op: 'demolishWall', wall: between(q, k, d) }),
      () => ({ op: 'renameRoom', room: k, name: 'Living' })
    );
    expect(s.changes[0]).toMatchObject({ keep: k });
    // Dining becomes the larger Room; merging by area alone would keep it instead.
    const e = valid(setRoomSize(p, d, 5500, 3800));
    expect(derive(e).rooms[d]!.area).toBeGreaterThan(derive(e).rooms[k]!.area);
    expect(mergeRooms(e, between(e, k, d)).id).toBe(d);
    const r = applyScenario(e, s);
    expect(r.conflicts).toEqual([]);
    expect(r.plan.rooms[k]!.name).toBe('Living');
    expect(r.plan.rooms[d]).toBeUndefined();
  });

  test('falls back to the larger Room when the kept one is gone, and Changes on it vanish', () => {
    const { p, k, d } = house();
    const wall = wallRef(p, between(p, k, d), (r) => r);
    const s: Scenario = {
      id: 's',
      name: 'x',
      nextId: 3,
      changes: [
        { id: 'c1', op: 'demolishWall', wall, keep: 'r404' },
        { id: 'c2', op: 'renameRoom', room: 'r404', name: 'Living' }
      ]
    };
    const r = applyScenario(p, s);
    expect(r.plan.rooms[d]).toBeUndefined();
    expect(r.plan.rooms[k]!.name).toBe('Kitchen');
    expect(r.conflicts).toEqual([{ change: 'c2', reason: 'vanished' }]);
  });
});

describe('replay', () => {
  test('is deterministic: reopening gives the same plan', () => {
    const { p, k, d } = house();
    const s = scenario(
      p,
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
      (q) => ({ op: 'demolishWall', wall: between(q, k, d) }),
      (q) => ({ op: 'addOpening', wall: wallOn(q, 'v', 8500)!, kind: 'door', center: 3000 })
    );
    expect(fresh(p, s).plan).toEqual(applyScenario(p, s).plan);
  });

  test('is memoised per Existing Plan and Scenario', () => {
    const { p, k } = house();
    const s = scenario(p, () => ({ op: 'renameRoom', room: k, name: 'Galley' }));
    expect(applyScenario(p, s).plan).toBe(applyScenario(p, s).plan);
  });
});

describe('Draw Room', () => {
  test('one Change makes the Room; naming it straight away changes that Change', () => {
    const { p } = house();
    let s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 7000, y0: 5000, x1: 9900, y1: 7900 },
      name: 'Room'
    }));
    const made = applyScenario(p, s);
    const id = Object.keys(made.plan.rooms).find((r) => !p.rooms[r])!;
    expect(made.statuses.rooms[id]).toBe('new');
    s = recordChange(p, s, { op: 'renameRoom', room: id, name: 'Study' })!.scenario;
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]).toMatchObject({ op: 'drawRoom', name: 'Study' });
    expect(Object.values(fresh(p, s).plan.rooms).map((r) => r.name)).toContain('Study');
    // Any other Change in between, and a rename is its own Change again.
    s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 7000, y0: 5000, x1: 9900, y1: 7900 },
      name: 'Room'
    }));
    s = recordChange(p, s, { op: 'drawWall', a: { x: 6000, y: 1000 }, b: { x: 6000, y: 3000 } })!.scenario;
    s = recordChange(p, s, { op: 'renameRoom', room: id, name: 'Study' })!.scenario;
    expect(s.changes.map((c) => c.op)).toEqual(['drawRoom', 'drawWall', 'renameRoom']);
  });

  test('a drawn Room follows the Existing Plan: carved out of a Room captured there later', () => {
    const { p } = house();
    const s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 7000, y0: 5000, x1: 9900, y1: 7900 },
      name: 'Study'
    }));
    // The user captures that corner as a Room in the Existing Plan; the Scenario now carves Study out of it.
    const e = valid(nameSpace(p, 8000, 6000, 'Garage').plan);
    const r = applyScenario(e, s);
    valid(r.plan);
    expect(r.conflicts).toEqual([]);
    expect(Object.values(r.plan.rooms).map((x) => x.name)).toEqual(
      expect.arrayContaining(['Garage', 'Study'])
    );
  });
});

describe('Change Status', () => {
  test('drawing a Wall across a Room demolishes nothing; the Room keeps its larger part', () => {
    const { p, k } = house();
    // The Kitchen is 4 × 3.8 m at x 200–4200; a Wall at x = 1200 cuts off 950 mm.
    const s = scenario(p, () => ({ op: 'drawWall', a: { x: 1200, y: 100 }, b: { x: 1200, y: 4050 } }));
    const r = applyScenario(p, s);
    valid(r.plan);
    expect(r.conflicts).toEqual([]);
    expect(r.statuses.demolished).toEqual({});
    expect(derive(r.plan).rooms[k]!.bounds).toMatchObject({ x0: 1250, x1: 4200 });
    expect(r.statuses.rooms[k]).toBe('retained');
  });

  test('lengths add up: Retained + Demolished is the Existing Plan, Retained + New is the Scenario', () => {
    const { p, k, d } = house();
    const s = scenario(
      p,
      (q) => ({ op: 'pushWall', wall: between(q, k, d), delta: 400 }),
      () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } })
    );
    const r = applyScenario(p, s);
    const len = (q: Plan) =>
      Object.values(q.walls).reduce((n, w) => n + wallLine(q, w).t1 - wallLine(q, w).t0, 0);
    const retained = Object.values(r.statuses.walls).reduce(
      (n, x) => n + total(x.filter((y) => y.status === 'retained')),
      0
    );
    expect(retained + demolishedLength(r)).toBe(len(p));
    expect(retained + newLength(r)).toBe(len(r.plan));
  });

  test('union merges touching and overlapping stretches', () => {
    expect(
      union([
        { t0: 5, t1: 9 },
        { t0: 0, t1: 2 },
        { t0: 2, t1: 4 },
        { t0: 8, t1: 12 }
      ])
    ).toEqual([
      { t0: 0, t1: 4 },
      { t0: 5, t1: 12 }
    ]);
  });
});
