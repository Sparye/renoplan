import { describe, expect, test } from 'vitest';
import { emptyPlan } from '../plan';
import { valid, wallAt } from '../test/helpers';
import { addOpening, deleteOpening, moveOpening, updateOpening } from './openings';
import { addOutline } from './outline';
import { addRoom, mergeRooms, moveRoom } from './rooms';
import { pushWall } from './walls';

function house() {
  const o = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const a = addRoom(o, { name: 'A', w: 3000, l: 4000, x: 200, y: 200 });
  const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3300, y: 200 });
  return { p: valid(b.plan), a: a.id!, b: b.id! };
}

describe('Openings', () => {
  test('a door is added centred on the click, with a preset width', () => {
    const { p, a } = house();
    const shared = wallAt(p, 'v', 3200, a);
    const r = addOpening(p, shared, 'door', 2000);
    const q = valid(r.plan);
    expect(q.openings[r.id!]).toMatchObject({ wall: shared, kind: 'door', width: 810, at: 1595 });
  });

  test('stays on the clear span of its wall', () => {
    const { p, a } = house();
    const r = addOpening(p, wallAt(p, 'v', 3200, a), 'window', 100);
    const q = valid(moveOpening(r.plan, r.id!, -5000));
    expect(q.openings[r.id!]!.at).toBe(200);
  });

  test('a door on a Shared Wall stays with the neighbour when a Room moves away', () => {
    const { p, a, b } = house();
    const shared = wallAt(p, 'v', 3200, a);
    const r = addOpening(p, shared, 'door', 2000);
    const q = valid(moveRoom(r.plan, b, 4000, 3000));
    expect(q.openings[r.id!]!.wall).toBe(shared);
    expect(q.openings[r.id!]!.at).toBe(1595);
  });

  test('a window on the exterior stays with the façade', () => {
    const { p, a } = house();
    const top = wallAt(p, 'h', 200, a);
    const r = addOpening(p, top, 'window', 1500);
    const q = valid(moveRoom(r.plan, a, 0, 2000));
    expect(q.walls[q.openings[r.id!]!.wall]!.exterior).toBe(true);
  });

  test("an opening on a Room's own wall travels with it", () => {
    const { p, a } = house();
    const bottom = wallAt(p, 'h', 4200, a);
    const r = addOpening(p, bottom, 'door', 1500);
    const at = r.plan.openings[r.id!]!.at;
    const q = valid(moveRoom(r.plan, a, 0, 2500));
    expect(q.openings[r.id!]!.at).toBe(at);
  });

  test('openings follow when their wall is split or merged', () => {
    const { p, a } = house();
    const shared = wallAt(p, 'v', 3200, a);
    const r = addOpening(p, shared, 'door', 2000);
    const m = mergeRooms(r.plan, shared);
    expect(m.plan.openings[r.id!]).toBeUndefined();
    const bottom = wallAt(p, 'h', 4200, a);
    const d = addOpening(p, bottom, 'door', 4000);
    const q = valid(pushWall(d.plan, wallAt(d.plan, 'v', 3200, a), 200));
    expect(Object.keys(q.openings)).toEqual([d.id]);
  });

  test('changing the width keeps it centred; deleting removes it', () => {
    const { p, a } = house();
    const r = addOpening(p, wallAt(p, 'v', 3200, a), 'door', 2000);
    const q = valid(updateOpening(r.plan, r.id!, { width: 860, swing: 'pos' }));
    expect(q.openings[r.id!]).toMatchObject({ width: 860, at: 1570, swing: 'pos' });
    expect(deleteOpening(q, r.id!).openings).toEqual({});
  });
});
