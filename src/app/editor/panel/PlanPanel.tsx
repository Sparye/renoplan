import { type FormEvent, useState } from 'react';
import { type WingSide, addOutline, addWing, derive, formatArea, parseLength, setOutlineSize } from '@/core';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { useEditorStore } from '../context';
import { TINT } from '../drawing';
import { Hint, LengthField, Section } from './fields';

/** What the panel shows with nothing selected: the Outline, the Rooms, and how to work the canvas. */
export function PlanPanel() {
  const useEditor = useEditorStore();
  const plan = useEditor((s) => s.history.present);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const D = derive(plan);
  const o = D.outline?.bounds;
  const rooms = Object.entries(plan.rooms);
  const placed = rooms.filter(([id]) => !D.parked.includes(id)).length;
  const unlabelled = D.unlabelled.reduce((s, u) => s + u.area, 0);

  return (
    <>
      <Section title="Outline" hint="outside dimensions">
        {o ? (
          <>
            <div className="flex items-center gap-2">
              <LengthField
                label="W"
                value={o.x1 - o.x0}
                onCommit={(w) => commit(setOutlineSize(plan, w, o.y1 - o.y0))}
              />
              <span className="text-muted-foreground text-xs">×</span>
              <LengthField
                label="L"
                value={o.y1 - o.y0}
                onCommit={(l) => commit(setOutlineSize(plan, o.x1 - o.x0, l))}
              />
            </div>
            <WingForm />
            <Hint>
              The outline stays as measured: dragging an exterior wall resizes the rooms against it. ⌥-drag
              moves the outline itself.
            </Hint>
          </>
        ) : (
          <OutlineForm onAdd={(w, l) => commit(addOutline(plan, w, l))} />
        )}
      </Section>
      <Section title="Rooms" hint={`${placed} of ${rooms.length} placed`}>
        {rooms.length ? (
          <ul className="-mx-2 space-y-0.5">
            {rooms.map(([id, r]) => (
              <li key={id}>
                <button
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
                  onClick={() => select({ kind: 'room', id })}
                >
                  <i className="size-3 shrink-0 rounded-sm border" style={{ background: TINT[r.type] }} />
                  <span className="flex-1 truncate">{r.name}</span>
                  <small className="text-muted-foreground tabular-nums">
                    {formatArea(D.rooms[id]!.area)} m²
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Hint>No rooms yet. Add each room's inside dimensions above.</Hint>
        )}
        {D.unlabelled.length > 0 && (
          <Hint>
            Unlabelled space: {formatArea(unlabelled)} m² in {D.unlabelled.length} area
            {D.unlabelled.length > 1 ? 's' : ''}. Click one to name it.
          </Hint>
        )}
      </Section>
      <Section title="Gestures">
        <ul className="text-muted-foreground space-y-1 text-xs leading-relaxed">
          <li>
            <b className="text-foreground">Drag inside a room</b> — move it
          </li>
          <li>
            <b className="text-foreground">Drag a wall</b> — push/pull it; rooms on both sides follow
          </li>
          <li>
            <b className="text-foreground">Click a wall</b> — add a door or window, or remove it to merge
            rooms
          </li>
          <li>
            <b className="text-foreground">Scroll</b> or space-drag to pan · pinch or ⌘-scroll to zoom
          </li>
          <li>⌘Z / ⇧⌘Z undo/redo · Delete · Esc</li>
        </ul>
      </Section>
    </>
  );
}

function OutlineForm({ onAdd }: { onAdd: (w: number, l: number) => void }) {
  const [w, setW] = useState('');
  const [l, setL] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const W = parseLength(w);
    const L = parseLength(l);
    if (W && L) onAdd(W, L);
  };
  return (
    <form className="flex items-center gap-1.5" onSubmit={submit}>
      <Input
        aria-label="Outline width"
        className="h-8 w-16 px-2"
        placeholder="W"
        value={w}
        onChange={(e) => setW(e.target.value)}
      />
      <span className="text-muted-foreground text-xs">×</span>
      <Input
        aria-label="Outline length"
        className="h-8 w-16 px-2"
        placeholder="L"
        value={l}
        onChange={(e) => setL(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline">
        Add outline
      </Button>
    </form>
  );
}

function WingForm() {
  const useEditor = useEditorStore();
  const [open, setOpen] = useState(false);
  const [w, setW] = useState('4.0');
  const [l, setL] = useState('3.0');
  const [side, setSide] = useState<WingSide>('right');
  const [error, setError] = useState('');
  if (!open)
    return (
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setOpen(true)}>
        + Add a wing (L-shaped house)
      </Button>
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const W = parseLength(w);
    const L = parseLength(l);
    if (!W || !L) return;
    const st = useEditor.getState();
    const next = addWing(st.history.present, side, W, L);
    if (next === st.history.present) return setError('The wing has to share an edge with the outline.');
    st.commit(next);
    st.fit();
    setOpen(false);
  };
  return (
    <form className="space-y-1.5" onSubmit={submit}>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Wing width"
          className="h-8 w-14 px-2"
          value={w}
          onChange={(e) => setW(e.target.value)}
        />
        <span className="text-muted-foreground text-xs">×</span>
        <Input
          aria-label="Wing length"
          className="h-8 w-14 px-2"
          value={l}
          onChange={(e) => setL(e.target.value)}
        />
        <Select value={side} onValueChange={(s) => setSide(s as WingSide)}>
          <SelectTrigger size="sm" aria-label="Wing side">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="right">on the right</SelectItem>
            <SelectItem value="bottom">below</SelectItem>
            <SelectItem value="left">on the left</SelectItem>
            <SelectItem value="top">above</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm">
          Add wing
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </form>
  );
}
