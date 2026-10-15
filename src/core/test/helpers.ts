import { expect } from 'vitest';
import { derive } from '../derive';
import { checkPlan } from '../invariants';
import type { Plan, RoomId, WallId } from '../plan';
import { wallLine } from '../plan';

export function valid(p: Plan): Plan {
  expect(checkPlan(p)).toEqual([]);
  return p;
}

/** Inside W × L of a rectangular Room. */
export function size(p: Plan, room: RoomId): [number, number] | null {
  const g = derive(p).rooms[room];
  if (!g?.rectangular || !g.bounds) return null;
  return [g.bounds.x1 - g.bounds.x0, g.bounds.y1 - g.bounds.y0];
}

export function inside(p: Plan, room: RoomId) {
  return derive(p).rooms[room]?.bounds ?? null;
}

/** Walls claiming a Room, as "neg|pos" pairs of room names. */
export function sharedWalls(p: Plan): string[] {
  const name = (r: string | null) => (r ? p.rooms[r]!.name : '-');
  return Object.values(p.walls)
    .filter((w) => w.neg && w.pos)
    .map((w) => `${name(w.neg)}|${name(w.pos)}`)
    .sort();
}

/** The Wall claiming a Room on a face at a coordinate. */
export function wallAt(p: Plan, axis: 'h' | 'v', face: number, room: RoomId): WallId {
  const id = Object.keys(p.walls).find((wid) => {
    const w = p.walls[wid]!;
    const l = wallLine(p, w);
    return l.axis === axis && ((w.neg === room && l.lo === face) || (w.pos === room && l.hi === face));
  });
  if (!id) throw new Error(`no ${axis} wall of ${room} at ${face}`);
  return id;
}

export const ids = (r: { id: string | null }) => r.id!;
