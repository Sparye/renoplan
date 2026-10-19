import { derive } from './derive';
import { incidence, materialRect, usableSpan } from './graph';
import { faceCovered, findFusion } from './normalize';
import { type Plan, faceOf, wallLine } from './plan';

/** Everything that must hold for a plan in normal form. Returns the violations; empty means valid. */
export function checkPlan(p: Plan): string[] {
  const errs: string[] = [];
  const int = (v: number) => Number.isInteger(v);
  const maxId = Math.max(
    0,
    ...[p.nodes, p.walls, p.rooms, p.openings].flatMap((m) => Object.keys(m).map((k) => Number(k.slice(1))))
  );
  if (p.nextId <= maxId) errs.push(`nextId ${p.nextId} is not past ${maxId}`);

  const points = new Map<string, string>();
  for (const [id, n] of Object.entries(p.nodes)) {
    if (!int(n.x) || !int(n.y)) errs.push(`node ${id} is not on integer mm`);
    const key = `${n.x},${n.y}`;
    if (points.has(key)) errs.push(`nodes ${points.get(key)} and ${id} coincide`);
    points.set(key, id);
  }
  const inc = incidence(p);
  for (const [n, ws] of inc) if (!ws.length) errs.push(`node ${n} is orphaned`);

  for (const [id, w] of Object.entries(p.walls)) {
    const a = p.nodes[w.a];
    const b = p.nodes[w.b];
    if (!a || !b) {
      errs.push(`wall ${id} has a missing node`);
      continue;
    }
    if (a.x !== b.x && a.y !== b.y) errs.push(`wall ${id} is not orthogonal`);
    if (a.x > b.x || a.y > b.y) errs.push(`wall ${id} is not oriented low to high`);
    if (a.x === b.x && a.y === b.y) errs.push(`wall ${id} has zero length`);
    if (!int(w.thickness) || w.thickness < 1) errs.push(`wall ${id} has thickness ${w.thickness}`);
    for (const r of [w.neg, w.pos]) if (r && !p.rooms[r]) errs.push(`wall ${id} claims missing room ${r}`);
    if (w.neg && w.neg === w.pos) errs.push(`wall ${id} has room ${w.neg} on both faces`);
    const l = wallLine(p, w);
    for (const [n, node] of Object.entries(p.nodes)) {
      if (n === w.a || n === w.b) continue;
      const t = l.axis === 'h' ? node.x : node.y;
      const c = l.axis === 'h' ? node.y : node.x;
      if (c === l.c && t > l.t0 && t < l.t1) errs.push(`node ${n} sits inside wall ${id} without a split`);
    }
  }
  for (const [n, ws] of inc) {
    if (ws.length !== 2) continue;
    const [x, y] = ws.map((id) => p.walls[id]!);
    if (
      wallLine(p, x!).axis === wallLine(p, y!).axis &&
      x!.thickness === y!.thickness &&
      x!.exterior === y!.exterior &&
      x!.structural === y!.structural &&
      x!.drawn === y!.drawn &&
      x!.neg === y!.neg &&
      x!.pos === y!.pos
    )
      errs.push(`node ${n} joins two walls that should be one`);
  }
  const fu = findFusion(p);
  if (fu) errs.push(`wall ${fu.own} should fuse into wall ${fu.host}`);

  const D = derive(p);
  if (Object.values(p.walls).some((w) => w.exterior) && !D.outline)
    errs.push('the exterior walls do not enclose anything');
  for (const [id, g] of Object.entries(D.rooms)) {
    if (!g.area) errs.push(`room ${id} encloses nothing`);
    if (!int(g.area)) errs.push(`room ${id} area is not integer`);
  }
  // Every claimed face borders the Room it claims, or touches no floor at all (a covered corner stub).
  const rects = new Map(Object.keys(p.walls).map((id) => [id, materialRect(p, id, inc)]));
  for (const [id, w] of Object.entries(p.walls))
    for (const side of ['neg', 'pos'] as const) {
      const room = w[side];
      if (!room || !D.rooms[room]) continue;
      const l = D.walls[id]!.line;
      const f = faceOf(l, side) + (side === 'pos' ? 0.5 : -0.5);
      const touches = D.rooms[room].rects.some((r) =>
        l.axis === 'v'
          ? f > r.x0 && f < r.x1 && Math.min(r.y1, l.t1) > Math.max(r.y0, l.t0)
          : f > r.y0 && f < r.y1 && Math.min(r.x1, l.t1) > Math.max(r.x0, l.t0)
      );
      if (!touches && !faceCovered(p, id, side, rects))
        errs.push(`wall ${id} claims room ${room} on its ${side} face but does not bound it`);
    }

  for (const [id, o] of Object.entries(p.openings)) {
    if (!p.walls[o.wall]) {
      errs.push(`opening ${id} is on missing wall ${o.wall}`);
      continue;
    }
    const [u0, u1] = usableSpan(p, o.wall, inc);
    if (!int(o.at) || !int(o.width)) errs.push(`opening ${id} is not on integer mm`);
    if (o.at < u0 || o.at + o.width > u1) errs.push(`opening ${id} sticks out of wall ${o.wall}`);
  }
  return errs;
}

/**
 * The checks a user would notice: every Room encloses floor, the Outline encloses floor, and every claim
 * bounds its Room. Cheap enough to run after every command.
 */
export function isSound(p: Plan): boolean {
  const D = derive(p);
  if (Object.values(D.rooms).some((r) => !r.area)) return false;
  if (!D.outline && Object.values(p.walls).some((w) => w.exterior)) return false;
  if (Object.values(p.walls).some((w) => w.neg && w.neg === w.pos)) return false;
  let rects: Map<string, ReturnType<typeof materialRect>> | null = null;
  for (const [id, w] of Object.entries(p.walls))
    for (const side of ['neg', 'pos'] as const) {
      const room = w[side];
      if (!room) continue;
      const l = D.walls[id]!.line;
      const f = faceOf(l, side) + (side === 'pos' ? 0.5 : -0.5);
      const touches = D.rooms[room]?.rects.some((r) =>
        l.axis === 'v'
          ? f > r.x0 && f < r.x1 && Math.min(r.y1, l.t1) > Math.max(r.y0, l.t0)
          : f > r.y0 && f < r.y1 && Math.min(r.x1, l.t1) > Math.max(r.x0, l.t0)
      );
      if (touches) continue;
      rects ??= new Map(Object.keys(p.walls).map((k) => [k, materialRect(p, k)]));
      if (!faceCovered(p, id, side, rects)) return false;
    }
  return true;
}
