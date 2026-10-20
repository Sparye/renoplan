import { describe, expect, test } from 'vitest';
import { addOutline, addRoom, pushWall } from '../commands';
import { derive } from '../derive';
import { rectsArea } from '../grid';
import { runOf } from '../graph';
import { type Plan, type RoomId, type WallId, clonePlan, emptyPlan, extensionWall, wallLine } from '../plan';
import { valid } from '../test/helpers';
import { extensionOf } from './extension';
import { type Gesture, type Scenario, emptyScenario } from './model';
import { applyScenario, recordChange } from './replay';
import { summarize } from './summary';

/**
 * Outline 10 × 8 m (exterior Walls 200 mm, centrelines at 100 and 9900 / 7900). Kitchen top left, Lounge
 * (2.35 × 3.8 m) top right against the right exterior Wall, at x 7450–9800, y 200–4000.
 */
function house() {
  const p0 = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const k = addRoom(p0, { name: 'Kitchen', w: 4000, l: 3800, x: 200, y: 200 });
  const l = addRoom(k.plan, { name: 'Lounge', w: 2350, l: 3800, x: 7450, y: 200 });
  return { p: valid(l.plan), k: k.id!, lounge: l.id! };
}

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

/** A Room against the outside of the right exterior Wall, beside the Lounge: centrelines 9900–13000 × 1000–3500. */
const AGAINST = { x0: 9900, y0: 1000, x1: 13000, y1: 3500 };
const studio = (): Gesture => ({ op: 'drawRoom', rect: AGAINST, name: 'Studio' });

const made = (existing: Plan, p: Plan) => Object.keys(p.rooms).find((r) => !existing.rooms[r])!;
const between = (p: Plan, neg: RoomId, pos: RoomId): WallId =>
  Object.keys(p.walls).find((w) => p.walls[w]!.neg === neg && p.walls[w]!.pos === pos)!;
/** The Wall on a centreline covering a point along it. */
const wallOn = (p: Plan, axis: 'h' | 'v', c: number, t: number): WallId =>
  Object.keys(p.walls).find((id) => {
    const l = wallLine(p, p.walls[id]!);
    return l.axis === axis && l.c === c && l.t0 < t && t < l.t1;
  })!;

describe('Draw Room outside the Outline', () => {
  test('against an exterior Wall: a New Room that joins the Outline as an Extension', () => {
    const { p, lounge } = house();
    const s = scenario(p, studio);
    // Outside the Outline, Draw Room draws exterior Walls.
    expect(s.changes[0]).toMatchObject({ op: 'drawRoom', thickness: 200 });
    const r = applyScenario(p, s);
    valid(r.plan);
    const id = made(p, r.plan);
    const D = derive(r.plan);
    expect(r.statuses.rooms[id]).toBe('new');
    expect(D.parked).not.toContain(id);
    expect(D.crossing).not.toContain(id);
    expect(D.rooms[id]!.bounds).toEqual({ x0: 10000, y0: 1100, x1: 12900, y1: 3400 });
    // Its three outer Walls are the Outline now, and an Extension's; the Wall it is against stays, interior.
    const outer = Object.values(r.plan.walls).filter((w) => w.neg === id || w.pos === id);
    expect(outer.filter((w) => extensionWall(w))).toHaveLength(3);
    const old = r.plan.walls[between(r.plan, lounge, id)]!;
    expect(old).toMatchObject({ exterior: false, drawn: false, thickness: 200 });
    // Nothing is Demolished: the Wall it is against is the same material.
    expect(r.statuses.demolished).toEqual({});
    // The Extension: the floor and Walls outside the Existing Plan's Footprint.
    expect(extensionOf(p, r.plan)).toEqual([{ x0: 10000, y0: 900, x1: 13100, y1: 3600 }]);
    expect(summarize(p, r).extensionArea).toBe(3100 * 2700);
  });

  test('free-standing: a second Outline region, all of it Extension', () => {
    const { p } = house();
    const r = applyScenario(
      p,
      scenario(p, () => ({
        op: 'drawRoom',
        rect: { x0: 15000, y0: 1000, x1: 18000, y1: 4000 },
        name: 'Shed'
      }))
    );
    valid(r.plan);
    const id = made(p, r.plan);
    expect(derive(r.plan).parked).not.toContain(id);
    const own = Object.values(r.plan.walls).filter((w) => w.neg === id || w.pos === id);
    expect(own.map((w) => extensionWall(w))).toEqual([true, true, true, true]);
    expect(summarize(p, r).extensionArea).toBe(3200 * 3200);
  });

  test('inside the Outline: interior Walls, no Extension, as before', () => {
    const { p } = house();
    const s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 6000, y0: 5000, x1: 9900, y1: 7900 },
      name: 'Study'
    }));
    expect(s.changes[0]).toMatchObject({ thickness: 100 });
    const r = applyScenario(p, s);
    expect(Object.values(r.plan.walls).some((w) => extensionWall(w))).toBe(false);
    expect(extensionOf(p, r.plan)).toEqual([]);
  });

  test('without an Outline nothing joins one, but the Room is still Extension floor', () => {
    const p = valid(addRoom(emptyPlan(), { name: 'Kitchen', w: 4000, l: 3000, x: 0, y: 0 }).plan);
    const s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 4050, y0: -50, x1: 7000, y1: 3050 },
      name: 'Studio'
    }));
    expect(s.changes[0]).toMatchObject({ thickness: 100 });
    const r = applyScenario(p, s);
    valid(r.plan);
    expect(Object.values(r.plan.walls).some((w) => w.exterior)).toBe(false);
    expect(summarize(p, r).extensionArea).toBeGreaterThan(0);
  });

  test('naming a space closed off outside the Outline with Draw Wall makes an Extension too', () => {
    const { p } = house();
    const r = applyScenario(
      p,
      scenario(
        p,
        () => ({ op: 'drawWall', a: { x: 9900, y: 1000 }, b: { x: 13000, y: 1000 } }),
        () => ({ op: 'drawWall', a: { x: 13000, y: 1000 }, b: { x: 13000, y: 3500 } }),
        () => ({ op: 'drawWall', a: { x: 9900, y: 3500 }, b: { x: 13000, y: 3500 } }),
        () => ({ op: 'nameSpace', x: 11000, y: 2000, name: 'Porch' })
      )
    );
    valid(r.plan);
    const id = made(p, r.plan);
    expect(derive(r.plan).parked).not.toContain(id);
    expect(summarize(p, r).extensionArea).toBe(3050 * 2600);
  });
});

describe('demolishing the Wall an Extension is against', () => {
  test('opens the house into it: the Room inside merges with the Extension', () => {
    const { p, lounge } = house();
    const s = scenario(p, studio, (q) => ({ op: 'demolishWall', wall: between(q, lounge, made(p, q)) }));
    const r = applyScenario(p, s);
    valid(r.plan);
    expect(r.conflicts).toEqual([]);
    // The Lounge is the larger Room, so it keeps its name; the Extension is part of it.
    expect(Object.values(r.plan.rooms).map((x) => x.name)).toEqual(['Kitchen', 'Lounge']);
    expect(derive(r.plan).rooms[lounge]!.area).toBe(2350 * 3800 + 2900 * 2300 + 200 * 2300);
    // The old exterior Wall is Demolished where the Extension was against it.
    const gone = Object.values(r.statuses.demolished).flat();
    expect(gone).toEqual([{ t0: 1000, t1: 3500 }]);
    expect(summarize(p, r).extensionArea).toBe(3100 * 2700);
    expect(summarize(p, r).demolished).toEqual({ count: 1, length: 2500 });
  });

  test('anywhere else it is still refused: the Outline would be left open', () => {
    const { p } = house();
    const s = scenario(p, studio);
    const q = applyScenario(p, s).plan;
    // The right exterior Wall below the Extension, and the bottom one.
    for (const wall of [wallOn(q, 'v', 9900, 6000), wallOn(q, 'h', 7900, 5000)])
      expect(recordChange(p, s, { op: 'demolishWall', wall })).toBeNull();
  });

  test("still refused with an Extension standing free, though that one's loop stays closed", () => {
    const { p } = house();
    const s = scenario(p, () => ({
      op: 'drawRoom',
      rect: { x0: 15000, y0: 1000, x1: 18000, y1: 4000 },
      name: 'Shed'
    }));
    const q = applyScenario(p, s).plan;
    for (const wall of [wallOn(q, 'v', 9900, 6000), wallOn(q, 'h', 7900, 5000)])
      expect(recordChange(p, s, { op: 'demolishWall', wall })).toBeNull();
  });
});

describe("pushing an Extension's outer Wall", () => {
  test('moves it: the Extension grows, unlike an Existing Plan Outline Wall', () => {
    const { p } = house();
    const s0 = scenario(p, studio);
    const q = applyScenario(p, s0).plan;
    const id = made(p, q);
    const outer = wallOn(q, 'v', 13000, 2000);
    expect(runOf(q, outer)).toEqual([outer]);
    const r = applyScenario(
      p,
      scenario(p, studio, (x) => ({ op: 'pushWall', wall: wallOn(x, 'v', 13000, 2000), delta: 1000 }))
    );
    valid(r.plan);
    expect(derive(r.plan).rooms[id]!.bounds).toEqual({ x0: 10000, y0: 1100, x1: 13900, y1: 3400 });
    expect(Object.values(r.plan.walls).filter((w) => extensionWall(w))).toHaveLength(3);
    expect(summarize(p, r).extensionArea).toBe(4100 * 2700);
  });

  test('an Existing Plan Outline Wall stays measured: pushing it resizes the Room against it', () => {
    const { p, lounge } = house();
    const q = applyScenario(p, scenario(p, studio)).plan;
    const right = wallOn(q, 'v', 9900, 300);
    expect(runOf(q, right).some((w) => q.walls[w]!.drawn)).toBe(false);
    const pushed = valid(pushWall(clonePlan(q), right, -300));
    expect(derive(pushed).rooms[lounge]!.bounds!.x1).toBe(9500);
    expect(Object.values(pushed.walls).some((w) => w.exterior && wallLine(pushed, w).c === 9900)).toBe(true);
    expect(extensionOf(p, pushed)).toEqual(extensionOf(p, q));
  });

  test('its sides move too, along the house', () => {
    const { p } = house();
    const r = applyScenario(
      p,
      scenario(p, studio, (x) => ({ op: 'pushWall', wall: wallOn(x, 'h', 1000, 11000), delta: -500 }))
    );
    valid(r.plan);
    const id = made(p, r.plan);
    expect(derive(r.plan).rooms[id]!.bounds).toEqual({ x0: 10000, y0: 600, x1: 12900, y1: 3400 });
    expect(rectsArea(extensionOf(p, r.plan))).toBe(3100 * 3200);
    // The Wall it is against is still one Wall between the two Rooms, so demolishing it still merges them.
    const [lounge] = Object.keys(p.rooms).filter((x) => p.rooms[x]!.name === 'Lounge');
    const old = Object.values(r.plan.walls).filter((w) => w.neg === lounge && w.pos === id);
    expect(old.map((w) => wallLine(r.plan, w)).map((l) => [l.t0, l.t1])).toEqual([[500, 3500]]);
  });
});
