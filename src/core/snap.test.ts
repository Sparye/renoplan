import { describe, expect, test } from 'vitest';
import { addOutline, addRoom, applyMove, preparePush, prepareMove } from './commands';
import { derive } from './derive';
import { emptyPlan } from './plan';
import { clearances, snapMove, snapPush } from './snap';
import { sharedWalls, valid, wallAt } from './test/helpers';

const opts = { threshold: 150, grid: 100 };

function twoRooms() {
  const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
  const b = addRoom(a.plan, { name: 'B', w: 2000, l: 3000, x: 6000, y: 0 });
  return { p: b.plan, a: a.id!, b: b.id! };
}

describe('snapMove', () => {
  test('pulls a Room one interior Wall from its neighbour, which makes a Shared Wall', () => {
    const { p, b } = twoRooms();
    const prep = prepareMove(p, b)!;
    // B's left inside face would land at 3170; A's right Wall's outside face is at 3100.
    const s = snapMove(prep.plan, b, -2830, 13, opts);
    expect(s.dx).toBe(-2900);
    expect(s.guides).toContainEqual(expect.objectContaining({ axis: 'v', c: 3100 }));
    // And aligns the tops.
    expect(s.dy).toBe(0);
    const q = valid(applyMove(prep, s.dx, s.dy));
    expect(sharedWalls(q)).toEqual(['A|B']);
  });

  test('falls back to the grid when nothing is near', () => {
    const { p, b } = twoRooms();
    const prep = prepareMove(p, b)!;
    expect(snapMove(prep.plan, b, 1234, 4567, opts)).toMatchObject({ dx: 1200, dy: 4600, guides: [] });
  });

  test('snaps into the corner of the Outline', () => {
    const o = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
    const a = addRoom(o, { name: 'A', w: 3000, l: 3000 });
    const box = derive(a.plan).rooms[a.id!]!.bounds!;
    const prep = prepareMove(a.plan, a.id!)!;
    const s = snapMove(prep.plan, a.id!, 200 - box.x0 + 60, 200 - box.y0 - 40, opts);
    expect([box.x0 + s.dx, box.y0 + s.dy]).toEqual([200, 200]);
  });
});

describe('snapPush', () => {
  test('aligns a pushed wall with a parallel face and respects the range', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 3000, x: 3100, y: 0 });
    const p = b.plan;
    const prep = preparePush(p, wallAt(p, 'h', 4000, a.id!))!;
    // A's bottom wall (lo 4000) towards B's bottom wall (lo 3000).
    expect(snapPush(prep, -960, opts).delta).toBe(-1000);
    expect(snapPush(prep, -99999, opts).delta).toBe(prep.range[0]);
  });
});

describe('clearances', () => {
  test('reports the distance still to go and how much floor it leaves', () => {
    const { p, a } = twoRooms();
    const c = clearances(p, a);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ distance: 5900 - 3000, tone: 'ok', clear: 2800 });
  });

  test('warns when the gap would only be measurement slop', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 3000, x: 3250, y: 0 });
    expect(clearances(b.plan, a.id!)[0]).toMatchObject({ distance: 150, tone: 'warn' });
  });
});
