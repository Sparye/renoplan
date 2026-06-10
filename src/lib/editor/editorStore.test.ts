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
});

describe('baseline locking', () => {
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

  it('creates one renovation scenario from the locked snapshot', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    const state = get(store);

    expect(state.activeMode).toBe('scenario');
    expect(state.scenarioPlan?.id).toBe('renovation-plan');
    expect(state.scenarioPlan?.rooms).toEqual(state.lockedBaseline?.plan.rooms);
  });
});

describe('scenario bounds and history', () => {
  it('clamps scenario moves and resizes to the locked baseline bounding box', () => {
    const store = createEditorStore({
      storage: new MemoryStorage(JSON.stringify(samplePlan())),
      now: () => '2026-06-08T00:00:00.000Z'
    });

    store.lockBaseline();
    store.createRenovationPlan();
    store.moveRoom('room-a', 180, 0, { history: true });
    expect(get(store).plan.rooms.find((room) => room.id === 'room-a')?.x).toBe(
      100
    );

    store.resizeRoom('room-a', 'e', 400, 100, { history: true });
    const room = get(store).plan.rooms.find(
      (candidate) => candidate.id === 'room-a'
    );
    expect(room?.x).toBe(0);
    expect(room?.width).toBe(200);
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
    store.moveRoom('room-b', 100, 0, { history: true });
    expect(get(store).scenarioPast).toHaveLength(1);

    store.switchMode('baseline');
    expect(get(store).past).toHaveLength(1);

    store.switchMode('scenario');
    expect(get(store).past).toHaveLength(1);
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
        prefix === 'proposed-room' ? 'proposed-room-1' : 'baseline-1'
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
    const ids = ['baseline-1', 'proposed-room-1'];
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
    expect(get(store).plan.proposedRooms[0].width).toBe(200);

    store.updateProposedRoom('proposed-room-1', { name: 'New study' });
    expect(get(store).plan.proposedRooms[0].name).toBe('New study');

    store.deleteProposedRoom('proposed-room-1');
    expect(get(store).plan.proposedRooms).toHaveLength(0);

    store.undo();
    expect(get(store).plan.proposedRooms[0].name).toBe('New study');
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
});
