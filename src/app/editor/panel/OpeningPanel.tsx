import { OPENING_PRESETS, type OpeningId, type OpeningKind, deleteOpening, updateOpening } from '@/core';
import { Button } from '@/app/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/app/components/ui/toggle-group';
import { useEditorStore } from '../context';
import { Hint, LengthField, Section } from './fields';

const NAMES: Record<OpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Opening' };

export function OpeningPanel({ id }: { id: OpeningId }) {
  const useEditor = useEditorStore();
  const plan = useEditor((s) => s.history.present);
  const commit = useEditor((s) => s.commit);
  const o = plan.openings[id]!;
  return (
    <Section title={NAMES[o.kind]} hint={`${o.width} mm`}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={o.kind}
        onValueChange={(k) => k && commit(updateOpening(plan, id, { kind: k as OpeningKind }))}
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
          onValueChange={(w) => w && commit(updateOpening(plan, id, { width: Number(w) }))}
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
          onCommit={(width) => commit(updateOpening(plan, id, { width }))}
        />
      </div>
      {o.kind === 'door' && (
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => commit(updateOpening(plan, id, { swing: o.swing === 'neg' ? 'pos' : 'neg' }))}
          >
            Flip side
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => commit(updateOpening(plan, id, { hinge: o.hinge === 'start' ? 'end' : 'start' }))}
          >
            Flip hinge
          </Button>
        </div>
      )}
      <Hint>Drag it along the wall. The blue numbers are the distances to the corners.</Hint>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => commit(deleteOpening(plan, id), null)}
      >
        Delete {NAMES[o.kind].toLowerCase()}
      </Button>
    </Section>
  );
}
