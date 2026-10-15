import { expect, test } from 'vitest';
import { commit, redo, startHistory, undo } from './history';

test('undo and redo walk the snapshots', () => {
  let h = startHistory(1);
  h = commit(h, 2);
  h = commit(h, 3);
  expect(undo(h).present).toBe(2);
  expect(undo(undo(h)).present).toBe(1);
  expect(undo(undo(undo(h))).present).toBe(1);
  expect(redo(undo(undo(h))).present).toBe(2);
  expect(commit(undo(h), 9).future).toEqual([]);
});

test('committing the present leaves no undo step', () => {
  const h = startHistory({});
  expect(commit(h, h.present)).toBe(h);
});
