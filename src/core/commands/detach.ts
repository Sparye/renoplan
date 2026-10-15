import { addNode, wallsAt } from '../graph';
import { mergeNodes } from '../normalize';
import {
  type Plan,
  type RoomId,
  type WallId,
  claims,
  faceOf,
  faceOffsets,
  mintId,
  point,
  sideOf,
  wallLine
} from '../plan';

// Detaching is the inverse of fusion: a Room stops using another Wall as its boundary and gets its own
// Wall on the same inside face. Nothing visibly moves; the caller moves things afterwards.

/** Gives a Room its own Wall in place of each listed Wall it claims. Returns the new Wall for each one. */
export function detachFrom(p: Plan, room: RoomId, walls: readonly WallId[]): Map<WallId, WallId> {
  const copies: { orig: WallId; copy: WallId; moved: boolean }[] = [];
  for (const id of walls) {
    const w = p.walls[id];
    const side = w && sideOf(w, room);
    if (!w || !side) continue;
    const l = wallLine(p, w);
    // A Room's own Wall is interior; it takes the exterior Wall's inside face, not its thickness (and is
    // never thicker than the exterior Wall, so it doesn't poke out past the Outline).
    const t = w.exterior ? Math.min(p.defaults.interior, w.thickness) : w.thickness;
    const [fl, ce] = faceOffsets(t);
    const face = faceOf(l, side);
    const c = side === 'pos' ? face - ce : face + fl;
    let { a, b } = w;
    if (c !== l.c) {
      const pa = point(l.axis, l.t0, c);
      const pb = point(l.axis, l.t1, c);
      a = addNode(p, pa.x, pa.y);
      b = addNode(p, pb.x, pb.y);
    }
    const copy = mintId(p, 'w');
    p.walls[copy] = {
      a,
      b,
      thickness: t,
      exterior: false,
      structural: false,
      neg: side === 'neg' ? room : null,
      pos: side === 'pos' ? room : null
    };
    w[side] = null;
    copies.push({ orig: id, copy, moved: c !== l.c });
  }
  // Two moved copies whose originals met at a corner meet where their new centrelines cross. Their end
  // nodes are fresh, so moving them touches nothing else.
  for (const k1 of copies)
    for (const k2 of copies) {
      if (!k1.moved || !k2.moved) continue;
      const o1 = p.walls[k1.orig]!;
      const o2 = p.walls[k2.orig]!;
      const l1 = wallLine(p, p.walls[k1.copy]!);
      const l2 = wallLine(p, p.walls[k2.copy]!);
      if (l1.axis === l2.axis) continue;
      const end = o1.a === o2.a || o1.a === o2.b ? 'a' : o1.b === o2.a || o1.b === o2.b ? 'b' : null;
      if (!end) continue;
      const node = p.nodes[p.walls[k1.copy]![end]]!;
      if (l1.axis === 'h') node.x = l2.c;
      else node.y = l2.c;
    }
  // The Room's side Walls re-end on the new Walls' centreline. Only interior Walls the Room still claims
  // move, so a neighbour's geometry and the Outline are never touched; an exterior side Wall meets the
  // new Wall in a T-junction instead.
  for (const { orig, copy, moved } of copies) {
    if (!moved) continue;
    const o = p.walls[orig]!;
    const cw = p.walls[copy]!;
    const axis = wallLine(p, o).axis;
    for (const [n, m] of [
      [o.a, cw.a],
      [o.b, cw.b]
    ] as const)
      for (const id of wallsAt(p, n)) {
        const w = p.walls[id]!;
        if (id === orig || w.exterior || !claims(w, room) || wallLine(p, w).axis === axis) continue;
        if (w.a === n) w.a = m;
        if (w.b === n) w.b = m;
      }
  }
  return new Map(copies.map((c) => [c.orig, c.copy]));
}

/** Gives the Room its own nodes, so moving them moves nothing else. */
export function isolateNodes(p: Plan, room: RoomId) {
  const mine = new Set(Object.keys(p.walls).filter((id) => claims(p.walls[id]!, room)));
  const nodes = new Set([...mine].flatMap((id) => [p.walls[id]!.a, p.walls[id]!.b]));
  for (const n of nodes) {
    if (wallsAt(p, n).every((id) => mine.has(id))) continue;
    const { x, y } = p.nodes[n]!;
    const m = addNode(p, x, y);
    for (const id of mine) {
      const w = p.walls[id]!;
      if (w.a === n) w.a = m;
      if (w.b === n) w.b = m;
    }
  }
}

/** Detaches a Room from every Wall it shares, so it can move or resize without moving its neighbours. */
export function detachRoom(p: Plan, room: RoomId) {
  const shared = Object.keys(p.walls).filter((id) => {
    const w = p.walls[id]!;
    const side = sideOf(w, room);
    if (!side) return false;
    return w.exterior || w[side === 'neg' ? 'pos' : 'neg'] !== null;
  });
  detachFrom(p, room, shared);
  mergeNodes(p);
  isolateNodes(p, room);
}
