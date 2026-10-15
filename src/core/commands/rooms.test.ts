import { describe, expect, test } from 'vitest';
import { derive } from '../derive';
import { emptyPlan, wallLine } from '../plan';
import { sharedWalls, size, valid, wallAt } from '../test/helpers';
import { addOpening } from './openings';
import { addOutline, addWing } from './outline';
import { pushWall, setWallThickness } from './walls';
import { addRoom, deleteRoom, mergeRooms, moveRoom, nameSpace, renameRoom, setRoomSize } from './rooms';

const base = () => valid(addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 }));

describe('addRoom', () => {
  test('creates four interior walls around the inside rectangle', () => {
    const { plan, id } = addRoom(emptyPlan(), { name: 'Bedroom', w: 3000, l: 4000, x: 0, y: 0 });
    valid(plan);
    expect(Object.keys(plan.walls)).toHaveLength(4);
    expect(size(plan, id!)).toEqual([3000, 4000]);
    expect(plan.rooms[id!]).toEqual({ name: 'Bedroom', type: 'bedroom' });
    expect(derive(plan).rooms[id!]!.area).toBe(12_000_000);
  });

  test('parks rooms in a row to the right of the Outline', () => {
    let p = base();
    const a = addRoom(p, { name: 'A', w: 3000, l: 3000 });
    p = a.plan;
    const b = addRoom(p, { name: 'B', w: 3000, l: 3000 });
    p = valid(b.plan);
    const ra = derive(p).rooms[a.id!]!.bounds!;
    const rb = derive(p).rooms[b.id!]!.bounds!;
    expect(ra.x0).toBeGreaterThanOrEqual(12000);
    expect(rb.x0).toBeGreaterThan(ra.x1 + 100);
    expect(derive(p).parked.sort()).toEqual([a.id, b.id].sort());
  });

  test('rejects rooms smaller than the minimum', () => {
    const p = emptyPlan();
    expect(addRoom(p, { name: 'x', w: 100, l: 3000 }).plan).toBe(p);
  });
});

describe('snapping two rooms one interior wall apart', () => {
  test('fuses their walls into one Shared Wall', () => {
    let p = emptyPlan();
    const a = addRoom(p, { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    // B's inside face lands on A's right wall's outside face: 100 mm apart.
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3100, y: 0 });
    p = valid(b.plan);
    expect(sharedWalls(p)).toEqual(['A|B']);
    expect(Object.keys(p.walls)).toHaveLength(7);
    expect(size(p, a.id!)).toEqual([3000, 4000]);
    expect(size(p, b.id!)).toEqual([2000, 4000]);
  });

  test('a shorter neighbour shares only its span and leaves a T-junction', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 2000, x: 3100, y: 1000 });
    const p = valid(b.plan);
    expect(sharedWalls(p)).toEqual(['A|B']);
    expect(size(p, a.id!)).toEqual([3000, 4000]);
    expect(size(p, b.id!)).toEqual([2000, 2000]);
  });

  test('fuses with walls of a different thickness by their faces', () => {
    let p = base();
    // Inside the exterior wall's inside face (200 mm) in the top-left corner.
    const a = addRoom(p, { name: 'A', w: 3000, l: 4000, x: 200, y: 200 });
    p = valid(a.plan);
    const ext = Object.values(p.walls).filter((w) => w.exterior);
    expect(ext.filter((w) => w.neg === a.id || w.pos === a.id)).toHaveLength(2);
    expect(Object.values(p.walls).filter((w) => !w.exterior)).toHaveLength(2);
    expect(size(p, a.id!)).toEqual([3000, 4000]);
  });
});

describe('moveRoom', () => {
  test('detaches from neighbours, who keep the Shared Wall', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3100, y: 0 });
    const shared = wallAt(b.plan, 'v', 3000, a.id!);
    const p = valid(moveRoom(b.plan, b.id!, 5000, 0));
    expect(sharedWalls(p)).toEqual([]);
    expect(p.walls[shared]).toBeDefined();
    expect(p.walls[shared]!.neg).toBe(a.id);
    expect(size(p, a.id!)).toEqual([3000, 4000]);
    expect(derive(p).rooms[b.id!]!.bounds).toEqual({ x0: 8100, y0: 0, x1: 10100, y1: 4000 });
  });

  test('moving by zero gives back the same structure', () => {
    const a = addRoom(base(), { name: 'A', w: 3000, l: 4000, x: 200, y: 200 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3300, y: 200 });
    const p = valid(moveRoom(b.plan, a.id!, 0, 0));
    expect(Object.keys(p.walls).length).toBe(Object.keys(b.plan.walls).length);
    expect(sharedWalls(p)).toEqual(sharedWalls(b.plan));
  });

  test('dropping a room onto another leaves an Overlap', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 3000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 3000, l: 3000, x: 5000, y: 0 });
    const p = valid(moveRoom(b.plan, b.id!, -4000, 500));
    const D = derive(p);
    expect(D.rooms[a.id!]!.area).toBe(9_000_000);
    expect(D.rooms[b.id!]!.area).toBe(9_000_000);
    expect(D.overlaps.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0)).toBe(2000 * 2500);
  });

  test('moving by zero next to a room crossing the Outline keeps its door whole', () => {
    // The hall fills the Outline; R straddles the right exterior Wall, its bottom inside face level
    // with the hall's, so R's bottom Wall crosses that exterior Wall mid-span.
    const p0 = base();
    const hall = nameSpace(p0, 5000, 4000, 'Hallway');
    const r = addRoom(hall.plan, { name: 'R', w: 700, l: 600, x: 9500, y: 7200 });
    const bottom = wallAt(r.plan, 'h', 7800, r.id!);
    const door = addOpening(r.plan, bottom, 'door', 9500);
    const p = valid(moveRoom(door.plan, hall.id!, 0, 0));
    expect(Object.values(p.openings).map((o) => [o.at, o.width])).toEqual([[9500, 700]]);
  });

  test('a Room around an island keeps its area when the island lands on a thicker Wall', () => {
    // The hall surrounds a cupboard, so it takes a ring of its own Walls with it. Moved down until the
    // ring's bottom face lies on the Outline's outside face, the ring fuses into that thicker Wall.
    const p0 = base();
    const c = addRoom(p0, { name: 'Cupboard', w: 1000, l: 1000, x: 2000, y: 2000 });
    const hall = nameSpace(c.plan, 500, 500, 'Hallway');
    const area = derive(hall.plan).rooms[hall.id!]!.area;
    const p = valid(moveRoom(hall.plan, hall.id!, 0, 8000 - 3100));
    expect(derive(p).rooms[hall.id!]!.area).toBe(area);
  });

  // An L-shaped hall moved out past a wing's corner: its inside corner fuses into the wing's Walls, and
  // the part of its own Wall left over meets them only in a short stub of the Outline.
  test.each([
    ['top', -1300, -1500],
    ['left', -1500, -1300]
  ] as const)('moving by zero keeps the area of a hall wrapped around a %s wing corner', (side, dx, dy) => {
    const o = addWing(addOutline(emptyPlan(), 6000, 5000, { x: 0, y: 0 }), side, 1500, 1500);
    const hall = nameSpace(o, 3000, 2500, 'Hallway');
    const p = valid(moveRoom(hall.plan, hall.id!, dx, dy));
    expect(derive(p).rooms[hall.id!]!.area).toBe(derive(hall.plan).rooms[hall.id!]!.area);
    const q = valid(moveRoom(p, hall.id!, 0, 0));
    expect(derive(q).rooms[hall.id!]!.rects).toEqual(derive(p).rooms[hall.id!]!.rects);
  });

  test('moving by zero keeps a corner stub joined to the Wall beside it', () => {
    // Pulling the wing's inside Wall to 1 mm short of the Outline's right Wall leaves the hall a 51 mm
    // stub of the top Wall at the corner, with the hall's own Wall re-ending on it.
    const o = addWing(addOutline(emptyPlan(), 6000, 5000, { x: 0, y: 0 }), 'top', 1500, 1500);
    const hall = nameSpace(o, 3000, 2500, 'Hallway');
    const p = valid(pushWall(hall.plan, wallAt(hall.plan, 'v', 1300, hall.id!), 4500));
    const q = valid(moveRoom(p, hall.id!, 0, 0));
    expect(derive(q).rooms[hall.id!]!.rects).toEqual(derive(p).rooms[hall.id!]!.rects);
  });

  test("moving keeps a hall's corner closed where it wraps around the Outline's corner", () => {
    // The hall's inside corner lands on the Outline's bottom-right corner: its own Walls fuse into the
    // right exterior Wall (leaving the hall a stub of it) and then into the bottom one.
    const o = addWing(addOutline(emptyPlan(), 6000, 5000, { x: 0, y: 0 }), 'left', 1500, 1500);
    const hall = nameSpace(o, 3000, 2500, 'Hallway');
    const area = derive(hall.plan).rooms[hall.id!]!.area;
    const p = valid(moveRoom(hall.plan, hall.id!, 5400, 3100));
    const q = valid(moveRoom(p, hall.id!, 400, 400));
    expect(derive(q).rooms[hall.id!]!.area).toBe(area);
  });

  test("moving by zero keeps a hall's corner where a thinner Outline Wall was pulled out", () => {
    // The left exterior Wall is thinned to 150 mm and the hall's side pulled out past it, then the
    // Outline itself: the hall's corner below the wing is left with 1 mm jogs and a stub of its own Wall.
    const o = addWing(addOutline(emptyPlan(), 6000, 5000, { x: 0, y: 0 }), 'left', 1500, 1500);
    const hall = nameSpace(o, 3000, 2500, 'Hallway');
    let p = pushWall(hall.plan, wallAt(hall.plan, 'h', 200, hall.id!), 0);
    p = setWallThickness(p, wallAt(p, 'v', 200, hall.id!), 150);
    p = pushWall(p, wallAt(p, 'v', 150, hall.id!), -50);
    const left = Object.keys(p.walls).find((id) => {
      const l = wallLine(p, p.walls[id]!);
      return p.walls[id]!.exterior && l.axis === 'v' && l.lo === 0 && l.t0 === 1400;
    })!;
    p = valid(pushWall(p, left, -50));
    const q = valid(moveRoom(p, hall.id!, 0, 0));
    expect(derive(q).rooms[hall.id!]!.rects).toEqual(derive(p).rooms[hall.id!]!.rects);
  });

  test('a room dragged across the Outline is crossing it', () => {
    const a = addRoom(base(), { name: 'A', w: 3000, l: 3000 });
    const p = valid(moveRoom(a.plan, a.id!, -3500, 1000));
    expect(derive(p).crossing).toEqual([a.id]);
  });
});

describe('setRoomSize', () => {
  test('grows rightward into a neighbour, which does not move', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3100, y: 0 });
    const p = valid(setRoomSize(b.plan, a.id!, 3500, 4000));
    expect(size(p, a.id!)).toEqual([3500, 4000]);
    expect(derive(p).rooms[b.id!]!.bounds).toEqual({ x0: 3100, y0: 0, x1: 5100, y1: 4000 });
    expect(derive(p).overlaps.length).toBeGreaterThan(0);
  });

  test('shrinking leaves the neighbour its wall', () => {
    const a = addRoom(emptyPlan(), { name: 'A', w: 3000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'B', w: 2000, l: 4000, x: 3100, y: 0 });
    const p = valid(setRoomSize(b.plan, a.id!, 2500, 3500));
    expect(size(p, a.id!)).toEqual([2500, 3500]);
    expect(size(p, b.id!)).toEqual([2000, 4000]);
  });
});

describe('merge, delete, name', () => {
  const pair = () => {
    const a = addRoom(emptyPlan(), { name: 'Living', w: 4000, l: 4000, x: 0, y: 0 });
    const b = addRoom(a.plan, { name: 'Nook', w: 2000, l: 2000, x: 4100, y: 0 });
    return { p: b.plan, a: a.id!, b: b.id! };
  };

  test('merging removes the Shared Wall and makes an L-shaped room', () => {
    const { p, a, b } = pair();
    const m = mergeRooms(p, wallAt(p, 'v', 4000, a));
    valid(m.plan);
    expect(m.id).toBe(a);
    expect(m.plan.rooms[b]).toBeUndefined();
    const g = derive(m.plan).rooms[a]!;
    expect(g.area).toBe(16_000_000 + 2_000 * 2_000 + 100 * 2000);
    expect(g.rectangular).toBe(false);
  });

  test('deleting a room leaves its neighbour whole', () => {
    const { p, a, b } = pair();
    const q = valid(deleteRoom(p, b));
    expect(Object.keys(q.walls)).toHaveLength(4);
    expect(size(q, a)).toEqual([4000, 4000]);
  });

  test('renaming re-guesses the type unless the user chose one', () => {
    const { p, a } = pair();
    expect(renameRoom(p, a, 'Bedroom 1').rooms[a]!.type).toBe('bedroom');
  });

  test('naming Unlabelled Space claims the walls around it', () => {
    let p = base();
    p = addRoom(p, { name: 'A', w: 4000, l: 7600, x: 200, y: 200 }).plan;
    p = addRoom(p, { name: 'B', w: 4000, l: 7600, x: 5600, y: 200 }).plan;
    p = valid(p);
    const D = derive(p);
    expect(D.unlabelled).toHaveLength(1);
    expect(D.unlabelled[0]!.area).toBe((5500 - 4300) * 7600);
    const n = nameSpace(p, 5000, 4000, 'Hallway');
    valid(n.plan);
    expect(derive(n.plan).unlabelled).toHaveLength(0);
    expect(derive(n.plan).rooms[n.id!]!.area).toBe((5500 - 4300) * 7600);
    expect(n.plan.rooms[n.id!]!.type).toBe('hallway');
  });

  test('naming the space around an island Room does not claim the island', () => {
    const c = addRoom(base(), { name: 'Cupboard', w: 1000, l: 1000, x: 2000, y: 2000 });
    const n = nameSpace(c.plan, 500, 500, 'Hallway');
    const D = derive(valid(n.plan));
    expect(D.rooms[n.id!]!.area).toBe(9600 * 7600 - 1200 * 1200);
    expect(D.overlaps).toEqual([]);
  });

  test('a thin strip is absorbed, not Unlabelled Space', () => {
    let p = base();
    p = addRoom(p, { name: 'A', w: 4000, l: 7600, x: 200, y: 200 }).plan;
    p = addRoom(p, { name: 'B', w: 5350, l: 7600, x: 4450, y: 200 }).plan;
    const D = derive(valid(p));
    expect(D.unlabelled).toHaveLength(0);
    expect(D.slivers.length).toBeGreaterThan(0);
  });
});
