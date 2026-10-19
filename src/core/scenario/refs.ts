import { type Line, type Plan, type RoomId, type WallId, wallLine } from '../plan';
import type { Mm } from '../units';
import type { Target, WallRef } from './model';

// Finding what a Change points at in the plan as it stands now (ADR 0010).

/** Turns a Target into the id it has in the plan being replayed, or null if it is gone. */
export type Lookup = (t: Target) => string | null;

/**
 * Where a WallRef points: the Walls on one centreline overlapping the stretch [t0, t1]. Best match first:
 * a Wall bounding the recorded Rooms on the recorded faces, then the one covering most of the stretch.
 */
export interface Resolved {
  walls: WallId[];
  t0: Mm;
  t1: Mm;
}

export function wallRef(p: Plan, id: WallId, target: (room: RoomId) => Target | null): WallRef {
  const w = p.walls[id]!;
  const { axis, c, t0, t1 } = wallLine(p, w);
  return { axis, c, t0, t1, neg: w.neg && target(w.neg), pos: w.pos && target(w.pos) };
}

/**
 * The Walls a WallRef points at. A Wall is first what it bounds, then where it is:
 * - Walls on the recorded centreline over the recorded stretch that bound the recorded Rooms on the
 *   recorded faces, however Existing Plan edits split, merged or renumbered them;
 * - otherwise the Wall moved, and is followed to the one parallel centreline whose Walls bound those Rooms
 *   on those faces over that stretch (the Rooms' boundary moved, even if a measured Outline stayed put);
 * - otherwise whatever Walls lie on the recorded centreline, if any, for the command to judge;
 * - otherwise it has vanished, or is ambiguous if more than one centreline could be it.
 */
export function resolveWall(
  p: Plan,
  ref: WallRef,
  lookup: Lookup
): Resolved | { conflict: 'vanished' | 'ambiguous' } {
  const near: [WallId, Line][] = [];
  for (const id of Object.keys(p.walls)) {
    const l = wallLine(p, p.walls[id]!);
    if (l.axis === ref.axis && Math.min(l.t1, ref.t1) > Math.max(l.t0, ref.t0)) near.push([id, l]);
  }
  const neg = ref.neg && lookup(ref.neg);
  const pos = ref.pos && lookup(ref.pos);
  const same = (id: WallId) => p.walls[id]!.neg === neg && p.walls[id]!.pos === pos;
  const on = (c: Mm) => near.filter(([, l]) => l.c === c);
  const exact = on(ref.c);
  // Rooms to recognise the Wall by: it had some, and they are all still there.
  const known = (ref.neg || ref.pos) && !(ref.neg && !neg) && !(ref.pos && !pos);
  if (known) {
    if (exact.some(([id]) => same(id))) return stretch(exact, ref, same);
    const lines = new Set(near.filter(([id]) => same(id)).map(([, l]) => l.c));
    if (lines.size === 1) return stretch(on([...lines][0]!), ref, same);
    if (!exact.length) return { conflict: lines.size ? 'ambiguous' : 'vanished' };
  }
  return exact.length ? stretch(exact, ref, same) : { conflict: 'vanished' };
}

function stretch(walls: [WallId, Line][], ref: WallRef, same: (id: WallId) => boolean): Resolved {
  const cover = (l: Line) => Math.min(l.t1, ref.t1) - Math.max(l.t0, ref.t0);
  const sorted = [...walls].sort(
    ([a, la], [b, lb]) => Number(same(b)) - Number(same(a)) || cover(lb) - cover(la) || la.t0 - lb.t0
  );
  return {
    walls: sorted.map(([id]) => id),
    t0: Math.max(ref.t0, Math.min(...sorted.map(([, l]) => l.t0))),
    t1: Math.min(ref.t1, Math.max(...sorted.map(([, l]) => l.t1)))
  };
}
