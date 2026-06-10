import { browser } from '$app/environment';
import { derived, writable } from 'svelte/store';
import type {
  Opening,
  PlanDocument,
  PlanRect,
  ProposedRoom,
  Room,
  RoomInventoryItem,
  RoomType,
  SetupRoomKind,
  Wall
} from '$lib/domain/types';

export const GRID_SIZE = 24;
export const METRES_PER_GRID = 0.25;

const STORAGE_KEY = 'renoplan.editor.v1';
const ENVELOPE_VERSION = 1;
const MIN_ROOM_SIZE = GRID_SIZE * 2;

export type ActiveMode = 'baseline' | 'scenario';

export interface PlanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LockedBaseline {
  id: string;
  name: 'Existing v1';
  version: 1;
  locked: true;
  createdAt: string;
  bounds: PlanBounds;
  plan: PlanDocument;
}

export interface EditorEnvelope {
  version: 1;
  baselinePlan: PlanDocument;
  lockedBaseline: LockedBaseline | null;
  scenarioPlan: PlanDocument | null;
  activeMode: ActiveMode;
}

export interface EditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyPlan: PlanDocument = {
  id: 'existing-v1-plan',
  rooms: [],
  proposedRooms: [],
  walls: [],
  openings: [],
  objects: []
};

export const roomSetupOptions: {
  kind: SetupRoomKind;
  label: string;
  type: RoomType;
  width: number;
  height: number;
}[] = [
  {
    kind: 'bedroom',
    label: 'Bedroom',
    type: 'bedroom',
    width: 144,
    height: 144
  },
  { kind: 'toilet', label: 'Toilet', type: 'wet', width: 72, height: 96 },
  { kind: 'bathroom', label: 'Bathroom', type: 'wet', width: 120, height: 96 },
  {
    kind: 'kitchen',
    label: 'Kitchen',
    type: 'kitchen',
    width: 168,
    height: 144
  },
  {
    kind: 'living',
    label: 'Living room',
    type: 'living',
    width: 240,
    height: 168
  },
  {
    kind: 'dining',
    label: 'Dining room',
    type: 'living',
    width: 168,
    height: 144
  },
  {
    kind: 'laundry',
    label: 'Laundry',
    type: 'utility',
    width: 120,
    height: 96
  },
  { kind: 'storage', label: 'Storage', type: 'utility', width: 96, height: 96 },
  { kind: 'garage', label: 'Garage', type: 'generic', width: 240, height: 240 },
  {
    kind: 'other',
    label: 'Other room',
    type: 'generic',
    width: 144,
    height: 120
  }
];

export type SetupStep = 'counts' | 'measurements' | 'editor';

export interface EditorState extends EditorEnvelope {
  plan: PlanDocument;
  setupStep: SetupStep;
  inventory: RoomInventoryItem[];
  selectedRoomId: string | null;
  selectedProposedRoomId: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
  saveState: 'saved' | 'saving' | 'offline';
  baselinePast: PlanDocument[];
  baselineFuture: PlanDocument[];
  scenarioPast: PlanDocument[];
  scenarioFuture: PlanDocument[];
  past: PlanDocument[];
  future: PlanDocument[];
}

export interface CreateEditorStoreOptions {
  storage?: EditorStorage | null;
  now?: () => string;
  createId?: (prefix: string) => string;
}

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const clonePlan = (plan: PlanDocument): PlanDocument => ({
  ...plan,
  rooms: plan.rooms.map((room) => ({ ...room })),
  proposedRooms: (plan.proposedRooms ?? []).map((room) => ({ ...room })),
  walls: plan.walls.map((wall) => ({ ...wall, roomIds: [...wall.roomIds] })),
  openings: plan.openings.map((opening) => ({ ...opening })),
  objects: plan.objects.map((object) => ({ ...object }))
});

const wallId = (
  firstRoomId: string,
  secondRoomId: string,
  orientation: 'horizontal' | 'vertical'
) => `wall-${[firstRoomId, secondRoomId].sort().join('-')}-${orientation}`;

const exteriorWallId = (
  roomId: string,
  side: 'north' | 'east' | 'south' | 'west',
  start: number,
  end: number
) => `wall-${roomId}-${side}-${Math.round(start)}-${Math.round(end)}`;

const wallLength = (wall: Wall) =>
  Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);

const clampOpeningOffset = (
  wall: Wall,
  opening: Pick<Opening, 'offset' | 'width'>
) =>
  Math.min(
    Math.max(0, opening.offset),
    Math.max(0, wallLength(wall) - opening.width)
  );

const overlap = (
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
) => {
  const start = Math.max(firstStart, secondStart);
  const end = Math.min(firstEnd, secondEnd);
  return end > start ? { start, end } : null;
};

const same = (first: number, second: number) =>
  Math.abs(first - second) < 0.001;

export const snapValue = (value: number, enabled = true) =>
  enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;

export const pixelsToMetres = (value: number) =>
  (value / GRID_SIZE) * METRES_PER_GRID;

export const metresToPixels = (value: number) =>
  Math.max(MIN_ROOM_SIZE, Math.round(value / METRES_PER_GRID) * GRID_SIZE);

const setupOptionFor = (kind: SetupRoomKind) =>
  roomSetupOptions.find((option) => option.kind === kind) ??
  roomSetupOptions[0];

function roomLabel(kind: SetupRoomKind, index: number, count: number) {
  const option = setupOptionFor(kind);
  return count > 1 ? `${option.label} ${index + 1}` : option.label;
}

function inventoryFromCounts(counts: Record<SetupRoomKind, number>) {
  return roomSetupOptions.flatMap((option) => {
    const count = Math.max(0, Math.floor(counts[option.kind] ?? 0));

    return Array.from({ length: count }, (_, index) => ({
      id: `${option.kind}-${index + 1}`,
      kind: option.kind,
      label: roomLabel(option.kind, index, count),
      type: option.type,
      width: option.width,
      height: option.height,
      measured: false
    }));
  });
}

function planFromInventory(inventory: RoomInventoryItem[]): PlanDocument {
  const margin = GRID_SIZE * 2;
  const gap = GRID_SIZE;
  const maxWidth = 840;

  let x = margin;
  let y = margin;
  let rowHeight = 0;

  const rooms = inventory.map((item) => {
    if (x + item.width > maxWidth) {
      x = margin;
      y += rowHeight + gap;
      rowHeight = 0;
    }

    const room: Room = {
      id: item.id,
      name: item.label,
      type: item.type,
      x,
      y,
      width: item.width,
      height: item.height
    };

    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);

    return room;
  });

  return normalisePlan({
    ...emptyPlan,
    rooms
  });
}

function proposedRoomLabel(plan: PlanDocument, kind: SetupRoomKind) {
  const option = setupOptionFor(kind);
  const count =
    plan.proposedRooms.filter((room) => room.type === option.type).length + 1;
  return `${option.label} ${count}`;
}

export function derivePlanBounds(plan: PlanDocument): PlanBounds | null {
  if (plan.rooms.length === 0) return null;

  const left = Math.min(...plan.rooms.map((room) => room.x));
  const top = Math.min(...plan.rooms.map((room) => room.y));
  const right = Math.max(...plan.rooms.map((room) => room.x + room.width));
  const bottom = Math.max(...plan.rooms.map((room) => room.y + room.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function deriveSharedWalls(plan: PlanDocument): Wall[] {
  const previousWalls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const walls: Wall[] = [];

  for (let firstIndex = 0; firstIndex < plan.rooms.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < plan.rooms.length;
      secondIndex += 1
    ) {
      const first = plan.rooms[firstIndex];
      const second = plan.rooms[secondIndex];
      const firstRight = first.x + first.width;
      const secondRight = second.x + second.width;
      const firstBottom = first.y + first.height;
      const secondBottom = second.y + second.height;

      if (same(firstRight, second.x) || same(secondRight, first.x)) {
        const yOverlap = overlap(first.y, firstBottom, second.y, secondBottom);
        if (yOverlap) {
          const x = same(firstRight, second.x) ? firstRight : secondRight;
          const id = wallId(first.id, second.id, 'vertical');
          const previous = previousWalls.get(id);
          walls.push({
            id,
            kind: 'shared',
            roomIds: [first.id, second.id],
            x1: x,
            y1: yOverlap.start,
            x2: x,
            y2: yOverlap.end,
            structural: previous?.structural ?? false,
            removed: previous?.removed ?? false
          });
        }
      }

      if (same(firstBottom, second.y) || same(secondBottom, first.y)) {
        const xOverlap = overlap(first.x, firstRight, second.x, secondRight);
        if (xOverlap) {
          const y = same(firstBottom, second.y) ? firstBottom : secondBottom;
          const id = wallId(first.id, second.id, 'horizontal');
          const previous = previousWalls.get(id);
          walls.push({
            id,
            kind: 'shared',
            roomIds: [first.id, second.id],
            x1: xOverlap.start,
            y1: y,
            x2: xOverlap.end,
            y2: y,
            structural: previous?.structural ?? false,
            removed: previous?.removed ?? false
          });
        }
      }
    }
  }

  return walls;
}

function subtractSegments(
  segment: { start: number; end: number },
  cuts: { start: number; end: number }[]
) {
  return cuts.reduce(
    (segments, cut) =>
      segments.flatMap((candidate) => {
        const start = Math.max(candidate.start, cut.start);
        const end = Math.min(candidate.end, cut.end);

        if (end <= start) return [candidate];

        return [
          { start: candidate.start, end: start },
          { start: end, end: candidate.end }
        ].filter((next) => next.end > next.start);
      }),
    [segment]
  );
}

export function deriveWalls(plan: PlanDocument): Wall[] {
  const previousWalls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const sharedWalls = deriveSharedWalls(plan);
  const exteriorWalls: Wall[] = [];

  for (const room of plan.rooms) {
    const right = room.x + room.width;
    const bottom = room.y + room.height;
    const sides = [
      {
        side: 'north' as const,
        orientation: 'horizontal' as const,
        line: room.y,
        start: room.x,
        end: right,
        makeWall: (start: number, end: number) => ({
          x1: start,
          y1: room.y,
          x2: end,
          y2: room.y
        })
      },
      {
        side: 'south' as const,
        orientation: 'horizontal' as const,
        line: bottom,
        start: room.x,
        end: right,
        makeWall: (start: number, end: number) => ({
          x1: start,
          y1: bottom,
          x2: end,
          y2: bottom
        })
      },
      {
        side: 'west' as const,
        orientation: 'vertical' as const,
        line: room.x,
        start: room.y,
        end: bottom,
        makeWall: (start: number, end: number) => ({
          x1: room.x,
          y1: start,
          x2: room.x,
          y2: end
        })
      },
      {
        side: 'east' as const,
        orientation: 'vertical' as const,
        line: right,
        start: room.y,
        end: bottom,
        makeWall: (start: number, end: number) => ({
          x1: right,
          y1: start,
          x2: right,
          y2: end
        })
      }
    ];

    for (const side of sides) {
      const cuts = sharedWalls
        .filter((wall) => {
          if (!wall.roomIds.includes(room.id)) return false;

          if (side.orientation === 'horizontal') {
            return same(wall.y1, side.line) && same(wall.y2, side.line);
          }

          return same(wall.x1, side.line) && same(wall.x2, side.line);
        })
        .map((wall) =>
          side.orientation === 'horizontal'
            ? {
                start: Math.min(wall.x1, wall.x2),
                end: Math.max(wall.x1, wall.x2)
              }
            : {
                start: Math.min(wall.y1, wall.y2),
                end: Math.max(wall.y1, wall.y2)
              }
        );

      for (const segment of subtractSegments(
        { start: side.start, end: side.end },
        cuts
      )) {
        const id = exteriorWallId(
          room.id,
          side.side,
          segment.start,
          segment.end
        );
        const previous = previousWalls.get(id);
        exteriorWalls.push({
          id,
          kind: 'exterior',
          roomIds: [room.id],
          ...side.makeWall(segment.start, segment.end),
          structural: previous?.structural ?? false,
          removed: previous?.removed ?? false
        });
      }
    }
  }

  return [...sharedWalls, ...exteriorWalls];
}

function normalisePlan(plan: PlanDocument): PlanDocument {
  const walls = deriveWalls(plan);
  const wallIds = new Set(walls.map((wall) => wall.id));
  const openings = plan.openings.filter((opening) =>
    wallIds.has(opening.wallId)
  );

  return {
    ...clonePlan(plan),
    walls,
    openings
  };
}

function normaliseEnvelope(envelope: EditorEnvelope): EditorEnvelope {
  const baselinePlan = normalisePlan(envelope.baselinePlan);
  const scenarioPlan = envelope.scenarioPlan
    ? normalisePlan(envelope.scenarioPlan)
    : null;
  const lockedBaseline = envelope.lockedBaseline
    ? {
        ...envelope.lockedBaseline,
        bounds:
          derivePlanBounds(envelope.lockedBaseline.plan) ??
          envelope.lockedBaseline.bounds,
        plan: normalisePlan(envelope.lockedBaseline.plan)
      }
    : null;

  return {
    version: ENVELOPE_VERSION,
    baselinePlan,
    lockedBaseline,
    scenarioPlan,
    activeMode:
      envelope.activeMode === 'scenario' && scenarioPlan
        ? 'scenario'
        : 'baseline'
  };
}

function isPlanDocument(value: unknown): value is PlanDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PlanDocument).rooms) &&
    Array.isArray((value as PlanDocument).walls) &&
    Array.isArray((value as PlanDocument).openings) &&
    Array.isArray((value as PlanDocument).objects)
  );
}

function ensurePlanDocument(value: PlanDocument): PlanDocument {
  return {
    ...value,
    proposedRooms: value.proposedRooms ?? []
  };
}

function isEditorEnvelope(value: unknown): value is EditorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EditorEnvelope).version === ENVELOPE_VERSION &&
    isPlanDocument((value as EditorEnvelope).baselinePlan)
  );
}

export function createEnvelopeFromPlan(plan: PlanDocument): EditorEnvelope {
  return {
    version: ENVELOPE_VERSION,
    baselinePlan: normalisePlan(ensurePlanDocument(plan)),
    lockedBaseline: null,
    scenarioPlan: null,
    activeMode: 'baseline'
  };
}

export function parseEditorEnvelope(raw: string | null): EditorEnvelope {
  if (!raw) return createEnvelopeFromPlan(emptyPlan);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isEditorEnvelope(parsed)) return normaliseEnvelope(parsed);
    if (isPlanDocument(parsed)) return createEnvelopeFromPlan(parsed);
  } catch {
    return createEnvelopeFromPlan(emptyPlan);
  }

  return createEnvelopeFromPlan(emptyPlan);
}

function getDefaultStorage(): EditorStorage | null {
  if (!browser) return null;
  return localStorage;
}

function loadEnvelope(storage: EditorStorage | null) {
  if (!storage) return createEnvelopeFromPlan(emptyPlan);
  return parseEditorEnvelope(storage.getItem(STORAGE_KEY));
}

function persistEnvelope(
  storage: EditorStorage | null,
  envelope: EditorEnvelope
) {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(normaliseEnvelope(envelope)));
}

function activePlan(state: EditorEnvelope) {
  return state.activeMode === 'scenario' && state.scenarioPlan
    ? state.scenarioPlan
    : state.baselinePlan;
}

function activePast(state: EditorState) {
  return state.activeMode === 'scenario'
    ? state.scenarioPast
    : state.baselinePast;
}

function activeFuture(state: EditorState) {
  return state.activeMode === 'scenario'
    ? state.scenarioFuture
    : state.baselineFuture;
}

function withComputedState(
  state: Omit<EditorState, 'plan' | 'past' | 'future'>
) {
  return {
    ...state,
    plan: activePlan(state),
    past: activePast(state as EditorState),
    future: activeFuture(state as EditorState)
  };
}

function envelopeFromState(state: EditorState): EditorEnvelope {
  return {
    version: ENVELOPE_VERSION,
    baselinePlan: state.baselinePlan,
    lockedBaseline: state.lockedBaseline,
    scenarioPlan: state.scenarioPlan,
    activeMode: state.activeMode
  };
}

function constrainRect(rect: PlanRect): PlanRect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_ROOM_SIZE, rect.width),
    height: Math.max(MIN_ROOM_SIZE, rect.height)
  };
}

function clampRectToBounds(rect: PlanRect, bounds: PlanBounds | null) {
  if (!bounds) return rect;

  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;

  return {
    x: Math.min(Math.max(rect.x, bounds.x), maxX),
    y: Math.min(Math.max(rect.y, bounds.y), maxY),
    width,
    height
  };
}

function resizeRect(
  room: PlanRect,
  handle: ResizeHandle,
  x: number,
  y: number
): PlanRect {
  const right = room.x + room.width;
  const bottom = room.y + room.height;

  if (handle === 'e') {
    return constrainRect({ ...room, width: x - room.x });
  }

  if (handle === 's') {
    return constrainRect({ ...room, height: y - room.y });
  }

  if (handle === 'se') {
    return constrainRect({ ...room, width: x - room.x, height: y - room.y });
  }

  if (handle === 'w') {
    const width = right - x;
    return width < MIN_ROOM_SIZE
      ? { ...room, width: MIN_ROOM_SIZE }
      : { ...room, x, width };
  }

  if (handle === 'n') {
    const height = bottom - y;
    return height < MIN_ROOM_SIZE
      ? { ...room, height: MIN_ROOM_SIZE }
      : { ...room, y, height };
  }

  if (handle === 'nw') {
    const width = right - x;
    const height = bottom - y;
    return {
      x: width < MIN_ROOM_SIZE ? right - MIN_ROOM_SIZE : x,
      y: height < MIN_ROOM_SIZE ? bottom - MIN_ROOM_SIZE : y,
      width: Math.max(MIN_ROOM_SIZE, width),
      height: Math.max(MIN_ROOM_SIZE, height)
    };
  }

  if (handle === 'ne') {
    const height = bottom - y;
    return {
      x: room.x,
      y: height < MIN_ROOM_SIZE ? bottom - MIN_ROOM_SIZE : y,
      width: Math.max(MIN_ROOM_SIZE, x - room.x),
      height: Math.max(MIN_ROOM_SIZE, height)
    };
  }

  const width = right - x;
  return {
    x: width < MIN_ROOM_SIZE ? right - MIN_ROOM_SIZE : x,
    y: room.y,
    width: Math.max(MIN_ROOM_SIZE, width),
    height: Math.max(MIN_ROOM_SIZE, y - room.y)
  };
}

function canEditGeometry(state: EditorState) {
  return state.activeMode === 'scenario' || !state.lockedBaseline;
}

function canEditWalls(state: EditorState) {
  return state.activeMode === 'scenario' || !state.lockedBaseline;
}

export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

export function createEditorStore(options: CreateEditorStoreOptions = {}) {
  const storage = options.storage ?? getDefaultStorage();
  const now = options.now ?? (() => new Date().toISOString());
  const makeId = options.createId ?? createRuntimeId;
  const startingEnvelope = loadEnvelope(storage);
  const store = writable<EditorState>(
    withComputedState({
      ...startingEnvelope,
      setupStep:
        startingEnvelope.baselinePlan.rooms.length > 0 ? 'editor' : 'counts',
      inventory: [],
      selectedRoomId: null,
      selectedProposedRoomId: null,
      selectedWallId: null,
      snapToGrid: true,
      saveState: 'saved',
      baselinePast: [],
      baselineFuture: [],
      scenarioPast: [],
      scenarioFuture: []
    })
  );

  function saveState(state: EditorState) {
    persistEnvelope(storage, envelopeFromState(state));
  }

  function updateState(updater: (state: EditorState) => EditorState) {
    store.update((state) => withComputedState(updater(state)));
  }

  function mutatePlan(
    updater: (plan: PlanDocument, state: EditorState) => PlanDocument,
    options: {
      history?: boolean;
      selectedRoomId?: string | null;
      selectedProposedRoomId?: string | null;
      selectedWallId?: string | null;
    } = {}
  ) {
    updateState((state) => {
      const previousPlan = activePlan(state);
      const nextPlan = normalisePlan(updater(clonePlan(previousPlan), state));
      const nextState = { ...state, saveState: 'saving' as const };

      if (state.activeMode === 'scenario') {
        nextState.scenarioPlan = nextPlan;
        nextState.scenarioPast = options.history
          ? [...state.scenarioPast, clonePlan(previousPlan)].slice(-50)
          : state.scenarioPast;
        nextState.scenarioFuture = options.history ? [] : state.scenarioFuture;
      } else {
        nextState.baselinePlan = nextPlan;
        nextState.baselinePast = options.history
          ? [...state.baselinePast, clonePlan(previousPlan)].slice(-50)
          : state.baselinePast;
        nextState.baselineFuture = options.history ? [] : state.baselineFuture;
      }

      nextState.selectedRoomId = options.selectedRoomId ?? state.selectedRoomId;
      nextState.selectedProposedRoomId =
        options.selectedProposedRoomId ?? state.selectedProposedRoomId;
      nextState.selectedWallId = options.selectedWallId ?? state.selectedWallId;
      saveState(nextState);

      return nextState;
    });
  }

  return {
    subscribe: store.subscribe,
    createInventory(counts: Record<SetupRoomKind, number>) {
      updateState((state) => {
        if (state.lockedBaseline) return state;
        const inventory = inventoryFromCounts(counts);

        return {
          ...state,
          inventory,
          setupStep: inventory.length > 0 ? 'measurements' : 'counts',
          saveState: 'saved'
        };
      });
    },
    returnToCounts() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          setupStep: 'counts',
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
      });
    },
    updateInventoryRoom(
      roomId: string,
      patch: Pick<
        Partial<RoomInventoryItem>,
        'label' | 'width' | 'height' | 'measured'
      >
    ) {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          inventory: state.inventory.map((item) =>
            item.id === roomId ? { ...item, ...patch } : item
          )
        };
      });
    },
    startEditorFromInventory() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        const plan = planFromInventory(state.inventory);
        const nextState = {
          ...state,
          baselinePlan: plan,
          activeMode: 'baseline' as const,
          setupStep: 'editor' as const,
          selectedRoomId: plan.rooms[0]?.id ?? null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    returnToSetup() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          setupStep: state.inventory.length > 0 ? 'measurements' : 'counts',
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
      });
    },
    lockBaseline() {
      updateState((state) => {
        if (
          state.activeMode !== 'baseline' ||
          state.baselinePlan.rooms.length === 0
        ) {
          return state;
        }

        const plan = normalisePlan(state.baselinePlan);
        const bounds = derivePlanBounds(plan);
        if (!bounds) return state;

        const nextState = {
          ...state,
          baselinePlan: plan,
          lockedBaseline: {
            id: makeId('baseline'),
            name: 'Existing v1' as const,
            version: 1 as const,
            locked: true as const,
            createdAt: now(),
            bounds,
            plan: clonePlan(plan)
          },
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    unlockBaseline() {
      updateState((state) => {
        if (!state.lockedBaseline || state.scenarioPlan) return state;

        const plan = clonePlan(state.lockedBaseline.plan);
        const nextState = {
          ...state,
          baselinePlan: plan,
          lockedBaseline: null,
          activeMode: 'baseline' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    createRenovationPlan() {
      updateState((state) => {
        if (!state.lockedBaseline || state.scenarioPlan) return state;

        const plan = {
          ...clonePlan(state.lockedBaseline.plan),
          id: 'renovation-plan'
        };
        const nextState = {
          ...state,
          scenarioPlan: normalisePlan(plan),
          activeMode: 'scenario' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          scenarioPast: [],
          scenarioFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    switchMode(mode: ActiveMode) {
      updateState((state) => {
        if (mode === 'scenario' && !state.scenarioPlan) return state;

        const nextState = {
          ...state,
          activeMode: mode,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
        saveState(nextState);
        return nextState;
      });
    },
    moveRoom(
      roomId: string,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditGeometry(state)) return plan;
          const bounds =
            state.activeMode === 'scenario'
              ? (state.lockedBaseline?.bounds ?? null)
              : null;

          return {
            ...plan,
            rooms: plan.rooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    ...clampRectToBounds(
                      {
                        ...room,
                        x: snapValue(x, state.snapToGrid),
                        y: snapValue(y, state.snapToGrid)
                      },
                      bounds
                    )
                  }
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: roomId,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    resizeRoom(
      roomId: string,
      handle: ResizeHandle,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditGeometry(state)) return plan;
          const bounds =
            state.activeMode === 'scenario'
              ? (state.lockedBaseline?.bounds ?? null)
              : null;

          return {
            ...plan,
            rooms: plan.rooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    ...clampRectToBounds(
                      resizeRect(
                        room,
                        handle,
                        snapValue(x, state.snapToGrid),
                        snapValue(y, state.snapToGrid)
                      ),
                      bounds
                    )
                  }
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: roomId,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    updateWall(
      wallId: string,
      patch: Pick<Partial<Wall>, 'structural' | 'removed'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;

          return {
            ...plan,
            walls: plan.walls.map((wall) =>
              wall.id === wallId ? { ...wall, ...patch } : wall
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: wallId
        }
      );
    },
    addProposedRoom(kind: SetupRoomKind) {
      const roomId = makeId('proposed-room');
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds;
          if (!bounds) return plan;

          const option = setupOptionFor(kind);
          const width = Math.min(option.width, bounds.width);
          const height = Math.min(option.height, bounds.height);
          const proposedRoom: ProposedRoom = {
            id: roomId,
            name: proposedRoomLabel(plan, kind),
            type: option.type,
            ...clampRectToBounds(
              {
                x: snapValue(bounds.x + (bounds.width - width) / 2),
                y: snapValue(bounds.y + (bounds.height - height) / 2),
                width,
                height
              },
              bounds
            )
          };

          return {
            ...plan,
            proposedRooms: [...plan.proposedRooms, proposedRoom]
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    moveProposedRoom(
      roomId: string,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    ...clampRectToBounds(
                      {
                        ...room,
                        x: snapValue(x, state.snapToGrid),
                        y: snapValue(y, state.snapToGrid)
                      },
                      bounds
                    )
                  }
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    resizeProposedRoom(
      roomId: string,
      handle: ResizeHandle,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    ...clampRectToBounds(
                      resizeRect(
                        room,
                        handle,
                        snapValue(x, state.snapToGrid),
                        snapValue(y, state.snapToGrid)
                      ),
                      bounds
                    )
                  }
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    updateProposedRoom(
      roomId: string,
      patch: Pick<Partial<ProposedRoom>, 'name' | 'width' | 'height'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    ...patch,
                    ...clampRectToBounds(
                      {
                        ...room,
                        width: Math.max(
                          MIN_ROOM_SIZE,
                          patch.width ?? room.width
                        ),
                        height: Math.max(
                          MIN_ROOM_SIZE,
                          patch.height ?? room.height
                        )
                      },
                      bounds
                    )
                  }
                : room
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    deleteProposedRoom(roomId: string) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.filter(
              (room) => room.id !== roomId
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    addOpening(wallId: string, offset?: number) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;
          const wall = plan.walls.find((candidate) => candidate.id === wallId);
          if (!wall || wall.removed) return plan;

          const opening: Opening = {
            id: makeId('opening'),
            wallId,
            kind: 'door',
            offset: 0,
            width: GRID_SIZE * 2
          };
          opening.offset = clampOpeningOffset(wall, {
            ...opening,
            offset: offset ?? wallLength(wall) / 2 - opening.width / 2
          });

          return {
            ...plan,
            openings: [...plan.openings, opening]
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: wallId
        }
      );
    },
    updateOpening(
      openingId: string,
      patch: Pick<Partial<Opening>, 'offset' | 'width'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;

          const opening = plan.openings.find(
            (candidate) => candidate.id === openingId
          );
          if (!opening) return plan;

          const wall = plan.walls.find(
            (candidate) => candidate.id === opening.wallId
          );
          if (!wall || wall.removed) return plan;

          const nextOpening = {
            ...opening,
            ...patch,
            width: Math.min(
              Math.max(GRID_SIZE, patch.width ?? opening.width),
              wallLength(wall)
            )
          };
          nextOpening.offset = clampOpeningOffset(wall, nextOpening);

          return {
            ...plan,
            openings: plan.openings.map((candidate) =>
              candidate.id === openingId ? nextOpening : candidate
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null
        }
      );
    },
    selectRoom(roomId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: roomId,
        selectedProposedRoomId: null,
        selectedWallId: null
      }));
    },
    selectProposedRoom(roomId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: null,
        selectedProposedRoomId: roomId,
        selectedWallId: null
      }));
    },
    selectWall(wallId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: null,
        selectedProposedRoomId: null,
        selectedWallId: wallId
      }));
    },
    toggleSnap() {
      updateState((state) => ({ ...state, snapToGrid: !state.snapToGrid }));
    },
    undo() {
      updateState((state) => {
        const previous = activePast(state).at(-1);
        if (!previous) return state;

        const plan = normalisePlan(previous);
        const currentPlan = activePlan(state);
        const nextState = {
          ...state,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };

        if (state.activeMode === 'scenario') {
          nextState.scenarioPlan = plan;
          nextState.scenarioPast = state.scenarioPast.slice(0, -1);
          nextState.scenarioFuture = [
            clonePlan(currentPlan),
            ...state.scenarioFuture
          ].slice(0, 50);
        } else {
          nextState.baselinePlan = plan;
          nextState.baselinePast = state.baselinePast.slice(0, -1);
          nextState.baselineFuture = [
            clonePlan(currentPlan),
            ...state.baselineFuture
          ].slice(0, 50);
        }

        saveState(nextState);
        return nextState;
      });
    },
    redo() {
      updateState((state) => {
        const next = activeFuture(state)[0];
        if (!next) return state;

        const plan = normalisePlan(next);
        const currentPlan = activePlan(state);
        const nextState = {
          ...state,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };

        if (state.activeMode === 'scenario') {
          nextState.scenarioPlan = plan;
          nextState.scenarioPast = [
            ...state.scenarioPast,
            clonePlan(currentPlan)
          ].slice(-50);
          nextState.scenarioFuture = state.scenarioFuture.slice(1);
        } else {
          nextState.baselinePlan = plan;
          nextState.baselinePast = [
            ...state.baselinePast,
            clonePlan(currentPlan)
          ].slice(-50);
          nextState.baselineFuture = state.baselineFuture.slice(1);
        }

        saveState(nextState);
        return nextState;
      });
    },
    markSaved() {
      updateState((state) => ({ ...state, saveState: 'saved' }));
    },
    resetLocalPlan() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        const envelope = createEnvelopeFromPlan(emptyPlan);
        const nextState = {
          ...state,
          ...envelope,
          setupStep: 'counts' as const,
          inventory: [],
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          snapToGrid: true,
          saveState: 'saving' as const,
          baselinePast: [],
          baselineFuture: [],
          scenarioPast: [],
          scenarioFuture: []
        };
        saveState(nextState);
        return nextState;
      });
    }
  };
}

export const editor = createEditorStore();

export const selectedRoom = derived(editor, ($editor) =>
  $editor.plan.rooms.find((room) => room.id === $editor.selectedRoomId)
);

export const selectedProposedRoom = derived(editor, ($editor) =>
  $editor.plan.proposedRooms.find(
    (room) => room.id === $editor.selectedProposedRoomId
  )
);

export const selectedWall = derived(editor, ($editor) =>
  $editor.plan.walls.find((wall) => wall.id === $editor.selectedWallId)
);
