// A coordinate-compressed grid: every rectangle edge becomes a grid line, so each cell is either fully
// inside or fully outside every rectangle and all areas stay exact integers.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectArea = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
export const rectsArea = (rs: readonly Rect[]) => rs.reduce((s, r) => s + rectArea(r), 0);
export const rectContains = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;

export function intersects(a: Rect, b: Rect): boolean {
  return Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
}

export function bounds(rs: readonly Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}

const uniqSorted = (vs: number[]) => [...new Set(vs)].sort((a, b) => a - b);

function indexOf(vs: readonly number[], v: number): number {
  let lo = 0;
  let hi = vs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = vs[mid]!;
    if (m === v) return mid;
    if (m < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Index of the cell interval containing v (xs[i] <= v < xs[i+1]), or -1. */
function cellIndex(vs: readonly number[], v: number): number {
  if (v < vs[0]! || v >= vs[vs.length - 1]!) return -1;
  let lo = 0;
  let hi = vs.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (vs[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class Grid {
  readonly xs: number[];
  readonly ys: number[];
  readonly nx: number;
  readonly ny: number;

  /** A grid over the rectangles' edges, padded by one cell on every side so the border is outside. */
  constructor(rects: readonly Rect[], extra: { xs?: number[]; ys?: number[] } = {}) {
    const b = bounds(rects) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    this.xs = uniqSorted([b.x0 - 1, b.x1 + 1, ...rects.flatMap((r) => [r.x0, r.x1]), ...(extra.xs ?? [])]);
    this.ys = uniqSorted([b.y0 - 1, b.y1 + 1, ...rects.flatMap((r) => [r.y0, r.y1]), ...(extra.ys ?? [])]);
    this.nx = this.xs.length - 1;
    this.ny = this.ys.length - 1;
  }

  get size() {
    return this.nx * this.ny;
  }

  cell(i: number, j: number) {
    return j * this.nx + i;
  }

  cellRect(c: number): Rect {
    const i = c % this.nx;
    const j = (c - i) / this.nx;
    return { x0: this.xs[i]!, y0: this.ys[j]!, x1: this.xs[i + 1]!, y1: this.ys[j + 1]! };
  }

  cellArea(c: number) {
    return rectArea(this.cellRect(c));
  }

  cellAt(x: number, y: number): number {
    const i = cellIndex(this.xs, x);
    const j = cellIndex(this.ys, y);
    return i < 0 || j < 0 ? -1 : this.cell(i, j);
  }

  /** Index range [i0, i1) of the cells a rect covers. The rect's edges must be grid lines. */
  span(r: Rect): [number, number, number, number] | null {
    const i0 = indexOf(this.xs, r.x0);
    const i1 = indexOf(this.xs, r.x1);
    const j0 = indexOf(this.ys, r.y0);
    const j1 = indexOf(this.ys, r.y1);
    if (i0 < 0 || i1 < 0 || j0 < 0 || j1 < 0) throw new Error('rect edge is not a grid line');
    return i1 > i0 && j1 > j0 ? [i0, i1, j0, j1] : null;
  }

  /** Calls f for every cell the rect covers. */
  forRect(r: Rect, f: (c: number) => void) {
    const s = this.span(r);
    if (!s) return;
    for (let j = s[2]; j < s[3]; j++) for (let i = s[0]; i < s[1]; i++) f(this.cell(i, j));
  }

  mask(rects: readonly Rect[]): Uint8Array {
    const m = new Uint8Array(this.size);
    for (const r of rects) this.forRect(r, (c) => (m[c] = 1));
    return m;
  }

  /** The 4-neighbours of a cell. */
  neighbours(c: number, f: (n: number) => void) {
    const i = c % this.nx;
    const j = (c - i) / this.nx;
    if (i > 0) f(c - 1);
    if (i < this.nx - 1) f(c + 1);
    if (j > 0) f(c - this.nx);
    if (j < this.ny - 1) f(c + this.nx);
  }

  /** Flood fill from the seeds over cells where open(c); returns the visited mask. */
  flood(seeds: Iterable<number>, open: (c: number) => boolean): Uint8Array {
    const seen = new Uint8Array(this.size);
    const stack: number[] = [];
    for (const s of seeds)
      if (!seen[s] && open(s)) {
        seen[s] = 1;
        stack.push(s);
      }
    while (stack.length) {
      const c = stack.pop()!;
      this.neighbours(c, (n) => {
        if (!seen[n] && open(n)) {
          seen[n] = 1;
          stack.push(n);
        }
      });
    }
    return seen;
  }

  border(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nx; i++) out.push(this.cell(i, 0), this.cell(i, this.ny - 1));
    for (let j = 0; j < this.ny; j++) out.push(this.cell(0, j), this.cell(this.nx - 1, j));
    return out;
  }

  /** Cells not covered by solid and not reachable from outside the grid. */
  enclosed(solid: Uint8Array): Uint8Array {
    const outside = this.flood(this.border(), (c) => !solid[c]);
    const inner = new Uint8Array(this.size);
    for (let c = 0; c < this.size; c++) if (!solid[c] && !outside[c]) inner[c] = 1;
    return inner;
  }

  /** Merges the selected cells into rectangles: horizontal runs, stacked while they line up. */
  rects(sel: (c: number) => boolean): Rect[] {
    const out: Rect[] = [];
    const open = new Map<string, Rect & { j: number }>();
    for (let j = 0; j < this.ny; j++) {
      let i = 0;
      while (i < this.nx) {
        if (!sel(this.cell(i, j))) {
          i++;
          continue;
        }
        let k = i;
        while (k + 1 < this.nx && sel(this.cell(k + 1, j))) k++;
        const key = `${i},${k}`;
        const prev = open.get(key);
        if (prev && prev.j === j - 1) {
          prev.y1 = this.ys[j + 1]!;
          prev.j = j;
        } else {
          const r = { x0: this.xs[i]!, y0: this.ys[j]!, x1: this.xs[k + 1]!, y1: this.ys[j + 1]!, j };
          open.set(key, r);
          out.push(r);
        }
        i = k + 1;
      }
    }
    return out.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
  }
}

/** The region enclosed by a set of solid rectangles, as rectangles. */
export function enclosedRects(solid: readonly Rect[]): Rect[] {
  if (!solid.length) return [];
  const g = new Grid(solid);
  const inner = g.enclosed(g.mask(solid));
  return g.rects((c) => inner[c] === 1);
}

/** A good point for a label: the centre of the rect whose smaller side is largest. */
export function labelPoint(rs: readonly Rect[]): { x: number; y: number } | null {
  let best: Rect | null = null;
  const fat = (r: Rect) => Math.min(r.x1 - r.x0, r.y1 - r.y0);
  for (const r of rs) if (!best || fat(r) > fat(best)) best = r;
  return best ? { x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2 } : null;
}
