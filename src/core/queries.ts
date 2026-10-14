import { derive } from './derive';
import type { Plan, RoomId, WallId } from './plan';

// Questions the UI asks about a plan.

/** The thinnest Wall whose material contains the point, if any. */
export function wallAtPoint(p: Plan, x: number, y: number): WallId | null {
  const D = derive(p);
  let best: { id: WallId; t: number } | null = null;
  for (const [id, g] of Object.entries(D.walls)) {
    const r = g.rect;
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const t = g.line.hi - g.line.lo;
    if (!best || t < best.t) best = { id, t };
  }
  return best?.id ?? null;
}

/** The Room whose region contains the point, if any (the smallest, where Rooms overlap). */
export function roomAtPoint(p: Plan, x: number, y: number): RoomId | null {
  const D = derive(p);
  let best: { id: RoomId; area: number } | null = null;
  for (const [id, g] of Object.entries(D.rooms))
    if (g.rects.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) && (!best || g.area < best.area))
      best = { id, area: g.area };
  return best?.id ?? null;
}

/** Everything drawn, for fitting the view: Walls and Rooms. */
export function planBounds(p: Plan) {
  const D = derive(p);
  const rs = [
    ...Object.values(D.walls).map((w) => w.rect),
    ...Object.values(D.rooms).flatMap((r) => r.rects)
  ];
  if (!rs.length) return null;
  return {
    x0: Math.min(...rs.map((r) => r.x0)),
    y0: Math.min(...rs.map((r) => r.y0)),
    x1: Math.max(...rs.map((r) => r.x1)),
    y1: Math.max(...rs.map((r) => r.y1))
  };
}
