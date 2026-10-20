import type { Axis, OpeningId, OpeningKind, RoomId, RoomType, Side, WallId } from '../plan';
import type { Mm } from '../units';

// A Scenario is an ordered list of Changes to the Existing Plan (ADR 0001), replayed through the core
// commands every time it is read (ADR 0010). Its plan is derived, never stored.

export type ChangeId = string;

/**
 * A Room or Opening a Change points at: an Existing Plan id (those never change), or the one an earlier
 * Change in the same Scenario created. Ids minted during a replay depend on the Existing Plan's counter,
 * so they are never stored.
 */
export type Target = string | { created: ChangeId };

/**
 * A Wall a Change points at, by where it was when the Change was recorded: a stretch of one centreline,
 * and the Rooms on its faces. Wall ids are not stable across Existing Plan edits (ADR 0009), so a Change
 * never stores one.
 */
export interface WallRef {
  axis: Axis;
  /** Centreline coordinate across the Wall. */
  c: Mm;
  /** Centreline span along the Wall. */
  t0: Mm;
  t1: Mm;
  neg: Target | null;
  pos: Target | null;
}

export interface OpeningPatch {
  kind?: OpeningKind;
  at?: Mm;
  width?: Mm;
  swing?: Side;
  hinge?: 'start' | 'end';
}

/** One gesture in Scenario Mode, as the UI makes it: ids are those of the Scenario's current plan. */
export type Gesture =
  | { op: 'demolishWall'; wall: WallId }
  | { op: 'drawWall'; a: Point; b: Point; thickness?: Mm }
  | { op: 'pushWall'; wall: WallId; delta: Mm; outline?: boolean }
  | { op: 'setThickness'; wall: WallId; thickness: Mm }
  | { op: 'addOpening'; wall: WallId; kind: OpeningKind; center: Mm }
  | { op: 'removeOpening'; opening: OpeningId }
  | { op: 'modifyOpening'; opening: OpeningId; patch: OpeningPatch }
  | { op: 'nameSpace'; x: Mm; y: Mm; name: string }
  /** A Room on a rectangle of Wall centrelines (drawRoom). */
  | { op: 'drawRoom'; rect: Box; name: string; thickness?: Mm }
  | { op: 'renameRoom'; room: RoomId; name: string }
  | { op: 'setRoomType'; room: RoomId; type: RoomType }
  /** Turns a Room back into Unlabelled Space; its Walls stay (unnameRoom). */
  | { op: 'removeRoom'; room: RoomId };

export interface Point {
  x: Mm;
  y: Mm;
}

export interface Box {
  x0: Mm;
  y0: Mm;
  x1: Mm;
  y1: Mm;
}

/** A gesture as stored: its targets are WallRefs and Targets, so it survives Existing Plan edits. */
export type Change = { id: ChangeId } & (
  | {
      op: 'demolishWall';
      wall: WallRef;
      /** The Room that survives if the Rooms merge. */
      keep: Target | null;
    }
  | { op: 'drawWall'; a: Point; b: Point; thickness: Mm }
  | { op: 'pushWall'; wall: WallRef; delta: Mm; outline: boolean }
  | { op: 'setThickness'; wall: WallRef; thickness: Mm }
  | { op: 'addOpening'; wall: WallRef; kind: OpeningKind; center: Mm }
  | { op: 'removeOpening'; opening: Target }
  | { op: 'modifyOpening'; opening: Target; patch: OpeningPatch }
  | { op: 'nameSpace'; x: Mm; y: Mm; name: string }
  | { op: 'drawRoom'; rect: Box; name: string; thickness: Mm }
  | { op: 'renameRoom'; room: Target; name: string }
  | { op: 'setRoomType'; room: Target; type: RoomType }
  | { op: 'removeRoom'; room: Target }
);

export interface Scenario {
  id: string;
  name: string;
  changes: Change[];
  /** Change ids are minted from the Scenario, like plan ids from the plan. */
  nextId: number;
}

export const emptyScenario = (id: string, name: string): Scenario => ({ id, name, changes: [], nextId: 1 });

/** The three kinds of Change (CONTEXT.md). */
export type ChangeKind = 'demolished' | 'new' | 'modified';

export function changeKind(c: Pick<Change, 'op'>): ChangeKind {
  switch (c.op) {
    case 'demolishWall':
    case 'removeOpening':
    case 'removeRoom':
      return 'demolished';
    case 'drawWall':
    case 'addOpening':
    case 'nameSpace':
    case 'drawRoom':
      return 'new';
    case 'pushWall':
    case 'setThickness':
    case 'modifyOpening':
    case 'renameRoom':
    case 'setRoomType':
      return 'modified';
  }
}

/**
 * A Change that no longer applies because the Existing Plan was edited underneath it (ADR 0005):
 * - vanished: its target is gone;
 * - ambiguous: its Wall moved, and more than one Wall could be where it went;
 * - rejected: its target is there, but the command no longer makes, demolishes or moves anything (or would
 *   break the plan). A Change that sets a value the Existing Plan already has is satisfied, not a Conflict.
 */
export interface Conflict {
  change: ChangeId;
  reason: 'vanished' | 'ambiguous' | 'rejected';
}
