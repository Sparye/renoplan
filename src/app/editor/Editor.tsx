import { useEffect, useState } from 'react';
import { deleteRoom } from '@/core';
import type { Project } from '@/persistence';
import { Comparison } from '../compare/Comparison';
import { newId, projects } from '../projects';
import { actions } from './actions';
import { Canvas } from './Canvas';
import { EditorContext } from './context';
import { SidePanel } from './panel/SidePanel';
import { StartOverlay } from './StartOverlay';
import { ScenarioTabs } from './ScenarioTabs';
import { createEditor, currentPlan } from './store';
import { Toolbar } from './Toolbar';

export function Editor({ project }: { project: Project }) {
  const [useEditor] = useState(() => createEditor(project, projects, newId));
  const empty = useEditor((s) => !Object.keys(s.history.present.walls).length && !s.history.past.length);
  const [started, setStarted] = useState(!empty);
  const comparing = useEditor((s) => !!s.compare);

  useEffect(() => {
    requestAnimationFrame(() => useEditor.getState().fit());
  }, [useEditor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      const field = (e.target as HTMLElement).closest('input, textarea, select, [role="combobox"]');
      if ((e.target as HTMLElement).closest('[role="dialog"], [role="listbox"]')) return;
      // The Comparison is read-only: Escape leaves it, and nothing else edits.
      if (st.compare) {
        if (e.key === 'Escape') st.closeCompare();
        return;
      }
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
      } else if (e.key === 'Escape') {
        if (st.tool !== 'select') st.setTool('select');
        else st.select(null);
      } else if (key === 'w' && !mod && st.mode.kind === 'scenario') {
        st.setTool(st.tool === 'drawWall' ? 'select' : 'drawWall');
      } else if (key === 'r' && !mod && st.mode.kind === 'scenario') {
        st.setTool(st.tool === 'drawRoom' ? 'select' : 'drawRoom');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = st.selection;
        const act = actions(useEditor);
        if (s?.kind === 'opening') act.removeOpening(s.id);
        // Removing the Wall between two Rooms merges them; in a Scenario any Wall can be demolished.
        else if (s?.kind === 'wall') act.removeWall(s.id);
        else if (s?.kind === 'room' && st.mode.kind === 'existing')
          st.commit(deleteRoom(currentPlan(st), s.id), null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [useEditor]);

  return (
    <EditorContext.Provider value={useEditor}>
      <div className="flex h-full">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {comparing ? (
            <Comparison />
          ) : (
            <>
              <Canvas />
              <Toolbar />
              <ScenarioTabs />
            </>
          )}
          {!started && !comparing && (
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
