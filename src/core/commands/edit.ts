import { isSound } from '../invariants';
import { normalize } from '../normalize';
import { type Plan, clonePlan } from '../plan';

/**
 * Brings a draft into normal form. A command never makes a sound plan unsound: if the result would leave
 * a Room enclosing nothing, a broken Outline, or a claim off its Room, the command is a no-op instead.
 */
export function finish(base: Plan, draft: Plan): Plan {
  normalize(draft);
  if (isSound(draft) || !isSound(base)) return draft;
  rejections.count++;
  return base;
}

/** How many commands the soundness check has turned into no-ops; the tests keep an eye on it. */
export const rejections = { count: 0 };

/** Runs a mutation on a copy of the plan and finishes it. If the mutation returns false it was a no-op. */
export function edit(p: Plan, f: (draft: Plan) => void | boolean): Plan {
  const d = clonePlan(p);
  if (f(d) === false) return p;
  return finish(p, d);
}

/** Like edit, for commands that create something and report its id. */
export function create(p: Plan, f: (draft: Plan) => string | null): { plan: Plan; id: string | null } {
  const d = clonePlan(p);
  const id = f(d);
  if (id === null) return { plan: p, id: null };
  const plan = finish(p, d);
  return plan === p ? { plan: p, id: null } : { plan, id };
}
