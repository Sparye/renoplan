import { useEffect, useState } from 'react';
import { deleteOpening, deleteRoom, mergeRooms } from '@/core';
import type { Project } from '@/persistence';
import { projects } from '../projects';
import { Canvas } from './Canvas';
import { EditorContext } from './context';
import { SidePanel } from './panel/SidePanel';
import { StartOverlay } from './StartOverlay';
import { createEditor } from './store';
import { Toolbar } from './Toolbar';

export function Editor({ project }: { project: Project }) {
  const [useEditor] = useState(() => createEditor(project, projects));
  const empty = useEditor((s) => !Object.keys(s.history.present.walls).length && !s.history.past.length);
  const [started, setStarted] = useState(!empty);

  useEffect(() => {
    requestAnimationFrame(() => useEditor.getState().fit());
  }, [useEditor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      const field = (e.target as HTMLElement).closest('input, textarea, select, [role="combobox"]');
      if ((e.target as HTMLElement).closest('[role="dialog"], [role="listbox"]')) return;
      if (field) {
        // Escape leaves a field (it has already reset itself) and clears the selection.
        if (e.key === 'Escape') {
          (field as HTMLElement).blur();
          st.select(null);
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Escape') st.select(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = st.selection;
        const plan = st.history.present;
        if (s?.kind === 'room') st.commit(deleteRoom(plan, s.id), null);
        else if (s?.kind === 'opening') st.commit(deleteOpening(plan, s.id), null);
        else if (s?.kind === 'wall') {
          // Deleting the Wall between two Rooms merges them.
          const m = mergeRooms(plan, s.id);
          if (m.id) st.commit(m.plan, { kind: 'room', id: m.id });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [useEditor]);

  return (
    <EditorContext.Provider value={useEditor}>
      <div className="flex h-full">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Canvas />
          <Toolbar />
          {!started && (
            <StartOverlay
              plan={useEditor.getState().history.present}
              onStart={(plan) => {
                useEditor.getState().commit(plan);
                setStarted(true);
                requestAnimationFrame(() => useEditor.getState().fit());
              }}
            />
          )}
        </main>
        <SidePanel />
      </div>
    </EditorContext.Provider>
  );
}
