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
    expect(get(store).plan.proposedRooms[0].width).toBe(200);
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
    expect(get(store).plan.proposedRooms[0].width).toBe(200);

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
});
