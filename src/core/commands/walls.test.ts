import { describe, expect, test } from 'vitest';
import { derive } from '../derive';
import { emptyPlan, wallLine } from '../plan';
import { normalizePlan } from '../normalize';
import { size, valid, wallAt } from '../test/helpers';
import { addOutline } from './outline';
import { addRoom } from './rooms';
import { deleteRoom, moveRoom, nameSpace, setRoomSize } from './rooms';
import { drawWall, preparePush, pushWall, runSides, setStructural, setWallThickness } from './walls';

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

describe('drawWall', () => {
  const drawnIds = (p: ReturnType<typeof emptyPlan>) =>
    Object.keys(p.walls).filter((id) => p.walls[id]!.drawn);

  test('a drawn Wall dividing a Room keeps the larger part as the Room; the rest is Unlabelled', () => {
    const { p, a } = house();
    const before = derive(p).unlabelled.reduce((n, s) => n + s.area, 0);
    // A is 3 × 4 m at x 200–3200; a Wall at x = 1200 cuts off 950 mm on its left.
    const q = valid(drawWall(p, { x: 1200, y: 100 }, { x: 1200, y: 4250 }).plan);
    const D = derive(q);
    expect(D.rooms[a]!.bounds).toEqual({ x0: 1250, y0: 200, x1: 3200, y1: 4200 });
    expect(D.unlabelled.reduce((n, s) => n + s.area, 0) - before).toBe(950 * 4000);
    // Naming the cut-off part makes a Room that shares the drawn Wall.
    const n = nameSpace(q, 700, 2000, 'Study');
    const r = valid(n.plan);
    expect(size(r, n.id!)).toEqual([950, 4000]);
    expect(Object.values(r.walls).some((w) => w.drawn && w.neg === n.id && w.pos === a)).toBe(true);
  });

  test('a drawn Wall that stops short of dividing a Room leaves it whole', () => {
    const { p, a } = house();
    const area = derive(p).rooms[a]!.area;
    const q = valid(drawWall(p, { x: 1200, y: 100 }, { x: 1200, y: 3000 }).plan);
    expect(derive(q).rooms[a]!.area).toBe(area);
    expect(
      Object.values(q.walls)
        .filter((w) => w.drawn)
        .every((w) => !w.neg && !w.pos)
    ).toBe(true);
  });

  test('a drawn Wall bounding no Room stays', () => {
    const { p } = house();
    const d = drawWall(p, { x: 6000, y: 1000 }, { x: 6000, y: 5000 });
    const q = valid(d.plan);
    expect(q.walls[d.id!]).toMatchObject({
      drawn: true,
      exterior: false,
      neg: null,
      pos: null,
      thickness: 100
    });
    expect(normalizePlan(q)).toEqual(q);
  });

  test('joins a Wall it ends on in a T-junction, splitting it but not its claims', () => {
    const { p, a } = house();
    const outline = derive(p).outline!.bounds;
    // From the top exterior Wall's centreline down into the open floor beside B.
    const q = valid(drawWall(p, { x: 7000, y: 100 }, { x: 7000, y: 3000 }).plan);
    const top = Object.keys(q.walls).filter((id) => {
      const l = wallLine(q, q.walls[id]!);
      return q.walls[id]!.exterior && l.axis === 'h' && l.c === 100;
    });
    expect(top.length).toBeGreaterThan(
      Object.keys(p.walls).filter(
        (id) =>
          p.walls[id]!.exterior &&
          wallLine(p, p.walls[id]!).c === 100 &&
          wallLine(p, p.walls[id]!).axis === 'h'
      ).length
    );
    expect(derive(q).outline!.bounds).toEqual(outline);
    expect(size(q, a)).toEqual([3000, 4000]);
  });

  test('a drawn Wall that closes off floor makes Unlabelled Space, which can be named', () => {
    const { p } = house();
    const before = derive(p).unlabelled.length;
    const q = valid(drawWall(p, { x: 7000, y: 100 }, { x: 7000, y: 7900 }).plan);
    expect(derive(q).unlabelled.length).toBe(before + 1);
  });

  test('stays where it was drawn when the Room it bounds moves, resizes or is deleted', () => {
    const { p } = house();
    // Right across the Outline, then the floor beyond it named: the new Room is bounded by the drawn Wall.
    const named = nameSpace(
      drawWall(p, { x: 7000, y: 100 }, { x: 7000, y: 7900 }).plan,
      8500,
      4000,
      'Studio'
    );
    const q = valid(named.plan);
    const b = named.id!;
    expect(drawnIds(q).some((id) => q.walls[id]!.pos === b)).toBe(true);
    // Where drawn material stands, however the pieces are split.
    const at = (r: typeof q) =>
      drawnIds(r)
        .map((id) => wallLine(r, r.walls[id]!))
        .sort((x, y) => x.t0 - y.t0)
        .reduce<{ axis: string; c: number; t0: number; t1: number }[]>((out, { axis, c, t0, t1 }) => {
          const last = out[out.length - 1];
          if (last && last.axis === axis && last.c === c && last.t1 === t0) last.t1 = t1;
          else out.push({ axis, c, t0, t1 });
          return out;
        }, []);
    const there = at(q);
    expect(at(valid(moveRoom(q, b, 0, 3000)))).toEqual(there);
    expect(at(valid(deleteRoom(q, b)))).toEqual(there);
    const smaller = valid(setRoomSize(q, b, 1500, 7600));
    expect(at(smaller)).toEqual(there);
    expect(size(smaller, b)).toEqual([1500, 7600]);
  });

  test('naming the space a drawn stub pokes into leaves the stub unclaimed', () => {
    const { p } = house();
    const d = drawWall(p, { x: 7000, y: 100 }, { x: 7000, y: 2000 });
    const n = nameSpace(d.plan, 8000, 5000, 'Studio');
    const q = valid(n.plan);
    expect(n.id).not.toBeNull();
    const stub = Object.keys(q.walls).filter((id) => q.walls[id]!.drawn);
    expect(stub.length).toBeGreaterThan(0);
    for (const id of stub) expect([q.walls[id]!.neg, q.walls[id]!.pos]).toEqual([null, null]);
  });

  test('two drawn Walls end to end become one; a drawn and an undrawn Wall do not', () => {
    const { p } = house();
    const one = drawWall(p, { x: 6000, y: 1000 }, { x: 6000, y: 3000 }).plan;
    const two = valid(drawWall(one, { x: 6000, y: 3000 }, { x: 6000, y: 5000 }).plan);
    expect(drawnIds(two)).toHaveLength(1);
    expect(wallLine(two, two.walls[drawnIds(two)[0]!]!)).toMatchObject({ t0: 1000, t1: 5000 });
  });

  test('capture artefacts still go: an undrawn interior Wall bounding nothing is dropped', () => {
    const { p } = house();
    const d = drawWall(p, { x: 6000, y: 1000 }, { x: 6000, y: 5000 });
    const q = { ...d.plan, walls: { ...d.plan.walls, [d.id!]: { ...d.plan.walls[d.id!]!, drawn: false } } };
    expect(normalizePlan(q).walls[d.id!]).toBeUndefined();
  });

  test('only adds Wall where there is none: along a parallel Wall it draws just the rest', () => {
    const { p, a } = house();
    // Along A's right Wall (centreline x = 3250, down to y = 4250): only the stretch below it is drawn.
    const along = drawWall(p, { x: 3250, y: 1000 }, { x: 3250, y: 6000 });
    const q = valid(along.plan);
    expect(wallLine(q, q.walls[along.id!]!)).toMatchObject({ c: 3250, t0: 4250, t1: 6000 });
    // Half over it, likewise; entirely over it, nothing.
    const half = valid(drawWall(p, { x: 3300, y: 1000 }, { x: 3300, y: 6000 }).plan);
    expect(drawnIds(half).map((id) => wallLine(half, half.walls[id]!).t0)).toEqual([4250]);
    expect(drawWall(p, { x: 3250, y: 1000 }, { x: 3250, y: 3000 }).id).toBeNull();
    // Beside it, face to face, is fine; so is crossing A's bottom Wall.
    expect(drawWall(p, { x: 3400, y: 4400 }, { x: 3400, y: 6000 }).id).not.toBeNull();
    const across = drawWall(p, { x: 1500, y: 3000 }, { x: 1500, y: 6000 });
    expect(across.id).not.toBeNull();
    expect(size(valid(across.plan), a)).toEqual([3000, 4000]);
  });

  test.each([
    ['a diagonal', { x: 6000, y: 1000 }, { x: 7000, y: 2000 }, 100],
    ['a point', { x: 6000, y: 1000 }, { x: 6000, y: 1000 }, 100],
    ['a hairline', { x: 6000, y: 1000 }, { x: 6000, y: 2000 }, 5]
  ])('refuses %s', (_, a, b, t) => {
    const { p } = house();
    expect(drawWall(p, a, b, t)).toEqual({ plan: p, id: null });
  });
});
