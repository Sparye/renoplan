import { useEditorStore } from '../context';
import { AddRoomForm } from './AddRoomForm';
import { OpeningPanel } from './OpeningPanel';
import { PlanPanel } from './PlanPanel';
import { RoomPanel } from './RoomPanel';
import { SpacePanel } from './SpacePanel';
import { WallPanel } from './WallPanel';

export function SidePanel() {
  const useEditor = useEditorStore();
  const selection = useEditor((s) => s.selection);
  const plan = useEditor((s) => s.history.present);
  let body = <PlanPanel />;
  if (selection?.kind === 'room' && plan.rooms[selection.id])
    body = <RoomPanel key={selection.id} id={selection.id} />;
  else if (selection?.kind === 'wall' && plan.walls[selection.id])
    body = <WallPanel key={selection.id} id={selection.id} at={selection.at} />;
  else if (selection?.kind === 'opening' && plan.openings[selection.id])
    body = <OpeningPanel key={selection.id} id={selection.id} />;
  else if (selection?.kind === 'space')
    body = <SpacePanel key={`${selection.x},${selection.y}`} x={selection.x} y={selection.y} />;
  return (
    <aside
      className="bg-background relative z-10 flex w-80 shrink-0 flex-col overflow-y-auto border-l"
      aria-label="Side panel"
    >
      <AddRoomForm />
      {body}
    </aside>
  );
}
