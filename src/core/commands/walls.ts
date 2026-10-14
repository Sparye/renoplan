import { derive } from '../derive';
import { collinearClosure, incidence, moveNodes, runOf } from '../graph';
import { mergeCollinear, mergeNodes } from '../normalize';
import {
  type Axis,
  type NodeId,
  type Plan,
  type RoomId,
  type WallId,
  clonePlan,
  faceOffsets,
  point,
  sideOf,
  wallLine
} from '../plan';
import type { Mm } from '../units';
import { detachFrom, isolateNodes } from './detach';
import { edit, finish } from './edit';

/** No Room's inside dimension is pushed below this. A degenerate-room guard, not a collision clamp. */
export const MIN_ROOM: Mm = 300;

export interface PushPrep {
  /** The plan before the push. */
  base: Plan;
  /** The plan with any detaching already done, not yet in normal form. */
  plan: Plan;
  /** The Walls that move. */
  run: WallId[];
  axis: Axis;
  range: [Mm, Mm];
}

/**
 * Prepares a push/pull of the run through a Wall. Every Room against the run is detached first, so its
 * own copy of the run moves and its corners stretch with it; T-junctions never slide along a neighbour's
 * Wall, and normal form fuses everything back afterwards.
 *
 * The Outline is measured: an exterior run with Rooms against it stays put and only the Rooms' copies
 * move — unless `outline` is set (⌥-drag), or nothing is against it.
 */
export function preparePush(p: Plan, wallId: WallId, opts: { outline?: boolean } = {}): PushPrep | null {
  if (!p.walls[wallId]) return null;
  const d = clonePlan(p);
  const run0 = runOf(d, wallId);
  const rooms = new Set(run0.flatMap((id) => [d.walls[id]!.neg, d.walls[id]!.pos]).filter((r) => r !== null));
  const bare = run0.filter((id) => !d.walls[id]!.exterior && !d.walls[id]!.neg && !d.walls[id]!.pos);
  const copies = new Map<WallId, WallId[]>();
  for (const room of rooms) {
    const shared = Object.keys(d.walls).filter((id) => {
      const w = d.walls[id]!;
      const side = sideOf(w, room);
      return side !== null && (w.exterior || w[side === 'neg' ? 'pos' : 'neg'] !== null);
    });
    for (const [orig, copy] of detachFrom(d, room, shared))
      copies.set(orig, [...(copies.get(orig) ?? []), copy]);
  }
  mergeNodes(d);
  for (const room of rooms) isolateNodes(d, room);
  // With their own nodes, the Rooms' Walls no longer need the splits a neighbour's junction made.
  const renamed = new Map<WallId, WallId>();
  while (mergeCollinear(d, (drop, keep) => renamed.set(drop, keep)));
  const live = (id: WallId): WallId => (d.walls[id] ? id : renamed.has(id) ? live(renamed.get(id)!) : id);
  const run = new Set<WallId>();
  for (const id0 of run0) {
    for (const c of copies.get(id0) ?? []) run.add(live(c));
    const id = live(id0);
    const w = d.walls[id];
    if (!w) continue;
    if (w.exterior) {
      if (opts.outline || !rooms.size) run.add(id);
    } else if (!claimsNone(w) || bare.includes(id)) run.add(id);
    else {
      // A Shared Wall whose Rooms have all taken copies: its Openings go with the first copy.
      const first = live(copies.get(id0)![0]!);
      for (const o of Object.values(d.openings)) if (o.wall === id) o.wall = first;
      delete d.walls[id];
    }
  }
  const ids = collinearClosure(
    d,
    [...run].filter((id) => d.walls[id])
  );
  if (!ids.length) return null;
  const axis = wallLine(d, d.walls[ids[0]!]!).axis;
  return { base: p, plan: d, run: ids, axis, range: pushRange(d, ids) };
}

const claimsNone = (w: { neg: string | null; pos: string | null }) => !w.neg && !w.pos;

export function applyPush(prep: PushPrep, delta: Mm): Plan {
  const d = clonePlan(prep.plan);
  const dd = Math.round(Math.min(prep.range[1], Math.max(prep.range[0], delta)));
  moveNodes(d, runNodes(d, prep.run), prep.axis, dd);
  return finish(prep.base, d);
}

export function pushWall(p: Plan, wallId: WallId, delta: Mm, opts: { outline?: boolean } = {}): Plan {
  const prep = preparePush(p, wallId, opts);
  return prep ? applyPush(prep, delta) : p;
}

const runNodes = (p: Plan, run: readonly WallId[]): NodeId[] => [
  ...new Set(run.flatMap((id) => [p.walls[id]!.a, p.walls[id]!.b]))
];

/** How far a run can move before a Room against it would be left less than MIN_ROOM across. */
export function pushRange(p: Plan, run: readonly WallId[]): [Mm, Mm] {
  const D = derive(p);
  let lo = -Infinity;
  let hi = Infinity;
  for (const id of run) {
    const w = p.walls[id]!;
    const l = D.walls[id]!.line;
    for (const side of ['neg', 'pos'] as const) {
      const room = w[side];
      if (!room) continue;
      // The Room's inside rects that touch this face, and how far they reach away from it.
      for (const r of D.rooms[room]?.rects ?? []) {
        const [r0, r1, t0, t1] = l.axis === 'v' ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1];
        if (Math.min(t1, l.t1) <= Math.max(t0, l.t0)) continue;
        if (side === 'neg' && r1 === l.lo) lo = Math.max(lo, MIN_ROOM - (r1 - r0));
        if (side === 'pos' && r0 === l.hi) hi = Math.min(hi, r1 - r0 - MIN_ROOM);
      }
    }
  }
  // Moving the Outline itself: its inside keeps at least the same minimum across.
  for (const id of run) {
    if (!p.walls[id]!.exterior) continue;
    const l = D.walls[id]!.line;
    for (const r of D.outline?.inside ?? []) {
      const [r0, r1, t0, t1] = l.axis === 'v' ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1];
      if (Math.min(t1, l.t1) <= Math.max(t0, l.t0)) continue;
      if (r1 === l.lo) lo = Math.max(lo, MIN_ROOM - (r1 - r0));
      if (r0 === l.hi) hi = Math.min(hi, r1 - r0 - MIN_ROOM);
    }
  }
  // A Wall joined to the run never shrinks to nothing: the run stops short of its far end.
  const inRun = new Set(run);
  const inc = incidence(p);
  const axis = D.walls[run[0]!]!.line.axis;
  for (const n of runNodes(p, run))
    for (const id of inc.get(n) ?? []) {
      if (inRun.has(id) || D.walls[id]!.line.axis === axis) continue;
      const w = p.walls[id]!;
      const far = p.nodes[w.a === n ? w.b : w.a]!;
      const here = p.nodes[n]!;
      const gap = axis === 'v' ? far.x - here.x : far.y - here.y;
      if (gap > 0) hi = Math.min(hi, gap - 1);
      else lo = Math.max(lo, gap + 1);
    }
  // A Room already below the minimum may still be pulled open, never pushed further in.
  return [Math.min(lo, 0), Math.max(hi, 0)];
}

/** Sets the thickness of the run through a Wall. Exterior Walls keep their outside face: the Outline is measured. */
export function setWallThickness(p: Plan, wallId: WallId, thickness: Mm): Plan {
  const w0 = p.walls[wallId];
  const t = Math.round(thickness);
  if (!w0 || t < 10 || t === w0.thickness) return p;
  const D = derive(p);
  return edit(p, (d) => {
    const run = runOf(d, wallId);
    const l = wallLine(d, d.walls[wallId]!);
    if (d.walls[wallId]!.exterior) {
      const mid = (l.t0 + l.t1) / 2;
      const probe = point(l.axis, mid, l.lo - 1);
      const outsideIsNeg = !D.insideOutline(probe.x, probe.y);
      const [fl, ce] = faceOffsets(t);
      const c = outsideIsNeg ? l.lo + fl : l.hi - ce;
      moveNodes(d, runNodes(d, collinearClosure(d, run)), l.axis, c - l.c);
    }
    for (const id of run) d.walls[id]!.thickness = t;
  });
}

export function setStructural(p: Plan, wallId: WallId, structural: boolean): Plan {
  if (!p.walls[wallId] || p.walls[wallId].structural === structural) return p;
  return edit(p, (d) => {
    d.walls[wallId]!.structural = structural;
  });
}

/** The run through a Wall and the Rooms on each side of it. */
export function runSides(p: Plan, wallId: WallId) {
  const run = runOf(p, wallId);
  const neg = new Set<RoomId>();
  const pos = new Set<RoomId>();
  for (const id of run) {
    const w = p.walls[id]!;
    if (w.neg) neg.add(w.neg);
    if (w.pos) pos.add(w.pos);
  }
  return {
    run,
    exterior: run.some((id) => p.walls[id]!.exterior),
    neg: [...neg],
    pos: [...pos]
  };
}
