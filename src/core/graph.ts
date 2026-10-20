import { Grid, type Rect, enclosedRects } from './grid';
import {
  type Axis,
  type Line,
  type NodeId,
  type Plan,
  type RoomId,
  type WallId,
  along,
  claims,
  faceOf,
  mintId,
  point,
  wallLine
} from './plan';
import type { Mm } from './units';

// Wall graph topology and its normal form (ADR 0009). Functions here mutate a draft plan.

export function wallsAt(p: Plan, n: NodeId): WallId[] {
  const out: WallId[] = [];
  for (const id in p.walls) {
    const w = p.walls[id]!;
    if (w.a === n || w.b === n) out.push(id);
  }
  return out;
}

export function incidence(p: Plan): Map<NodeId, WallId[]> {
  const m = new Map<NodeId, WallId[]>();
  for (const n in p.nodes) m.set(n, []);
  for (const id in p.walls) {
    const w = p.walls[id]!;
    m.get(w.a)?.push(id);
    m.get(w.b)?.push(id);
  }
  return m;
}

export function findNode(p: Plan, x: Mm, y: Mm): NodeId | null {
  for (const id in p.nodes) {
    const n = p.nodes[id]!;
    if (n.x === x && n.y === y) return id;
  }
  return null;
}

export function nodeAt(p: Plan, x: Mm, y: Mm): NodeId {
  return findNode(p, x, y) ?? addNode(p, x, y);
}

export function addNode(p: Plan, x: Mm, y: Mm): NodeId {
  const id = mintId(p, 'n');
  p.nodes[id] = { x, y };
  return id;
}

/** The node at a Wall's low (t0) or high (t1) end. */
export function endNode(p: Plan, id: WallId, end: 0 | 1): NodeId {
  const w = p.walls[id]!;
  const l = wallLine(p, w);
  const atA = along(l.axis, p.nodes[w.a]!) === (end === 0 ? l.t0 : l.t1);
  return atA ? w.a : w.b;
}

/** Perpendicular Walls meeting a Wall at one of its ends. */
function perpendicularAt(p: Plan, id: WallId, n: NodeId, inc?: Map<NodeId, WallId[]>): Line[] {
  const axis = wallLine(p, p.walls[id]!).axis;
  const out: Line[] = [];
  for (const o of inc?.get(n) ?? wallsAt(p, n)) {
    if (o === id) continue;
    const l = wallLine(p, p.walls[o]!);
    if (l.axis !== axis) out.push(l);
  }
  return out;
}

/** The Wall's solid material: its centreline span, extended at a junction to the far face of the Wall it meets. */
export function materialRect(p: Plan, id: WallId, inc?: Map<NodeId, WallId[]>): Rect {
  const l = wallLine(p, p.walls[id]!);
  let s = l.t0;
  let e = l.t1;
  for (const q of perpendicularAt(p, id, endNode(p, id, 0), inc)) s = Math.min(s, q.lo);
  for (const q of perpendicularAt(p, id, endNode(p, id, 1), inc)) e = Math.max(e, q.hi);
  return l.axis === 'h' ? { x0: s, x1: e, y0: l.lo, y1: l.hi } : { x0: l.lo, x1: l.hi, y0: s, y1: e };
}

/** The stretch of a Wall's faces that is clear of the Walls meeting it at its ends. */
export function usableSpan(p: Plan, id: WallId, inc?: Map<NodeId, WallId[]>): [Mm, Mm] {
  const l = wallLine(p, p.walls[id]!);
  let u0 = l.t0;
  let u1 = l.t1;
  for (const q of perpendicularAt(p, id, endNode(p, id, 0), inc)) u0 = Math.max(u0, q.hi);
  for (const q of perpendicularAt(p, id, endNode(p, id, 1), inc)) u1 = Math.min(u1, q.lo);
  return [u0, Math.max(u0, u1)];
}

/**
 * The Wall the user grabbed: collinear pieces joined through nodes, continuing past a junction only where
 * something continues along one side of it — the same Room, or the Outline. Two Rooms whose walls merely
 * line up are not one Wall.
 */
export function runOf(p: Plan, id: WallId, inc: Map<NodeId, WallId[]> = incidence(p)): WallId[] {
  const axis = wallLine(p, p.walls[id]!).axis;
  const continues = (x: WallId, y: WallId) => {
    const a = p.walls[x]!;
    const b = p.walls[y]!;
    return (
      // The Outline continues, but not from an Existing Plan Wall into an Extension's (ADR 0012).
      (a.exterior && b.exterior && a.drawn === b.drawn) ||
      (a.neg !== null && a.neg === b.neg) ||
      (a.pos !== null && a.pos === b.pos) ||
      (a.neg === b.neg && a.pos === b.pos)
    );
  };
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const w = p.walls[cur]!;
    for (const n of [w.a, w.b])
      for (const o of inc.get(n) ?? []) {
        if (seen.has(o) || wallLine(p, p.walls[o]!).axis !== axis || !continues(cur, o)) continue;
        seen.add(o);
        stack.push(o);
      }
  }
  return [...seen];
}

/** Splits a Wall at t along its axis. The original id keeps the low piece; returns the high piece's id. */
export function splitWall(p: Plan, id: WallId, t: Mm): WallId | null {
  const w = p.walls[id]!;
  const l = wallLine(p, w);
  if (t <= l.t0 || t >= l.t1) return null;
  const pt = point(l.axis, t, l.c);
  const m = nodeAt(p, pt.x, pt.y);
  const hiNode = endNode(p, id, 1);
  const loNode = endNode(p, id, 0);
  const nid = mintId(p, 'w');
  p.walls[nid] = { ...w, a: m, b: hiNode };
  p.walls[id] = { ...w, a: loNode, b: m };
  for (const o of Object.values(p.openings)) if (o.wall === id && o.at + o.width / 2 > t) o.wall = nid;
  return nid;
}

/** Splits a Wall at s0 and s1 and returns the piece spanning [s0, s1]. */
export function isolate(p: Plan, id: WallId, s0: Mm, s1: Mm): WallId {
  const piece = splitWall(p, id, s0) ?? id;
  splitWall(p, piece, s1);
  return piece;
}

export function deleteWall(p: Plan, id: WallId) {
  delete p.walls[id];
  for (const oid in p.openings) if (p.openings[oid]!.wall === id) delete p.openings[oid];
}

export function moveOpenings(p: Plan, from: WallId, to: WallId) {
  for (const o of Object.values(p.openings)) if (o.wall === from) o.wall = to;
}

/** Moves the given nodes across an axis by d. */
export function moveNodes(p: Plan, nodes: Iterable<NodeId>, axis: Axis, d: Mm) {
  for (const n of new Set(nodes)) {
    const node = p.nodes[n]!;
    if (axis === 'h') node.y += d;
    else node.x += d;
  }
}

/**
 * The region enclosed by a set of Walls. Junction extensions count only Walls in the set, so a Room's
 * region depends on its own Walls alone and never on a neighbour's junction.
 */
export function enclosedBy(p: Plan, walls: readonly WallId[]): Rect[] {
  return enclosedRects(ownMaterial(p, walls));
}

/** The Walls' material, with junction extensions counting only Walls in the set. */
function ownMaterial(p: Plan, walls: readonly WallId[]): Rect[] {
  const inc = new Map<NodeId, WallId[]>();
  for (const id of walls)
    for (const n of [p.walls[id]!.a, p.walls[id]!.b]) inc.set(n, [...(inc.get(n) ?? []), id]);
  return walls.map((id) => materialRect(p, id, inc));
}

export const roomWalls = (p: Plan, room: string): WallId[] =>
  Object.keys(p.walls).filter((id) => claims(p.walls[id]!, room));

/**
 * A Room's region: the floor its own Walls enclose beside the faces it claims. A pocket its Walls enclose
 * only behind unclaimed faces (inside an island of Walls standing in the Room) is not the Room's.
 */
export function roomRegion(p: Plan, room: RoomId): Rect[] {
  const walls = roomWalls(p, room);
  if (!walls.length) return [];
  const solid = ownMaterial(p, walls);
  const g = new Grid(solid);
  const inner = g.enclosed(g.mask(solid));
  const seeds: number[] = [];
  for (const id of walls) {
    const w = p.walls[id]!;
    const l = wallLine(p, w);
    const [lines, ts] = l.axis === 'v' ? [g.xs, g.ys] : [g.ys, g.xs];
    for (const side of ['neg', 'pos'] as const) {
      if (w[side] !== room) continue;
      const k = lines.indexOf(faceOf(l, side));
      const across = side === 'pos' ? k : k - 1;
      for (let i = 0; i < ts.length - 1; i++) {
        if (ts[i + 1]! <= l.t0 || ts[i]! >= l.t1) continue;
        const c = l.axis === 'v' ? g.cell(across, i) : g.cell(i, across);
        if (inner[c]) seeds.push(c);
      }
    }
  }
  const region = g.flood(seeds, (c) => inner[c] === 1);
  return g.rects((c) => region[c] === 1);
}

/** Everything collinear sharing a node with a moving Wall has to move too, or it would be skewed. */
export function collinearClosure(p: Plan, ids: WallId[]): WallId[] {
  if (!ids.length) return ids;
  const inc = incidence(p);
  const axis = wallLine(p, p.walls[ids[0]!]!).axis;
  const seen = new Set(ids);
  const stack = [...ids];
  while (stack.length) {
    const w = p.walls[stack.pop()!]!;
    for (const n of [w.a, w.b])
      for (const o of inc.get(n) ?? [])
        if (!seen.has(o) && wallLine(p, p.walls[o]!).axis === axis) {
          seen.add(o);
          stack.push(o);
        }
  }
  return [...seen];
}
