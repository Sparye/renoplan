import { describe, expect, test } from 'vitest';
import { addOpening, addOutline, addRoom, emptyPlan } from '@/core';
import { FORMAT, type Project, VERSION, fromDocument, parse, serialize } from './document';
import { memoryStorage, webStore } from './store';

function sample(): Project {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const a = addRoom(p, { name: 'Bedroom', w: 3000, l: 4000, x: 200, y: 200 });
  p = a.plan;
  const wall = Object.keys(p.walls).find((id) => p.walls[id]!.neg === a.id)!;
  p = addOpening(p, wall, 'door', 2000).plan;
  return {
    id: 'p1',
    name: 'Home',
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T01:00:00Z',
    existingPlan: p
  };
}

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
