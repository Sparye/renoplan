import { Grid, type Rect, rectsArea } from './grid';
import { incidence, materialRect, roomRegion, splitWall } from './graph';
import { type Axis, type Plan, type RoomId, type Side, type WallId, faceOf, wallLine } from './plan';
import type { Mm } from './units';

// Which stretch of a Wall face a Room claims. A Room claims a face exactly where the face borders the
// Room's region, bridging only junction material (Walls perpendicular to the face) — never a parallel
// neighbour's Wall lying alongside.

/** A grid over every Wall, with masks of the material of horizontal and vertical Walls. */
export function claimGrid(p: Plan, extra: readonly Rect[] = []) {
  const inc = incidence(p);
  const rects = new Map(Object.keys(p.walls).map((id) => [id, materialRect(p, id, inc)]));
  const all = [...rects.values()];
  const g = new Grid(all, { xs: extra.flatMap((r) => [r.x0, r.x1]), ys: extra.flatMap((r) => [r.y0, r.y1]) });
  const of = (axis: Axis) =>
    g.mask(
      Object.keys(p.walls)
        .filter((id) => wallLine(p, p.walls[id]!).axis === axis)
        .map((id) => rects.get(id)!)
    );
  // A face of a horizontal Wall bridges vertical Walls' material, and vice versa.
  return { g, rects, solid: g.mask(all), junction: { h: of('v'), v: of('h') } };
}

/**
 * Stretches along a Wall face that border a region: runs of cells beside the face that are in the region
 * or junction material, containing at least one region cell. A span reaching the end of the Wall's
 * material reaches the Wall's end (±Infinity).
 */
export function faceSpans(
  g: Grid,
  region: Uint8Array,
  junction: Uint8Array,
  axis: Axis,
  face: Mm,
  side: Side,
  rect: Rect
): [number, number][] {
  const lines = axis === 'v' ? g.xs : g.ys;
  const ts = axis === 'v' ? g.ys : g.xs;
  const k = lines.indexOf(face);
  const across = side === 'pos' ? k : k - 1;
  if (k < 0 || across < 0 || across >= lines.length - 1) return [];
  const [r0, r1] = axis === 'v' ? [rect.y0, rect.y1] : [rect.x0, rect.x1];
  const out: [number, number][] = [];
  let start: number | null = null;
  let hit = false;
  const close = (end: number) => {
    if (start !== null && hit) out.push([start, end]);
    start = null;
    hit = false;
  };
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i]! < r0 || ts[i + 1]! > r1) continue;
    const c = axis === 'v' ? g.cell(across, i) : g.cell(i, across);
    if (region[c] || junction[c]) {
      start ??= ts[i]!;
      hit ||= region[c] === 1;
    } else close(ts[i]!);
  }
  close(r1);
  return out.map(([a, b]) => [a <= r0 ? -Infinity : a, b >= r1 ? Infinity : b]);
}

/**
 * Sets a face's claim to the Room over the given spans and to `outside` elsewhere, splitting the Wall
 * where that changes. Returns whether anything changed.
 */
export function claimSpans(
  p: Plan,
  wallId: WallId,
  side: Side,
  spans: readonly [number, number][],
  room: RoomId,
  outside: RoomId | null
): boolean {
  const l = wallLine(p, p.walls[wallId]!);
  const whole = spans.some(([a, b]) => a <= l.t0 && b >= l.t1);
  if (whole) {
    if (p.walls[wallId]![side] === room) return false;
    p.walls[wallId]![side] = room;
    return true;
  }
  const cuts = [...new Set(spans.flat())].filter((t) => t > l.t0 && t < l.t1).sort((a, b) => b - a);
  // Highest first: the original id keeps the low piece as it is split.
  const pieces = [wallId];
  for (const t of cuts) {
    const hi = splitWall(p, wallId, t);
    if (hi) pieces.push(hi);
  }
  let changed = cuts.length > 0;
  for (const piece of pieces) {
    const pl = wallLine(p, p.walls[piece]!);
    const mid = (pl.t0 + pl.t1) / 2;
    const next = spans.some(([a, b]) => a <= mid && mid <= b) ? room : outside;
    if (p.walls[piece]![side] !== next) {
      p.walls[piece]![side] = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Trims every claim to the stretch of face that borders its Room. A claim on a face that no longer
 * borders the Room (its boundary slid along the Wall) is stale. Skipped if it would change any Room's
 * region, so it can only tidy, never break.
 */
export function repairClaims(p: Plan): boolean {
  const rooms = Object.keys(p.rooms);
  const regions = new Map(rooms.map((r) => [r, roomRegion(p, r)]));
  const { g, junction } = claimGrid(p, [...regions.values()].flat());
  const masks = new Map([...regions].map(([r, rs]) => [r, g.mask(rs)]));
  const geoms = new Map(
    Object.keys(p.walls).map((id) => [id, { line: wallLine(p, p.walls[id]!), rect: materialRect(p, id) }])
  );
  let changed = false;
  for (const id of Object.keys(p.walls))
    for (const side of ['neg', 'pos'] as const) {
      const room = p.walls[id]?.[side];
      if (!room || !masks.has(room)) continue;
      const { line, rect } = geoms.get(id)!;
      const spans = faceSpans(
        g,
        masks.get(room)!,
        junction[line.axis],
        line.axis,
        faceOf(line, side),
        side,
        rect
      );
      if (spans.some(([a, b]) => a === -Infinity && b === Infinity)) continue;
      changed = claimSpans(p, id, side, spans, room, null) || changed;
    }
  if (!changed) return false;
  // The safety net: a repair never changes what a Room encloses.
  for (const r of rooms) {
    const after = roomRegion(p, r);
    if (rectsArea(after) !== rectsArea(regions.get(r)!)) throw new RepairFailed();
  }
  return true;
}

export class RepairFailed extends Error {}

/** The parts of the spans a outside the spans b. */
export function without(a: readonly [number, number][], b: readonly [number, number][]): [number, number][] {
  let out = [...a];
  for (const [b0, b1] of b)
    out = out.flatMap(([a0, a1]): [number, number][] =>
      b1 <= a0 || b0 >= a1
        ? [[a0, a1]]
        : (
            [
              [a0, b0],
              [b1, a1]
            ] as [number, number][]
          ).filter(([x, y]) => y > x)
    );
  return out;
}
