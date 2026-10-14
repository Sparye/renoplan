import { type FormEvent, useState } from 'react';
import { derive, formatArea, nameSpace } from '@/core';
import { Button } from '@/app/components/ui/button';
import { useEditorStore } from '../context';
import { Hint, NameCombobox, Section } from './fields';

export function SpacePanel({ x, y }: { x: number; y: number }) {
  const useEditor = useEditorStore();
  const plan = useEditor((s) => s.history.present);
  const commit = useEditor((s) => s.commit);
  const [name, setName] = useState('Hallway');
  const space = derive(plan).unlabelled[derive(plan).spaceAt(x, y)];
  if (!space) return null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const r = nameSpace(plan, x, y, name);
    if (r.id) commit(r.plan, { kind: 'room', id: r.id });
  };
  return (
    <Section title="Unlabelled space" hint={`${formatArea(space.area)} m²`}>
      <Hint>Space no room claims — often a hallway or cupboard nobody measured.</Hint>
      <form className="flex gap-1.5" onSubmit={submit}>
        <NameCombobox
          className="flex-1"
          aria-label="Name"
          value={name}
          onChange={setName}
          onEnter={() => submit()}
        />
        <Button type="submit" size="sm">
          Make it a room
        </Button>
      </form>
    </Section>
  );
}
