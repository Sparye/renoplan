import { browser } from '$app/environment';
import { derived, writable } from 'svelte/store';
import type {
  Opening,
  PlanDocument,
  PlanRect,
  Room,
  TrayRoomTemplate,
  Wall
} from '$lib/domain/types';

export const GRID_SIZE = 24;
export const METRES_PER_GRID = 0.25;

const STORAGE_KEY = 'renoplan.editor.v1';
const MIN_ROOM_SIZE = GRID_SIZE * 2;

const initialPlan: PlanDocument = {
  id: 'existing-v1-plan',
  rooms: [
    {
      id: 'bedroom-1',
      name: 'Bedroom 1',
      type: 'bedroom',
      x: 320,
      y: 96,
      width: 168,
      height: 144
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      x: 488,
      y: 96,
      width: 168,
      height: 144
    },
    {
      id: 'living',
      name: 'Living Room',
      type: 'living',
      x: 320,
      y: 240,
      width: 336,
      height: 192
    },
    {
      id: 'toilet',
      name: 'Toilet',
      type: 'wet',
      x: 656,
      y: 96,
      width: 96,
      height: 96
    }
  ],
  walls: [],
  openings: [],
  objects: []
};

export const trayRoomTemplates: TrayRoomTemplate[] = [
  { label: 'Bedroom 2', type: 'bedroom', width: 168, height: 144 },
  { label: 'Bedroom 3', type: 'bedroom', width: 144, height: 144 },
  { label: 'Laundry', type: 'utility', width: 120, height: 96 }
];

export interface EditorState {
  plan: PlanDocument;
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
  if (!browser) return normalisePlan(initialPlan);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalisePlan(initialPlan);

  try {
    const parsed = JSON.parse(raw) as PlanDocument;
    return normalisePlan(parsed);
  } catch {
    return normalisePlan(initialPlan);
  }
}

function persistPlan(plan: PlanDocument) {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

function createEditorStore() {
  const store = writable<EditorState>({
    plan: loadPlan(),
    selectedRoomId: 'living',
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
    addRoom(template: TrayRoomTemplate, x: number, y: number) {
      const roomId = createId(
        template.label.toLowerCase().replaceAll(' ', '-')
      );
      mutatePlan(
        (plan, state) => ({
          ...plan,
          rooms: [
            ...plan.rooms,
            {
              id: roomId,
              name: template.label,
              type: template.type,
              x: snapValue(x - template.width / 2, state.snapToGrid),
              y: snapValue(y - template.height / 2, state.snapToGrid),
              width: template.width,
              height: template.height
            }
          ]
        }),
        { history: true, selectedRoomId: roomId, selectedWallId: null }
      );
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
      const plan = normalisePlan(initialPlan);
      persistPlan(plan);
      store.set({
        plan,
        selectedRoomId: 'living',
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
