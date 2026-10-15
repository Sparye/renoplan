import { Grid, type Rect, bounds, labelPoint, rectsArea } from './grid';
import { enclosedBy, incidence, materialRect, roomRegion } from './graph';
import { type Line, type Plan, type RoomId, type WallId, wallLine } from './plan';
import type { Mm } from './units';

// Everything about a plan that is not stored: computed by exact flood fill over a coordinate-compressed grid.

/** Strips of unclaimed floor thinner than this are measurement slop, absorbed into the Walls. */
export const SLIVER: Mm = 300;
/** Unclaimed pockets smaller than this (0.25 m²) are absorbed too. */
export const SLIVER_AREA = 250_000;

export interface WallGeom {
  line: Line;
  /** Solid material, including the junction squares. */
  rect: Rect;
}

export interface RoomGeom {
  /** The inside region: what the Room's claimed faces enclose. */
  rects: Rect[];
  area: number;
  bounds: Rect | null;
  label: { x: number; y: number } | null;
  /** The region is a single rectangle, so it has a W × L. */
  rectangular: boolean;
}

export interface Space {
  rects: Rect[];
  area: number;
  label: { x: number; y: number };
}

export interface Derived {
  walls: Record<WallId, WallGeom>;
  rooms: Record<RoomId, RoomGeom>;
  /** Unlabelled Space: enclosed floor no Room claims. */
  unlabelled: Space[];
  /** Absorbed strips, drawn as Wall. */
  slivers: Rect[];
  /** Where a Room sits on another Room or crosses the Outline. */
  overlaps: Rect[];
  crossing: RoomId[];
  /** Rooms not yet dragged into the Outline. */
  parked: RoomId[];
  /** The Outline's inside region (inside the exterior Walls), if there is an Outline. */
  outline: { inside: Rect[]; bounds: Rect } | null;
  footprint: { rects: Rect[]; area: number };
  /** Index into `unlabelled` of the Unlabelled Space at a point, or -1. */
  spaceAt(x: number, y: number): number;
  insideOutline(x: number, y: number): boolean;
}

const cache = new WeakMap<Plan, Derived>();

export function derive(p: Plan): Derived {
  const hit = cache.get(p);
  if (hit) return hit;
  const d = compute(p);
  cache.set(p, d);
  return d;
}

function compute(p: Plan): Derived {
  const inc = incidence(p);
  const walls: Record<WallId, WallGeom> = {};
  for (const id in p.walls) walls[id] = { line: wallLine(p, p.walls[id]!), rect: materialRect(p, id, inc) };

  const rooms: Record<RoomId, RoomGeom> = {};
  for (const id in p.rooms) {
    const rects = roomRegion(p, id);
    rooms[id] = {
      rects,
      area: rectsArea(rects),
      bounds: bounds(rects),
      label: labelPoint(rects),
      rectangular: rects.length === 1
    };
  }

  const exteriorIds = Object.keys(p.walls).filter((id) => p.walls[id]!.exterior);
  const exterior = exteriorIds.map((id) => walls[id]!.rect);
  const outlineInside = exterior.length ? enclosedBy(p, exteriorIds) : [];
  const outlineBounds = bounds(exterior);
  const outline =
    outlineInside.length && outlineBounds ? { inside: outlineInside, bounds: outlineBounds } : null;

  const solidRects = Object.values(walls).map((w) => w.rect);
  const empty: Derived = {
    walls,
    rooms,
    unlabelled: [],
    slivers: [],
    overlaps: [],
    crossing: [],
    parked: [],
    outline,
    footprint: { rects: [], area: 0 },
    spaceAt: () => -1,
    insideOutline: () => false
  };
  if (!solidRects.length) return empty;

  // Room and Outline regions use their own junction extents, so their edges join the grid lines too.
  const regionRects = [...Object.values(rooms).flatMap((r) => r.rects), ...outlineInside];
  const g = new Grid(solidRects, {
    xs: regionRects.flatMap((r) => [r.x0, r.x1]),
    ys: regionRects.flatMap((r) => [r.y0, r.y1])
  });
  const solid = g.mask(solidRects);
  const outside = g.flood(g.border(), (c) => !solid[c]);
  const inOutline = g.mask(outlineInside);

  const count = new Uint8Array(g.size);
  for (const id in rooms)
    for (const r of rooms[id]!.rects) g.forRect(r, (c) => (count[c] = Math.min(255, count[c]! + 1)));

  // Overlap: two Rooms on the same floor, or a Room crossing the Outline.
  const red = new Uint8Array(g.size);
  for (let c = 0; c < g.size; c++) if (count[c]! >= 2) red[c] = 1;
  const crossing: RoomId[] = [];
  const parked: RoomId[] = [];
  if (outline)
    for (const id in rooms) {
      let touches = false;
      let leaves = false;
      for (const r of rooms[id]!.rects)
        g.forRect(r, (c) => {
          if (inOutline[c]) touches = true;
          else leaves = true;
        });
      if (!touches) parked.push(id);
      else if (leaves) {
        crossing.push(id);
        for (const r of rooms[id]!.rects) g.forRect(r, (c) => !inOutline[c] && (red[c] = 1));
      }
    }

  // Unlabelled Space: enclosed floor that no Room claims.
  const free = new Uint8Array(g.size);
  for (let c = 0; c < g.size; c++) if (!solid[c] && !outside[c] && count[c] === 0) free[c] = 1;
  const thin = thinCells(g, free);
  const comp = new Int32Array(g.size).fill(-1);
  const comps: number[][] = [];
  for (let c = 0; c < g.size; c++) {
    if (!free[c] || comp[c]! >= 0) continue;
    const id = comps.length;
    const cls = thin[c];
    const seen = g.flood([c], (n) => free[n] === 1 && thin[n] === cls && comp[n]! < 0);
    const cells: number[] = [];
    for (let n = 0; n < g.size; n++)
      if (seen[n]) {
        comp[n] = id;
        cells.push(n);
      }
    comps.push(cells);
  }
  const unlabelled: Space[] = [];
  const spaceOfComp = new Int32Array(comps.length).fill(-1);
  const sliverCells = new Uint8Array(g.size);
  comps.forEach((cells, id) => {
    const area = cells.reduce((s, c) => s + g.cellArea(c), 0);
    if (thin[cells[0]!] || area < SLIVER_AREA) {
      for (const c of cells) sliverCells[c] = 1;
      return;
    }
    const set = new Set(cells);
    const rects = g.rects((c) => set.has(c));
    spaceOfComp[id] = unlabelled.length;
    unlabelled.push({ rects, area, label: labelPoint(rects)! });
  });

  const inFootprint = outline ? g.mask([...outlineInside, ...exterior]) : outside.map((o) => (o ? 0 : 1));
  const footprintRects = g.rects((c) => inFootprint[c] === 1);
  return {
    ...empty,
    unlabelled,
    slivers: g.rects((c) => sliverCells[c] === 1),
    overlaps: g.rects((c) => red[c] === 1),
    crossing,
    parked,
    footprint: { rects: footprintRects, area: rectsArea(footprintRects) },
    spaceAt: (x, y) => {
      const c = g.cellAt(x, y);
      return c < 0 || comp[c]! < 0 ? -1 : spaceOfComp[comp[c]!]!;
    },
    insideOutline: (x, y) => {
      const c = g.cellAt(x, y);
      return c >= 0 && inOutline[c] === 1;
    }
  };
}

/** Cells in a strip of free floor narrower than SLIVER, across either axis. */
function thinCells(g: Grid, free: Uint8Array): Uint8Array {
  const rowLen = new Float64Array(g.size);
  const colLen = new Float64Array(g.size);
  for (let j = 0; j < g.ny; j++) {
    let i = 0;
    while (i < g.nx) {
      if (!free[g.cell(i, j)]) {
        i++;
        continue;
      }
      let k = i;
      while (k + 1 < g.nx && free[g.cell(k + 1, j)]) k++;
      for (let q = i; q <= k; q++) rowLen[g.cell(q, j)] = g.xs[k + 1]! - g.xs[i]!;
      i = k + 1;
    }
  }
  for (let i = 0; i < g.nx; i++) {
    let j = 0;
    while (j < g.ny) {
      if (!free[g.cell(i, j)]) {
        j++;
        continue;
      }
      let k = j;
      while (k + 1 < g.ny && free[g.cell(i, k + 1)]) k++;
      for (let q = j; q <= k; q++) colLen[g.cell(i, q)] = g.ys[k + 1]! - g.ys[j]!;
      j = k + 1;
    }
  }
  const thin = new Uint8Array(g.size);
  for (let c = 0; c < g.size; c++) if (free[c] && Math.min(rowLen[c]!, colLen[c]!) < SLIVER) thin[c] = 1;
  return thin;
}
