import {
  type Mm,
  type OpeningKind,
  type WallId,
  derive,
  extensionWall,
  runSides,
  setStructural
} from '@/core';
import { Button } from '@/app/components/ui/button';
import { useActions, useEditorStore } from '../context';
import { currentPlan } from '../store';
import { Hint, LengthField, Section } from './fields';

export function WallPanel({ id, at }: { id: WallId; at: Mm }) {
  const useEditor = useEditorStore();
  const act = useActions();
  const plan = useEditor(currentPlan);
  const scenario = useEditor((s) => s.mode.kind === 'scenario');
  const commit = useEditor((s) => s.commit);
  const D = derive(plan);
  const wall = plan.walls[id]!;
  const { line } = D.walls[id]!;
  const sides = runSides(plan, id);
  const shared = !!(wall.neg && wall.pos);
  const v = line.axis === 'v';
  const dim = v ? 'width' : 'length';
  const [negName, posName] = v ? ['Left', 'Right'] : ['Above', 'Below'];

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
        onCommit={(n) => act.pushWall(id, sign * (n - size(room)), at)}
      />
    </div>
  );
  const add = (kind: OpeningKind) => act.addOpening(id, kind, at);
  // An Extension's outer Wall is being designed, not measured: it moves (ADR 0012).
  const extension = extensionWall(wall);
  const title = extension
    ? 'Extension wall'
    : wall.drawn
      ? 'Drawn wall'
      : sides.exterior
        ? 'Exterior wall'
        : shared
          ? 'Shared wall'
          : 'Wall';

  return (
    <Section title={title} hint={`${wall.thickness} mm`}>
      {sides.neg.length > 0 && <h3 className="text-muted-foreground text-xs font-medium">{negName}</h3>}
      {sides.neg.map((r) => row(r, 1))}
      {sides.pos.length > 0 && <h3 className="text-muted-foreground text-xs font-medium">{posName}</h3>}
      {sides.pos.map((r) => row(r, -1))}
      <Hint>
        {extension
          ? 'Editing a dimension moves this wall: the extension grows or shrinks.'
          : sides.exterior
            ? 'Editing a dimension resizes the room; the outline stays as measured. ⌥-drag moves the outline itself.'
            : 'Editing a dimension moves this wall; rooms on the other side follow.'}
      </Hint>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">Thickness</span>
        <LengthField
          unit="mm"
          aria-label="Thickness"
          value={wall.thickness}
          onCommit={(t) => act.setThickness(id, t)}
        />
      </div>
      {scenario ? (
        wall.structural && (
          <p className="text-xs text-amber-700">
            Marked structural. Demolishing it is flagged; the mark itself is edited in the existing plan.
          </p>
        )
      ) : (
        <>
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
        </>
      )}
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
      {scenario ? (
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => act.removeWall(id)}>
          {shared ? 'Demolish wall — merge rooms' : 'Demolish wall'}
        </Button>
      ) : (
        shared &&
        !wall.exterior && (
          <Button variant="outline" size="sm" onClick={() => act.removeWall(id)}>
            Remove wall — merge rooms
          </Button>
        )
      )}
    </Section>
  );
}
