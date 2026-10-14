// The framework-free core (ADR 0008): the Wall graph, derivation, commands, snapping and undo/redo.
export * from './commands';
export { derive, SLIVER, type Derived, type RoomGeom, type Space, type WallGeom } from './derive';
export { type Rect, rectsArea } from './grid';
export { runOf, usableSpan } from './graph';
export { normalizePlan } from './normalize';
export * from './history';
export { checkPlan } from './invariants';
export * from './plan';
export { ROOM_TYPES, guessRoomType } from './roomType';
export * from './snap';
export * from './units';
