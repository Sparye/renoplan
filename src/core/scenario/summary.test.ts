import { describe, expect, test } from 'vitest';
import { addOutline, addRoom, setStructural } from '../commands';
import { derive } from '../derive';
import { type Plan, type RoomId, type WallId, emptyPlan, wallLine } from '../plan';
import { valid } from '../test/helpers';
import { type Gesture, type Scenario, emptyScenario } from './model';
import { applyScenario, recordChange } from './replay';
import { changeStatuses } from './status';
import { type PlanSummary, compareRooms, summarize } from './summary';

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

function between(p: Plan, neg: RoomId | null, pos: RoomId | null): WallId {
  const id = Object.keys(p.walls).find((w) => p.walls[w]!.neg === neg && p.walls[w]!.pos === pos);
  if (!id) throw new Error(`no wall ${neg}|${pos}`);
  return id;
}

const span = (p: Plan, id: WallId) => {
  const l = wallLine(p, p.walls[id]!);
  return l.t1 - l.t0;
};

function scenario(existing: Plan, ...gestures: ((plan: Plan) => Gesture)[]): Scenario {
  let s = emptyScenario('s1', 'Option A');
  for (const g of gestures) {
    const r = recordChange(existing, s, g(applyScenario(existing, s).plan));
    if (!r) throw new Error(`gesture did nothing: ${JSON.stringify(g(applyScenario(existing, s).plan))}`);
    s = r.scenario;
  }
  return s;
}

const summary = (existing: Plan, s: Scenario) => summarize(existing, applyScenario(existing, s));
/** A plan compared as if a Scenario made it. */
const against = (existing: Plan, plan: Plan) =>
  summarize(existing, { plan, statuses: changeStatuses(existing, plan) });
const area = (p: Plan, id: RoomId) => derive(p).rooms[id]!.area;

describe('the Existing Plan', () => {
  test('is the baseline: every Room Retained, nothing demolished, no Extension', () => {
    const { p, k, d, b } = house();
    const s = summarize(p, null);
    expect(s.rooms).toEqual([
      { id: k, name: 'Kitchen', area: 4000 * 3800, status: 'retained' },
      { id: d, name: 'Dining', area: 3000 * 3800, status: 'retained' },
      { id: b, name: 'Bedroom', area: 3000 * 3000, status: 'retained' }
    ]);
    expect(s.roomArea).toBe(4000 * 3800 + 3000 * 3800 + 3000 * 3000);
    expect(s).toMatchObject({
      gone: [],
      demolished: { count: 0, length: 0 },
      structural: { count: 0, length: 0 },
      newWalls: 0,
      extensionArea: 0
    });
  });

  test('an empty Scenario summarises the same', () => {
    const { p } = house();
    expect(summary(p, emptyScenario('s1', 'Nothing'))).toEqual(summarize(p, null));
  });

  test('an empty plan has nothing', () => {
    expect(summarize(emptyPlan(), null)).toMatchObject({ rooms: [], roomArea: 0, extensionArea: 0 });
  });
});

describe('demolishing a Shared Wall', () => {
  test('is one Wall demolished, its length, and one merged Room', () => {
    const { p, k, d, b } = house();
    const wall = between(p, k, d);
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }))
    );
    expect(s.demolished).toEqual({ count: 1, length: span(p, wall) });
    expect(s.structural).toEqual({ count: 0, length: 0 });
    expect(s.newWalls).toBe(0);
    // The larger Kitchen keeps its id and takes the Dining and the Wall's floor.
    expect(s.rooms.map((r) => r.id)).toEqual([k, b]);
    expect(s.rooms[0]).toEqual({ id: k, name: 'Kitchen', area: 7100 * 3800, status: 'retained' });
    expect(s.gone).toEqual([{ id: d, into: k }]);
    expect(s.roomArea).toBe(7100 * 3800 + 3000 * 3000);
    expect(s.extensionArea).toBe(0);
  });

  test('marked structural is a structural Wall touched', () => {
    const h = house();
    const p = setStructural(h.p, between(h.p, h.k, h.d), true);
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, h.k, h.d) }))
    );
    expect(s.structural).toEqual({ count: 1, length: span(p, between(p, h.k, h.d)) });
    expect(s.structural).toEqual(s.demolished);
  });

  test('two Walls demolished count twice', () => {
    const { p, k, d, b } = house();
    const s = summary(
      p,
      scenario(
        p,
        (q) => ({ op: 'demolishWall', wall: between(q, k, d) }),
        (q) => ({ op: 'demolishWall', wall: between(q, k, b) })
      )
    );
    expect(s.demolished.count).toBe(2);
    expect(s.rooms.map((r) => r.id)).toEqual([k]);
    expect(s.gone.map((g) => g.id).sort()).toEqual([b, d].sort());
    expect(s.gone.every((g) => g.into === k)).toBe(true);
  });
});

describe('a Modified Wall', () => {
  test('counts as demolished where it was, and New where it went', () => {
    const { p, k, d } = house();
    const wall = between(p, k, d);
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'pushWall', wall: between(q, k, d), delta: 600 }))
    );
    expect(s.demolished).toEqual({ count: 1, length: span(p, wall) });
    expect(s.newWalls).toBe(span(p, wall));
    expect(s.gone).toEqual([]);
    expect(s.rooms.find((r) => r.id === k)!.area).toBe(4600 * 3800);
    expect(s.rooms.find((r) => r.id === d)!.area).toBe(2400 * 3800);
  });

  test('marked structural, it is touched even though it still stands', () => {
    const h = house();
    const p = setStructural(h.p, between(h.p, h.k, h.d), true);
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'pushWall', wall: between(q, h.k, h.d), delta: 600 }))
    );
    expect(s.structural.count).toBe(1);
  });

  test('a structural Wall left alone is not touched', () => {
    const h = house();
    const p = setStructural(h.p, between(h.p, h.k, h.b), true);
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'pushWall', wall: between(q, h.k, h.d), delta: 600 }))
    );
    expect(s.demolished.count).toBe(1);
    expect(s.structural).toEqual({ count: 0, length: 0 });
  });
});

describe('counting Walls', () => {
  /** The Existing Plan Walls on the centreline y = 4050, as pieces. */
  const pieces = (p: Plan) =>
    Object.keys(p.walls)
      .filter((id) => {
        const l = wallLine(p, p.walls[id]!);
        return l.axis === 'h' && l.c === 4050;
      })
      .map((id) => ({ id, ...wallLine(p, p.walls[id]!) }))
      .sort((a, b) => a.t0 - b.t0);
  const statuses = (p: Plan, demolished: Record<WallId, { t0: number; t1: number }[]>) => ({
    ...changeStatuses(p, p),
    demolished
  });

  test('touching Demolished stretches along one centreline are one Wall, however many pieces', () => {
    const { p } = house();
    const [a, b] = pieces(p);
    expect(b, 'two Wall pieces on y = 4050').toBeDefined();
    expect(a!.t1).toBe(b!.t0);
    const s = summarize(p, {
      plan: p,
      statuses: statuses(p, { [a!.id]: [{ t0: a!.t0, t1: a!.t1 }], [b!.id]: [{ t0: b!.t0, t1: b!.t1 }] })
    });
    expect(s.demolished).toEqual({ count: 1, length: b!.t1 - a!.t0 });
  });

  test('separate stretches along one centreline are separate Walls', () => {
    const { p } = house();
    const [a] = pieces(p);
    const s = summarize(p, {
      plan: p,
      statuses: statuses(p, {
        [a!.id]: [
          { t0: a!.t0, t1: a!.t0 + 500 },
          { t0: a!.t1 - 500, t1: a!.t1 }
        ]
      })
    });
    expect(s.demolished).toEqual({ count: 2, length: 1000 });
  });

  test('New Wall is measured along its centreline', () => {
    const { p } = house();
    const s = summary(
      p,
      scenario(p, () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }))
    );
    expect(s.newWalls).toBe(7800);
    expect(s.demolished).toEqual({ count: 0, length: 0 });
  });
});

describe('Extension area', () => {
  test('is the Footprint outside the Existing Plan Footprint', () => {
    const { p } = house();
    const wider = addOutline(emptyPlan(), 12000, 8000, { x: 0, y: 0 });
    expect(against(p, wider).extensionArea).toBe(2000 * 8000);
  });

  test('counts only the part outside, wherever it is', () => {
    const { p } = house();
    // Shifted 1 m right and 1 m down: an L of 1 m along the right and the bottom.
    const shifted = addOutline(emptyPlan(), 10000, 8000, { x: 1000, y: 1000 });
    expect(against(p, shifted).extensionArea).toBe(10000 * 8000 - 9000 * 7000);
  });

  test('a smaller Footprint is no Extension', () => {
    const { p } = house();
    expect(against(p, addOutline(emptyPlan(), 6000, 5000, { x: 0, y: 0 })).extensionArea).toBe(0);
  });
});

describe('Rooms a Scenario makes', () => {
  test('are New, with their area, and count in the total', () => {
    const { p } = house();
    const r = applyScenario(
      p,
      scenario(
        p,
        () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
        () => ({ op: 'nameSpace', x: 9200, y: 4000, name: 'Studio' })
      )
    );
    const s = summarize(p, r);
    const studio = s.rooms.find((x) => x.name === 'Studio')!;
    expect(studio.status).toBe('new');
    expect(studio.area).toBe(area(r.plan, studio.id));
    expect(studio.area).toBe((9800 - 8550) * (7800 - 200));
    expect(s.roomArea).toBe(summarize(p, null).roomArea + studio.area);
  });
});

describe('compareRooms', () => {
  const names = (rows: ReturnType<typeof compareRooms>) =>
    rows.map((r) =>
      r.cells.map((c) =>
        c.kind === 'room'
          ? `${c.room.name} ${c.room.area / 1e6}`
          : c.kind === 'gone'
            ? `→ ${c.into?.name}`
            : '-'
      )
    );

  test('the Existing Plan against itself matches every Room', () => {
    const { p, k, d, b } = house();
    const s = summarize(p, null);
    const rows = compareRooms(p, s, s);
    expect(rows.map((r) => r.existing)).toEqual([k, d, b]);
    expect(names(rows)).toEqual([
      ['Kitchen 15.2', 'Kitchen 15.2'],
      ['Dining 11.4', 'Dining 11.4'],
      ['Bedroom 9', 'Bedroom 9']
    ]);
  });

  test('a merged Room keeps its row; the Room it took is merged into it', () => {
    const { p, k, d } = house();
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }))
    );
    expect(names(compareRooms(p, summarize(p, null), s))).toEqual([
      ['Kitchen 15.2', 'Kitchen 26.98'],
      ['Dining 11.4', '→ Kitchen'],
      ['Bedroom 9', 'Bedroom 9']
    ]);
  });

  test('a renamed Room is matched by id', () => {
    const { p, d } = house();
    const s = summary(
      p,
      scenario(p, () => ({ op: 'renameRoom', room: d, name: 'Library' }))
    );
    const row = compareRooms(p, summarize(p, null), s)[1]!;
    expect(row.existing).toBe(d);
    expect(names([row])).toEqual([['Dining 11.4', 'Library 11.4']]);
  });

  test("each side's New Rooms are rows of their own, even when replay gave them the same id", () => {
    const { p } = house();
    const studio = (name: string) =>
      summary(
        p,
        scenario(
          p,
          () => ({ op: 'drawWall', a: { x: 8500, y: 100 }, b: { x: 8500, y: 7900 } }),
          () => ({ op: 'nameSpace', x: 9200, y: 4000, name })
        )
      );
    const a: PlanSummary = studio('Studio');
    const b: PlanSummary = studio('Gym');
    const [ra, rb] = [a, b].map((s) => s.rooms.find((r) => r.status === 'new')!);
    expect(ra!.id).toBe(rb!.id);
    const rows = compareRooms(p, a, b);
    expect(rows).toHaveLength(5);
    expect(rows.slice(3).map((r) => r.existing)).toEqual([null, null]);
    expect(names(rows.slice(3))).toEqual([
      [`Studio ${ra!.area / 1e6}`, '-'],
      ['-', `Gym ${rb!.area / 1e6}`]
    ]);
  });

  test('an Existing Plan Room gone from both sides still has its row', () => {
    const { p, k, d } = house();
    const s = summary(
      p,
      scenario(p, (q) => ({ op: 'demolishWall', wall: between(q, k, d) }))
    );
    expect(names(compareRooms(p, s, s))[1]).toEqual(['→ Kitchen', '→ Kitchen']);
  });
});
