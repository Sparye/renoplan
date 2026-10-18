import { type FormEvent, useState } from 'react';
import { derive, formatArea } from '@/core';
import { Button } from '@/app/components/ui/button';
import { useActions, useEditorStore } from '../context';
import { currentPlan } from '../store';
import { Hint, NameCombobox, Section } from './fields';

export function SpacePanel({ x, y }: { x: number; y: number }) {
  const useEditor = useEditorStore();
  const act = useActions();
  const plan = useEditor(currentPlan);
  const scenario = useEditor((s) => s.mode.kind === 'scenario');
  const [name, setName] = useState('Hallway');
  const space = derive(plan).unlabelled[derive(plan).spaceAt(x, y)];
  if (!space) return null;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    act.nameSpace(x, y, name);
  };
  return (
    <Section title="Unlabelled space" hint={`${formatArea(space.area)} m²`}>
      <Hint>
        {scenario
          ? 'Make all of it a room here, or use Draw room (R) to make a room of just part of it.'
          : 'Space no room claims — often a hallway or cupboard nobody measured.'}
      </Hint>
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
