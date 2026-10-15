import {
  type Mm,
  type OpeningKind,
  type WallId,
  addOpening,
  derive,
  mergeRooms,
  pushWall,
  runSides,
  setStructural,
  setWallThickness,
  wallAtPoint,
  point
} from '@/core';
import { Button } from '@/app/components/ui/button';
import { useEditorStore } from '../context';
import { Hint, LengthField, Section } from './fields';

export function WallPanel({ id, at }: { id: WallId; at: Mm }) {
  const useEditor = useEditorStore();
  const plan = useEditor((s) => s.history.present);
  const commit = useEditor((s) => s.commit);
  const D = derive(plan);
  const wall = plan.walls[id]!;
  const { line } = D.walls[id]!;
  const sides = runSides(plan, id);
  const shared = !!(wall.neg && wall.pos);
  const v = line.axis === 'v';
  const dim = v ? 'width' : 'length';
  const [negName, posName] = v ? ['Left', 'Right'] : ['Above', 'Below'];

  /** Pushes the Wall and keeps it selected. */
  const push = (delta: Mm) => {
    const next = pushWall(plan, id, delta);
    const q = point(line.axis, at, line.c + delta);
    const nid = wallAtPoint(next, q.x, q.y);
    commit(next, nid ? { kind: 'wall', id: nid, at } : null);
  };
  const size = (room: string) => {
    const b = D.rooms[room]?.bounds;
    return b ? (v ? b.x1 - b.x0 : b.y1 - b.y0) : 0;
  };
  const row = (room: string, sign: 1 | -1) => (
    <div key={room} className="flex items-center justify-between gap-2">
      <span className="truncate text-sm">{plan.rooms[room]!.name}</span>
      <LengthField
        aria-label={`${plan.rooms[room]!.name} ${dim}`}
        value={size(room)}
        onCommit={(n) => push(sign * (n - size(room)))}
      />
    </div>
  );
  const add = (kind: OpeningKind) => {
    const r = addOpening(plan, id, kind, at);
    if (r.id) commit(r.plan, { kind: 'opening', id: r.id });
  };

  return (
    <Section
      title={sides.exterior ? 'Exterior wall' : shared ? 'Shared wall' : 'Wall'}
      hint={`${wall.thickness} mm`}
    >
      {sides.neg.length > 0 && <h3 className="text-muted-foreground text-xs font-medium">{negName}</h3>}
      {sides.neg.map((r) => row(r, 1))}
      {sides.pos.length > 0 && <h3 className="text-muted-foreground text-xs font-medium">{posName}</h3>}
      {sides.pos.map((r) => row(r, -1))}
      <Hint>
        {sides.exterior
          ? 'Editing a dimension resizes the room; the outline stays as measured. ⌥-drag moves the outline itself.'
          : 'Editing a dimension moves this wall; rooms on the other side follow.'}
      </Hint>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">Thickness</span>
        <LengthField
          unit="mm"
          aria-label="Thickness"
          value={wall.thickness}
          onCommit={(t) => commit(setWallThickness(plan, id, t))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-foreground size-4"
          checked={wall.structural}
          onChange={(e) => commit(setStructural(plan, id, e.target.checked))}
        />
        Structural mark
      </label>
      <Hint>Your belief that this wall is load-bearing — a note, not an engineering assessment.</Hint>
      <h3 className="text-muted-foreground text-xs font-medium">Add at the click point</h3>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={() => add('door')}>
          Door
        </Button>
        <Button variant="outline" size="sm" onClick={() => add('window')}>
          Window
        </Button>
        <Button variant="outline" size="sm" onClick={() => add('opening')}>
          Opening
        </Button>
      </div>
      {shared && !wall.exterior && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const m = mergeRooms(plan, id);
            if (m.id) commit(m.plan, { kind: 'room', id: m.id });
          }}
        >
          Remove wall — merge rooms
        </Button>
      )}
    </Section>
  );
}
