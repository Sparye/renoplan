import { derive } from '../derive';
import { bounds } from '../grid';
import { deleteWall } from '../graph';
import { mergeNodes, splitAtNodes } from '../normalize';
import { type Plan, type WallId, clonePlan, wallLine } from '../plan';
import type { Mm } from '../units';
import { edit, finish } from './edit';
import { rectWalls } from './rooms';
import { pushWall } from './walls';

const MIN_OUTLINE: Mm = 1000;

const hasOutline = (p: Plan) => Object.values(p.walls).some((w) => w.exterior);

/** Adds the Outline: a W × L rectangle of exterior Walls, measured outside. */
export function addOutline(p: Plan, w: Mm, l: Mm, at?: { x: Mm; y: Mm }): Plan {
  if (hasOutline(p) || w < MIN_OUTLINE || l < MIN_OUTLINE) return p;
  const D = derive(p);
  const b = bounds(Object.values(D.walls).map((g) => g.rect));
  // With Rooms already on the canvas, the Outline goes to their left so they stay parked beside it.
  const pos = at ?? (b ? { x: b.x0 - 2000 - w, y: b.y0 } : { x: 0, y: 0 });
  return edit(p, (d) => {
    rectWalls(d, { x0: pos.x, y0: pos.y, x1: pos.x + w, y1: pos.y + l }, d.defaults.exterior, null, true);
  });
}

export type WingSide = 'right' | 'bottom' | 'left' | 'top';

/**
 * Adds a wing (another rectangle) to the Outline, for L-shaped houses. W × L are its outside dimensions:
 * W along x, L along y. It is aligned with the Outline's top or left edge; ⌥-drag moves it afterwards.
 */
export function addWing(p: Plan, side: WingSide, w: Mm, l: Mm): Plan {
  const D = derive(p);
  if (!D.outline || w < MIN_OUTLINE || l < MIN_OUTLINE) return p;
  const o = D.outline.bounds;
  // Thickness of the exterior Wall along that edge, so the wing's Wall lands exactly on it.
  const edge = Object.keys(p.walls).find((id) => {
    if (!p.walls[id]!.exterior) return false;
    const { axis, lo, hi } = D.walls[id]!.line;
    if (side === 'right') return axis === 'v' && hi === o.x1;
    if (side === 'left') return axis === 'v' && lo === o.x0;
    if (side === 'bottom') return axis === 'h' && hi === o.y1;
    return axis === 'h' && lo === o.y0;
  });
  const t = edge ? p.walls[edge]!.thickness : p.defaults.exterior;
  // The wing overlaps the Outline by one Wall thickness, so their shared Walls coincide.
  const r =
    side === 'right'
      ? { x0: o.x1 - t, x1: o.x1 + w, y0: o.y0, y1: o.y0 + l }
      : side === 'left'
        ? { x0: o.x0 - w, x1: o.x0 + t, y0: o.y0, y1: o.y0 + l }
        : side === 'bottom'
          ? { x0: o.x0, x1: o.x0 + w, y0: o.y1 - t, y1: o.y1 + l }
          : { x0: o.x0, x1: o.x0 + w, y0: o.y0 - l, y1: o.y0 + t };
  const d = clonePlan(p);
  rectWalls(d, r, t, null, true);
  mergeNodes(d);
  splitAtNodes(d);
  // Where the wing meets the Outline, the exterior Walls go: that is floor now. Where a Room is against
  // it, the Wall stays as an interior Wall, so the Room keeps its boundary and its Walls stay joined.
  const seen = new Map<string, WallId>();
  let joined = false;
  for (const id of Object.keys(d.walls)) {
    const wall = d.walls[id]!;
    if (!wall.exterior) continue;
    const key = `${wall.a}|${wall.b}`;
    const twin = seen.get(key);
    if (!twin) {
      seen.set(key, id);
      continue;
    }
    const keep = d.walls[twin]!;
    const other = d.walls[id]!;
    keep.neg ??= other.neg;
    keep.pos ??= other.pos;
    deleteWall(d, id);
    if (keep.neg || keep.pos) keep.exterior = false;
    else deleteWall(d, twin);
    joined = true;
  }
  if (!joined) return p;
  return finish(p, d);
}

/** Edits the Outline's overall W × L by moving its right and bottom exterior Walls. */
export function setOutlineSize(p: Plan, w: Mm, l: Mm): Plan {
  const o = derive(p).outline?.bounds;
  if (!o) return p;
  let next = p;
  const shift = (axis: 'h' | 'v', at: Mm, d: Mm) => {
    for (let guard = 0; d && guard < 100; guard++) {
      const id = Object.keys(next.walls).find((wid) => {
        const wall = next.walls[wid]!;
        const line = wallLine(next, wall);
        return wall.exterior && line.axis === axis && line.hi === at;
      });
      if (!id) return;
      const moved = pushWall(next, id, d, { outline: true });
      if (moved === next) return;
      next = moved;
    }
  };
  shift('v', o.x1, Math.max(MIN_OUTLINE, Math.round(w)) - (o.x1 - o.x0));
  shift('h', o.y1, Math.max(MIN_OUTLINE, Math.round(l)) - (o.y1 - o.y0));
  return next;
}
