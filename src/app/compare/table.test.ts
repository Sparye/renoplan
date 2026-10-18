import { expect, test } from 'vitest';
import {
  type Plan,
  addOutline,
  addRoom,
  applyScenario,
  emptyPlan,
  emptyScenario,
  recordChange,
  setStructural
} from '@/core';
import { comparisonTable } from './table';

/** Outline 10 × 8 m; Kitchen and Dining side by side sharing a Wall at x = 4250. */
function house() {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const k = addRoom(p, { name: 'Kitchen', w: 4000, l: 3800, x: 200, y: 200 });
  const d = addRoom(k.plan, { name: 'Dining', w: 3000, l: 3800, x: 4300, y: 200 });
  p = d.plan;
  const shared = Object.keys(p.walls).find((w) => p.walls[w]!.neg === k.id && p.walls[w]!.pos === d.id)!;
  return { p, shared };
}

const demolished = (p: Plan, wall: string) =>
  applyScenario(p, recordChange(p, emptyScenario('s1', 'Open plan'), { op: 'demolishWall', wall })!.scenario);

test('the Existing Plan against a Scenario that merges two Rooms', () => {
  const { p, shared } = house();
  const t = comparisonTable(
    p,
    { name: 'Existing plan', side: null },
    { name: 'Open plan', side: demolished(p, shared) }
  );
  expect(t.columns).toEqual(['Room', 'Existing plan', 'Open plan']);
  expect(t.rows.map((r) => r.cells)).toEqual([
    ['Kitchen', '15.2 m²', '27.0 m²'],
    ['Dining', '11.4 m²', 'Merged into Kitchen'],
    ['Room area', '26.6 m²', '27.0 m²'],
    ['Walls demolished', '0', '1 · 3.95 m'],
    ['Structural walls touched', '0', '0'],
    ['New walls', '0.00 m', '0.00 m'],
    ['Extension area', '0.0 m²', '0.0 m²']
  ]);
  expect(t.rows.every((r) => r.warn.every((w) => !w))).toBe(true);
});

test('a structural Wall touched is a warning', () => {
  const h = house();
  const p = setStructural(h.p, h.shared, true);
  const t = comparisonTable(
    p,
    { name: 'Existing plan', side: null },
    { name: 'Open plan', side: demolished(p, h.shared) }
  );
  const row = t.rows.find((r) => r.cells[0] === 'Structural walls touched')!;
  expect(row.cells).toEqual(['Structural walls touched', '0', '1 · 3.95 m']);
  expect(row.warn).toEqual([false, false, true]);
});
