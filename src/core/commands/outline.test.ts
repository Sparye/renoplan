import { describe, expect, test } from 'vitest';
import { derive } from '../derive';
import { emptyPlan } from '../plan';
import { size, valid } from '../test/helpers';
import { addOutline, addWing, setOutlineSize } from './outline';
import { addRoom } from './rooms';

describe('Outline', () => {
  test('is four exterior walls measured outside', () => {
    const p = valid(addOutline(emptyPlan(), 12400, 9200));
    const D = derive(p);
    expect(D.outline!.bounds).toEqual({ x0: 0, y0: 0, x1: 12400, y1: 9200 });
    expect(D.unlabelled).toHaveLength(1);
    expect(D.unlabelled[0]!.area).toBe(12000 * 8800);
    expect(D.footprint.area).toBe(12400 * 9200);
  });

  test('only one Outline', () => {
    const p = addOutline(emptyPlan(), 10000, 8000);
    expect(addOutline(p, 5000, 5000)).toBe(p);
  });

  test('a wing makes an L-shape and removes the walls between them', () => {
    const p = valid(addWing(addOutline(emptyPlan(), 10000, 8000), 'right', 4000, 3000));
    const D = derive(p);
    expect(D.outline!.bounds).toEqual({ x0: 0, y0: 0, x1: 14000, y1: 8000 });
    expect(D.footprint.area).toBe(10000 * 8000 + 4000 * 3000);
    expect(Object.values(p.walls).filter((w) => w.exterior)).toHaveLength(6);
    expect(D.unlabelled).toHaveLength(1);
  });

  test('a wing next to a Room against that wall gives the Room its own wall', () => {
    let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
    const a = addRoom(p, { name: 'A', w: 3000, l: 2000, x: 6800, y: 200 });
    p = valid(addWing(a.plan, 'right', 4000, 3000));
    expect(size(p, a.id!)).toEqual([3000, 2000]);
  });

  test('editing the size moves the right and bottom walls', () => {
    const p = valid(setOutlineSize(addOutline(emptyPlan(), 10000, 8000), 11000, 7000));
    expect(derive(p).outline!.bounds).toEqual({ x0: 0, y0: 0, x1: 11000, y1: 7000 });
  });
});
