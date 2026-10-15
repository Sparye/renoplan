import { type FormEvent, useRef, useState } from 'react';
import { addRoom, derive, parseLength } from '@/core';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { useEditorStore } from '../context';
import { Hint, NameCombobox } from './fields';

/** Always at the top of the panel, whatever is selected: adding the next Room is never more than a click away. */
export function AddRoomForm() {
  const useEditor = useEditorStore();
  const [name, setName] = useState('');
  const [w, setW] = useState('');
  const [l, setL] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const wRef = useRef<HTMLInputElement>(null);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const W = parseLength(w);
    const L = parseLength(l);
    if (!W || !L) {
      setError('Enter both inside dimensions, e.g. 3.6 × 4.2');
      return;
    }
    const st = useEditor.getState();
    const r = addRoom(st.history.present, { name, w: W, l: L });
    if (!r.id) {
      setError('Rooms are at least 0.3 m each way.');
      return;
    }
    st.commit(r.plan, { kind: 'room', id: r.id });
    const b = derive(r.plan).rooms[r.id]?.bounds;
    if (b) st.reveal(b);
    setName('');
    setW('');
    setL('');
    setError('');
    nameRef.current?.focus();
  };

  return (
    <section className="space-y-2 border-b px-4 py-4">
      <h2 className="flex items-baseline justify-between text-sm font-semibold">
        Add rooms <small className="text-muted-foreground font-normal">inside dimensions</small>
      </h2>
      <form className="flex items-center gap-1.5" onSubmit={submit} aria-label="Add room">
        <NameCombobox
          className="min-w-0 flex-1"
          aria-label="Room name"
          placeholder="Name"
          value={name}
          onChange={setName}
          ref={nameRef}
          onEnter={() => (w && l ? submit() : wRef.current?.focus())}
        />
        <Input
          ref={wRef}
          aria-label="Width"
          className="h-8 w-14 px-2"
          placeholder="W"
          value={w}
          onChange={(e) => setW(e.target.value)}
        />
        <span className="text-muted-foreground text-xs">×</span>
        <Input
          aria-label="Length"
          className="h-8 w-14 px-2"
          placeholder="L"
          value={l}
          onChange={(e) => setL(e.target.value)}
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : (
        <Hint>
          Wall face to wall face, in metres (3.6) or mm (3600). Enter adds it and starts the next. New rooms
          line up beside the outline.
        </Hint>
      )}
    </section>
  );
}
