import {
  type Box,
  type Mm,
  type OpeningId,
  type OpeningKind,
  type OpeningPatch,
  type Plan,
  type Point,
  type RoomId,
  type RoomType,
  type WallId,
  addOpening,
  deleteOpening,
  derive,
  mergeRooms,
  moveOpening,
  nameSpace,
  point,
  pushWall,
  renameRoom,
  roomAtPoint,
  setRoomType,
  setWallThickness,
  updateOpening,
  wallAtPoint
} from '@/core';
import { type EditorStore, type Selection, currentPlan } from './store';

// The edits both Modes share (CONTEXT.md: same gestures in both). In the Existing Plan each one runs its
// command and commits the plan; in a Scenario it is recorded as a Change (ADR 0010). Either way the
// selection follows the element to wherever it ends up, since ids may change.

/** The name a drawn Room starts with, for the user to type over. */
export const NEW_ROOM = 'New room';

export interface Actions {
  pushWall(id: WallId, delta: Mm, at: Mm, outline?: boolean): void;
  setThickness(id: WallId, thickness: Mm): void;
  /** Removes a Wall: in the Existing Plan only between two Rooms (merging them); in a Scenario, any. */
  removeWall(id: WallId): void;
  drawWall(a: Point, b: Point): boolean;
  /** Draw Room: a New Room on a rectangle of Wall centrelines, selected so it can be named. */
  drawRoom(rect: Box): boolean;
  addOpening(wall: WallId, kind: OpeningKind, at: Mm): void;
  removeOpening(id: OpeningId): void;
  updateOpening(id: OpeningId, patch: OpeningPatch): void;
  nameSpace(x: Mm, y: Mm, name: string): void;
  renameRoom(id: RoomId, name: string): void;
  setRoomType(id: RoomId, type: RoomType): void;
}

export function actions(useEditor: EditorStore): Actions {
  const st = () => useEditor.getState();
  const scenario = () => st().mode.kind === 'scenario';
  const plan = () => currentPlan(st());
  /** The Wall now at a point, e.g. where a pushed Wall went. */
  const wallAt =
    (q: { x: Mm; y: Mm }, at: Mm) =>
    (p: Plan): Selection => {
      const id = wallAtPoint(p, q.x, q.y);
      return id ? { kind: 'wall', id, at } : null;
    };
  /** The Opening that appeared, comparing ids before and after. */
  const newOpening =
    (before: Plan) =>
    (p: Plan): Selection => {
      const id = Object.keys(p.openings).find((o) => !before.openings[o]);
      return id ? { kind: 'opening', id } : null;
    };
  const roomAt =
    (q: { x: Mm; y: Mm }) =>
    (p: Plan): Selection => {
      const id = roomAtPoint(p, q.x, q.y);
      return id ? { kind: 'room', id } : null;
    };
  /** The Opening now at a point, e.g. where a moved Opening went. */
  const openingAt =
    (q: { x: Mm; y: Mm }) =>
    (p: Plan): Selection => {
      for (const [id, o] of Object.entries(p.openings)) {
        const l = derive(p).walls[o.wall]?.line;
        if (!l) continue;
        const t = l.axis === 'h' ? q.x : q.y;
        const n = l.axis === 'h' ? q.y : q.x;
        if (t >= o.at && t <= o.at + o.width && n >= l.lo && n <= l.hi) return { kind: 'opening', id };
      }
      return null;
    };

  return {
    pushWall(id, delta, at, outline = false) {
      const p = plan();
      const line = derive(p).walls[id]!.line;
      const sel = wallAt(point(line.axis, at, line.c + delta), at);
      if (scenario()) st().record({ op: 'pushWall', wall: id, delta, outline }, sel);
      else {
        const next = pushWall(p, id, delta, { outline });
        st().commit(next, sel(next));
      }
    },
    setThickness(id, thickness) {
      const p = plan();
      const line = derive(p).walls[id]!.line;
      const at = (line.t0 + line.t1) / 2;
      const sel = wallAt(point(line.axis, at, line.c), at);
      if (scenario()) st().record({ op: 'setThickness', wall: id, thickness }, sel);
      else {
        const next = setWallThickness(p, id, thickness);
        st().commit(next, sel(next));
      }
    },
    removeWall(id) {
      const p = plan();
      const line = derive(p).walls[id]!.line;
      const mid = point(line.axis, (line.t0 + line.t1) / 2, line.c);
      if (scenario()) {
        st().record({ op: 'demolishWall', wall: id }, (q) => roomAt(mid)(q));
        return;
      }
      const m = mergeRooms(p, id);
      if (m.id) st().commit(m.plan, { kind: 'room', id: m.id });
    },
    drawWall(a, b) {
      if (!scenario()) return false;
      const along = a.x === b.x ? 'v' : 'h';
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return st().record({ op: 'drawWall', a, b }, (q) => {
        const id = wallAtPoint(q, mid.x, mid.y);
        return id ? { kind: 'wall', id, at: along === 'h' ? mid.x : mid.y } : null;
      });
    },
    drawRoom(rect) {
      if (!scenario()) return false;
      const mid = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
      return st().record({ op: 'drawRoom', rect, name: NEW_ROOM }, roomAt(mid));
    },
    addOpening(wall, kind, at) {
      const p = plan();
      if (scenario()) st().record({ op: 'addOpening', wall, kind, center: at }, newOpening(p));
      else {
        const r = addOpening(p, wall, kind, at);
        if (r.id) st().commit(r.plan, { kind: 'opening', id: r.id });
      }
    },
    removeOpening(id) {
      const p = plan();
      if (scenario()) st().record({ op: 'removeOpening', opening: id }, () => null);
      else st().commit(deleteOpening(p, id), null);
    },
    updateOpening(id, patch) {
      const p = plan();
      if (scenario()) {
        const o = p.openings[id]!;
        const l = derive(p).walls[o.wall]!.line;
        // A new width keeps the Opening centred; a new position moves its start.
        const t = patch.at !== undefined ? patch.at + (patch.width ?? o.width) / 2 : o.at + o.width / 2;
        st().record({ op: 'modifyOpening', opening: id, patch }, openingAt(point(l.axis, t, l.c)));
        return;
      }
      const { at, ...rest } = patch;
      let next = Object.keys(rest).length ? updateOpening(p, id, rest) : p;
      if (at !== undefined) next = moveOpening(next, id, at);
      st().commit(next);
    },
    nameSpace(x, y, name) {
      const p = plan();
      if (scenario()) st().record({ op: 'nameSpace', x, y, name }, roomAt({ x, y }));
      else {
        const r = nameSpace(p, x, y, name);
        if (r.id) st().commit(r.plan, { kind: 'room', id: r.id });
      }
    },
    renameRoom(id, name) {
      if (scenario()) st().record({ op: 'renameRoom', room: id, name });
      else st().commit(renameRoom(plan(), id, name));
    },
    setRoomType(id, type) {
      if (scenario()) st().record({ op: 'setRoomType', room: id, type });
      else st().commit(setRoomType(plan(), id, type));
    }
  };
}
