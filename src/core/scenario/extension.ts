import { derive } from '../derive';
import { Grid, type Rect } from '../grid';
import type { Plan } from '../plan';

/**
 * Extension (CONTEXT.md): the floor of a plan's Footprint outside the Existing Plan's Footprint, as
 * rectangles. Empty for the Existing Plan itself, and for a Scenario that stays inside it.
 */
export function extensionOf(existing: Plan, plan: Plan): Rect[] {
  if (plan === existing) return [];
  const mine = derive(plan).footprint.rects;
  const theirs = derive(existing).footprint.rects;
  if (!mine.length) return [];
  const g = new Grid([...mine, ...theirs]);
  const a = g.mask(mine);
  const b = g.mask(theirs);
  return g.rects((c) => a[c] === 1 && b[c] === 0);
}
