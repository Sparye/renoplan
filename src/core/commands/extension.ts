import { derive } from '../derive';
import { rectsArea } from '../grid';
import { type Plan, type RoomId, clonePlan, otherSide, sideOf } from '../plan';
import type { Mm } from '../units';
import { isSound } from '../invariants';
import { normalize } from '../normalize';

// Extensions (ADR 0012): in a Scenario, a Room made outside the Outline joins it, the way a wing does in
// capture. Capture never calls these.

/**
 * Takes a Room lying wholly outside the Outline into it. The Room's own Walls become exterior, and drawn,
 * which marks them as an Extension's (they move when pushed); the stretch of Outline the Room is against
 * stays standing as an interior Wall between it and the house, so demolishing it merges the two. A no-op
 * without an Outline, for a Room touching the floor inside it, or if the Outline would not close around
 * both.
 */
export function annexRoom(p: Plan, room: RoomId): Plan {
  const D = derive(p);
  if (!D.outline || !D.parked.includes(room)) return p;
  const d = clonePlan(p);
  for (const w of Object.values(d.walls)) {
    const side = sideOf(w, room);
    if (!side) continue;
    if (w.exterior) w.exterior = false;
    else if (!w[otherSide(side)]) {
      w.exterior = true;
      w.drawn = true;
    }
  }
  // Declining is not the soundness backstop at work (ADR 0009): a Room that can't join stays a New Room.
  normalize(d);
  if (!isSound(d)) return p;
  const inside = (x: Plan) => rectsArea(derive(x).outline?.inside ?? []);
  // The Outline now encloses the house and the Room, not some loop of Walls around one of them.
  if (derive(d).parked.includes(room) || inside(d) < inside(p) + (D.rooms[room]?.area ?? 0)) return p;
  return d;
}

/**
 * The thickness Draw Room gives its Walls: an exterior Wall's outside the Outline, where it makes an
 * Extension, else an interior Wall's.
 */
export function drawRoomThickness(p: Plan, r: { x0: Mm; y0: Mm; x1: Mm; y1: Mm }): Mm {
  const D = derive(p);
  const outside = D.outline && !D.insideOutline((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
  return outside ? p.defaults.exterior : p.defaults.interior;
}
