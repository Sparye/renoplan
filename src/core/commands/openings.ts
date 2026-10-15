import { usableSpan } from '../graph';
import { type Opening, type OpeningId, type OpeningKind, type Plan, type WallId, mintId } from '../plan';
import type { Mm } from '../units';
import { create, edit } from './edit';

export const OPENING_PRESETS: Record<OpeningKind, readonly Mm[]> = {
  door: [710, 810, 860],
  window: [600, 1200, 1800],
  opening: [900, 1200, 2400]
};

const DEFAULT_WIDTH: Record<OpeningKind, Mm> = { door: 810, window: 1200, opening: 900 };

/** Adds an Opening centred on a point along the Wall. Doors swing into a Room the Wall bounds. */
export function addOpening(
  p: Plan,
  wallId: WallId,
  kind: OpeningKind,
  center: Mm
): { plan: Plan; id: OpeningId | null } {
  const w = p.walls[wallId];
  if (!w) return { plan: p, id: null };
  const [u0, u1] = usableSpan(p, wallId);
  const width = Math.min(DEFAULT_WIDTH[kind], u1 - u0);
  if (width <= 0) return { plan: p, id: null };
  const at = Math.round(Math.min(Math.max(center - width / 2, u0), u1 - width));
  return create(p, (d) => {
    const id = mintId(d, 'o');
    d.openings[id] = {
      wall: wallId,
      kind,
      at,
      width,
      swing: w.neg ? 'neg' : 'pos',
      hinge: 'start'
    };
    return id;
  });
}

/** Slides an Opening along its Wall; it stays on the Wall's clear span. */
export function moveOpening(p: Plan, id: OpeningId, at: Mm): Plan {
  const o = p.openings[id];
  if (!o || Math.round(at) === o.at) return p;
  return edit(p, (d) => {
    d.openings[id]!.at = Math.round(at);
  });
}

export function updateOpening(
  p: Plan,
  id: OpeningId,
  patch: Partial<Pick<Opening, 'kind' | 'width' | 'swing' | 'hinge'>>
): Plan {
  const o = p.openings[id];
  if (!o) return p;
  return edit(p, (d) => {
    const next = { ...o, ...patch };
    // A new width keeps the Opening centred where it was.
    if (patch.width !== undefined) {
      next.width = Math.max(1, Math.round(patch.width));
      next.at = Math.round(o.at + (o.width - next.width) / 2);
    }
    d.openings[id] = next;
  });
}

export function deleteOpening(p: Plan, id: OpeningId): Plan {
  if (!p.openings[id]) return p;
  return edit(p, (d) => {
    delete d.openings[id];
  });
}
