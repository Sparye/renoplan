import { describe, expect, test } from 'vitest';
import { derive } from '../derive';
import { emptyPlan } from '../plan';
import { size, valid, wallAt } from '../test/helpers';
import { addOutline } from './outline';
import { addRoom } from './rooms';
import { preparePush, pushWall, runSides, setStructural, setWallThickness } from './walls';

/** Outline 10 × 8 m; A and B side by side in the top-left, both against the top exterior wall. */
function house() {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const a = addRoom(p, { name: 'A', w: 3000, l: 4000, x: 200, y: 200 });
  const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3300, y: 200 });
  p = valid(b.plan);
  return { p, a: a.id!, b: b.id! };
}

describe('pushWall', () => {
  test('pushing a Shared Wall resizes the Rooms on both sides together', () => {
    const { p, a, b } = house();
    const q = valid(pushWall(p, wallAt(p, 'v', 3200, a), 500));
    expect(size(q, a)).toEqual([3500, 4000]);
    expect(size(q, b)).toEqual([1500, 4000]);
  });

  test("walls that merely line up are separate: pushing one Room's bottom leaves its neighbour", () => {
    const { p, a, b } = house();
    // The bottom walls of A and B are collinear and meet at the Shared Wall, but no Room continues along them.
    const q = valid(pushWall(p, wallAt(p, 'h', 4200, a), 600));
    expect(size(q, a)).toEqual([3000, 4600]);
    expect(size(q, b)).toEqual([2000, 4000]);
  });

  test('a spine with one Room along one side moves as one wall', () => {
    let p = emptyPlan();
    const c = addRoom(p, { name: 'C', w: 3000, l: 6100, x: 3100, y: 0 });
    const a = addRoom(c.plan, { name: 'A', w: 3000, l: 3000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 3000, l: 3000, x: 0, y: 3100 });
    p = valid(b.plan);
    const q = valid(pushWall(p, wallAt(p, 'v', 3000, a.id!), 400));
    expect(size(q, a.id!)).toEqual([3400, 3000]);
    expect(size(q, b.id!)).toEqual([3400, 3000]);
    expect(size(q, c.id!)).toEqual([2600, 6100]);
  });

  test('stops before a Room falls below the minimum size', () => {
    const { p, a, b } = house();
    const q = valid(pushWall(p, wallAt(p, 'v', 3200, a), 5000));
    expect(size(q, b)).toEqual([300, 4000]);
    expect(size(q, a)).toEqual([4700, 4000]);
  });

  test('an exterior wall with Rooms against it resizes those Rooms; the Outline stays', () => {
    const { p, a, b } = house();
    const outline = derive(p).outline!.bounds;
    const q = valid(pushWall(p, wallAt(p, 'h', 200, a), 400));
    expect(derive(q).outline!.bounds).toEqual(outline);
    expect(size(q, a)).toEqual([3000, 3600]);
    expect(size(q, b)).toEqual([2000, 3600]);
    // The strip left behind is Unlabelled Space (joined to the open floor beside B).
    expect(derive(q).spaceAt(1000, 350)).toBeGreaterThanOrEqual(0);
  });

  test('⌥ (outline) moves the exterior wall itself, and the Rooms against it follow', () => {
    const { p, a } = house();
    const q = valid(pushWall(p, wallAt(p, 'h', 200, a), -500, { outline: true }));
    expect(derive(q).outline!.bounds.y0).toBe(-500);
    expect(size(q, a)).toEqual([3000, 4500]);
  });

  test('an exterior wall with no Room against it moves the Outline', () => {
    const { p } = house();
    const right = Object.keys(p.walls).find(
      (id) => p.walls[id]!.exterior && derive(p).walls[id]!.line.hi === 10000
    )!;
    const q = valid(pushWall(p, right, 1000));
    expect(derive(q).outline!.bounds.x1).toBe(11000);
  });

  test('preparing a push reports the movable range', () => {
    const { p, a } = house();
    const prep = preparePush(p, wallAt(p, 'v', 3200, a))!;
    expect(prep.range).toEqual([-2700, 1700]);
  });
});

describe('wall properties', () => {
  test('interior thickness keeps the centreline', () => {
    const { p, a, b } = house();
    const q = valid(setWallThickness(p, wallAt(p, 'v', 3200, a), 200));
    expect(size(q, a)).toEqual([2950, 4000]);
    expect(size(q, b)).toEqual([1950, 4000]);
  });

  test('exterior thickness keeps the outside face', () => {
    const { p, a } = house();
    const outline = derive(p).outline!.bounds;
    const q = valid(setWallThickness(p, wallAt(p, 'h', 200, a), 300));
    expect(derive(q).outline!.bounds).toEqual(outline);
    expect(size(q, a)).toEqual([3000, 3900]);
  });

  test('Structural Mark is per wall', () => {
    const { p, a } = house();
    const id = wallAt(p, 'v', 3200, a);
    const q = valid(setStructural(p, id, true));
    expect(q.walls[id]!.structural).toBe(true);
    expect(Object.values(q.walls).filter((w) => w.structural)).toHaveLength(1);
  });

  test('runSides lists the Rooms each side of a run', () => {
    const { p, a, b } = house();
    const s = runSides(p, wallAt(p, 'v', 3200, a));
    expect(s.neg).toEqual([a]);
    expect(s.pos).toEqual([b]);
    expect(s.exterior).toBe(false);
  });
});
