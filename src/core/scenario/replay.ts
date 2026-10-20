import {
  addOpening,
  annexRoom,
  deleteOpening,
  drawRoom,
  drawRoomThickness,
  drawWall,
  mergeRooms,
  moveOpening,
  nameSpace,
  applyPush,
  preparePush,
  renameRoom,
  setRoomType,
  setWallThickness,
  updateOpening
} from '../commands';
import { edit } from '../commands/edit';
import { derive } from '../derive';
import type { Rect } from '../grid';
import { deleteWall, isolate } from '../graph';
import { type Plan, type RoomId, wallLine } from '../plan';
import type { Change, ChangeId, Conflict, Gesture, Scenario, Target, WallRef } from './model';
import { type Lookup, type Resolved, resolveWall, wallRef } from './refs';
import { type ChangeStatuses, type Stretch, changeStatuses, union } from './status';

// Replaying a Scenario over the Existing Plan (ADR 0010): each Change goes through the same core command
// as in the Existing Plan, against the plan as it stands after the Changes before it.

export interface Replay {
  plan: Plan;
  conflicts: Conflict[];
  /** The id each Change that created a Room or Opening gave it in this replay. */
  created: Map<ChangeId, string>;
}

export interface Applied {
  /** The Scenario's plan: the Existing Plan with every Change that still applies. */
  plan: Plan;
  statuses: ChangeStatuses;
  conflicts: Conflict[];
}

type Outcome = { plan: Plan; created?: string | null } | { conflict: Conflict['reason'] };

/**
 * Whether a command left the plan looking as it was. Normal form may renumber, split or re-fuse Walls
 * without anything visible changing; a Change that does only that does nothing.
 */
function unchanged(a: Plan, b: Plan): boolean {
  return a === b || looks(a) === looks(b);
}

/** What the user sees: Wall material and attributes, each Room's name, type and region, each Opening. */
function looks(p: Plan): string {
  const D = derive(p);
  const material = new Map<string, Stretch[]>();
  for (const [id, w] of Object.entries(p.walls)) {
    const { axis, c, t0, t1 } = D.walls[id]!.line;
    const k = [axis, c, w.thickness, w.exterior, w.structural, w.drawn].join('|');
    material.set(k, [...(material.get(k) ?? []), { t0, t1 }]);
  }
  const walls = [...material].map(([k, s]) => [k, union(s)] as const).sort(([x], [y]) => (x < y ? -1 : 1));
  const rooms = Object.keys(p.rooms)
    .sort()
    .map((id) => [id, p.rooms[id]!.name, p.rooms[id]!.type, region(D.rooms[id]!.rects)]);
  const openings = Object.keys(p.openings)
    .sort()
    .map((id) => {
      const o = p.openings[id]!;
      const { axis, c } = D.walls[o.wall]!.line;
      return [id, o.kind, o.at, o.width, o.swing, o.hinge, axis, c];
    });
  return JSON.stringify([walls, rooms, openings]);
}

/** A region in one canonical form, however it was cut into rectangles: maximal horizontal bands. */
function region(rects: readonly Rect[]): number[][] {
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const bands: number[][] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const [y0, y1] = [ys[i]!, ys[i + 1]!];
    const xs = union(
      rects.filter((r) => r.y0 <= y0 && r.y1 >= y1).map((r) => ({ t0: r.x0, t1: r.x1 }))
    ).flatMap((s) => [s.t0, s.t1]);
    const last = bands[bands.length - 1];
    if (last && last[1] === y0 && last.slice(2).join() === xs.join()) last[1] = y1;
    else if (xs.length) bands.push([y0, y1, ...xs]);
  }
  return bands;
}

/**
 * Changes that set something to a value. One that changes nothing is already satisfied: the Existing Plan
 * has since been made that way (as nearly as the command allows), so there is nothing to resolve.
 */
const ABSOLUTE = new Set<Change['op']>(['setThickness', 'modifyOpening', 'renameRoom', 'setRoomType']);

/**
 * Applies one Change. A Change that throws, or does nothing when it should make something, demolish
 * something or move something, no longer applies.
 */
export function applyChange(p: Plan, c: Change, created: ReadonlyMap<ChangeId, string>): Outcome {
  const lookup: Lookup = (t) => (typeof t === 'string' ? t : (created.get(t.created) ?? null));
  let out: Outcome;
  try {
    out = run(p, c, lookup);
  } catch {
    return { conflict: 'rejected' };
  }
  if ('plan' in out && unchanged(p, out.plan))
    return ABSOLUTE.has(c.op) ? { plan: p } : { conflict: 'rejected' };
  return out;
}

function run(p: Plan, c: Change, lookup: Lookup): Outcome {
  const wall = (ref: WallRef, f: (r: Resolved) => Outcome): Outcome => {
    const r = resolveWall(p, ref, lookup);
    return 'conflict' in r ? r : f(r);
  };
  const room = (t: Target, f: (id: RoomId) => Plan): Outcome => {
    const id = lookup(t);
    return id && p.rooms[id] ? { plan: f(id) } : { conflict: 'vanished' };
  };
  const opening = (t: Target, f: (id: string) => Plan): Outcome => {
    const id = lookup(t);
    return id && p.openings[id] ? { plan: f(id) } : { conflict: 'vanished' };
  };
  switch (c.op) {
    case 'demolishWall':
      return wall(c.wall, (r) => ({ plan: demolish(p, r, c.wall.neg, c.wall.pos, c.keep, lookup) }));
    case 'drawWall':
      return { plan: drawWall(p, c.a, c.b, c.thickness).plan };
    case 'pushWall':
      return wall(c.wall, (r) => ({ plan: push(p, r.walls[0]!, c.delta, c.outline) }));
    case 'setThickness':
      return wall(c.wall, (r) => ({ plan: setWallThickness(p, r.walls[0]!, c.thickness) }));
    case 'addOpening':
      return wall(c.wall, (r) => {
        // The piece the Opening's centre falls on, or the nearest; failing that (an Existing Plan edit may
        // have cut a sliver off where the centre falls), the next nearest piece that can hold it.
        const dist = (id: string) => {
          const l = wallLine(p, p.walls[id]!);
          return Math.max(l.t0 - c.center, c.center - l.t1, 0);
        };
        for (const host of [...r.walls].sort((a, b) => dist(a) - dist(b))) {
          const res = addOpening(p, host, c.kind, c.center);
          if (res.id && res.plan.openings[res.id]) return { plan: res.plan, created: res.id };
        }
        return { plan: p };
      });
    case 'removeOpening':
      return opening(c.opening, (id) => deleteOpening(p, id));
    case 'modifyOpening':
      return opening(c.opening, (id) => {
        const { at, ...rest } = c.patch;
        const q = Object.keys(rest).length ? updateOpening(p, id, rest) : p;
        return at === undefined || !q.openings[id] ? q : moveOpening(q, id, at);
      });
    case 'nameSpace': {
      // In a Scenario, a space named outside the Outline is an Extension (ADR 0012).
      const res = nameSpace(p, c.x, c.y, c.name);
      return { plan: res.id ? annexRoom(res.plan, res.id) : res.plan, created: res.id };
    }
    case 'drawRoom': {
      const res = drawRoom(p, c.rect, c.name, c.thickness);
      return { plan: res.plan, created: res.id };
    }
    case 'renameRoom':
      return room(c.room, (id) => renameRoom(p, id, c.name));
    case 'setRoomType':
      return room(c.room, (id) => setRoomType(p, id, c.type));
  }
}

/**
 * A push that the range clamps to nothing does nothing — even if detaching and fusing back happen to
 * leave the plan looking slightly different.
 */
function push(p: Plan, id: string, delta: number, outline: boolean): Plan {
  const prep = preparePush(p, id, { outline });
  if (!prep) return p;
  const d = Math.round(Math.min(prep.range[1], Math.max(prep.range[0], delta)));
  return d ? applyPush(prep, d) : p;
}

/**
 * Demolishing a Wall between two Rooms merges them, keeping the Room that was kept when the Change was
 * recorded (the larger one, if that Room is gone). Any other Wall is just removed over the stretch; the
 * soundness check turns that into a no-op if a Room or the Outline would be left open.
 */
function demolish(
  p: Plan,
  r: Resolved,
  neg: Target | null,
  pos: Target | null,
  keep: Target | null,
  lookup: Lookup
): Plan {
  const shared = r.walls.filter((id) => p.walls[id]!.neg && p.walls[id]!.pos);
  if (shared.length) {
    const [n, s] = [neg && lookup(neg), pos && lookup(pos)];
    const same = shared.find((id) => p.walls[id]!.neg === n && p.walls[id]!.pos === s);
    return mergeRooms(p, same ?? shared[0]!, (keep && lookup(keep)) ?? undefined).plan;
  }
  return edit(p, (d) => {
    for (const id of r.walls) {
      const l = wallLine(d, d.walls[id]!);
      deleteWall(d, isolate(d, id, Math.max(l.t0, r.t0), Math.min(l.t1, r.t1)));
    }
  });
}

/** Replays every Change in order. A Change that no longer applies is skipped and reported. */
export function replay(existing: Plan, s: Scenario): Replay {
  let plan = existing;
  const conflicts: Conflict[] = [];
  const created = new Map<ChangeId, string>();
  for (const c of s.changes) {
    const out = applyChange(plan, c, created);
    if ('conflict' in out) {
      conflicts.push({ change: c.id, reason: out.conflict });
      continue;
    }
    plan = out.plan;
    if (out.created) created.set(c.id, out.created);
  }
  return { plan, conflicts, created };
}

const cache = new WeakMap<Plan, WeakMap<Scenario, Replay>>();

function replayed(existing: Plan, s: Scenario): Replay {
  const hit = cache.get(existing)?.get(s);
  if (hit) return hit;
  const r = replay(existing, s);
  remember(existing, s, r);
  return r;
}

function remember(existing: Plan, s: Scenario, r: Replay) {
  let m = cache.get(existing);
  if (!m) cache.set(existing, (m = new WeakMap()));
  m.set(s, r);
}

/** The Scenario's plan, the Change Status of everything in it, and its Conflicts. Pure and total. */
export function applyScenario(existing: Plan, s: Scenario): Applied {
  const r = replayed(existing, s);
  return { plan: r.plan, statuses: changeStatuses(existing, r.plan), conflicts: r.conflicts };
}

/**
 * Records a gesture made in Scenario Mode on the Scenario's current plan. Returns the Scenario with the
 * new Change, or null if the gesture does nothing — so a recorded Change is never born a Conflict.
 */
export function recordChange(
  existing: Plan,
  s: Scenario,
  g: Gesture
): { scenario: Scenario; id: ChangeId } | null {
  const r = replayed(existing, s);
  const id = `c${s.nextId}`;
  const change = toChange(existing, r, g, id);
  if (!change) return null;
  const folded = foldName(existing, s, r, change);
  if (folded) return folded;
  const out = applyChange(r.plan, change, r.created);
  if ('conflict' in out || unchanged(r.plan, out.plan)) return null;
  const scenario: Scenario = { ...s, changes: [...s.changes, change], nextId: s.nextId + 1 };
  const created = new Map(r.created);
  if (out.created) created.set(id, out.created);
  remember(existing, scenario, { plan: out.plan, conflicts: r.conflicts, created });
  return { scenario, id };
}

/**
 * Naming the Room the last Change just made changes that Change instead of adding a rename, so drawing a
 * Room and then typing its name is one Change and one undo step.
 */
function foldName(
  existing: Plan,
  s: Scenario,
  r: Replay,
  c: Change
): { scenario: Scenario; id: ChangeId } | null {
  const last = s.changes[s.changes.length - 1];
  if (c.op !== 'renameRoom' || typeof c.room === 'string' || !last || c.room.created !== last.id) return null;
  if (last.op !== 'nameSpace' && last.op !== 'drawRoom') return null;
  const scenario: Scenario = { ...s, changes: [...s.changes.slice(0, -1), { ...last, name: c.name }] };
  const next = replayed(existing, scenario);
  if (next.conflicts.length > r.conflicts.length || unchanged(r.plan, next.plan)) return null;
  return { scenario, id: last.id };
}

/** Turns the UI's ids into what a Change stores: WallRefs for Walls, Targets for Rooms and Openings. */
function toChange(existing: Plan, r: Replay, g: Gesture, id: ChangeId): Change | null {
  const p = r.plan;
  const madeBy = new Map([...r.created].map(([c, made]) => [made, c]));
  const target = (x: string, mine: boolean): Target | null =>
    mine ? x : madeBy.has(x) ? { created: madeBy.get(x)! } : null;
  const room = (x: RoomId) => (p.rooms[x] ? target(x, !!existing.rooms[x]) : null);
  const opening = (x: string) => (p.openings[x] ? target(x, !!existing.openings[x]) : null);
  const ref = (w: string) => {
    if (!p.walls[w]) return null;
    const { neg, pos } = p.walls[w]!;
    if ((neg && !room(neg)) || (pos && !room(pos))) return null;
    return wallRef(p, w, room);
  };
  switch (g.op) {
    case 'demolishWall': {
      const wall = ref(g.wall);
      if (!wall) return null;
      const merged = p.walls[g.wall]!.neg && p.walls[g.wall]!.pos ? mergeRooms(p, g.wall).id : null;
      return { id, op: g.op, wall, keep: merged ? room(merged) : null };
    }
    case 'drawWall': {
      const pt = (q: { x: number; y: number }) => ({ x: Math.round(q.x), y: Math.round(q.y) });
      const thickness = Math.round(g.thickness ?? p.defaults.interior);
      return { id, op: g.op, a: pt(g.a), b: pt(g.b), thickness };
    }
    case 'pushWall': {
      const wall = ref(g.wall);
      return wall && { id, op: g.op, wall, delta: Math.round(g.delta), outline: !!g.outline };
    }
    case 'setThickness': {
      const wall = ref(g.wall);
      return wall && { id, op: g.op, wall, thickness: Math.round(g.thickness) };
    }
    case 'addOpening': {
      const wall = ref(g.wall);
      return wall && { id, op: g.op, wall, kind: g.kind, center: Math.round(g.center) };
    }
    case 'removeOpening': {
      const o = opening(g.opening);
      return o === null ? null : { id, op: g.op, opening: o };
    }
    case 'modifyOpening': {
      const o = opening(g.opening);
      const patch = { ...g.patch };
      if (patch.at !== undefined) patch.at = Math.round(patch.at);
      if (patch.width !== undefined) patch.width = Math.round(patch.width);
      return o === null ? null : { id, op: g.op, opening: o, patch };
    }
    case 'nameSpace':
      return { id, op: g.op, x: Math.round(g.x), y: Math.round(g.y), name: g.name };
    case 'drawRoom': {
      const { x0, y0, x1, y1 } = g.rect;
      const rect = {
        x0: Math.round(Math.min(x0, x1)),
        y0: Math.round(Math.min(y0, y1)),
        x1: Math.round(Math.max(x0, x1)),
        y1: Math.round(Math.max(y0, y1))
      };
      const thickness = Math.round(g.thickness ?? drawRoomThickness(p, rect));
      return { id, op: g.op, rect, name: g.name, thickness };
    }
    case 'renameRoom': {
      const t = room(g.room);
      return t === null ? null : { id, op: g.op, room: t, name: g.name };
    }
    case 'setRoomType': {
      const t = room(g.room);
      return t === null ? null : { id, op: g.op, room: t, type: g.type };
    }
  }
}
