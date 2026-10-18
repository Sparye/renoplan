import { claimGrid, claimSpans, faceSpans, without } from '../claims';
import { derive } from '../derive';
import { Grid, type Rect, intersects } from '../grid';
import { addNode, collinearClosure, incidence, materialRect, moveNodes, roomRegion, runOf } from '../graph';
import { mergeCollinear, mergeNodes } from '../normalize';
import {
  type Axis,
  type NodeId,
  type Plan,
  type RoomId,
  type Side,
  type WallId,
  clonePlan,
  faceOf,
  faceOffsets,
  mintId,
  point,
  wallLine
} from '../plan';
import type { Mm } from '../units';
import { detachFrom, isolateNodes, sharesWall } from './detach';
import { create, edit, finish } from './edit';

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
    const shared = Object.keys(d.walls).filter((id) => sharesWall(d, id, room));
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
      // A Shared Wall whose Rooms have all taken copies: its Openings (and whether it was drawn) go with
      // the first copy.
      const first = live(copies.get(id0)![0]!);
      for (const o of Object.values(d.openings)) if (o.wall === id) o.wall = first;
      d.walls[first]!.drawn ||= w.drawn;
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

/**
 * Draw Wall: an interior Wall along a centreline from a to b, bounding no Room yet. It is drawn, so normal
 * form keeps it; where an end sits on another Wall's centreline the two join in a T-junction. It may cross
 * other Walls, but only adds Wall where there is none: the stretches lying along a parallel Wall's material
 * are left out. Returns the longest piece drawn.
 */
export function drawWall(
  p: Plan,
  a: { x: Mm; y: Mm },
  b: { x: Mm; y: Mm },
  thickness: Mm = p.defaults.interior,
  /** A point the Room it divides should give up, if it can (see drawRoom). */
  away?: { x: Mm; y: Mm }
): { plan: Plan; id: WallId | null } {
  const [ax, ay, bx, by] = [a.x, a.y, b.x, b.y].map(Math.round) as [Mm, Mm, Mm, Mm];
  const t = Math.round(thickness);
  if ((ax !== bx && ay !== by) || (ax === bx && ay === by) || !(t >= 10)) return { plan: p, id: null };
  const axis: Axis = ay === by ? 'h' : 'v';
  const c = axis === 'h' ? ay : ax;
  const [fl, ce] = faceOffsets(t);
  let free: [Mm, Mm][] = [
    axis === 'h' ? [Math.min(ax, bx), Math.max(ax, bx)] : [Math.min(ay, by), Math.max(ay, by)]
  ];
  for (const w of Object.values(p.walls)) {
    const l = wallLine(p, w);
    if (l.axis !== axis || Math.min(l.hi, c + ce) <= Math.max(l.lo, c - fl)) continue;
    free = free.flatMap(([s0, s1]): [Mm, Mm][] =>
      l.t1 <= s0 || l.t0 >= s1
        ? [[s0, s1]]
        : (
            [
              [s0, l.t0],
              [l.t1, s1]
            ] as [Mm, Mm][]
          ).filter(([x, y]) => y > x)
    );
  }
  if (!free.length) return { plan: p, id: null };
  return create(p, (d) => {
    let longest: [WallId, Mm] | null = null;
    for (const [s0, s1] of free) {
      const id = mintId(d, 'w');
      const [pa, pb] = [point(axis, s0, c), point(axis, s1, c)];
      d.walls[id] = {
        a: addNode(d, pa.x, pa.y),
        b: addNode(d, pb.x, pb.y),
        thickness: t,
        exterior: false,
        structural: false,
        drawn: true,
        neg: null,
        pos: null
      };
      if (!longest || s1 - s0 > longest[1]) longest = [id, s1 - s0];
    }
    splitDivided(d, away);
    return longest![0];
  });
}

/**
 * A Room that drawn Walls divide into separate parts keeps the largest part (the largest without `away`,
 * if there is one). The rest stops being the Room's and shows as Unlabelled Space, for the user to name.
 */
function splitDivided(d: Plan, away?: { x: Mm; y: Mm }) {
  const drawn = Object.keys(d.walls)
    .filter((id) => d.walls[id]!.drawn)
    .map((id) => materialRect(d, id));
  for (const room of Object.keys(d.rooms)) {
    const region = roomRegion(d, room);
    const cut = drawn.filter((r) => region.some((q) => intersects(q, r)));
    if (!cut.length) continue;
    const g = new Grid([...region, ...cut]);
    const inside = g.mask(region);
    const blocked = g.mask(cut);
    const open = (c: number) => inside[c] === 1 && !blocked[c];
    const seen = new Uint8Array(g.size);
    const parts: { mask: Uint8Array; area: number }[] = [];
    for (let c = 0; c < g.size; c++) {
      if (seen[c] || !open(c)) continue;
      const mask = g.flood([c], open);
      let area = 0;
      for (let k = 0; k < g.size; k++)
        if (mask[k]) {
          seen[k] = 1;
          area += g.cellArea(k);
        }
      parts.push({ mask, area });
    }
    if (parts.length < 2) continue;
    const at = away && g.cellAt(away.x, away.y);
    const elsewhere = parts.filter((q) => at === undefined || at < 0 || !q.mask[at]);
    const keep = (elsewhere.length ? elsewhere : parts).reduce((a, b) => (b.area > a.area ? b : a));
    reclaim(
      d,
      room,
      g.rects((c) => keep.mask[c] === 1)
    );
  }
}

/**
 * Trims a Room's claims to the faces bordering `region`, and claims the drawn Walls' faces along it. Called
 * while drawing, when the only Walls bounding no Room are drawn ones.
 */
function reclaim(d: Plan, room: RoomId, region: Rect[]) {
  const { g, junction } = claimGrid(d, region);
  const mask = g.mask(region);
  for (const id of Object.keys(d.walls)) {
    const w = d.walls[id]!;
    const line = wallLine(d, w);
    const rect = materialRect(d, id);
    const spans = (side: Side) =>
      faceSpans(g, mask, junction[line.axis], line.axis, faceOf(line, side), side, rect);
    if (w.drawn) {
      // A drawn Wall bounds the part on one face only; with the part on both faces it stands inside it.
      const neg = w.neg === null ? spans('neg') : [];
      const pos = w.pos === null ? spans('pos') : [];
      if (neg.length) claimSpans(d, id, 'neg', without(neg, pos), room, null);
      if (pos.length) claimSpans(d, id, 'pos', without(pos, neg), room, null);
      continue;
    }
    for (const side of ['neg', 'pos'] as const)
      if (w[side] === room) claimSpans(d, id, side, spans(side), room, null);
  }
  // A Wall the Room let go of still stands (it is in the house): it stays like a drawn Wall instead of
  // being dropped as a capture leftover, which would show it as Demolished.
  for (const w of Object.values(d.walls)) if (!w.exterior && !w.neg && !w.pos) w.drawn = true;
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
