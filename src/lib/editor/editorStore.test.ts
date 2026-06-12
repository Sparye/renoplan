import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { PlanDocument } from '$lib/domain/types';
import {
  createEditorStore,
  deriveWalls,
  parseEditorEnvelope
} from '$lib/editor/editorStore';

class MemoryStorage {
  value: string | null;

  constructor(value: string | null = null) {
    this.value = value;
  }

  getItem() {
    return this.value;
  }

  setItem(_key: string, value: string) {
    this.value = value;
  }
}

const samplePlan = (): PlanDocument => ({
  id: 'existing-v1-plan',
  rooms: [
    {
      id: 'room-a',
      name: 'Room A',
      type: 'generic',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    },
    {
      id: 'room-b',
      name: 'Room B',
      type: 'generic',
      x: 100,
      y: 0,
      width: 100,
      height: 100
    }
  ],
  proposedRooms: [],
  walls: [],
  openings: [],
  objects: []
});

describe('editor envelope persistence', () => {
  it('loads old raw plan storage into the new envelope shape', () => {
    const envelope = parseEditorEnvelope(JSON.stringify(samplePlan()));

    expect(envelope.baselinePlan.rooms).toHaveLength(2);
    expect(envelope.lockedBaseline).toBeNull();
    expect(envelope.scenarioPlan).toBeNull();
    expect(envelope.activeMode).toBe('baseline');
  });
});

describe('wall derivation', () => {
  it('derives exterior walls for all four sides of a standalone room', () => {
    const walls = deriveWalls({
      ...samplePlan(),
      rooms: [samplePlan().rooms[0]]
    });

    expect(walls.filter((wall) => wall.kind === 'exterior')).toHaveLength(4);
    expect(walls.filter((wall) => wall.kind === 'shared')).toHaveLength(0);
  });

  it('keeps shared walls clickable and leaves remaining room sides exterior', () => {
    const walls = deriveWalls(samplePlan());

    expect(walls.filter((wall) => wall.kind === 'shared')).toHaveLength(1);
    expect(walls.filter((wall) => wall.kind === 'exterior')).toHaveLength(6);
  });

  it('derives exterior walls around an irregular merged room', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveRoom('room-b', 50, 50);
    store.mergeRoom('room-a', 'room-b');
    const state = get(store);

    expect(state.plan.rooms).toHaveLength(1);
    expect(state.plan.rooms[0].shape).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 48 },
      { x: 148, y: 48 },
      { x: 148, y: 148 },
      { x: 48, y: 148 },
      { x: 48, y: 100 },
      { x: 0, y: 100 }
    ]);
    expect(state.plan.walls).toHaveLength(8);
    expect(state.selectedRoomId).toBe('room-a');
  });

  it('adds a baseline room next to the selected room so it can be merged', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => 'room-c'
    });

    store.selectRoom('room-a');
    store.addRoom('bathroom');
    let state = get(store);

    expect(state.plan.rooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'room-c',
          name: 'Bathroom',
          x: 96,
          y: 0,
          width: 120,
          height: 96
        })
      ])
    );
    expect(state.selectedRoomId).toBe('room-c');

    store.mergeRoom('room-c', 'room-a');
    state = get(store);

    expect(state.plan.rooms).toHaveLength(2);
    expect(state.plan.rooms.find((room) => room.id === 'room-c')).toEqual(
      expect.objectContaining({
        name: 'Bathroom + Room A',
        shape: expect.any(Array)
      })
    );
  });

  it('updates baseline room dimensions directly from the inspector', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.updateRoom('room-a', { width: 288, height: 240 });
    const state = get(store);

    expect(state.plan.rooms.find((room) => room.id === 'room-a')).toEqual(
      expect.objectContaining({
        width: 288,
        height: 240
      })
    );
    expect(state.selectedRoomId).toBe('room-a');
    expect(state.plan.walls.length).toBeGreaterThan(0);
  });

  it('snaps baseline rooms to neighbouring edges while configuring the baseline', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveRoom('room-b', 105, 0, { history: true });
    const state = get(store);

    expect(state.plan.rooms.find((room) => room.id === 'room-b')?.x).toBe(100);
  });

  it('deletes baseline rooms while keeping the footprint room intact', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => 'room-1'
    });

    store.startEditorFromWholeArea(240, 240);
    store.addRoom('kitchen');
    store.deleteRoom('room-1');
    store.deleteRoom('whole-area');
    const state = get(store);

    expect(state.plan.rooms).toEqual([
      expect.objectContaining({ id: 'whole-area' })
    ]);
    expect(state.selectedRoomId).toBeNull();
  });
});

describe('baseline locking', () => {
  it('can start a draft baseline from whole-area dimensions', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.startEditorFromWholeArea(528, 768);
    const state = get(store);

    expect(state.setupStep).toBe('editor');
    expect(state.selectedRoomId).toBe('whole-area');
    expect(state.baselinePlan.rooms).toEqual([
      expect.objectContaining({
        id: 'whole-area',
        name: 'Whole area',
        type: 'generic',
        x: 48,
        y: 48,
        width: 528,
        height: 768
      })
    ]);
    expect(state.baselinePlan.walls).toHaveLength(4);
  });

  it('can start a draft baseline from whole-area dimensions and measured rooms', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.createInventory({
      bedroom: 1,
      toilet: 0,
      bathroom: 0,
      kitchen: 1,
      living: 0,
      dining: 0,
      laundry: 0,
      storage: 0,
      garage: 0,
      other: 0
    });
    store.updateInventoryRoom('bedroom-1', {
      width: 336,
      height: 288,
      measured: true
    });
    store.startEditorFromInventoryWithinWholeArea(576, 768);
    const state = get(store);

    expect(state.setupStep).toBe('editor');
    expect(state.selectedRoomId).toBe('bedroom-1');
    expect(state.baselinePlan.rooms).toEqual([
      expect.objectContaining({
        id: 'whole-area',
        name: 'Whole area',
        x: 48,
        y: 48,
        width: 576,
        height: 768
      }),
      expect.objectContaining({
        id: 'bedroom-1',
        name: 'Bedroom',
        x: 72,
        y: 72,
        width: 336,
        height: 288
      }),
      expect.objectContaining({
        id: 'kitchen-1',
        name: 'Kitchen',
        x: 432,
        y: 72,
        width: 168,
        height: 144
      })
    ]);
    expect(state.baselinePlan.walls.length).toBeGreaterThan(4);
  });

  it('keeps baseline rooms inside the configured whole-area footprint', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.createInventory({
      bedroom: 0,
      toilet: 0,
      bathroom: 0,
      kitchen: 1,
      living: 0,
      dining: 0,
      laundry: 0,
      storage: 0,
      garage: 0,
      other: 0
    });
    store.startEditorFromInventoryWithinWholeArea(528, 384);
    store.moveRoom('kitchen-1', 0, 0, { history: true });
    let state = get(store);

    expect(state.plan.rooms.find((room) => room.id === 'kitchen-1')).toEqual(
      expect.objectContaining({
        x: 48,
        y: 48
      })
    );

    store.moveRoom('kitchen-1', 900, 900, { history: true });
    state = get(store);

    expect(state.plan.rooms.find((room) => room.id === 'kitchen-1')).toEqual(
      expect.objectContaining({
        x: 408,
        y: 288
      })
    );
  });

  it('keeps the left edge fixed when a baseline room grows into the right footprint edge', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.createInventory({
      bedroom: 0,
      toilet: 0,
      bathroom: 0,
      kitchen: 1,
      living: 0,
      dining: 0,
      laundry: 0,
      storage: 0,
      garage: 0,
      other: 0
    });
    store.startEditorFromInventoryWithinWholeArea(528, 384);
    store.resizeRoom('kitchen-1', 'e', 900, 72, { history: true });

    expect(
      get(store).plan.rooms.find((room) => room.id === 'kitchen-1')
    ).toEqual(
      expect.objectContaining({
        x: 72,
        width: 504
      })
    );
  });

  it('blocks locking an empty baseline', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();

    expect(get(store).lockedBaseline).toBeNull();
  });

  it('locks a non-empty baseline and stores bounds plus a snapshot', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => 'baseline-1'
    });

    store.lockBaseline();
    const state = get(store);

    expect(state.lockedBaseline?.id).toBe('baseline-1');
    expect(state.lockedBaseline?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100
    });
    expect(state.lockedBaseline?.plan.rooms).toEqual(state.baselinePlan.rooms);
    expect(state.baselines).toHaveLength(1);
    expect(state.baselines[0].name).toBe('Untitled renovation');
  });

  it('unlocks before scenario creation by restoring the locked snapshot', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.unlockBaseline();
    const state = get(store);

    expect(state.lockedBaseline).toBeNull();
    expect(state.activeMode).toBe('baseline');
    expect(state.baselinePlan.rooms[0].x).toBe(0);
  });

  it('creates one renovation scenario with an empty proposed layout', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    const state = get(store);

    expect(state.activeMode).toBe('scenario');
    expect(state.scenarioPlan?.id).toBe('renovation-plan');
    expect(state.scenarioPlan?.rooms).toEqual([]);
    expect(state.scenarioPlan?.proposedRooms).toEqual([]);
    expect(state.showReferenceBackground).toBe(true);
  });

  it('persists the reference background toggle per scenario', () => {
    const storage = new MemoryStorage(JSON.stringify(samplePlan()));
    const store = createEditorStore({
      storage,
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.toggleReferenceBackground();

    expect(get(store).showReferenceBackground).toBe(false);
    expect(parseEditorEnvelope(storage.value).showReferenceBackground).toBe(
      false
    );
  });

  it('resets a legacy copied-baseline scenario back to baseline review', () => {
    const lockedPlan = samplePlan();
    const envelope = parseEditorEnvelope(
      JSON.stringify({
        version: 1,
        baselinePlan: lockedPlan,
        lockedBaseline: {
          id: 'baseline-1',
          name: 'Existing v1',
          version: 1,
          locked: true,
          createdAt: '2026-06-08T00:00:00.000Z',
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          plan: lockedPlan
        },
        scenarioPlan: { ...lockedPlan, id: 'renovation-plan' },
        showReferenceBackground: true,
        activeMode: 'scenario'
      })
    );

    expect(envelope.lockedBaseline).not.toBeNull();
    expect(envelope.scenarioPlan).toBeNull();
    expect(envelope.activeMode).toBe('baseline');
  });

  it('can start a new draft after a renovation scenario without losing the saved baseline', () => {
    const storage = new MemoryStorage(JSON.stringify(samplePlan()));
    const store = createEditorStore({
      storage,
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bathroom');
    store.startNewBaseline();
    const state = get(store);

    expect(state.lockedBaseline).toBeNull();
    expect(state.scenarioPlan).toBeNull();
    expect(state.baselines).toHaveLength(1);
    expect(state.baselines[0].scenarios).toHaveLength(1);
    expect(state.baselinePlan.rooms).toEqual([]);
    expect(state.activeMode).toBe('baseline');
    expect(state.setupStep).toBe('project-details');
    expect(parseEditorEnvelope(storage.value).baselines).toHaveLength(1);
  });

  it('loads saved baselines into the dashboard', () => {
    const storage = new MemoryStorage(JSON.stringify(samplePlan()));
    const store = createEditorStore({
      storage,
      now: () => '2026-06-08T00:00:00.000Z'
    });
    store.lockBaseline();

    const reloaded = createEditorStore({ storage });
    const state = get(reloaded);

    expect(state.setupStep).toBe('dashboard');
    expect(state.baselines).toHaveLength(1);
    expect(state.baselines[0].scenarios).toEqual([]);
  });
});

describe('scenario bounds and history', () => {
  it('snaps proposed rooms to neighbouring edges even when dimensions are off-grid', () => {
    let idIndex = 0;
    const ids = [
      'baseline-1',
      'scenario-1',
      'proposed-room-1',
      'proposed-room-2'
    ];
    const store = createEditorStore({
      storage: new MemoryStorage(),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.startEditorFromWholeArea(600, 500);
    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bathroom');
    store.addProposedRoom('other');
    store.updateProposedRoom('proposed-room-1', {
      width: 163.2,
      height: 288
    });
    store.updateProposedRoom('proposed-room-2', {
      width: 57.6,
      height: 82.56
    });
    store.moveProposedRoom('proposed-room-1', 48, 48);

    const largeRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'proposed-room-1'
    );
    const smallRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'proposed-room-2'
    );
    expect(largeRoom).toBeDefined();
    expect(smallRoom).toBeDefined();

    store.moveProposedRoom(
      'proposed-room-2',
      (largeRoom?.x ?? 0) + (largeRoom?.width ?? 0),
      (largeRoom?.y ?? 0) + (largeRoom?.height ?? 0) - (smallRoom?.height ?? 0),
      { history: true }
    );

    const [nextLargeRoom, nextSmallRoom] = get(store).plan.proposedRooms;
    expect(nextSmallRoom.x).toBeCloseTo(nextLargeRoom.x + nextLargeRoom.width);
    expect(nextSmallRoom.y + nextSmallRoom.height).toBeCloseTo(
      nextLargeRoom.y + nextLargeRoom.height
    );
  });

  it('snaps irregular proposed rooms by their polygon edges', () => {
    const baselinePlan: PlanDocument = {
      id: 'existing-v1-plan',
      rooms: [
        {
          id: 'whole-area',
          name: 'Whole area',
          type: 'generic',
          x: 0,
          y: 0,
          width: 800,
          height: 500
        }
      ],
      proposedRooms: [],
      walls: [],
      openings: [],
      objects: []
    };
    const scenarioPlan: PlanDocument = {
      id: 'renovation-plan',
      rooms: [],
      proposedRooms: [
        {
          id: 'left-room',
          name: 'Left irregular',
          type: 'generic',
          x: 48,
          y: 48,
          width: 360,
          height: 336,
          shape: [
            { x: 48, y: 48 },
            { x: 408, y: 48 },
            { x: 408, y: 240 },
            { x: 312, y: 240 },
            { x: 312, y: 384 },
            { x: 48, y: 384 }
          ]
        },
        {
          id: 'right-room',
          name: 'Right irregular',
          type: 'generic',
          x: 456,
          y: 48,
          width: 360,
          height: 336,
          shape: [
            { x: 552, y: 48 },
            { x: 816, y: 48 },
            { x: 816, y: 384 },
            { x: 456, y: 384 },
            { x: 456, y: 240 },
            { x: 552, y: 240 }
          ]
        }
      ],
      walls: [],
      openings: [],
      objects: []
    };
    const store = createEditorStore({
      storage: new MemoryStorage(
        JSON.stringify({
          version: 1,
          draftProjectName: 'Irregular snap',
          baselinePlan,
          draftPlan: null,
          lockedBaseline: {
            id: 'baseline-1',
            name: 'Irregular snap',
            version: 1,
            locked: true,
            createdAt: '2026-06-08T00:00:00.000Z',
            bounds: { x: 0, y: 0, width: 800, height: 500 },
            plan: baselinePlan
          },
          scenarioPlan,
          showReferenceBackground: true,
          baselines: [],
          activeBaselineId: 'baseline-1',
          activeScenarioId: 'scenario-1',
          activeMode: 'scenario'
        })
      ),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveProposedRoom('right-room', 312, 48, { history: true });
    const rightRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'right-room'
    );

    expect(rightRoom?.x).toBe(312);
    expect(rightRoom?.shape?.[0].x).toBe(408);
    expect(rightRoom?.shape?.[4].x).toBe(312);
  });

  it('snaps irregular proposed rooms when the target is at the top-left footprint edge', () => {
    const baselinePlan: PlanDocument = {
      id: 'existing-v1-plan',
      rooms: [
        {
          id: 'whole-area',
          name: 'Whole area',
          type: 'generic',
          x: 0,
          y: 0,
          width: 800,
          height: 500
        }
      ],
      proposedRooms: [],
      walls: [],
      openings: [],
      objects: []
    };
    const scenarioPlan: PlanDocument = {
      id: 'renovation-plan',
      rooms: [],
      proposedRooms: [
        {
          id: 'left-room',
          name: 'Left irregular',
          type: 'generic',
          x: 0,
          y: 0,
          width: 360,
          height: 336,
          shape: [
            { x: 0, y: 0 },
            { x: 360, y: 0 },
            { x: 360, y: 192 },
            { x: 264, y: 192 },
            { x: 264, y: 336 },
            { x: 0, y: 336 }
          ]
        },
        {
          id: 'right-room',
          name: 'Right irregular',
          type: 'generic',
          x: 408,
          y: 0,
          width: 360,
          height: 336,
          shape: [
            { x: 504, y: 0 },
            { x: 768, y: 0 },
            { x: 768, y: 336 },
            { x: 408, y: 336 },
            { x: 408, y: 192 },
            { x: 504, y: 192 }
          ]
        }
      ],
      walls: [],
      openings: [],
      objects: []
    };
    const store = createEditorStore({
      storage: new MemoryStorage(
        JSON.stringify({
          version: 1,
          draftProjectName: 'Top-left irregular snap',
          baselinePlan,
          draftPlan: null,
          lockedBaseline: {
            id: 'baseline-1',
            name: 'Top-left irregular snap',
            version: 1,
            locked: true,
            createdAt: '2026-06-08T00:00:00.000Z',
            bounds: { x: 0, y: 0, width: 800, height: 500 },
            plan: baselinePlan
          },
          scenarioPlan,
          showReferenceBackground: true,
          baselines: [],
          activeBaselineId: 'baseline-1',
          activeScenarioId: 'scenario-1',
          activeMode: 'scenario'
        })
      ),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveProposedRoom('right-room', 264, 0, { history: true });
    const rightRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'right-room'
    );

    expect(rightRoom?.x).toBe(264);
    expect(rightRoom?.y).toBe(0);
    expect(rightRoom?.shape?.[0]).toEqual({ x: 360, y: 0 });
    expect(rightRoom?.shape?.[4]).toEqual({ x: 264, y: 192 });

    store.moveProposedRoom('right-room', 408, 0);
    store.moveProposedRoom('left-room', 48, 0, { history: true });
    const leftRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'left-room'
    );
    const movedRightRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'right-room'
    );

    expect(leftRoom?.x).toBe(48);
    expect(leftRoom?.y).toBe(0);
    expect(movedRightRoom?.x).toBe(408);
  });

  it('prefers facing irregular edges over coincident top-corner points', () => {
    const baselinePlan: PlanDocument = {
      id: 'existing-v1-plan',
      rooms: [
        {
          id: 'whole-area',
          name: 'Whole area',
          type: 'generic',
          x: 0,
          y: 0,
          width: 900,
          height: 500
        }
      ],
      proposedRooms: [],
      walls: [],
      openings: [],
      objects: []
    };
    const scenarioPlan: PlanDocument = {
      id: 'renovation-plan',
      rooms: [],
      proposedRooms: [
        {
          id: 'left-room',
          name: 'Left irregular',
          type: 'generic',
          x: 0,
          y: 0,
          width: 420,
          height: 360,
          shape: [
            { x: 0, y: 0 },
            { x: 324, y: 0 },
            { x: 324, y: 144 },
            { x: 420, y: 144 },
            { x: 420, y: 360 },
            { x: 0, y: 360 }
          ]
        },
        {
          id: 'right-room',
          name: 'Right irregular',
          type: 'generic',
          x: 420,
          y: 0,
          width: 420,
          height: 360,
          shape: [
            { x: 420, y: 0 },
            { x: 840, y: 0 },
            { x: 840, y: 360 },
            { x: 516, y: 360 },
            { x: 516, y: 144 },
            { x: 420, y: 144 }
          ]
        }
      ],
      walls: [],
      openings: [],
      objects: []
    };
    const store = createEditorStore({
      storage: new MemoryStorage(
        JSON.stringify({
          version: 1,
          draftProjectName: 'Top-corner irregular snap',
          baselinePlan,
          draftPlan: null,
          lockedBaseline: {
            id: 'baseline-1',
            name: 'Top-corner irregular snap',
            version: 1,
            locked: true,
            createdAt: '2026-06-08T00:00:00.000Z',
            bounds: { x: 0, y: 0, width: 900, height: 500 },
            plan: baselinePlan
          },
          scenarioPlan,
          showReferenceBackground: true,
          baselines: [],
          activeBaselineId: 'baseline-1',
          activeScenarioId: 'scenario-1',
          activeMode: 'scenario'
        })
      ),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveProposedRoom('right-room', 324, 0, { history: true });
    const rightRoom = get(store).plan.proposedRooms.find(
      (room) => room.id === 'right-room'
    );

    expect(rightRoom?.x).toBe(324);
    expect(rightRoom?.shape?.[0]).toEqual({ x: 324, y: 0 });
    expect(rightRoom?.shape?.[4]).toEqual({ x: 420, y: 144 });
  });

  it('clamps scenario moves and resizes to the locked baseline bounding box', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: (prefix) =>
        prefix === 'proposed-room'
          ? 'proposed-room-1'
          : prefix === 'scenario'
            ? 'scenario-1'
            : 'baseline-1'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bedroom');
    store.moveProposedRoom('proposed-room-1', 180, 0, { history: true });
    expect(get(store).plan.proposedRooms[0].x).toBe(56);

    store.resizeProposedRoom('proposed-room-1', 'e', 400, 100, {
      history: true
    });
    expect(get(store).plan.proposedRooms[0]).toEqual(
      expect.objectContaining({
        x: 56,
        width: 144
      })
    );
  });

  it('keeps separate undo and redo stacks for baseline and scenario modes', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.moveRoom('room-a', 24, 0, { history: true });
    expect(get(store).baselinePast).toHaveLength(1);

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bedroom');
    store.moveProposedRoom(get(store).plan.proposedRooms[0].id, 100, 0, {
      history: true
    });
    expect(get(store).scenarioPast).toHaveLength(2);

    store.switchMode('baseline');
    expect(get(store).past).toHaveLength(1);

    store.switchMode('scenario');
    expect(get(store).past).toHaveLength(2);
  });

  it('adds openings to exterior walls', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => 'opening-1'
    });
    const exteriorWall = get(store).plan.walls.find(
      (wall) => wall.kind === 'exterior'
    );

    expect(exteriorWall).toBeDefined();
    store.addOpening(exteriorWall?.id ?? '');

    expect(get(store).plan.openings).toEqual([
      expect.objectContaining({
        id: 'opening-1',
        wallId: exteriorWall?.id
      })
    ]);
  });

  it('adds proposed rooms to scenario plans without deriving walls from them', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: (prefix) =>
        prefix === 'proposed-room'
          ? 'proposed-room-1'
          : prefix === 'scenario'
            ? 'scenario-1'
            : 'baseline-1'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    const wallCount = get(store).plan.walls.length;
    store.addProposedRoom('bathroom');

    expect(get(store).plan.proposedRooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'proposed-room-1',
          name: 'Bathroom 1',
          type: 'wet'
        })
      ])
    );
    expect(get(store).plan.walls).toHaveLength(wallCount);
    expect(get(store).selectedProposedRoomId).toBe('proposed-room-1');
  });

  it('moves, resizes, renames, deletes, and undoes proposed rooms', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'proposed-room-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bedroom');
    store.moveProposedRoom('proposed-room-1', 180, 0, { history: true });
    expect(
      get(store).plan.proposedRooms.find(
        (room) => room.id === 'proposed-room-1'
      )?.x
    ).toBe(56);

    store.resizeProposedRoom('proposed-room-1', 'e', 400, 100, {
      history: true
    });
    expect(get(store).plan.proposedRooms[0]).toEqual(
      expect.objectContaining({
        x: 56,
        width: 144
      })
    );

    store.updateProposedRoom('proposed-room-1', { name: 'New study' });
    expect(get(store).plan.proposedRooms[0].name).toBe('New study');

    store.deleteProposedRoom('proposed-room-1');
    expect(get(store).plan.proposedRooms).toHaveLength(0);

    store.undo();
    expect(get(store).plan.proposedRooms[0].name).toBe('New study');
  });

  it('keeps proposed rooms from overlapping each other', () => {
    let idIndex = 0;
    const ids = [
      'baseline-1',
      'scenario-1',
      'proposed-room-1',
      'proposed-room-2'
    ];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('toilet');
    store.addProposedRoom('toilet');
    store.moveProposedRoom('proposed-room-2', 64, 0, { history: true });

    const [first, second] = get(store).plan.proposedRooms;
    const separatedHorizontally =
      first.x + first.width <= second.x || second.x + second.width <= first.x;
    const separatedVertically =
      first.y + first.height <= second.y || second.y + second.height <= first.y;

    expect(separatedHorizontally || separatedVertically).toBe(true);
  });

  it('adds openings at a requested wall offset and clamps later edits', () => {
    let idIndex = 0;
    const ids = ['opening-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });
    const exteriorWall = get(store).plan.walls.find(
      (wall) => wall.id === 'wall-room-a-north-0-100'
    );

    expect(exteriorWall).toBeDefined();
    store.addOpening(exteriorWall?.id ?? '', 24);
    expect(get(store).plan.openings[0]).toEqual(
      expect.objectContaining({
        offset: 24,
        width: 48
      })
    );

    store.updateOpening('opening-1', { offset: 500, width: 72 });

    expect(get(store).plan.openings[0]).toEqual(
      expect.objectContaining({
        offset: 28,
        width: 72
      })
    );
  });

  it('adds door, window, and sliding door openings to renovation scenarios', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'opening-1', 'opening-2'];
    const storage = new MemoryStorage(JSON.stringify(samplePlan()));
    const store = createEditorStore({
      storage,
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    const wallId = get(store).lockedBaseline?.plan.walls.find(
      (wall) => wall.id === 'wall-room-a-north-0-100'
    )?.id;

    expect(wallId).toBeDefined();
    store.addOpening(wallId ?? '', 24, 'window');
    store.addOpening(wallId ?? '', 48, 'sliding-door');
    store.updateOpening('opening-1', { kind: 'door' });

    expect(get(store).plan.openings).toEqual([
      expect.objectContaining({
        id: 'opening-1',
        wallId,
        kind: 'door'
      }),
      expect.objectContaining({
        id: 'opening-2',
        wallId,
        kind: 'sliding-door'
      })
    ]);

    const reloaded = createEditorStore({ storage });
    reloaded.openScenario('baseline-1', 'scenario-1');

    expect(get(reloaded).plan.openings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'opening-1', kind: 'door' }),
        expect.objectContaining({ id: 'opening-2', kind: 'sliding-door' })
      ])
    );
  });

  it('adds proposed walls to renovation scenarios and keeps their openings', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'wall-1', 'opening-1'];
    const storage = new MemoryStorage(JSON.stringify(samplePlan()));
    const store = createEditorStore({
      storage,
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addScenarioWall();
    store.updateScenarioWall('wall-1', { x1: 24, y1: 24, x2: 124, y2: 24 });
    store.addOpening('wall-1', 24, 'door');

    expect(get(store).plan.walls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wall-1',
          kind: 'proposed',
          x1: 24,
          y1: 24,
          x2: 120,
          y2: 24
        })
      ])
    );
    expect(get(store).plan.openings).toEqual([
      expect.objectContaining({ id: 'opening-1', wallId: 'wall-1' })
    ]);

    const reloaded = createEditorStore({ storage });
    reloaded.openScenario('baseline-1', 'scenario-1');

    expect(get(reloaded).plan.walls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'wall-1', kind: 'proposed' })
      ])
    );
    expect(get(reloaded).plan.openings).toEqual([
      expect.objectContaining({ id: 'opening-1', wallId: 'wall-1' })
    ]);

    reloaded.deleteScenarioWall('wall-1');

    expect(get(reloaded).plan.walls).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'wall-1' })])
    );
    expect(get(reloaded).plan.openings).toEqual([]);
  });

  it('moves free proposed walls in renovation scenarios', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'wall-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addScenarioWall();
    const before = get(store).plan.walls.find((wall) => wall.id === 'wall-1');

    expect(before).toBeDefined();
    store.moveScenarioWall('wall-1', 24, 24, { history: true });

    const after = get(store).plan.walls.find((wall) => wall.id === 'wall-1');
    expect(after).toEqual(
      expect.objectContaining({
        x1: 24,
        y1: 24,
        x2: (before?.x2 ?? 0) - (before?.x1 ?? 0) + 24,
        y2: 24
      })
    );
  });

  it('adds openings from a selected proposed room side and keeps them attached when moved', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'proposed-room-1', 'opening-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bathroom');
    store.addOpeningToProposedRoomSide(
      'proposed-room-1',
      'east',
      'sliding-door'
    );

    let wall = get(store).plan.walls.find(
      (candidate) => candidate.id === 'wall-proposed-room-1-east-proposed'
    );

    expect(wall).toEqual(
      expect.objectContaining({
        kind: 'proposed',
        roomIds: ['proposed-room-1'],
        side: 'east'
      })
    );
    expect(get(store).plan.openings).toEqual([
      expect.objectContaining({
        id: 'opening-1',
        wallId: 'wall-proposed-room-1-east-proposed',
        kind: 'sliding-door'
      })
    ]);

    store.moveProposedRoom('proposed-room-1', 48, 48, { history: true });
    const room = get(store).plan.proposedRooms.find(
      (candidate) => candidate.id === 'proposed-room-1'
    );
    wall = get(store).plan.walls.find(
      (candidate) => candidate.id === 'wall-proposed-room-1-east-proposed'
    );

    expect(wall).toEqual(
      expect.objectContaining({
        x1: (room?.x ?? 0) + (room?.width ?? 0),
        y1: room?.y,
        x2: (room?.x ?? 0) + (room?.width ?? 0),
        y2: (room?.y ?? 0) + (room?.height ?? 0)
      })
    );
  });

  it('updates window length and position on a proposed room side', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'proposed-room-1', 'opening-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bathroom');
    store.addOpeningToProposedRoomSide('proposed-room-1', 'north', 'window');
    store.updateOpening('opening-1', { offset: 24, width: 72 });

    expect(get(store).plan.openings[0]).toEqual(
      expect.objectContaining({
        kind: 'window',
        offset: 24,
        width: 72
      })
    );

    store.updateOpening('opening-1', { offset: 500, width: 240 });
    const wall = get(store).plan.walls.find(
      (candidate) => candidate.id === 'wall-proposed-room-1-north-proposed'
    );

    expect(get(store).plan.openings[0]).toEqual(
      expect.objectContaining({
        width: Math.min(
          240,
          wall ? Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) : 0
        ),
        offset: 0
      })
    );
  });

  it('keeps the proposed room selected when editing a side opening', () => {
    let idIndex = 0;
    const ids = ['baseline-1', 'scenario-1', 'proposed-room-1', 'opening-1'];
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z',
      createId: () => ids[idIndex++] ?? 'id'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.addProposedRoom('bathroom');
    store.addOpeningToProposedRoomSide('proposed-room-1', 'north', 'window');
    store.selectProposedRoom('proposed-room-1');
    store.updateOpening('opening-1', { offset: 24 });

    expect(get(store).selectedProposedRoomId).toBe('proposed-room-1');
    expect(get(store).selectedWallId).toBeNull();
  });
});
