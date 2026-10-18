import { useState } from 'react';
import {
  ROOM_TYPES,
  type RoomId,
  type RoomType,
  deleteRoom,
  derive,
  formatArea,
  formatMetres,
  setRoomSize
} from '@/core';
import { Button } from '@/app/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { useActions, useEditorStore } from '../context';
import { activeApplied, currentPlan } from '../store';
import { TINT } from '../drawing';
import { Hint, LengthField, NameCombobox, Section } from './fields';

export function RoomPanel({ id }: { id: RoomId }) {
  const useEditor = useEditorStore();
  const act = useActions();
  const plan = useEditor(currentPlan);
  const scenario = useEditor((s) => s.mode.kind === 'scenario');
  const isNew = useEditor((s) => activeApplied(s)?.statuses.rooms[id] === 'new');
  const commit = useEditor((s) => s.commit);
  const room = plan.rooms[id]!;
  const D = derive(plan);
  const g = D.rooms[id]!;
  // What the user is typing; null when not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const b = g.bounds;
  const W = b ? b.x1 - b.x0 : 0;
  const L = b ? b.y1 - b.y0 : 0;
  const overlapping = D.overlaps.some((r) =>
    g.rects.some(
      (q) => Math.min(r.x1, q.x1) > Math.max(r.x0, q.x0) && Math.min(r.y1, q.y1) > Math.max(r.y0, q.y0)
    )
  );

  return (
    <Section title="Room" hint={`${formatArea(g.area)} m²`}>
      <NameCombobox
        aria-label="Name"
        value={draft ?? room.name}
        onChange={setDraft}
        onBlur={() => {
          if (draft !== null) act.renameRoom(id, draft);
          setDraft(null);
        }}
        onEnter={() => {
          if (draft !== null) act.renameRoom(id, draft);
          setDraft(null);
        }}
      />
      <Select value={room.type} onValueChange={(t) => act.setRoomType(id, t as RoomType)}>
        <SelectTrigger size="sm" className="w-full" aria-label="Room type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROOM_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              <span className="inline-block size-3 rounded-sm border" style={{ background: TINT[t] }} />
              {t[0]!.toUpperCase() + t.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scenario ? (
        <>
          {g.rectangular && b && (
            <p className="text-sm tabular-nums">
              {formatMetres(W)} × {formatMetres(L)} m
            </p>
          )}
          <Hint>
            {isNew ? 'New in this scenario. ' : ''}In a scenario, rooms change by pushing, demolishing and
            drawing walls.
          </Hint>
        </>
      ) : g.rectangular ? (
        <>
          <div className="flex items-center gap-2">
            <LengthField label="W" value={W} onCommit={(v) => commit(setRoomSize(plan, id, v, L))} />
            <span className="text-muted-foreground text-xs">×</span>
            <LengthField label="L" value={L} onCommit={(v) => commit(setRoomSize(plan, id, W, v))} />
          </div>
          <Hint>Inside dimensions. W grows to the right, L grows downward; neighbours stay put.</Hint>
        </>
      ) : (
        <Hint>An irregular room. Push or pull its walls to adjust it.</Hint>
      )}
      {D.parked.includes(id) && (
        <p className="text-muted-foreground text-xs">Not placed yet — drag it into the outline.</p>
      )}
      {D.crossing.includes(id) && <p className="text-destructive text-xs">Crosses the outline.</p>}
      {overlapping && <p className="text-destructive text-xs">Overlaps another room.</p>}
      {!scenario && (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => commit(deleteRoom(plan, id), null)}
        >
          Delete room
        </Button>
      )}
    </Section>
  );
}
