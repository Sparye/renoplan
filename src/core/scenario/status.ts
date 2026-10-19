import { type OpeningId, type Plan, type RoomId, type WallId, wallLine } from '../plan';
import type { Mm } from '../units';

// Change Status (CONTEXT.md) by comparing what is built, not by reading the Change list: a Wall is
// Retained wherever the same material — same centreline, same thickness — exists both today and in the
// Scenario. So a Modified (moved) Wall shows as Demolished where it was and New where it went, and a
// Wall that Existing Plan edits merely split, merged or renumbered stays Retained (ADR 0010).

export type ChangeStatus = 'retained' | 'demolished' | 'new';

export interface Stretch {
  t0: Mm;
  t1: Mm;
}

export interface ChangeStatuses {
  /** Every Wall of the Scenario's plan, as stretches along its centreline that are Retained or New. */
  walls: Record<WallId, (Stretch & { status: 'retained' | 'new' })[]>;
  /** Stretches of Existing Plan Walls that the Scenario removes, by Existing Plan Wall id. */
  demolished: Record<WallId, Stretch[]>;
  rooms: Record<RoomId, 'retained' | 'new'>;
  demolishedRooms: RoomId[];
  openings: Record<OpeningId, 'retained' | 'new'>;
  /** Existing Plan Openings that the Scenario removes or changes. */
  demolishedOpenings: OpeningId[];
}

/** Wall material, as the union of centreline stretches per (axis, centreline, thickness). */
function material(p: Plan): Map<string, Stretch[]> {
  const m = new Map<string, Stretch[]>();
  for (const w of Object.values(p.walls)) {
    const l = wallLine(p, w);
    const k = `${l.axis}|${l.c}|${w.thickness}`;
    m.set(k, [...(m.get(k) ?? []), { t0: l.t0, t1: l.t1 }]);
  }
  for (const [k, s] of m) m.set(k, union(s));
  return m;
}

export function union(s: readonly Stretch[]): Stretch[] {
  const out: Stretch[] = [];
  for (const r of [...s].sort((a, b) => a.t0 - b.t0)) {
    const last = out[out.length - 1];
    if (last && r.t0 <= last.t1) last.t1 = Math.max(last.t1, r.t1);
    else out.push({ ...r });
  }
  return out;
}

/** The parts of [t0, t1] inside and outside a sorted, disjoint set of stretches. */
function split(t0: Mm, t1: Mm, by: readonly Stretch[]): { inside: Stretch[]; outside: Stretch[] } {
  const inside: Stretch[] = [];
  const outside: Stretch[] = [];
  let t = t0;
  for (const s of by) {
    if (s.t1 <= t) continue;
    if (s.t0 >= t1) break;
    if (s.t0 > t) outside.push({ t0: t, t1: s.t0 });
    const e = Math.min(s.t1, t1);
    inside.push({ t0: Math.max(t, s.t0), t1: e });
    t = e;
  }
  if (t < t1) outside.push({ t0: t, t1 });
  return { inside, outside };
}

export function changeStatuses(existing: Plan, plan: Plan): ChangeStatuses {
  const before = material(existing);
  const after = material(plan);
  const key = (p: Plan, id: WallId) => {
    const l = wallLine(p, p.walls[id]!);
    return { k: `${l.axis}|${l.c}|${p.walls[id]!.thickness}`, l };
  };

  const walls: ChangeStatuses['walls'] = {};
  for (const id of Object.keys(plan.walls)) {
    const { k, l } = key(plan, id);
    const { inside, outside } = split(l.t0, l.t1, before.get(k) ?? []);
    walls[id] = [
      ...inside.map((s) => ({ ...s, status: 'retained' as const })),
      ...outside.map((s) => ({ ...s, status: 'new' as const }))
    ].sort((a, b) => a.t0 - b.t0);
  }
  const demolished: ChangeStatuses['demolished'] = {};
  for (const id of Object.keys(existing.walls)) {
    const { k, l } = key(existing, id);
    const { outside } = split(l.t0, l.t1, after.get(k) ?? []);
    if (outside.length) demolished[id] = outside;
  }

  const rooms: ChangeStatuses['rooms'] = {};
  for (const id of Object.keys(plan.rooms)) rooms[id] = existing.rooms[id] ? 'retained' : 'new';
  const demolishedRooms = Object.keys(existing.rooms).filter((id) => !plan.rooms[id]);

  // An Opening is Retained only if it is still the same Opening in the same place.
  const where = (p: Plan, id: OpeningId) => {
    const o = p.openings[id]!;
    const l = wallLine(p, p.walls[o.wall]!);
    return JSON.stringify([l.axis, l.c, o.kind, o.at, o.width, o.swing, o.hinge]);
  };
  const openings: ChangeStatuses['openings'] = {};
  const demolishedOpenings: OpeningId[] = [];
  for (const id of Object.keys(plan.openings))
    openings[id] = existing.openings[id] && where(existing, id) === where(plan, id) ? 'retained' : 'new';
  for (const id of Object.keys(existing.openings))
    if (openings[id] !== 'retained') demolishedOpenings.push(id);

  return { walls, demolished, rooms, demolishedRooms, openings, demolishedOpenings };
}
