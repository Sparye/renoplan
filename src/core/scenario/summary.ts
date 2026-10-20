import { derive } from '../derive';
import { type Rect, intersects, rectsArea } from '../grid';
import { type Plan, type RoomId, wallLine } from '../plan';
import type { Mm } from '../units';
import { extensionOf } from './extension';
import { type ChangeStatuses, type Stretch, union } from './status';

// What a Comparison's summary table says about one side: a plan against the Existing Plan, read from
// Change Status (ADR 0010) only, never from the Change list.

export interface RoomSummary {
  id: RoomId;
  name: string;
  /** mm² */
  area: number;
  status: 'retained' | 'new';
}

/** Wall material by Wall, as separate contiguous stretches along their centrelines. */
export interface WallTally {
  count: number;
  length: Mm;
}

export interface PlanSummary {
  /** The side's Rooms, in plan order. */
  rooms: RoomSummary[];
  /** Existing Plan Rooms the side no longer has, and the side's Room that took most of their floor (a merge). */
  gone: { id: RoomId; into: RoomId | null }[];
  /** Total Room area, mm². Unlabelled Space is not a Room. */
  roomArea: number;
  /** Existing Plan Wall that is Demolished. A Modified Wall counts where it was: it is taken down and rebuilt. */
  demolished: WallTally;
  /** The Demolished Wall that is marked structural. */
  structural: WallTally;
  /** Length of New Wall. */
  newWalls: Mm;
  /** Floor of the side's Footprint outside the Existing Plan's Footprint (Extension), mm². */
  extensionArea: number;
}

/** One side of a Comparison: the Existing Plan (null), or a Scenario's plan and its Change Status. */
export type ComparisonSide = { plan: Plan; statuses: ChangeStatuses } | null;

/** Stretches keyed by centreline, counted as Walls: touching stretches are one Wall. */
function tally(byLine: Map<string, Stretch[]>): WallTally {
  let count = 0;
  let length = 0;
  for (const ss of byLine.values())
    for (const s of union(ss)) {
      if (s.t1 <= s.t0) continue;
      count++;
      length += s.t1 - s.t0;
    }
  return { count, length };
}

function add(m: Map<string, Stretch[]>, k: string, ss: readonly Stretch[]) {
  m.set(k, [...(m.get(k) ?? []), ...ss]);
}

/** Area shared by two sets of disjoint rectangles. */
function overlap(a: readonly Rect[], b: readonly Rect[]): number {
  let n = 0;
  for (const r of a)
    for (const q of b)
      if (intersects(r, q))
        n += (Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0)) * (Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0));
  return n;
}

/**
 * The summary of one side of a Comparison. The Existing Plan's own summary (side null) is the baseline:
 * every Room Retained, nothing Demolished or New, no Extension.
 */
export function summarize(existing: Plan, side: ComparisonSide): PlanSummary {
  const plan = side?.plan ?? existing;
  const D = derive(plan);
  const E = derive(existing);
  const rooms: RoomSummary[] = Object.keys(plan.rooms).map((id) => ({
    id,
    name: plan.rooms[id]!.name,
    area: D.rooms[id]!.area,
    status: side?.statuses.rooms[id] ?? 'retained'
  }));
  if (!side)
    return {
      rooms,
      gone: [],
      roomArea: rooms.reduce((s, r) => s + r.area, 0),
      demolished: { count: 0, length: 0 },
      structural: { count: 0, length: 0 },
      newWalls: 0,
      extensionArea: 0
    };

  const gone = side.statuses.demolishedRooms.map((id) => {
    let into: RoomId | null = null;
    let most = 0;
    for (const r of rooms) {
      const n = overlap(E.rooms[id]!.rects, D.rooms[r.id]!.rects);
      if (n > most) [into, most] = [r.id, n];
    }
    return { id, into };
  });

  const demolished = new Map<string, Stretch[]>();
  const structural = new Map<string, Stretch[]>();
  for (const [id, ss] of Object.entries(side.statuses.demolished)) {
    const w = existing.walls[id];
    if (!w) continue;
    const l = wallLine(existing, w);
    add(demolished, `${l.axis}|${l.c}`, ss);
    if (w.structural) add(structural, `${l.axis}|${l.c}`, ss);
  }
  const built = new Map<string, Stretch[]>();
  for (const [id, ss] of Object.entries(side.statuses.walls)) {
    const w = plan.walls[id];
    if (!w) continue;
    const l = wallLine(plan, w);
    add(
      built,
      `${l.axis}|${l.c}`,
      ss.filter((s) => s.status === 'new')
    );
  }

  return {
    rooms,
    gone,
    roomArea: rooms.reduce((s, r) => s + r.area, 0),
    demolished: tally(demolished),
    structural: tally(structural),
    newWalls: tally(built).length,
    extensionArea: rectsArea(extensionOf(existing, plan))
  };
}

/** One side's cell in a Room row: the Room, an Existing Plan Room it no longer has, or nothing. */
export type RoomCell =
  { kind: 'room'; room: RoomSummary } | { kind: 'gone'; into: RoomSummary | null } | { kind: 'none' };

export interface RoomRow {
  /** The Existing Plan Room the row is about, or null for a Room one side made. */
  existing: RoomId | null;
  cells: [RoomCell, RoomCell];
}

/**
 * The Rooms of two sides, row by row. Existing Plan Rooms come first, in Existing Plan order, matched by
 * id (a merged Room keeps one of the two ids). Then each side's New Rooms, one row each: a Room a Scenario
 * made has an id minted during replay, so it never matches a Room on the other side.
 */
export function compareRooms(existing: Plan, a: PlanSummary, b: PlanSummary): RoomRow[] {
  const cell = (s: PlanSummary, id: RoomId): RoomCell => {
    const room = s.rooms.find((r) => r.id === id && r.status === 'retained');
    if (room) return { kind: 'room', room };
    const g = s.gone.find((x) => x.id === id);
    if (g) return { kind: 'gone', into: s.rooms.find((r) => r.id === g.into) ?? null };
    return { kind: 'none' };
  };
  const made = (s: PlanSummary) => s.rooms.filter((r) => r.status === 'new');
  return [
    ...Object.keys(existing.rooms).map(
      (id) => ({ existing: id, cells: [cell(a, id), cell(b, id)] }) as RoomRow
    ),
    ...made(a).map((room): RoomRow => ({
      existing: null,
      cells: [{ kind: 'room', room }, { kind: 'none' }]
    })),
    ...made(b).map((room): RoomRow => ({ existing: null, cells: [{ kind: 'none' }, { kind: 'room', room }] }))
  ];
}
