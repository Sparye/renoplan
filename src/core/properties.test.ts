import fc from 'fast-check';
import { expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 600_000 });
import {
  addOpening,
  addOutline,
  addRoom,
  addWing,
  applyMove,
  deleteRoom,
  mergeRooms,
  moveRoom,
  nameSpace,
  prepareMove,
  pushWall,
  setRoomSize,
  setWallThickness
} from './commands';
import { rejections } from './commands/edit';
import { derive } from './derive';
import { Grid } from './grid';
import { normalize } from './normalize';
import { checkPlan } from './invariants';
import { type Plan, clonePlan, emptyPlan, wallLine } from './plan';
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

function apply(p: Plan, o: Op): Plan {
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
      expect(areas(q)).toEqual(before);
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
      expect(without(areas(q), r)).toEqual(without(areas(p), r));
      if (q !== p) {
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
      if (m.id && !derive(p).overlaps.length)
        expect(derive(m.plan).rooms[m.id]!.area).toBeGreaterThanOrEqual(before[neg!]! + before[pos!]!);
      return m.plan;
    }
    case 'delete': {
      const r = pick(rooms, o.i);
      if (!r) return p;
      const q = deleteRoom(p, r);
      expect(areas(q)).toEqual(without(areas(p), r));
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
      if (n.id) {
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

test('moving a Room by nothing changes nothing the user can see', () => {
  const seen = (p: Plan) => {
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
  };
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
