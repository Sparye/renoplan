import fc from 'fast-check';
import { expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 600_000 });
import {
  addOpening,
  addOutline,
  addRoom,
  addWing,
  applyMove,
  deleteOpening,
  deleteRoom,
  mergeRooms,
  moveRoom,
  nameSpace,
  prepareMove,
  MIN_ROOM,
  pushWall,
  setRoomSize,
  setWallThickness
} from './commands';
import { rejections } from './commands/edit';
import { derive } from './derive';
import { Grid, type Rect, intersects, rectsArea } from './grid';
import { normalize } from './normalize';
import { checkPlan } from './invariants';
import { type Plan, clonePlan, emptyPlan, extensionWall, wallLine } from './plan';
import {
  type Change,
  type Gesture,
  type Scenario,
  type Target,
  applyScenario,
  emptyScenario,
  extensionOf,
  recordChange
} from './scenario';
import { type Stretch, union } from './scenario/status';
import { planBounds } from './queries';
import { snapMove } from './snap';

// Random capture sessions: every command keeps the plan valid, and commands that promise not to move
// neighbours don't.

const len = (min: number, max: number) => fc.integer({ min: min / 50, max: max / 50 }).map((v) => v * 50);
const delta = len(-6000, 6000);

const op = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.record({ k: fc.constant('outline' as const), w: len(6000, 14000), l: len(5000, 11000) })
  },
  {
    weight: 1,
    arbitrary: fc.record({
      k: fc.constant('wing' as const),
      side: fc.constantFrom('right' as const, 'bottom' as const, 'left' as const, 'top' as const),
      w: len(1500, 5000),
      l: len(1500, 5000)
    })
  },
  {
    weight: 4,
    arbitrary: fc.record({ k: fc.constant('add' as const), w: len(600, 6000), l: len(600, 6000) })
  },
  {
    weight: 6,
    arbitrary: fc.record({
      k: fc.constant('move' as const),
      i: fc.nat(),
      dx: delta,
      dy: delta,
      snap: fc.boolean()
    })
  },
  {
    weight: 4,
    arbitrary: fc.record({ k: fc.constant('push' as const), i: fc.nat(), d: delta, outline: fc.boolean() })
  },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('size' as const),
      i: fc.nat(),
      w: len(300, 6000),
      l: len(300, 6000)
    })
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('merge' as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('delete' as const), i: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('opening' as const),
      i: fc.nat(),
      kind: fc.constantFrom('door' as const, 'window' as const, 'opening' as const),
      t: fc.double({ min: 0, max: 1, noNaN: true })
    })
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('name' as const), i: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('thickness' as const), i: fc.nat(), t: len(50, 400) }) }
);
type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

const pick = <T>(xs: T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);
const areas = (p: Plan) => Object.fromEntries(Object.entries(derive(p).rooms).map(([id, g]) => [id, g.area]));
const without = (o: Record<string, number>, id: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));

/** Applies a capture command; `checks` also asserts what the command promises (off where they are not under test). */
function apply(p: Plan, o: Op, checks = true): Plan {
  const rooms = Object.keys(p.rooms);
  const walls = Object.keys(p.walls);
  switch (o.k) {
    case 'outline':
      return addOutline(p, o.w, o.l);
    case 'wing':
      return addWing(p, o.side, o.w, o.l);
    case 'add':
      return addRoom(p, { name: 'R', w: o.w, l: o.l }).plan;
    case 'move': {
      const r = pick(rooms, o.i);
      if (!r) return p;
      const before = areas(p);
      let q: Plan;
      if (o.snap) {
        const prep = prepareMove(p, r)!;
        const s = snapMove(prep.plan, r, o.dx, o.dy, { threshold: 400, grid: 100 });
        q = applyMove(prep, s.dx, s.dy);
      } else q = moveRoom(p, r, o.dx, o.dy);
      // Moving a Room never changes its own area or anyone else's.
      if (checks) expect(areas(q)).toEqual(before);
      return q;
    }
    case 'push': {
      const w = pick(walls, o.i);
      return w ? pushWall(p, w, o.d, { outline: o.outline }) : p;
    }
    case 'size': {
      const r = pick(rooms, o.i);
      if (!r) return p;
      const q = setRoomSize(p, r, o.w, o.l);
      // Neighbours never move.
      if (checks) expect(without(areas(q), r)).toEqual(without(areas(p), r));
      if (checks && q !== p) {
        const b = derive(q).rooms[r]!.bounds!;
        expect([b.x1 - b.x0, b.y1 - b.y0]).toEqual([o.w, o.l]);
      }
      return q;
    }
    case 'merge': {
      const shared = walls.filter((id) => p.walls[id]!.neg && p.walls[id]!.pos);
      const w = pick(shared, o.i);
      if (!w) return p;
      const { neg, pos } = p.walls[w]!;
      const before = areas(p);
      const m = mergeRooms(p, w);
      // Without an Overlap, nothing is counted twice: the merged Room has at least both areas.
      if (checks && m.id && !derive(p).overlaps.length)
        expect(derive(m.plan).rooms[m.id]!.area).toBeGreaterThanOrEqual(before[neg!]! + before[pos!]!);
      return m.plan;
    }
    case 'delete': {
      const r = pick(rooms, o.i);
      if (!r) return p;
      const q = deleteRoom(p, r);
      if (checks) expect(areas(q)).toEqual(without(areas(p), r));
      return q;
    }
    case 'opening': {
      const w = pick(walls, o.i);
      if (!w) return p;
      const l = wallLine(p, p.walls[w]!);
      return addOpening(p, w, o.kind, l.t0 + o.t * (l.t1 - l.t0)).plan;
    }
    case 'name': {
      const s = pick(derive(p).unlabelled, o.i);
      if (!s) return p;
      const r = s.rects.reduce((a, b) =>
        Math.min(b.x1 - b.x0, b.y1 - b.y0) > Math.min(a.x1 - a.x0, a.y1 - a.y0) ? b : a
      );
      const before = areas(p);
      const n = nameSpace(p, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 'Hallway');
      if (checks && n.id) {
        expect(without(areas(n.plan), n.id)).toEqual(before);
        expect(derive(n.plan).rooms[n.id]!.area).toBeGreaterThanOrEqual(s.area);
      }
      return n.plan;
    }
    case 'thickness': {
      const w = pick(walls, o.i);
      return w ? setWallThickness(p, w, o.t) : p;
    }
  }
}

test('every command sequence keeps the plan valid and in normal form', () => {
  let commands = 0;
  rejections.count = 0;
  fc.assert(
    fc.property(fc.array(op, { minLength: 1, maxLength: 25 }), (ops) => {
      let p = emptyPlan();
      for (const o of ops) {
        p = apply(p, o);
        commands++;
        const errs = checkPlan(p);
        if (errs.length) throw new Error(`${JSON.stringify(o)} → ${errs.join('; ')}`);
        expect(normalize(clonePlan(p))).toEqual(p);
      }
    }),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
  // The soundness net is a backstop for rare corner cases, not how commands normally behave.
  expect(rejections.count / commands).toBeLessThan(0.01);
});

/** What the user can see of a plan. */
function seen(p: Plan) {
  const D = derive(p);
  const solid = Object.values(D.walls).map((w) => w.rect);
  const g = new Grid(solid);
  const m = g.mask(solid);
  return {
    rooms: Object.fromEntries(Object.entries(D.rooms).map(([id, r]) => [id, r.rects])),
    walls: g.rects((c) => m[c] === 1),
    unlabelled: D.unlabelled.map((s) => s.rects),
    openings: Object.values(p.openings).map((o) => [o.kind, o.at, o.width])
  };
}

test('moving a Room by nothing changes nothing the user can see', () => {
  fc.assert(
    fc.property(fc.array(op, { minLength: 1, maxLength: 20 }), fc.nat(), (ops, i) => {
      let p = emptyPlan();
      for (const o of ops) p = apply(p, o);
      const r = pick(Object.keys(p.rooms), i);
      if (!r) return;
      expect(seen(moveRoom(p, r, 0, 0))).toEqual(seen(p));
    }),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
});

// ---------- Scenarios (ADR 0010) ----------
// Random capture sessions, then random Scenario Mode gestures recorded over them, then more Existing Plan
// edits underneath: replaying never throws, stays valid, and Conflicts arise only from real edits.

// Extensions (ADR 0012): a Room drawn against the outside of an exterior Wall, or free-standing beyond the
// plan; and demolishing exterior Walls, or the Wall an Extension is against.
const extend = fc.record({
  k: fc.constant('extend' as const),
  i: fc.nat(),
  t: fc.double({ min: 0, max: 1, noNaN: true }),
  w: len(1000, 5000),
  d: len(1000, 4000)
});
const shed = fc.record({
  k: fc.constant('shed' as const),
  below: fc.boolean(),
  f: fc.double({ min: 0, max: 1, noNaN: true }),
  gap: len(300, 3000),
  w: len(1000, 4000),
  l: len(1000, 4000)
});
const open = fc.record({ k: fc.constant('open' as const), i: fc.nat() });

const gesture = fc.oneof(
  { weight: 3, arbitrary: fc.record({ k: fc.constant('demolish' as const), i: fc.nat() }) },
  {
    weight: 4,
    arbitrary: fc.record({
      k: fc.constant('draw' as const),
      i: fc.nat(),
      t: fc.double({ min: 0, max: 1, noNaN: true }),
      up: fc.boolean(),
      // Ends on another Wall's centreline, or runs a free length.
      to: fc.option(fc.nat(), { nil: null }),
      len: len(300, 6000)
    })
  },
  {
    weight: 3,
    arbitrary: fc.record({ k: fc.constant('push' as const), i: fc.nat(), d: delta, outline: fc.boolean() })
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('thickness' as const), i: fc.nat(), t: len(50, 400) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('opening' as const),
      i: fc.nat(),
      kind: fc.constantFrom('door' as const, 'window' as const, 'opening' as const),
      t: fc.double({ min: 0, max: 1, noNaN: true })
    })
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('unopen' as const), i: fc.nat() }) },
  {
    weight: 1,
    arbitrary: fc.record({
      k: fc.constant('reopen' as const),
      i: fc.nat(),
      d: len(-1000, 1000),
      w: len(300, 2000)
    })
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('name' as const), i: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('room' as const),
      fx: fc.double({ min: 0, max: 1, noNaN: true }),
      fy: fc.double({ min: 0, max: 1, noNaN: true }),
      w: len(300, 5000),
      l: len(300, 5000)
    })
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('rename' as const), i: fc.nat() }) },
  { weight: 2, arbitrary: extend },
  { weight: 1, arbitrary: shed },
  { weight: 2, arbitrary: open }
);
type G = typeof gesture extends fc.Arbitrary<infer T> ? T : never;

/** Sessions that mostly build Extensions and open the house into them, among any other gestures. */
const extensionGesture = fc.oneof(
  { weight: 4, arbitrary: extend },
  { weight: 1, arbitrary: shed },
  { weight: 3, arbitrary: open },
  { weight: 4, arbitrary: gesture }
);

/** The point to name an Unlabelled Space at: the middle of its widest rectangle. */
function spacePoint(p: Plan, i: number) {
  const s = pick(derive(p).unlabelled, i);
  if (!s) return null;
  const r = s.rects.reduce((a, b) =>
    Math.min(b.x1 - b.x0, b.y1 - b.y0) > Math.min(a.x1 - a.x0, a.y1 - a.y0) ? b : a
  );
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

function toGesture(p: Plan, g: G): Gesture | null {
  const walls = Object.keys(p.walls);
  const openings = Object.keys(p.openings);
  switch (g.k) {
    case 'demolish': {
      const w = pick(walls, g.i);
      return w ? { op: 'demolishWall', wall: w } : null;
    }
    case 'room': {
      // A rectangle anywhere over the plan, on the 50 mm grid.
      const b = planBounds(p);
      if (!b) return null;
      const x0 = Math.round((b.x0 + g.fx * (b.x1 - b.x0)) / 50) * 50;
      const y0 = Math.round((b.y0 + g.fy * (b.y1 - b.y0)) / 50) * 50;
      return { op: 'drawRoom', rect: { x0, y0, x1: x0 + g.w, y1: y0 + g.l }, name: 'Den' };
    }
    case 'draw': {
      const w = pick(walls, g.i);
      if (!w) return null;
      const l = wallLine(p, p.walls[w]!);
      const t = Math.round(l.t0 + g.t * (l.t1 - l.t0));
      const sign = g.up ? -1 : 1;
      let end = l.c + sign * g.len;
      if (g.to !== null) {
        // The nearest parallel centreline on that side whose span covers t.
        const across = walls
          .map((id) => wallLine(p, p.walls[id]!))
          .filter((m) => m.axis === l.axis && m.t0 <= t && t <= m.t1 && sign * (m.c - l.c) > 0)
          .map((m) => m.c);
        const target = pick(across, g.to);
        if (target !== undefined) end = target;
      }
      const at = (c: number) => (l.axis === 'h' ? { x: t, y: c } : { x: c, y: t });
      return { op: 'drawWall', a: at(l.c), b: at(end) };
    }
    case 'push': {
      const w = pick(walls, g.i);
      return w ? { op: 'pushWall', wall: w, delta: g.d, outline: g.outline } : null;
    }
    case 'thickness': {
      const w = pick(walls, g.i);
      return w ? { op: 'setThickness', wall: w, thickness: g.t } : null;
    }
    case 'opening': {
      const w = pick(walls, g.i);
      if (!w) return null;
      const l = wallLine(p, p.walls[w]!);
      return { op: 'addOpening', wall: w, kind: g.kind, center: l.t0 + g.t * (l.t1 - l.t0) };
    }
    case 'unopen': {
      const o = pick(openings, g.i);
      return o ? { op: 'removeOpening', opening: o } : null;
    }
    case 'reopen': {
      const o = pick(openings, g.i);
      return o
        ? { op: 'modifyOpening', opening: o, patch: { at: p.openings[o]!.at + g.d, width: g.w } }
        : null;
    }
    case 'name': {
      const at = spacePoint(p, g.i);
      return at ? { op: 'nameSpace', ...at, name: 'Studio' } : null;
    }
    case 'rename': {
      const r = pick(Object.keys(p.rooms), g.i);
      return r ? { op: 'renameRoom', room: r, name: `Room ${g.i}` } : null;
    }
    case 'extend': {
      // One side of the rectangle on an exterior Wall's centreline, the rest outside the Outline.
      const D = derive(p);
      // Mostly against a Room, so that demolishing the Wall opens the house into the Extension.
      const outline = walls.filter((id) => p.walls[id]!.exterior);
      const roomy = outline.filter((id) => p.walls[id]!.neg || p.walls[id]!.pos);
      const w = pick(roomy.length && g.i % 4 ? roomy : outline, g.i);
      if (!w) return null;
      const l = wallLine(p, p.walls[w]!);
      const a = Math.round((l.t0 + g.t * (l.t1 - l.t0) - g.w / 2) / 50) * 50;
      const probe = (c: number) =>
        l.axis === 'h' ? D.insideOutline(a + g.w / 2, c) : D.insideOutline(c, a + g.w / 2);
      const out = probe(l.lo - 1) ? 1 : probe(l.hi + 1) ? -1 : 0;
      if (!out) return null;
      const [c0, c1] = [l.c, l.c + out * g.d].sort((x, y) => x - y) as [number, number];
      const rect =
        l.axis === 'h' ? { x0: a, x1: a + g.w, y0: c0, y1: c1 } : { x0: c0, x1: c1, y0: a, y1: a + g.w };
      return { op: 'drawRoom', rect, name: 'Extension' };
    }
    case 'shed': {
      const b = planBounds(p);
      if (!b) return null;
      const snap = (v: number) => Math.round(v / 50) * 50;
      const rect = g.below
        ? { x0: snap(b.x0 + g.f * (b.x1 - b.x0)), y0: snap(b.y1 + g.gap) }
        : { x0: snap(b.x1 + g.gap), y0: snap(b.y0 + g.f * (b.y1 - b.y0)) };
      return { op: 'drawRoom', rect: { ...rect, x1: rect.x0 + g.w, y1: rect.y0 + g.l }, name: 'Shed' };
    }
    case 'open': {
      // The Wall between an Extension and the house when there is one, else any exterior Wall.
      const ext = new Set(
        Object.values(p.walls)
          .filter((w) => extensionWall(w))
          .flatMap((w) => [w.neg, w.pos])
      );
      const against = walls.filter((id) => {
        const w = p.walls[id]!;
        return !w.drawn && !w.exterior && w.neg && w.pos && (ext.has(w.neg) || ext.has(w.pos));
      });
      const w = pick(against.length && g.i % 4 ? against : walls.filter((id) => p.walls[id]!.exterior), g.i);
      return w ? { op: 'demolishWall', wall: w } : null;
    }
  }
}

/** An Existing Plan session. What capture commands promise is the capture properties' business, not these. */
function capture(ops: readonly Op[], from = emptyPlan()): Plan {
  let p = from;
  for (const o of ops)
    try {
      p = apply(p, o, false);
    } catch {
      // A capture command that throws is the capture properties' to report; this session goes on without it.
    }
  return p;
}

/** How many Changes of each kind the sessions recorded, so a generator that never lands one shows up. */
const recorded = new Map<string, number>();

/** Records the gestures that do something, checking the Scenario after each one. */
function record(existing: Plan, gestures: readonly G[]): Scenario {
  let s = emptyScenario('s1', 'Option');
  for (const g of gestures) {
    const before = applyScenario(existing, s).plan;
    const ge = toGesture(before, g);
    const r0 = rejections.count;
    const r = ge && recordChange(existing, s, ge);
    // The soundness backstop, outside what it refuses by design: demolishing a Wall that leaves a Room or
    // the Outline open (ADR 0010).
    if (ge && ge.op !== 'demolishWall') {
      const tally = g.k === 'extend' || g.k === 'shed' ? extensionGestures : scenarioGestures;
      tally.count++;
      if (rejections.count > r0) tally.rejected++;
    }
    if (!r) continue;
    s = r.scenario;
    const count = (k: string) => recorded.set(k, (recorded.get(k) ?? 0) + 1);
    count(ge.op);
    const out = applyScenario(existing, s);
    // A recorded Change is never born a Conflict.
    expect(out.conflicts).toEqual([]);
    sound(out.plan, ge);
    // The Room on the inside face of an Extension's Wall is inside the Outline it joined.
    const D = derive(out.plan);
    for (const [id, w] of Object.entries(out.plan.walls)) {
      if (!extensionWall(w)) continue;
      const l = D.walls[id]!.line;
      const mid = (l.t0 + l.t1) / 2;
      for (const [side, f] of [
        ['neg', l.lo - 0.5],
        ['pos', l.hi + 0.5]
      ] as const) {
        const room = w[side];
        const inside = l.axis === 'v' ? D.insideOutline(f, mid) : D.insideOutline(mid, f);
        if (room && inside) expect(D.parked).not.toContain(room);
      }
    }
    const grew = rectsArea(extensionOf(existing, out.plan)) > rectsArea(extensionOf(existing, before));
    if (ge.op === 'drawRoom' && grew && Object.values(out.plan.walls).some((w) => extensionWall(w)))
      count('extension');
    if (
      g.k === 'open' &&
      ge.op === 'demolishWall' &&
      Object.keys(out.plan.rooms).length < Object.keys(before.rooms).length
    )
      count('opened');
  }
  return s;
}

/**
 * Scenario gestures, and how many of them the soundness backstop refused. Extension gestures are counted
 * apart: the others' rate (about 2%, mostly pushes) predates them.
 */
const scenarioGestures = { count: 0, rejected: 0 };
const extensionGestures = { count: 0, rejected: 0 };

function sound(p: Plan, why: unknown) {
  const errs = checkPlan(p);
  if (errs.length) throw new Error(`${JSON.stringify(why)} → ${errs.join('; ')}`);
  expect(normalize(clonePlan(p))).toEqual(p);
}

/** Retained + Demolished covers the Existing Plan's Walls; Retained + New covers the Scenario's. */
function statusesAddUp(existing: Plan, r: ReturnType<typeof applyScenario>) {
  const by = (p: Plan) => {
    const m = new Map<string, Stretch[]>();
    for (const w of Object.values(p.walls)) {
      const l = wallLine(p, w);
      const k = `${l.axis}|${l.c}|${w.thickness}`;
      m.set(k, [...(m.get(k) ?? []), { t0: l.t0, t1: l.t1 }]);
    }
    return m;
  };
  const length = (s: Stretch[]) => union(s).reduce((n, x) => n + x.t1 - x.t0, 0);
  const keyed = (p: Plan, ids: Record<string, Stretch[]>) => {
    const m = new Map<string, Stretch[]>();
    for (const [id, s] of Object.entries(ids)) {
      const l = wallLine(p, p.walls[id]!);
      const k = `${l.axis}|${l.c}|${p.walls[id]!.thickness}`;
      m.set(k, [...(m.get(k) ?? []), ...s]);
    }
    return m;
  };
  const only = (status: string) =>
    keyed(
      r.plan,
      Object.fromEntries(
        Object.entries(r.statuses.walls).map(([id, s]) => [id, s.filter((x) => x.status === status)])
      )
    );
  const retained = only('retained');
  const added = only('new');
  const gone = keyed(existing, r.statuses.demolished);
  for (const [k, s] of by(existing))
    expect(length(retained.get(k) ?? []) + length(gone.get(k) ?? [])).toBe(length(s));
  for (const [k, s] of by(r.plan))
    expect(length(retained.get(k) ?? []) + length(added.get(k) ?? [])).toBe(length(s));
}

// Known open capture bugs (ADR 0009, "Known open"), pinned as failing until fixed. Each replays a
// counterexample the random sessions found.
const replay = (ops: Op[]) => {
  let p = emptyPlan();
  for (const o of ops) {
    p = apply(p, o);
    const errs = checkPlan(p);
    if (errs.length) throw new Error(errs.join('; '));
  }
  return p;
};
const zeroMoveKeepsAreas = (p: Plan, i: number) => {
  const r = pick(Object.keys(p.rooms), i)!;
  expect(areas(moveRoom(p, r, 0, 0))).toEqual(areas(p));
};
/** The move happens (the soundness check doesn't refuse it) and keeps every area. */
const movesKeepingAreas = (p: Plan, i: number, dx: number, dy: number) => {
  const r = pick(Object.keys(p.rooms), i)!;
  const q = moveRoom(p, r, dx, dy);
  expect(q).not.toBe(p);
  expect(areas(q)).toEqual(areas(p));
};

test.fails("end cap A: a Room bounded by a thick Wall's end cap keeps its area on a zero move", () => {
  const p = replay([
    { k: 'outline', w: 6000, l: 5000 },
    { k: 'wing', side: 'top', w: 3400, l: 1500 },
    { k: 'push', i: 1126362752, d: -2550, outline: false },
    { k: 'name', i: 0 },
    { k: 'thickness', i: 230723158, t: 50 },
    { k: 'outline', w: 6000, l: 5000 }
  ]);
  zeroMoveKeepsAreas(p, 0);
});

test.fails('end cap B: a merged Room crossing the Outline keeps its area on a 50 mm move', () => {
  const p = replay([
    { k: 'outline', w: 6000, l: 5000 },
    { k: 'add', w: 600, l: 600 },
    { k: 'push', i: 103677491, d: 2250, outline: false },
    { k: 'name', i: 0 },
    { k: 'size', i: 0, w: 300, l: 750 },
    { k: 'merge', i: 0 }
  ]);
  movesKeepingAreas(p, 0, 0, -50);
});

test.fails('end cap E: a merged Room across a right wing keeps its area on a 50 mm move', () => {
  const p = replay([
    { k: 'add', w: 600, l: 600 },
    { k: 'outline', w: 6000, l: 5000 },
    { k: 'name', i: 0 },
    { k: 'wing', side: 'right', w: 1500, l: 1500 },
    { k: 'move', i: 0, dx: -2200, dy: 750, snap: false },
    { k: 'merge', i: 0 }
  ]);
  movesKeepingAreas(p, 0, 0, -50);
});

test.fails('merge then move never leaves a Room on both faces of a Wall', () => {
  const p = replay([
    { k: 'outline', w: 6000, l: 5000 },
    { k: 'name', i: 0 },
    { k: 'add', w: 600, l: 600 },
    { k: 'add', w: 600, l: 600 },
    { k: 'move', i: 1871132627, dx: -1150, dy: 0, snap: true },
    { k: 'push', i: 734491472, d: -50, outline: false },
    { k: 'move', i: 0, dx: 1700, dy: -250, snap: true },
    { k: 'merge', i: 79485247 }
  ]);
  movesKeepingAreas(p, 0, 0, 50);
});

/** A Scenario recorded over a capture session replays the same from scratch, and soundly after more edits. */
function replaysSoundly(before: Op[], gestures: G[], after: Op[], from?: Plan) {
  const e0 = capture(before, from);
  const s = record(e0, gestures);
  // Replaying from scratch, as after reopening the Project, gives the same plan.
  const again = applyScenario(clonePlan(e0), structuredClone(s));
  expect(again.plan).toEqual(applyScenario(e0, s).plan);
  statusesAddUp(e0, again);

  const e1 = capture(after, e0);
  const r = applyScenario(e1, s);
  sound(r.plan, { after });
  statusesAddUp(e1, r);
  const ids = s.changes.map((c) => c.id);
  expect(new Set(r.conflicts.map((c) => c.change)).size).toBe(r.conflicts.length);
  for (const c of r.conflicts) expect(ids).toContain(c.change);
}

test('a Scenario replays soundly over any later Existing Plan edits', () => {
  fc.assert(
    fc.property(
      fc.array(op, { minLength: 1, maxLength: 20 }),
      fc.array(gesture, { minLength: 1, maxLength: 10 }),
      fc.array(op, { maxLength: 10 }),
      (before, gestures, after) => replaysSoundly(before, gestures, after)
    ),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
  // Every kind of gesture was recorded somewhere.
  expect([...recorded.keys()].filter((k) => k !== 'extension' && k !== 'opened').sort()).toEqual(
    [
      'addOpening',
      'demolishWall',
      'drawWall',
      'modifyOpening',
      'nameSpace',
      'drawRoom',
      'pushWall',
      'removeOpening',
      'renameRoom',
      'setThickness'
    ].sort()
  );
  if (process.env.STATS) console.log(Object.fromEntries(recorded), scenarioGestures);
});

/**
 * A house whose Rooms are against its Outline, so Extensions have a Room to open into: a row of Rooms along
 * the top of the Outline, and one along the bottom.
 */
const tiled = fc
  .record({
    w: len(6000, 14000),
    l: len(7000, 11000),
    top: fc.array(len(1500, 4000), { minLength: 1, maxLength: 4 }),
    depth: len(2000, 3500),
    bottom: len(1500, 5000),
    under: len(1500, 3000)
  })
  .map((h) => {
    let p = addOutline(emptyPlan(), h.w, h.l, { x: 0, y: 0 });
    let x = 200;
    for (const w of h.top) {
      if (x + w > h.w - 200) break;
      p = addRoom(p, { name: 'Top', w, l: h.depth, x, y: 200 }).plan;
      x += w + 100;
    }
    const w = Math.min(h.bottom, h.w - 400);
    return addRoom(p, { name: 'Bottom', w, l: h.under, x: 200, y: h.l - 200 - h.under }).plan;
  });

test('Extensions: Rooms drawn outside the Outline and exterior Walls demolished replay soundly', () => {
  recorded.clear();
  fc.assert(
    fc.property(
      tiled,
      fc.array(op, { maxLength: 10 }),
      fc.array(extensionGesture, { minLength: 1, maxLength: 10 }),
      fc.array(op, { maxLength: 10 }),
      (house, before, gestures, after) => replaysSoundly(before, gestures, after, house)
    ),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
  // Extensions were made, and the house opened into them.
  expect(recorded.get('extension')).toBeGreaterThan(0);
  expect(recorded.get('opened')).toBeGreaterThan(0);
  if (process.env.STATS) console.log(Object.fromEntries(recorded), extensionGestures);
  // The soundness backstop stays a backstop for them: under 1% (ADR 0012). A rate needs a sample, so it is
  // checked on longer runs (RUNS=1000 and up); the default run makes only a few hundred of these gestures.
  if (extensionGestures.count >= 1000)
    expect(extensionGestures.rejected / extensionGestures.count).toBeLessThan(0.01);
});

/** Existing Plan edits that touch nothing a Scenario points at, or only nudge it. */
const harmless = fc.oneof(
  fc.record({ k: fc.constant('still' as const), i: fc.nat() }),
  fc.record({ k: fc.constant('room' as const), w: len(600, 4000), l: len(600, 4000) }),
  fc.record({
    k: fc.constant('opening' as const),
    i: fc.nat(),
    kind: fc.constantFrom('door' as const, 'window' as const),
    t: fc.double({ min: 0, max: 1, noNaN: true })
  }),
  fc.record({ k: fc.constant('nudge' as const), i: fc.nat(), d: fc.constantFrom(-50, 50) })
);

test('harmless Existing Plan edits never make a Change conflict', () => {
  fc.assert(
    fc.property(
      fc.array(op, { minLength: 1, maxLength: 20 }),
      fc.array(gesture, { minLength: 1, maxLength: 10 }),
      harmless,
      (before, gestures, h) => {
        const e0 = capture(before);
        const s = record(e0, gestures);
        // Every Wall the Scenario has at any step of its replay, and those of them it drew.
        const steps = s.changes.map(
          (_, k) => applyScenario(e0, { ...s, changes: s.changes.slice(0, k + 1) }).plan
        );
        const all = steps.flatMap((q) => Object.values(derive(q).walls).map((w) => w.rect));
        const drawn = steps.flatMap((q) =>
          Object.keys(q.walls)
            .filter((id) => q.walls[id]!.drawn)
            .map((id) => derive(q).walls[id]!.rect)
        );
        const clear = (rs: Rect[], of: Rect[], margin: number) =>
          !rs.some((r) => {
            const zone = { x0: r.x0 - margin, y0: r.y0 - margin, x1: r.x1 + margin, y1: r.y1 + margin };
            return of.some((w) => intersects(w, zone));
          });
        // Moving a Room against an L-shaped Outline can still change it (open capture bugs, ADR 0010).
        const winged = (derive(e0).outline?.inside.length ?? 0) > 1;
        let e1 = e0;
        if ((h.k === 'still' || h.k === 'nudge') && winged) return;
        if (h.k === 'still') {
          const r = pick(Object.keys(e0.rooms), h.i);
          if (r) e1 = moveRoom(e0, r, 0, 0);
          // Capture's known move-by-nothing bugs (ADR 0010, deferred) are not harmless edits.
          if (JSON.stringify(seen(e1)) !== JSON.stringify(seen(e0))) return;
        } else if (h.k === 'room') {
          const a = addRoom(e0, { name: 'Shed', w: h.w, l: h.l });
          // A new Room is parked clear of the Existing Plan, but a Scenario may have drawn out there: the
          // edit is harmless only if the Room lands clear of every Wall the Scenario has at any step, and
          // of every Room it drew.
          const drawnRooms = s.changes.flatMap((c) => (c.op === 'drawRoom' ? [c.rect] : []));
          const shed = [derive(a.plan).rooms[a.id!]?.bounds ?? null].filter((b) => b !== null);
          if (!a.id || !clear(shed, all, 300) || !clear(shed, drawnRooms, 300)) return;
          e1 = a.plan;
        } else if (h.k === 'opening') {
          const w = pick(Object.keys(e0.walls), h.i);
          if (w) {
            const l = wallLine(e0, e0.walls[w]!);
            e1 = addOpening(e0, w, h.kind, l.t0 + h.t * (l.t1 - l.t0)).plan;
          }
        } else {
          // A measurement correction: an interior Wall bounding a Room moves a little...
          const w = pick(
            Object.keys(e0.walls).filter(
              (id) => !e0.walls[id]!.exterior && (e0.walls[id]!.neg || e0.walls[id]!.pos)
            ),
            h.i
          );
          if (!w) return;
          e1 = pushWall(e0, w, h.d);
          // ... with the same Rooms on its faces (in an Overlap, a nudge can change which Rooms meet).
          const { neg, pos } = e0.walls[w]!;
          const l = wallLine(e0, e0.walls[w]!);
          const kept = Object.values(e1.walls).some((x) => {
            const m = wallLine(e1, x);
            return (
              x.neg === neg &&
              x.pos === pos &&
              m.axis === l.axis &&
              m.c === l.c + h.d &&
              Math.min(m.t1, l.t1) > Math.max(m.t0, l.t0)
            );
          });
          if (!kept) return;
          // Unless, replayed in the Scenario, the material it moves runs into Walls the Scenario drew: their
          // ends stay where they were drawn (ADR 0010, deferred).
          const material = (q: Plan) => new Set(seen(q).walls.map((r) => JSON.stringify(r)));
          // Nor may it close up an Unlabelled Space the Scenario has (a strip nudged below SLIVER is gone), or
          // bring a Room to the minimum size, where a Scenario's push no longer fits.
          const tight = (q: Plan) =>
            Object.values(derive(q).rooms).some(
              (g) =>
                g.bounds && Math.min(g.bounds.x1 - g.bounds.x0, g.bounds.y1 - g.bounds.y0) < MIN_ROOM + 100
            );
          const moved: Rect[] = [];
          for (let k = 0; k < s.changes.length; k++) {
            const prefix = { ...s, changes: s.changes.slice(0, k + 1) };
            const [q0, q1] = [applyScenario(e0, prefix).plan, applyScenario(e1, prefix).plan];
            if (derive(q0).unlabelled.length !== derive(q1).unlabelled.length || tight(q1)) return;
            const [m0, m1] = [material(q0), material(q1)];
            for (const r of [...m0, ...m1]) if (!m0.has(r) || !m1.has(r)) moved.push(JSON.parse(r) as Rect);
          }
          if (!clear(moved, drawn, 100)) return;
        }
        const r = applyScenario(e1, s);
        sound(r.plan, h);
        expect(r.conflicts).toEqual([]);
      }
    ),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
});

test('a Change whose Existing Plan Room or Opening is deleted is a Conflict', () => {
  fc.assert(
    fc.property(
      fc.array(op, { minLength: 1, maxLength: 20 }),
      fc.array(gesture, { minLength: 1, maxLength: 10 }),
      fc.nat(),
      (before, gestures, i) => {
        const e0 = capture(before);
        const s = record(e0, gestures);
        const target = (t: Target) => (typeof t === 'string' ? t : null);
        const aimed: { c: Change; room?: string; opening?: string }[] = [];
        for (const c of s.changes) {
          if (c.op === 'renameRoom' && target(c.room)) aimed.push({ c, room: target(c.room)! });
          if ((c.op === 'removeOpening' || c.op === 'modifyOpening') && target(c.opening))
            aimed.push({ c, opening: target(c.opening)! });
        }
        const a = pick(aimed, i);
        if (!a) return;
        const e1 = a.room ? deleteRoom(e0, a.room) : deleteOpening(e0, a.opening!);
        if (e1 === e0) return;
        const r = applyScenario(e1, s);
        sound(r.plan, a);
        expect(r.conflicts).toContainEqual({ change: a.c.id, reason: 'vanished' });
      }
    ),
    { numRuns: Number(process.env.RUNS ?? 300) }
  );
});
