import { derived, writable } from 'svelte/store';
import type { PlanDocument, Room, TrayRoomTemplate } from '$lib/domain/types';

export const GRID_SIZE = 24;
export const METRES_PER_GRID = 0.25;

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
  walls: [
    {
      id: 'wall-bedroom-kitchen',
      kind: 'shared',
      roomIds: ['bedroom-1', 'kitchen'],
      x1: 488,
      y1: 96,
      x2: 488,
      y2: 240,
      structural: false,
      removed: false
    },
    {
      id: 'wall-bedroom-living-open',
      kind: 'shared',
      roomIds: ['bedroom-1', 'living'],
      x1: 392,
      y1: 240,
      x2: 512,
      y2: 240,
      structural: false,
      removed: true
    }
  ],
  openings: [
    {
      id: 'door-toilet',
      wallId: 'wall-toilet-living',
      kind: 'door',
      offset: 48,
      width: 48
    }
  ],
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
  snapToGrid: boolean;
  saveState: 'saved' | 'saving' | 'offline';
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

export const snapValue = (value: number, enabled = true) =>
  enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;

export const pixelsToMetres = (value: number) =>
  (value / GRID_SIZE) * METRES_PER_GRID;

function createEditorStore() {
  const store = writable<EditorState>({
    plan: initialPlan,
    selectedRoomId: 'living',
    snapToGrid: true,
    saveState: 'saved'
  });

  return {
    subscribe: store.subscribe,
    addRoom(template: TrayRoomTemplate, x: number, y: number) {
      store.update((state) => {
        const plan = clonePlan(state.plan);
        const room: Room = {
          id: createId(template.label.toLowerCase().replaceAll(' ', '-')),
          name: template.label,
          type: template.type,
          x: snapValue(x - template.width / 2, state.snapToGrid),
          y: snapValue(y - template.height / 2, state.snapToGrid),
          width: template.width,
          height: template.height
        };

        plan.rooms = [...plan.rooms, room];

        return {
          ...state,
          plan,
          selectedRoomId: room.id,
          saveState: 'saving'
        };
      });
    },
    moveRoom(roomId: string, x: number, y: number) {
      store.update((state) => ({
        ...state,
        plan: {
          ...state.plan,
          rooms: state.plan.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  x: snapValue(x, state.snapToGrid),
                  y: snapValue(y, state.snapToGrid)
                }
              : room
          )
        },
        selectedRoomId: roomId,
        saveState: 'saving'
      }));
    },
    selectRoom(roomId: string | null) {
      store.update((state) => ({ ...state, selectedRoomId: roomId }));
    },
    toggleSnap() {
      store.update((state) => ({ ...state, snapToGrid: !state.snapToGrid }));
    },
    markSaved() {
      store.update((state) => ({ ...state, saveState: 'saved' }));
    }
  };
}

export const editor = createEditorStore();

export const selectedRoom = derived(editor, ($editor) =>
  $editor.plan.rooms.find((room) => room.id === $editor.selectedRoomId)
);
