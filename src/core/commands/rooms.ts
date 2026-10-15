import { derive } from '../derive';
import { claimGrid, claimSpans, faceSpans } from '../claims';
import { type Rect, intersects } from '../grid';
import { addNode, deleteWall, moveNodes } from '../graph';
import {
  type Plan,
  type RoomId,
  type RoomType,
  type Side,
  type WallId,
  claims,
  clonePlan,
  faceOf,
  faceOffsets,
  mintId,
  sideOf,
  wallLine
} from '../plan';
import { guessRoomType } from '../roomType';
import type { Mm } from '../units';
import { detachRoom } from './detach';
import { create, edit, finish } from './edit';
import { MIN_ROOM } from './walls';

/** Rooms are parked in rows this far to the right of the Outline, this far apart. */
const PARK_OFFSET: Mm = 2000;
const PARK_GAP: Mm = 800;
const PARK_ROW: Mm = 11000;

export interface NewRoom {
  name: string;
  type?: RoomType;
  /** Inside dimensions. */
  w: Mm;
  l: Mm;
  /** Top-left inside corner; parked beside the Outline when omitted. */
  x?: Mm;
  y?: Mm;
}

/** Adds a Room as four interior Walls around its inside rectangle. */
export function addRoom(p: Plan, r: NewRoom): { plan: Plan; id: RoomId | null } {
  const w = Math.round(r.w);
  const l = Math.round(r.l);
  if (!(w >= MIN_ROOM && l >= MIN_ROOM)) return { plan: p, id: null };
  const at = r.x !== undefined && r.y !== undefined ? { x: r.x, y: r.y } : parkingSpot(p, w, l);
  return create(p, (d) => {
    const id = mintId(d, 'r');
    const name = r.name.trim() || `Room ${Object.keys(d.rooms).length + 1}`;
    d.rooms[id] = { name, type: r.type ?? guessRoomType(name) };
    rectWalls(d, { x0: at.x, y0: at.y, x1: at.x + w, y1: at.y + l }, d.defaults.interior, id, false);
    return id;
  });
}

/** A thickness for each side of a rectangle of Walls. */
export type SideThickness = { top: Mm; bottom: Mm; left: Mm; right: Mm };

/**
 * Four Walls of thickness t (one for all sides, or one per side) around a rectangle. With a room, the
 * rectangle is its inside and each Wall claims it; without, the rectangle is the outside of the Walls
 * (an Outline).
 */
export function rectWalls(p: Plan, r: Rect, t: Mm | SideThickness, room: RoomId | null, exterior: boolean) {
  const ts = typeof t === 'number' ? { top: t, bottom: t, left: t, right: t } : t;
  // Room: faces on the rectangle from outside. Outline: faces on the rectangle from inside.
  const lo = (v: Mm, th: Mm) => (room ? v - faceOffsets(th)[1] : v + faceOffsets(th)[0]);
  const hi = (v: Mm, th: Mm) => (room ? v + faceOffsets(th)[0] : v - faceOffsets(th)[1]);
  const x0 = lo(r.x0, ts.left);
  const x1 = hi(r.x1, ts.right);
  const y0 = lo(r.y0, ts.top);
  const y1 = hi(r.y1, ts.bottom);
  const tl = addNode(p, x0, y0);
  const tr = addNode(p, x1, y0);
  const br = addNode(p, x1, y1);
  const bl = addNode(p, x0, y1);
  const wall = (a: string, b: string, thickness: Mm, side: Side | null) => {
    p.walls[mintId(p, 'w')] = {
      a,
      b,
      thickness,
      exterior,
      structural: false,
      drawn: false,
      neg: side === 'neg' ? room : null,
      pos: side === 'pos' ? room : null
    };
  };
  wall(tl, tr, ts.top, room ? 'pos' : null);
  wall(bl, br, ts.bottom, room ? 'neg' : null);
  wall(tl, bl, ts.left, room ? 'pos' : null);
  wall(tr, br, ts.right, room ? 'neg' : null);
}

/** The next free spot in rows to the right of the Outline (or of everything, without one). */
export function parkingSpot(p: Plan, w: Mm, l: Mm): { x: Mm; y: Mm } {
  const D = derive(p);
  const solid: Rect[] = [...Object.values(D.walls).map((g) => g.rect), ...D.footprint.rects];
  const anchor = D.outline?.bounds ?? null;
  const sx = anchor ? anchor.x1 + PARK_OFFSET : 0;
  let y = anchor ? anchor.y0 : 0;
  for (;;) {
    let x = sx;
    for (;;) {
      const zone = { x0: x - PARK_GAP, y0: y - PARK_GAP, x1: x + w + PARK_GAP, y1: y + l + PARK_GAP };
      const blockers = solid.filter((r) => intersects(r, zone));
      if (!blockers.length) return { x, y };
      x = Math.max(...blockers.map((r) => r.x1)) + PARK_GAP;
      if (x + w > sx + PARK_ROW) break;
    }
    const band = { x0: sx - PARK_GAP, y0: y - PARK_GAP, x1: Infinity, y1: y + l + PARK_GAP };
    const below = solid.filter((r) => intersects(r, band)).map((r) => r.y1 + PARK_GAP);
    y = Math.max(y + 1, ...below);
  }
}

// ---------- moving and resizing ----------

export interface MovePrep {
  /** The plan before the move. */
  base: Plan;
  /** The plan with the Room detached from its neighbours, not yet in normal form. */
  plan: Plan;
  room: RoomId;
}

/** Drag inside a Room: it moves as a block, leaving its neighbours their Walls. */
export function prepareMove(p: Plan, room: RoomId): MovePrep | null {
  if (!p.rooms[room]) return null;
  const d = clonePlan(p);
  detachRoom(d, room);
  return { base: p, plan: d, room };
}

export function applyMove(prep: MovePrep, dx: Mm, dy: Mm): Plan {
  const d = clonePlan(prep.plan);
  const mine = Object.keys(d.walls).filter((id) => claims(d.walls[id]!, prep.room));
  const nodes = new Set(mine.flatMap((id) => [d.walls[id]!.a, d.walls[id]!.b]));
  moveNodes(d, nodes, 'v', Math.round(dx));
  moveNodes(d, nodes, 'h', Math.round(dy));
  const set = new Set(mine);
  for (const o of Object.values(d.openings))
    if (set.has(o.wall)) o.at += Math.round(wallLine(d, d.walls[o.wall]!).axis === 'h' ? dx : dy);
  return finish(prep.base, d);
}

export function moveRoom(p: Plan, room: RoomId, dx: Mm, dy: Mm): Plan {
  const prep = prepareMove(p, room);
  return prep ? applyMove(prep, dx, dy) : p;
}

/**
 * Sets a rectangular Room's inside W × L. W grows rightward and L downward; neighbours never move, so a
 * clash shows as an Overlap. The Room is detached and rebuilt at its new size; normal form fuses it back
 * onto whatever it still touches. Openings on its own Walls stay on the same side.
 */
export function setRoomSize(p: Plan, room: RoomId, w: Mm, l: Mm): Plan {
  const g = derive(p).rooms[room];
  if (!g?.rectangular || !g.bounds) return p;
  const b = g.bounds;
  const W = Math.max(MIN_ROOM, Math.round(w));
  const L = Math.max(MIN_ROOM, Math.round(l));
  if (W === b.x1 - b.x0 && L === b.y1 - b.y0) return p;
  return edit(p, (d) => {
    detachRoom(d, room);
    const sideOfWall = (id: WallId) => {
      const line = wallLine(d, d.walls[id]!);
      const s = sideOf(d.walls[id]!, room)!;
      return `${line.axis}${s}`;
    };
    const openings = Object.values(d.openings).filter(
      (o) => d.walls[o.wall] && claims(d.walls[o.wall]!, room)
    );
    const carried = openings.map((o) => ({ o, side: sideOfWall(o.wall) }));
    for (const id of Object.keys(d.walls)) if (claims(d.walls[id]!, room)) delete d.walls[id];
    rectWalls(d, { x0: b.x0, y0: b.y0, x1: b.x0 + W, y1: b.y0 + L }, d.defaults.interior, room, false);
    const fresh = Object.keys(d.walls).filter((id) => claims(d.walls[id]!, room));
    for (const { o, side } of carried) {
      const host = fresh.find((id) => sideOfWall(id) === side);
      if (host) o.wall = host;
    }
  });
}

// ---------- naming, merging, deleting ----------

export function renameRoom(p: Plan, room: RoomId, name: string): Plan {
  const r = p.rooms[room];
  const n = name.trim();
  if (!r || !n || n === r.name) return p;
  return edit(p, (d) => {
    // The type follows the name until the user picks one that differs from the guess.
    const guessed = r.type === guessRoomType(r.name);
    d.rooms[room] = { name: n, type: guessed ? guessRoomType(n) : r.type };
  });
}

export function setRoomType(p: Plan, room: RoomId, type: RoomType): Plan {
  if (!p.rooms[room] || p.rooms[room].type === type) return p;
  return edit(p, (d) => {
    d.rooms[room]!.type = type;
  });
}

/** Removes a Room. Its own Walls go; Walls it shares stay with the neighbour, the Outline, or as drawn. */
export function deleteRoom(p: Plan, room: RoomId): Plan {
  if (!p.rooms[room]) return p;
  return edit(p, (d) => {
    for (const id of Object.keys(d.walls)) {
      const w = d.walls[id]!;
      const side = sideOf(w, room);
      if (!side) continue;
      const other = side === 'neg' ? w.pos : w.neg;
      if (!other && !w.exterior && !w.drawn) deleteWall(d, id);
      else w[side] = null;
    }
    delete d.rooms[room];
  });
}

/**
 * Removes the Shared Wall between two Rooms, merging them. The larger Room keeps its name, unless `prefer`
 * names one of the two (a Scenario replaying a merge keeps the Room it kept when recorded). Rooms on two
 * sides of the Outline never merge.
 */
export function mergeRooms(p: Plan, wallId: WallId, prefer?: RoomId): { plan: Plan; id: RoomId | null } {
  const w = p.walls[wallId];
  if (!w?.neg || !w.pos || w.neg === w.pos) return { plan: p, id: null };
  const pair = new Set([w.neg, w.pos]);
  const between = Object.values(p.walls).filter((x) => x.neg && x.pos && pair.has(x.neg) && pair.has(x.pos));
  if (between.some((x) => x.exterior)) return { plan: p, id: null };
  const rooms = derive(p).rooms;
  const [keep, drop] =
    prefer === w.pos
      ? [w.pos, w.neg]
      : prefer === w.neg || (rooms[w.neg]?.area ?? 0) >= (rooms[w.pos]?.area ?? 0)
        ? [w.neg, w.pos]
        : [w.pos, w.neg];
  return create(p, (d) => {
    for (const id of Object.keys(d.walls)) {
      const x = d.walls[id]!;
      const between = (x.neg === keep && x.pos === drop) || (x.neg === drop && x.pos === keep);
      if (between) deleteWall(d, id);
      else {
        if (x.neg === drop) x.neg = keep;
        if (x.pos === drop) x.pos = keep;
      }
    }
    delete d.rooms[drop];
    return keep;
  });
}

/** The parts of the spans a outside the spans b. */
function without(a: readonly [number, number][], b: readonly [number, number][]): [number, number][] {
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

/** Turns the Unlabelled Space at a point into a Room by claiming the free Wall faces around it. */
export function nameSpace(p: Plan, x: number, y: number, name: string): { plan: Plan; id: RoomId | null } {
  const D = derive(p);
  if (D.spaceAt(x, y) < 0) return { plan: p, id: null };
  const claimed = Object.values(D.rooms).flatMap((r) => r.rects);
  const { g, solid, junction } = claimGrid(p, claimed);
  const taken = g.mask(claimed);
  const outside = g.flood(g.border(), (c) => !solid[c]);
  const region = g.flood([g.cellAt(x, y)], (c) => !solid[c] && !outside[c] && !taken[c]);

  // Where a parallel Wall's material covers a Wall right across (a Room's own Wall pushed into the Outline
  // from outside), its face is no boundary anyone sees: the space is bounded by the Wall around it, and
  // sharing the buried one would join two Rooms through it.
  const buried = (wid: string): [number, number][] => {
    const { line } = D.walls[wid]!;
    const out: [number, number][] = [];
    for (const o in D.walls) {
      const q = D.walls[o]!;
      if (o === wid || q.line.axis !== line.axis) continue;
      const [lo, hi, s, e] =
        line.axis === 'v'
          ? [q.rect.x0, q.rect.x1, q.rect.y0, q.rect.y1]
          : [q.rect.y0, q.rect.y1, q.rect.x0, q.rect.x1];
      if (lo <= line.lo && hi >= line.hi) out.push([s, e]);
    }
    return out;
  };

  const result = create(p, (d) => {
    const id = mintId(d, 'r');
    const n = name.trim() || 'Hallway';
    d.rooms[id] = { name: n, type: guessRoomType(n) };
    for (const wid of Object.keys(d.walls)) {
      const { line, rect } = D.walls[wid]!;
      const hidden = buried(wid);
      const spans = (side: Side) =>
        // Claims only ever extend over the free face, never over another Room's claim.
        d.walls[wid]![side] !== null
          ? []
          : without(
              faceSpans(g, region, junction[line.axis], line.axis, faceOf(line, side), side, rect),
              hidden
            );
      const neg = spans('neg');
      const pos = spans('pos');
      // Where the space lies on both faces, the Wall stands inside it (a drawn stub): neither face bounds it.
      if (neg.length) claimSpans(d, wid, 'neg', without(neg, pos), id, null);
      if (pos.length) claimSpans(d, wid, 'pos', without(pos, neg), id, null);
    }
    return id;
  });
  if (!result.id || !(derive(result.plan).rooms[result.id]?.area ?? 0)) return { plan: p, id: null };
  return result;
}
