import { Grid, type Rect, intersects } from './grid';
import { RepairFailed, repairClaims } from './claims';
import {
  deleteWall,
  endNode,
  incidence,
  isolate,
  materialRect,
  moveOpenings,
  splitWall,
  usableSpan,
  wallsAt
} from './graph';
import { type NodeId, type Plan, type Side, type WallId, claims, clonePlan, faceOf, wallLine } from './plan';
import type { Mm } from './units';

// The normal form of the Wall graph (ADR 0009). Every command ends here.

export function mergeNodes(p: Plan): boolean {
  const byPoint = new Map<string, NodeId>();
  const remap = new Map<NodeId, NodeId>();
  for (const id in p.nodes) {
    const n = p.nodes[id]!;
    const key = `${n.x},${n.y}`;
    const keep = byPoint.get(key);
    if (keep) remap.set(id, keep);
    else byPoint.set(key, id);
  }
  if (!remap.size) return false;
  for (const w of Object.values(p.walls)) {
    w.a = remap.get(w.a) ?? w.a;
    w.b = remap.get(w.b) ?? w.b;
  }
  for (const id of remap.keys()) delete p.nodes[id];
  return true;
}

function orientAndDropDegenerate(p: Plan): boolean {
  let changed = false;
  for (const id of Object.keys(p.walls)) {
    const w = p.walls[id]!;
    const a = p.nodes[w.a]!;
    const b = p.nodes[w.b]!;
    if (a.x === b.x && a.y === b.y) {
      deleteWall(p, id);
      changed = true;
      continue;
    }
    if (a.x !== b.x && a.y !== b.y) throw new Error(`wall ${id} is not orthogonal`);
    if (a.x > b.x || a.y > b.y) {
      [w.a, w.b] = [w.b, w.a];
      changed = true;
    }
  }
  return changed;
}

function dropOrphanNodes(p: Plan): boolean {
  const used = new Set<NodeId>();
  for (const w of Object.values(p.walls)) used.add(w.a).add(w.b);
  let changed = false;
  for (const id of Object.keys(p.nodes))
    if (!used.has(id)) {
      delete p.nodes[id];
      changed = true;
    }
  return changed;
}

/** T-junctions: a Wall is split wherever a node sits on its centreline. */
export function splitAtNodes(p: Plan): boolean {
  const byX = new Map<number, number[]>();
  const byY = new Map<number, number[]>();
  for (const n of Object.values(p.nodes)) {
    byX.set(n.x, [...(byX.get(n.x) ?? []), n.y]);
    byY.set(n.y, [...(byY.get(n.y) ?? []), n.x]);
  }
  let changed = false;
  for (const id of Object.keys(p.walls)) {
    const l = wallLine(p, p.walls[id]!);
    const ts = (l.axis === 'h' ? byY.get(l.c) : byX.get(l.c)) ?? [];
    const cuts = [...new Set(ts.filter((t) => t > l.t0 && t < l.t1))].sort((a, b) => b - a);
    // Highest first, so the original id keeps shrinking towards t0.
    for (const t of cuts) {
      const hi = splitWall(p, id, t);
      if (!hi) continue;
      changed = true;
      endClaimsAtStem(p, id, hi);
    }
  }
  return changed;
}

/**
 * After a split at a junction: a Room bounded by a stem ends there. If the stem claims the Room on its
 * low face, the Room lies towards the low piece, so the high piece no longer bounds it — and vice versa.
 */
function endClaimsAtStem(p: Plan, lo: WallId, hi: WallId) {
  const w = p.walls[lo]!;
  const m = w.b;
  const l = wallLine(p, w);
  for (const sid of wallsAt(p, m)) {
    const s = p.walls[sid]!;
    const sl = wallLine(p, s);
    if (sl.axis === l.axis) continue;
    const far = s.a === m ? s.b : s.a;
    // Which face of the split Wall the stem stands on.
    const side: Side = (l.axis === 'h' ? p.nodes[far]!.y : p.nodes[far]!.x) < l.c ? 'neg' : 'pos';
    const room = p.walls[lo]![side];
    if (!room) continue;
    if (s.neg === room && s.pos !== room) p.walls[hi]![side] = null;
    if (s.pos === room && s.neg !== room) p.walls[lo]![side] = null;
  }
}

export interface Fusion {
  /** A Room's own Wall whose inside face lies on another Wall's free face. */
  own: WallId;
  /** The Wall that takes over as the Room's boundary. */
  host: WallId;
  side: Side;
  s0: Mm;
  s1: Mm;
}

/**
 * A Room's own Wall (one face claimed, the other free, not exterior) whose inside face lies exactly on a
 * free face of another Wall, facing the Room, over an overlapping span. Newer Walls fuse into older ones.
 */
export function findFusion(p: Plan): Fusion | null {
  const ids = Object.keys(p.walls);
  const lines = new Map(ids.map((id) => [id, wallLine(p, p.walls[id]!)]));
  for (let i = ids.length - 1; i >= 0; i--) {
    const own = ids[i]!;
    const e = p.walls[own]!;
    if (e.exterior) continue;
    const side: Side | null = e.neg && !e.pos ? 'neg' : e.pos && !e.neg ? 'pos' : null;
    if (!side) continue;
    const room = e[side]!;
    const el = lines.get(own)!;
    const face = faceOf(el, side);
    for (const host of ids) {
      if (host === own) continue;
      const f = p.walls[host]!;
      const fl = lines.get(host)!;
      if (fl.axis !== el.axis || f[side] !== null || claims(f, room) || faceOf(fl, side) !== face) continue;
      const s0 = Math.max(el.t0, fl.t0);
      const s1 = Math.min(el.t1, fl.t1);
      if (s1 > s0) return { own, host, side, s0, s1 };
    }
  }
  return null;
}

export function applyFusion(p: Plan, fu: Fusion) {
  const room = p.walls[fu.own]![fu.side];
  const own = isolate(p, fu.own, fu.s0, fu.s1);
  const host = isolate(p, fu.host, fu.s0, fu.s1);
  p.walls[host]![fu.side] = room;
  moveOpenings(p, own, host);
  const axis = wallLine(p, p.walls[own]!).axis;
  // The Room's side Walls re-end on the host's centreline.
  for (const [n, m] of [
    [endNode(p, own, 0), endNode(p, host, 0)],
    [endNode(p, own, 1), endNode(p, host, 1)]
  ] as const) {
    if (n === m) continue;
    for (const id of wallsAt(p, n)) {
      if (id === own) continue;
      const w = p.walls[id]!;
      if (wallLine(p, w).axis === axis) continue;
      if (w.a === n) w.a = m;
      if (w.b === n) w.b = m;
    }
  }
  delete p.walls[own];
}

/** Two Walls with the same ends and thickness whose claims don't conflict become one. */
function dedupe(p: Plan): boolean {
  const seen = new Map<string, WallId>();
  let changed = false;
  for (const id of Object.keys(p.walls)) {
    const w = p.walls[id]!;
    const key = `${w.a}|${w.b}|${w.thickness}`;
    const keep = seen.get(key);
    if (!keep) {
      seen.set(key, id);
      continue;
    }
    const k = p.walls[keep]!;
    const ok = (s: Side) => k[s] === w[s] || !k[s] || !w[s];
    if (!ok('neg') || !ok('pos')) continue;
    k.neg ??= w.neg;
    k.pos ??= w.pos;
    k.exterior ||= w.exterior;
    k.structural ||= w.structural;
    moveOpenings(p, id, keep);
    delete p.walls[id];
    changed = true;
  }
  return changed;
}

/**
 * Whether a Wall face touches no floor at all because junction material covers it: every point just
 * beyond it lies inside Walls perpendicular to this one (a corner stub).
 */
export function faceCovered(p: Plan, id: WallId, side: Side, rects: Map<WallId, Rect>): boolean {
  const l = wallLine(p, p.walls[id]!);
  const [n0, n1] = side === 'neg' ? [l.lo - 1, l.lo] : [l.hi, l.hi + 1];
  const strip =
    l.axis === 'h' ? { x0: l.t0, x1: l.t1, y0: n0, y1: n1 } : { x0: n0, x1: n1, y0: l.t0, y1: l.t1 };
  return covers(
    strip,
    [...rects].filter(([o]) => o !== id && wallLine(p, p.walls[o]!).axis !== l.axis).map(([, q]) => q)
  );
}

function covers(r: Rect, others: readonly Rect[]): boolean {
  const near = others.filter((q) => intersects(q, r));
  if (!near.length) return false;
  const g = new Grid([r, ...near]);
  const covered = g.mask(near);
  let all = true;
  g.forRect(r, (c) => {
    if (!covered[c]) all = false;
  });
  return all;
}

/**
 * Collinear Walls through a node joining only them merge when all their attributes match. A claim also
 * extends across a piece whose face on that side touches no floor (a corner stub), so the normal form
 * doesn't depend on the order things were fused in.
 */
export function mergeCollinear(p: Plan, onMerge?: (drop: WallId, keep: WallId) => void): boolean {
  const inc = incidence(p);
  let rects: Map<WallId, Rect> | null = null;
  for (const [n, ws] of inc) {
    if (ws.length !== 2) continue;
    const [i, j] = ws as [WallId, WallId];
    const x = p.walls[i]!;
    const y = p.walls[j]!;
    const lx = wallLine(p, x);
    const ly = wallLine(p, y);
    if (lx.axis !== ly.axis) continue;
    const [lo, hi] = x.b === n && y.a === n ? [i, j] : y.b === n && x.a === n ? [j, i] : [null, null];
    if (!lo || !hi) continue;
    if (x.thickness !== y.thickness || x.exterior !== y.exterior || x.structural !== y.structural) continue;
    const merged: Partial<Record<Side, string | null>> = {};
    let ok = true;
    for (const side of ['neg', 'pos'] as const) {
      if (x[side] === y[side]) {
        merged[side] = x[side];
        continue;
      }
      const bare = x[side] === null ? i : y[side] === null ? j : null;
      rects ??= new Map(Object.keys(p.walls).map((id) => [id, materialRect(p, id, inc)]));
      if (!bare || !faceCovered(p, bare, side, rects)) {
        ok = false;
        break;
      }
      merged[side] = x[side] ?? y[side];
    }
    if (!ok) continue;
    const keep = lx.t1 - lx.t0 >= ly.t1 - ly.t0 ? i : j;
    const drop = keep === i ? j : i;
    p.walls[keep] = {
      ...p.walls[keep]!,
      a: p.walls[lo]!.a,
      b: p.walls[hi]!.b,
      neg: merged.neg!,
      pos: merged.pos!
    };
    moveOpenings(p, drop, keep);
    delete p.walls[drop];
    delete p.nodes[n];
    onMerge?.(drop, keep);
    return true;
  }
  return false;
}

export const MIN_OPENING: Mm = 50;

/** Keeps every Opening on its Wall's clear span. */
function fitOpenings(p: Plan) {
  const inc = incidence(p);
  for (const id of Object.keys(p.openings)) {
    const o = p.openings[id]!;
    if (!p.walls[o.wall]) {
      delete p.openings[id];
      continue;
    }
    const [u0, u1] = usableSpan(p, o.wall, inc);
    const width = Math.min(o.width, u1 - u0);
    if (width < MIN_OPENING) {
      delete p.openings[id];
      continue;
    }
    o.width = width;
    o.at = Math.min(Math.max(o.at, u0), u1 - width);
  }
}

/**
 * During capture an interior Wall that bounds no Room is an artefact (a detached copy whose claim was
 * trimmed away): no Room or Outline uses it, so it goes. Revisit when Scenario Mode gets Draw Wall.
 */
function dropBare(p: Plan): boolean {
  let changed = false;
  for (const id of Object.keys(p.walls)) {
    const w = p.walls[id]!;
    if (w.exterior || w.neg || w.pos) continue;
    deleteWall(p, id);
    changed = true;
  }
  return changed;
}

/** Trims stale claims (see repairClaims), on a copy so a failed repair leaves the draft untouched. */
function tidyClaims(p: Plan): boolean {
  const q = clonePlan(p);
  try {
    if (!repairClaims(q)) return false;
  } catch (e) {
    if (e instanceof RepairFailed) return false;
    throw e;
  }
  Object.assign(p, q);
  return true;
}

/** Brings a draft into normal form. Idempotent. */
export function normalize(p: Plan): Plan {
  for (let guard = 0; ; guard++) {
    if (guard > 10_000) throw new Error('normalize did not converge');
    let changed = mergeNodes(p);
    changed = orientAndDropDegenerate(p) || changed;
    changed = dropOrphanNodes(p) || changed;
    changed = splitAtNodes(p) || changed;
    if (changed) continue;
    const fu = findFusion(p);
    if (fu) {
      applyFusion(p, fu);
      continue;
    }
    if (dedupe(p) || mergeCollinear(p) || tidyClaims(p) || dropBare(p)) continue;
    break;
  }
  fitOpenings(p);
  return p;
}

/** A normalized copy of any plan: what a decoded file goes through. */
export const normalizePlan = (p: Plan): Plan => normalize(clonePlan(p));
