import { browser } from '$app/environment';
import { derived, writable } from 'svelte/store';
import type {
  Opening,
  PlanDocument,
  PlanRect,
  RoomInventoryItem,
  RoomType,
  SetupRoomKind,
  Room,
  Wall
} from '$lib/domain/types';

export const GRID_SIZE = 24;
export const METRES_PER_GRID = 0.25;

const STORAGE_KEY = 'renoplan.editor.v1';
const MIN_ROOM_SIZE = GRID_SIZE * 2;

const emptyPlan: PlanDocument = {
  id: 'existing-v1-plan',
  rooms: [],
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

export interface EditorState {
  plan: PlanDocument;
  setupStep: SetupStep;
  inventory: RoomInventoryItem[];
  selectedRoomId: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
  saveState: 'saved' | 'saving' | 'offline';
  past: PlanDocument[];
  future: PlanDocument[];
}

const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const clonePlan = (plan: PlanDocument): PlanDocument => ({
  ...plan,
  rooms: plan.rooms.map((room) => ({ ...room })),
  walls: plan.walls.map((wall) => ({ ...wall, roomIds: [...wall.roomIds] })),
  openings: plan.openings.map((opening) => ({ ...opening })),
  objects: plan.objects.map((object) => ({ ...object }))
});

const wallId = (
  firstRoomId: string,
  secondRoomId: string,
  orientation: 'horizontal' | 'vertical'
) => `wall-${[firstRoomId, secondRoomId].sort().join('-')}-${orientation}`;

const wallLength = (wall: Wall) =>
  Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);

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

function normalisePlan(plan: PlanDocument): PlanDocument {
  const walls = deriveSharedWalls(plan);
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

function constrainRect(rect: PlanRect): PlanRect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_ROOM_SIZE, rect.width),
    height: Math.max(MIN_ROOM_SIZE, rect.height)
  };
}

function resizeRect(
  room: Room,
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

function loadPlan() {
  if (!browser) return normalisePlan(emptyPlan);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalisePlan(emptyPlan);

  try {
    const parsed = JSON.parse(raw) as PlanDocument;
    return normalisePlan(parsed);
  } catch {
    return normalisePlan(emptyPlan);
  }
}

function persistPlan(plan: PlanDocument) {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

function createEditorStore() {
  const startingPlan = loadPlan();
  const store = writable<EditorState>({
    plan: startingPlan,
    setupStep: startingPlan.rooms.length > 0 ? 'editor' : 'counts',
    inventory: [],
    selectedRoomId: null,
    selectedWallId: null,
    snapToGrid: true,
    saveState: 'saved',
    past: [],
    future: []
  });

  function mutatePlan(
    updater: (plan: PlanDocument, state: EditorState) => PlanDocument,
    options: {
      history?: boolean;
      selectedRoomId?: string | null;
      selectedWallId?: string | null;
    } = {}
  ) {
    store.update((state) => {
      const nextPlan = normalisePlan(updater(clonePlan(state.plan), state));

      persistPlan(nextPlan);

      return {
        ...state,
        plan: nextPlan,
        selectedRoomId: options.selectedRoomId ?? state.selectedRoomId,
        selectedWallId: options.selectedWallId ?? state.selectedWallId,
        past: options.history
          ? [...state.past, clonePlan(state.plan)].slice(-50)
          : state.past,
        future: options.history ? [] : state.future,
        saveState: 'saving'
      };
    });
  }

  return {
    subscribe: store.subscribe,
    createInventory(counts: Record<SetupRoomKind, number>) {
      const inventory = inventoryFromCounts(counts);

      store.update((state) => ({
        ...state,
        inventory,
        setupStep: inventory.length > 0 ? 'measurements' : 'counts',
        saveState: 'saved'
      }));
    },
    returnToCounts() {
      store.update((state) => ({
        ...state,
        setupStep: 'counts',
        selectedRoomId: null,
        selectedWallId: null
      }));
    },
    updateInventoryRoom(
      roomId: string,
      patch: Pick<
        Partial<RoomInventoryItem>,
        'label' | 'width' | 'height' | 'measured'
      >
    ) {
      store.update((state) => ({
        ...state,
        inventory: state.inventory.map((item) =>
          item.id === roomId ? { ...item, ...patch } : item
        )
      }));
    },
    startEditorFromInventory() {
      store.update((state) => {
        const plan = planFromInventory(state.inventory);
        persistPlan(plan);

        return {
          ...state,
          plan,
          setupStep: 'editor',
          selectedRoomId: plan.rooms[0]?.id ?? null,
          selectedWallId: null,
          past: [],
          future: [],
          saveState: 'saving'
        };
      });
    },
    returnToSetup() {
      store.update((state) => ({
        ...state,
        setupStep: state.inventory.length > 0 ? 'measurements' : 'counts',
        selectedRoomId: null,
        selectedWallId: null
      }));
    },
    moveRoom(
      roomId: string,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => ({
          ...plan,
          rooms: plan.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  x: snapValue(x, state.snapToGrid),
                  y: snapValue(y, state.snapToGrid)
                }
              : room
          )
        }),
        {
          history: options.history,
          selectedRoomId: roomId,
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
        (plan, state) => ({
          ...plan,
          rooms: plan.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  ...resizeRect(
                    room,
                    handle,
                    snapValue(x, state.snapToGrid),
                    snapValue(y, state.snapToGrid)
                  )
                }
              : room
          )
        }),
        {
          history: options.history,
          selectedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    updateWall(
      wallId: string,
      patch: Pick<Partial<Wall>, 'structural' | 'removed'>
    ) {
      mutatePlan(
        (plan) => ({
          ...plan,
          walls: plan.walls.map((wall) =>
            wall.id === wallId ? { ...wall, ...patch } : wall
          )
        }),
        { history: true, selectedRoomId: null, selectedWallId: wallId }
      );
    },
    addOpening(wallId: string) {
      mutatePlan(
        (plan) => {
          const wall = plan.walls.find((candidate) => candidate.id === wallId);
          if (!wall) return plan;

          const opening: Opening = {
            id: createId('opening'),
            wallId,
            kind: 'door',
            offset: Math.max(GRID_SIZE, wallLength(wall) / 2 - GRID_SIZE),
            width: GRID_SIZE * 2
          };

          return {
            ...plan,
            openings: [...plan.openings, opening]
          };
        },
        { history: true, selectedRoomId: null, selectedWallId: wallId }
      );
    },
    selectRoom(roomId: string | null) {
      store.update((state) => ({
        ...state,
        selectedRoomId: roomId,
        selectedWallId: null
      }));
    },
    selectWall(wallId: string | null) {
      store.update((state) => ({
        ...state,
        selectedRoomId: null,
        selectedWallId: wallId
      }));
    },
    toggleSnap() {
      store.update((state) => ({ ...state, snapToGrid: !state.snapToGrid }));
    },
    undo() {
      store.update((state) => {
        const previous = state.past.at(-1);
        if (!previous) return state;

        const plan = normalisePlan(previous);
        persistPlan(plan);

        return {
          ...state,
          plan,
          selectedRoomId: null,
          selectedWallId: null,
          past: state.past.slice(0, -1),
          future: [clonePlan(state.plan), ...state.future].slice(0, 50),
          saveState: 'saving'
        };
      });
    },
    redo() {
      store.update((state) => {
        const next = state.future[0];
        if (!next) return state;

        const plan = normalisePlan(next);
        persistPlan(plan);

        return {
          ...state,
          plan,
          selectedRoomId: null,
          selectedWallId: null,
          past: [...state.past, clonePlan(state.plan)].slice(-50),
          future: state.future.slice(1),
          saveState: 'saving'
        };
      });
    },
    markSaved() {
      store.update((state) => ({ ...state, saveState: 'saved' }));
    },
    resetLocalPlan() {
      const plan = normalisePlan(emptyPlan);
      persistPlan(plan);
      store.set({
        plan,
        setupStep: 'counts',
        inventory: [],
        selectedRoomId: null,
        selectedWallId: null,
        snapToGrid: true,
        saveState: 'saving',
        past: [],
        future: []
      });
    }
  };
}

export const editor = createEditorStore();

export const selectedRoom = derived(editor, ($editor) =>
  $editor.plan.rooms.find((room) => room.id === $editor.selectedRoomId)
);

export const selectedWall = derived(editor, ($editor) =>
  $editor.plan.walls.find((wall) => wall.id === $editor.selectedWallId)
);
