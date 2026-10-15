import type { Mm } from './units';

// The Existing Plan as a Wall graph (ADR 0004, ADR 0009). Geometry lives only in nodes and Walls;
// a Room is the region inside the loop of Wall faces that claim it.

export type NodeId = string;
export type WallId = string;
export type RoomId = string;
export type OpeningId = string;

/** 'h' runs along x (its faces are y-coordinates); 'v' runs along y (its faces are x-coordinates). */
export type Axis = 'h' | 'v';
/** A Wall's two faces: 'neg' is the left/top face, 'pos' the right/bottom face. */
export type Side = 'neg' | 'pos';

export type RoomType = 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'laundry' | 'hallway' | 'other';
export type OpeningKind = 'door' | 'window' | 'opening';

export interface PlanNode {
  x: Mm;
  y: Mm;
}

export interface Wall {
  /** Centreline from a to b; a is at the lower coordinate. */
  a: NodeId;
  b: NodeId;
  thickness: Mm;
  /** Part of the Outline. */
  exterior: boolean;
  /** Structural Mark. */
  structural: boolean;
  /** Drawn on its own with Draw Wall, so it stays even where it bounds no Room (ADR 0010). */
  drawn: boolean;
  /** The Room whose inside face is this Wall's left/top face, if any. */
  neg: RoomId | null;
  /** The Room whose inside face is this Wall's right/bottom face, if any. */
  pos: RoomId | null;
}

export interface Room {
  name: string;
  type: RoomType;
}

export interface Opening {
  wall: WallId;
  kind: OpeningKind;
  /** Start of the Opening: an absolute coordinate along the Wall's axis. */
  at: Mm;
  width: Mm;
  /** The face a door swings towards. */
  swing: Side;
  /** Which end of the Opening a door is hinged at, along the Wall's axis. */
  hinge: 'start' | 'end';
}

export interface WallDefaults {
  interior: Mm;
  exterior: Mm;
}

export interface Plan {
  nodes: Record<NodeId, PlanNode>;
  walls: Record<WallId, Wall>;
  rooms: Record<RoomId, Room>;
  openings: Record<OpeningId, Opening>;
  defaults: WallDefaults;
  /** Ids are minted from the plan so commands stay pure and deterministic. */
  nextId: number;
}

export const DEFAULT_WALLS: WallDefaults = { interior: 100, exterior: 200 };

export const emptyPlan = (defaults: WallDefaults = DEFAULT_WALLS): Plan => ({
  nodes: {},
  walls: {},
  rooms: {},
  openings: {},
  defaults: { ...defaults },
  nextId: 1
});

export function clonePlan(p: Plan): Plan {
  const nodes: Plan['nodes'] = {};
  for (const id in p.nodes) nodes[id] = { ...p.nodes[id]! };
  const walls: Plan['walls'] = {};
  for (const id in p.walls) walls[id] = { ...p.walls[id]! };
  const rooms: Plan['rooms'] = {};
  for (const id in p.rooms) rooms[id] = { ...p.rooms[id]! };
  const openings: Plan['openings'] = {};
  for (const id in p.openings) openings[id] = { ...p.openings[id]! };
  return { nodes, walls, rooms, openings, defaults: { ...p.defaults }, nextId: p.nextId };
}

export function mintId(p: Plan, prefix: 'n' | 'w' | 'r' | 'o'): string {
  return `${prefix}${p.nextId++}`;
}

// ---------- geometry of one Wall ----------

/** Faces sit at c − ⌊t/2⌋ and c + ⌈t/2⌉, so they are integers for any thickness. */
export const faceOffsets = (t: Mm): [Mm, Mm] => [Math.floor(t / 2), Math.ceil(t / 2)];

export interface Line {
  axis: Axis;
  /** Centreline coordinate across the Wall. */
  c: Mm;
  /** Centreline span along the Wall. */
  t0: Mm;
  t1: Mm;
  /** Faces across the Wall. */
  lo: Mm;
  hi: Mm;
}

/** Coordinate of a point along an axis. */
export const along = (axis: Axis, p: { x: number; y: number }): number => (axis === 'h' ? p.x : p.y);
/** Coordinate of a point across an axis. */
export const across = (axis: Axis, p: { x: number; y: number }): number => (axis === 'h' ? p.y : p.x);
export const point = (axis: Axis, t: number, c: number) => (axis === 'h' ? { x: t, y: c } : { x: c, y: t });
export const otherAxis = (axis: Axis): Axis => (axis === 'h' ? 'v' : 'h');
export const otherSide = (s: Side): Side => (s === 'neg' ? 'pos' : 'neg');

export function wallAxis(p: Plan, w: Wall): Axis {
  return p.nodes[w.a]!.y === p.nodes[w.b]!.y ? 'h' : 'v';
}

export function wallLine(p: Plan, w: Wall): Line {
  const a = p.nodes[w.a]!;
  const b = p.nodes[w.b]!;
  const axis: Axis = a.y === b.y ? 'h' : 'v';
  const c = across(axis, a);
  const [fl, ce] = faceOffsets(w.thickness);
  const ta = along(axis, a);
  const tb = along(axis, b);
  return { axis, c, t0: Math.min(ta, tb), t1: Math.max(ta, tb), lo: c - fl, hi: c + ce };
}

/** The coordinate of a Wall face. */
export const faceOf = (l: Line, s: Side): Mm => (s === 'neg' ? l.lo : l.hi);

/** The side of a Wall that a Room claims, if any. */
export function sideOf(w: Wall, room: RoomId): Side | null {
  return w.neg === room ? 'neg' : w.pos === room ? 'pos' : null;
}

export const claims = (w: Wall, room: RoomId): boolean => w.neg === room || w.pos === room;
