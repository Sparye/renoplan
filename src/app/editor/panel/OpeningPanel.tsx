import { OPENING_PRESETS, type OpeningId, type OpeningKind, usableSpan } from '@/core';
import { Button } from '@/app/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/app/components/ui/toggle-group';
import { useActions, useEditorStore } from '../context';
import { currentPlan } from '../store';
import { Hint, LengthField, Section } from './fields';

const NAMES: Record<OpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Opening' };

export function OpeningPanel({ id }: { id: OpeningId }) {
  const useEditor = useEditorStore();
  const act = useActions();
  const plan = useEditor(currentPlan);
  const o = plan.openings[id]!;
  const [u0, u1] = usableSpan(plan, o.wall);
  return (
    <Section title={NAMES[o.kind]} hint={`${o.width} mm`}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={o.kind}
        onValueChange={(k) => k && act.updateOpening(id, { kind: k as OpeningKind })}
        aria-label="Kind"
      >
        {(Object.keys(NAMES) as OpeningKind[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="px-3">
            {NAMES[k]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <h3 className="text-muted-foreground text-xs font-medium">Width</h3>
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(o.width)}
          onValueChange={(w) => w && act.updateOpening(id, { width: Number(w) })}
          aria-label="Width preset"
        >
          {OPENING_PRESETS[o.kind].map((w) => (
            <ToggleGroupItem key={w} value={String(w)} className="px-2 tabular-nums">
              {w}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <LengthField
          unit="mm"
          aria-label="Custom width"
          value={o.width}
          onCommit={(width) => act.updateOpening(id, { width })}
        />
      </div>
      <h3 className="text-muted-foreground text-xs font-medium">Position</h3>
      <div className="flex items-center gap-2">
        <LengthField
          aria-label="From the start corner"
          value={o.at - u0}
          onCommit={(d) => act.updateOpening(id, { at: u0 + d })}
        />
        <span className="text-muted-foreground text-xs">from one corner,</span>
        <span className="text-xs tabular-nums">{((u1 - o.at - o.width) / 1000).toFixed(2)} m</span>
        <span className="text-muted-foreground text-xs">to the other</span>
      </div>
      {o.kind === 'door' && (
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => act.updateOpening(id, { swing: o.swing === 'neg' ? 'pos' : 'neg' })}
          >
            Flip side
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => act.updateOpening(id, { hinge: o.hinge === 'start' ? 'end' : 'start' })}
          >
            Flip hinge
          </Button>
        </div>
      )}
      <Hint>Drag it along the wall. The blue numbers are the distances to the corners.</Hint>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => act.removeOpening(id)}>
        Delete {NAMES[o.kind].toLowerCase()}
      </Button>
    </Section>
  );
}
