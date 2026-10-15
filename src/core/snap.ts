import type { PushPrep } from './commands/walls';
import { SLIVER, derive } from './derive';
import { type Axis, type Plan, type RoomId, claims, faceOf } from './plan';
import type { Mm } from './units';

// Smart guides for dragging (ADR 0007): magnetic snapping to Wall faces, alignment guides, and live
// distances to neighbouring Walls. Thresholds are in mm; the UI converts from screen pixels.

/** A guide line: 'v' is vertical at x = c from y = a to b; 'h' is horizontal at y = c. */
export interface Guide {
  axis: Axis;
  c: number;
  a: number;
  b: number;
}

export interface SnapOptions {
  /** Snap radius in mm. */
  threshold: Mm;
  /** Grid step used when nothing is near; 0 for none. */
  grid: Mm;
}

interface Face {
  c: number;
  a: number;
  b: number;
}

const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : Math.round(v));

function best(moving: Face[], targets: Face[], delta: number, threshold: number) {
  let found: { off: number; guide: Face } | null = null;
  for (const m of moving)
    for (const t of targets) {
      const off = t.c - (m.c + delta);
      if (Math.abs(off) > threshold || (found && Math.abs(off) >= Math.abs(found.off))) continue;
      found = { off, guide: { c: t.c, a: Math.min(m.a, t.a), b: Math.max(m.b, t.b) } };
    }
  return found;
}

/**
 * Snaps a Room being moved (in the detached plan from prepareMove). Its inside faces snap to other Walls'
 * faces that face the same way — landing on a neighbour's outside face makes a Shared Wall; landing on
 * another Room's inside face aligns them.
 */
export function snapMove(plan: Plan, room: RoomId, dx: Mm, dy: Mm, opts: SnapOptions) {
  const D = derive(plan);
  const guides: Guide[] = [];
  const out = { dx, dy, guides };
  for (const axis of ['v', 'h'] as Axis[]) {
    const delta = axis === 'v' ? dx : dy;
    const shift = axis === 'v' ? dy : dx;
    const moving: Record<'neg' | 'pos', Face[]> = { neg: [], pos: [] };
    const targets: Record<'neg' | 'pos', Face[]> = { neg: [], pos: [] };
    for (const id in plan.walls) {
      const w = plan.walls[id]!;
      const g = D.walls[id]!;
      if (g.line.axis !== axis) continue;
      const span = axis === 'v' ? [g.rect.y0, g.rect.y1] : [g.rect.x0, g.rect.x1];
      if (claims(w, room)) {
        // The Room's inside face is the claimed face; it moves along with the Room.
        for (const side of ['neg', 'pos'] as const)
          if (w[side] === room)
            moving[side].push({ c: faceOf(g.line, side), a: span[0]! + shift, b: span[1]! + shift });
      } else {
        targets.neg.push({ c: g.line.lo, a: span[0]!, b: span[1]! });
        targets.pos.push({ c: g.line.hi, a: span[0]!, b: span[1]! });
      }
    }
    // A Room on a Wall's pos face has that face on its low side: it meets other Walls' high faces.
    const a = best(moving.pos, targets.pos, delta, opts.threshold);
    const b = best(moving.neg, targets.neg, delta, opts.threshold);
    const hit = a && b ? (Math.abs(a.off) <= Math.abs(b.off) ? a : b) : (a ?? b);
    const next = hit ? delta + hit.off : roundTo(delta, opts.grid);
    if (hit) guides.push({ axis, ...hit.guide });
    if (axis === 'v') out.dx = Math.round(next);
    else out.dy = Math.round(next);
  }
  return out;
}

/** Snaps a Wall being pushed: its faces align with the same faces of other parallel Walls. */
export function snapPush(prep: PushPrep, delta: Mm, opts: SnapOptions) {
  const plan = prep.plan;
  const D = derive(plan);
  const inRun = new Set(prep.run);
  const moving: Record<'lo' | 'hi', Face[]> = { lo: [], hi: [] };
  const targets: Record<'lo' | 'hi', Face[]> = { lo: [], hi: [] };
  for (const id in plan.walls) {
    const g = D.walls[id]!;
    if (g.line.axis !== prep.axis) continue;
    const span = prep.axis === 'v' ? [g.rect.y0, g.rect.y1] : [g.rect.x0, g.rect.x1];
    const into = inRun.has(id) ? moving : targets;
    into.lo.push({ c: g.line.lo, a: span[0]!, b: span[1]! });
    into.hi.push({ c: g.line.hi, a: span[0]!, b: span[1]! });
  }
  const a = best(moving.lo, targets.lo, delta, opts.threshold);
  const b = best(moving.hi, targets.hi, delta, opts.threshold);
  const hit = a && b ? (Math.abs(a.off) <= Math.abs(b.off) ? a : b) : (a ?? b);
  const raw = hit ? delta + hit.off : roundTo(delta, opts.grid);
  const d = Math.round(Math.min(prep.range[1], Math.max(prep.range[0], raw)));
  return { delta: d, guides: hit && d === Math.round(raw) ? [{ axis: prep.axis, ...hit.guide }] : [] };
}

export interface Clearance {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** How far the Room's inside face still is from snapping onto the Wall; negative when it is too close. */
  distance: Mm;
  /** 'bad' too close; 'warn' close enough to leave measurement slop; 'ok' leaves real floor. */
  tone: 'ok' | 'warn' | 'bad';
  /** Floor left between the Room's own Wall and the other Wall, when the tone is 'ok'. */
  clear: Mm;
}

const MAX_CLEARANCE: Mm = 8000;

/** Live distances from a Room to the nearest Wall in each direction, measured through its middle. */
export function clearances(plan: Plan, room: RoomId): Clearance[] {
  const D = derive(plan);
  const box = D.rooms[room]?.bounds;
  if (!box) return [];
  const own = plan.defaults.interior;
  const out: Clearance[] = [];
  for (const [axis, sign] of [
    ['v', 1],
    ['v', -1],
    ['h', 1],
    ['h', -1]
  ] as const) {
    const face = axis === 'v' ? (sign > 0 ? box.x1 : box.x0) : sign > 0 ? box.y1 : box.y0;
    const mid = axis === 'v' ? (box.y0 + box.y1) / 2 : (box.x0 + box.x1) / 2;
    let nearest: number | null = null;
    for (const id in plan.walls) {
      if (claims(plan.walls[id]!, room)) continue;
      const g = D.walls[id]!;
      if (g.line.axis !== axis) continue;
      const [a, b] = axis === 'v' ? [g.rect.y0, g.rect.y1] : [g.rect.x0, g.rect.x1];
      if (!(a < mid && mid < b)) continue;
      const d = sign > 0 ? g.line.lo - face : face - g.line.hi;
      const behind = sign > 0 ? g.line.hi <= face : g.line.lo >= face;
      if (behind) continue;
      if (nearest === null || d < nearest) nearest = d;
    }
    if (nearest === null || nearest > MAX_CLEARANCE || Math.abs(nearest) <= 1) continue;
    const tone = nearest < 0 ? 'bad' : nearest - own < SLIVER ? 'warn' : 'ok';
    const at = (n: number) => (axis === 'v' ? { x: n, y: mid } : { x: mid, y: n });
    out.push({
      from: at(face),
      to: at(face + sign * nearest),
      distance: nearest,
      tone,
      clear: nearest - own
    });
  }
  return out;
}
