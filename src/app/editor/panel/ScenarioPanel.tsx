import { Minus, Pencil, Plus, X } from 'lucide-react';
import {
  type Applied,
  type Change,
  type Conflict,
  type Plan,
  type Scenario,
  type Target,
  changeKind,
  derive,
  formatArea,
  formatMetres
} from '@/core';
import { Button } from '@/app/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip';
import { cn } from '@/app/lib/utils';
import { useEditorStore } from '../context';
import { activeApplied, activeScenario } from '../store';
import { Hint, Section } from './fields';

const CONFLICT: Record<Conflict['reason'], string> = {
  vanished: 'What it changed is no longer in the existing plan.',
  ambiguous: 'The wall moved in the existing plan, and more than one wall could be it.',
  rejected: 'It no longer changes anything, or it would leave a room open.'
};

/** What the panel shows in a Scenario with nothing selected: what it changes, and its Conflicts. */
export function ScenarioPanel() {
  const useEditor = useEditorStore();
  const scenario = useEditor(activeScenario);
  const result = useEditor(activeApplied);
  const existing = useEditor((s) => s.history.present);
  const removeChange = useEditor((s) => s.removeChange);
  if (!scenario || !result) return null;
  const conflicts = new Map(result.conflicts.map((c) => [c.change, c.reason]));
  const name = names(existing, scenario);

  return (
    <>
      <Summary existing={existing} result={result} />
      <Section title="Changes" hint={`${scenario.changes.length}`}>
        {scenario.changes.length ? (
          <ol className="-mx-2 space-y-0.5">
            {scenario.changes.map((c) => {
              const kind = changeKind(c);
              const reason = conflicts.get(c.id);
              const Icon = kind === 'demolished' ? Minus : kind === 'new' ? Plus : Pencil;
              return (
                <li
                  key={c.id}
                  className={cn(
                    'group flex items-start gap-2 rounded-md px-2 py-1 text-sm',
                    reason && 'bg-amber-50'
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      kind === 'demolished'
                        ? 'text-red-600'
                        : kind === 'new'
                          ? 'text-emerald-600'
                          : 'text-sky-700'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn(reason && 'text-muted-foreground line-through')}>{describe(c, name)}</p>
                    {reason && <p className="text-xs text-amber-700">Conflict: {CONFLICT[reason]}</p>}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Remove change: ${describe(c, name)}`}
                        onClick={() => removeChange(c.id)}
                      >
                        <X />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove this change</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ol>
        ) : (
          <Hint>
            No changes yet. Edit the plan as you would the existing one; every edit is recorded here.
          </Hint>
        )}
        {result.conflicts.length > 0 && (
          <Hint>
            Conflicts come from editing the existing plan after this scenario was made. They are skipped;
            remove them, or redo the change.
          </Hint>
        )}
      </Section>
      <Section title="Gestures">
        <ul className="text-muted-foreground space-y-1 text-xs leading-relaxed">
          <li>
            <b className="text-foreground">Drag a wall</b> — move it
          </li>
          <li>
            <b className="text-foreground">Click a wall</b> — add a door or window, or demolish it (Delete)
          </li>
          <li>
            <b className="text-foreground">Draw wall</b> (W) — drag to draw a new wall; Esc to stop
          </li>
          <li>
            <b className="text-foreground">Click unlabelled space</b> — name it as a room
          </li>
          <li>⌘Z / ⇧⌘Z undo/redo this scenario · Esc</li>
        </ul>
      </Section>
    </>
  );
}

function Summary({ existing, result }: { existing: Plan; result: Applied }) {
  const area = (p: Plan) => Object.values(derive(p).rooms).reduce((s, r) => s + r.area, 0);
  const delta = area(result.plan) - area(existing);
  const length = (ss: { t0: number; t1: number }[]) => ss.reduce((s, x) => s + x.t1 - x.t0, 0);
  const demolished = Object.entries(result.statuses.demolished).filter(([, ss]) => length(ss) > 0);
  const gone = demolished.reduce((s, [, ss]) => s + length(ss), 0);
  const structural = demolished.filter(([id]) => existing.walls[id]?.structural).length;
  const built = Object.values(result.statuses.walls)
    .flat()
    .filter((s) => s.status === 'new');
  return (
    <Section title="This scenario">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Room area</dt>
        <dd className="tabular-nums">
          {formatArea(area(result.plan))} m²
          {formatArea(Math.abs(delta)) !== formatArea(0) && (
            <span className="text-muted-foreground">
              {' '}
              ({delta > 0 ? '+' : '−'}
              {formatArea(Math.abs(delta))})
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Walls demolished</dt>
        <dd className="tabular-nums">
          {demolished.length}
          {gone > 0 && <span className="text-muted-foreground"> ({formatMetres(gone)} m)</span>}
        </dd>
        <dt className="text-muted-foreground">New walls</dt>
        <dd className="tabular-nums">{formatMetres(length(built))} m</dd>
      </dl>
      {structural > 0 && (
        <p className="text-xs text-amber-700">
          Demolishes {structural} wall{structural === 1 ? '' : 's'} marked structural.
        </p>
      )}
    </Section>
  );
}

/** Names Rooms by Target: Existing Plan Rooms by name, Rooms the Scenario made by the name it gave them. */
function names(existing: Plan, s: Scenario) {
  const made = new Map(s.changes.flatMap((c) => (c.op === 'nameSpace' ? [[c.id, c.name] as const] : [])));
  return (t: Target | null): string | null =>
    t === null
      ? null
      : typeof t === 'string'
        ? (existing.rooms[t]?.name ?? null)
        : (made.get(t.created) ?? null);
}

function describe(c: Change, name: (t: Target | null) => string | null): string {
  const between = (neg: Target | null, pos: Target | null) => {
    const rooms = [name(neg), name(pos)].filter((n): n is string => !!n);
    return rooms.length === 2
      ? ` between ${rooms[0]} and ${rooms[1]}`
      : rooms.length
        ? ` of ${rooms[0]}`
        : '';
  };
  const OPENING = { door: 'door', window: 'window', opening: 'opening' };
  switch (c.op) {
    case 'demolishWall':
      return `Demolished the wall${between(c.wall.neg, c.wall.pos)}`;
    case 'drawWall':
      return `New wall, ${formatMetres(Math.abs(c.b.x - c.a.x) + Math.abs(c.b.y - c.a.y))} m`;
    case 'pushWall':
      return `Moved the wall${between(c.wall.neg, c.wall.pos)} ${Math.abs(c.delta)} mm`;
    case 'setThickness':
      return `Made the wall${between(c.wall.neg, c.wall.pos)} ${c.thickness} mm thick`;
    case 'addOpening':
      return `New ${OPENING[c.kind]} in the wall${between(c.wall.neg, c.wall.pos)}`;
    case 'removeOpening':
      return 'Removed an opening';
    case 'modifyOpening':
      return c.patch.kind ? `Changed an opening to a ${OPENING[c.patch.kind]}` : 'Changed an opening';
    case 'nameSpace':
      return `New room: ${c.name}`;
    case 'renameRoom':
      return `Renamed ${name(c.room) ?? 'a room'} to ${c.name}`;
    case 'setRoomType':
      return `Made ${name(c.room) ?? 'a room'} a ${c.type}`;
  }
}
