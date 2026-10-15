import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  type Scenario,
  addOpening,
  addOutline,
  addRoom,
  applyScenario,
  checkPlan,
  emptyPlan,
  emptyScenario,
  recordChange
} from '@/core';
import { FORMAT, type Project, VERSION, fromDocument, parse, serialize } from './document';
import { memoryStorage, webStore } from './store';

function sample(): Project {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const a = addRoom(p, { name: 'Bedroom', w: 3000, l: 4000, x: 200, y: 200 });
  p = a.plan;
  const wall = Object.keys(p.walls).find((id) => p.walls[id]!.neg === a.id)!;
  p = addOpening(p, wall, 'door', 2000).plan;
  // A Scenario that uses every kind of Target: an Existing Plan id, a WallRef, and a created Opening.
  let s: Scenario = emptyScenario('s1', 'Open plan');
  const step = (g: Parameters<typeof recordChange>[2]) => (s = recordChange(p, s, g)!.scenario);
  step({ op: 'renameRoom', room: a.id!, name: 'Study' });
  step({ op: 'drawWall', a: { x: 1700, y: 100 }, b: { x: 1700, y: 2000 } });
  const sp = applyScenario(p, s).plan;
  const drawn = Object.keys(sp.walls).find((id) => sp.walls[id]!.drawn)!;
  step({ op: 'addOpening', wall: drawn, kind: 'opening', center: 1000 });
  const o = Object.keys(applyScenario(p, s).plan.openings).find((id) => !p.openings[id])!;
  step({ op: 'modifyOpening', opening: o, patch: { width: 700 } });
  return {
    id: 'p1',
    name: 'Home',
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T01:00:00Z',
    existingPlan: p,
    scenarios: [s]
  };
}

const v1 = () => JSON.parse(readFileSync(new URL('./fixtures/v1.renoplan.json', import.meta.url), 'utf8'));

describe('document', () => {
  test('round-trips through a file', () => {
    const project = sample();
    const r = parse(serialize(project));
    expect(r).toEqual({ ok: true, project });
  });

  test('carries the format and version', () => {
    const doc = JSON.parse(serialize(sample()));
    expect(doc.format).toBe(FORMAT);
    expect(doc.version).toBe(VERSION);
  });

  test.each([
    ['not JSON', 'hello'],
    ['another format', JSON.stringify({ format: 'other', version: 1 })],
    ['no version', JSON.stringify({ format: FORMAT })],
    ['a newer version', JSON.stringify({ format: FORMAT, version: 99 })]
  ])('rejects %s', (_, text) => {
    expect(parse(text).ok).toBe(false);
  });

  test('rejects a damaged plan', () => {
    const doc = JSON.parse(serialize(sample()));
    doc.project.existingPlan.walls.w5.thickness = 'thick';
    expect(fromDocument(doc).ok).toBe(false);
  });

  test('rejects a plan whose walls point at missing nodes', () => {
    const doc = JSON.parse(serialize(sample()));
    doc.project.existingPlan.nodes = {};
    const r = fromDocument(doc);
    expect(r.ok).toBe(false);
  });

  test('stores Scenarios as their Changes and replays them the same after reopening', () => {
    const project = sample();
    const r = parse(serialize(project));
    if (!r.ok) throw new Error(r.error);
    const [s] = r.project.scenarios;
    expect(s!.changes.map((c) => c.op)).toEqual(['renameRoom', 'drawWall', 'addOpening', 'modifyOpening']);
    expect(s!.changes[3]).toMatchObject({ opening: { created: s!.changes[2]!.id } });
    const before = applyScenario(project.existingPlan, project.scenarios[0]!);
    const after = applyScenario(r.project.existingPlan, s!);
    expect(after.conflicts).toEqual([]);
    expect(after.plan).toEqual(before.plan);
  });

  test.each([
    ['an unknown Change', 0, (c: Record<string, unknown>) => (c.op = 'teleportWall')],
    ['a Change without its target', 0, (c: Record<string, unknown>) => delete c.room],
    ['a fractional coordinate', 1, (c: Record<string, unknown>) => ((c.a as { x: number }).x = 1.5)]
  ])('rejects a Scenario with %s', (_, i, damage) => {
    const doc = JSON.parse(serialize(sample()));
    damage(doc.project.scenarios[0].changes[i]);
    expect(fromDocument(doc).ok).toBe(false);
  });

  test('rejects Scenarios with clashing ids', () => {
    const doc = JSON.parse(serialize(sample()));
    doc.project.scenarios.push(doc.project.scenarios[0]);
    expect(fromDocument(doc)).toMatchObject({ ok: false, error: expect.stringContaining('appears twice') });
    const again = JSON.parse(serialize(sample()));
    again.project.scenarios[0].nextId = 2;
    expect(fromDocument(again)).toMatchObject({ ok: false, error: expect.stringContaining('nextId') });
  });

  test('normalizes a hand-edited plan', () => {
    const doc = JSON.parse(serialize(sample()));
    const p = doc.project.existingPlan;
    // A duplicate node at the same point is merged back.
    const first = Object.keys(p.nodes)[0]!;
    p.nodes.n999 = { ...p.nodes[first] };
    const r = fromDocument(doc);
    expect(r.ok).toBe(true);
  });
});

describe('v1 documents', () => {
  test('open, migrated to the current version', () => {
    const doc = v1();
    expect(doc.version).toBe(1);
    const r = fromDocument(doc);
    if (!r.ok) throw new Error(r.error);
    expect(r.project.scenarios).toEqual([]);
    expect(Object.values(r.project.existingPlan.walls).every((w) => w.drawn === false)).toBe(true);
    expect(checkPlan(r.project.existingPlan)).toEqual([]);
    expect(Object.keys(r.project.existingPlan.walls).sort()).toEqual(
      Object.keys(doc.project.existingPlan.walls).sort()
    );
    expect(r.project.existingPlan.rooms).toEqual(doc.project.existingPlan.rooms);
  });

  test('save as the current version and reopen unchanged', () => {
    const r = fromDocument(v1());
    if (!r.ok) throw new Error(r.error);
    const saved = JSON.parse(serialize(r.project));
    expect(saved.version).toBe(VERSION);
    expect(fromDocument(saved)).toEqual(r);
  });

  test('can take a Scenario straight away', () => {
    const r = fromDocument(v1());
    if (!r.ok) throw new Error(r.error);
    const p = r.project.existingPlan;
    const shared = Object.keys(p.walls).find((id) => p.walls[id]!.neg && p.walls[id]!.pos)!;
    const rec = recordChange(p, emptyScenario('s1', 'Open plan'), { op: 'demolishWall', wall: shared });
    expect(rec).not.toBeNull();
    const out = applyScenario(p, rec!.scenario);
    expect(out.conflicts).toEqual([]);
    expect(Object.keys(out.plan.rooms)).toHaveLength(Object.keys(p.rooms).length - 1);
  });

  test('are still damaged if they were damaged', () => {
    const doc = v1();
    doc.project.existingPlan.walls = 'none';
    expect(fromDocument(doc).ok).toBe(false);
    const bare = v1();
    delete bare.project;
    expect(fromDocument(bare).ok).toBe(false);
  });
});

describe('webStore', () => {
  test('saves, lists newest first, loads and removes', () => {
    const store = webStore(memoryStorage());
    const a = sample();
    const b = { ...sample(), id: 'p2', name: 'Cabin', updatedAt: '2026-10-15T00:00:00Z' };
    store.save(a);
    store.save(b);
    expect(store.list().map((p) => p.name)).toEqual(['Cabin', 'Home']);
    expect(store.load('p1')).toEqual(a);
    store.remove('p1');
    expect(store.list().map((p) => p.id)).toEqual(['p2']);
    expect(store.load('p1')).toBeNull();
  });

  test('reads damaged storage as missing', () => {
    const s = memoryStorage();
    s.setItem('renoplan:projects', '{oops');
    s.setItem('renoplan:project:x', '{oops');
    const store = webStore(s);
    expect(store.list()).toEqual([]);
    expect(store.load('x')).toBeNull();
  });
});
