import { createContext, useContext, useMemo } from 'react';
import { type Actions, actions } from './actions';
import type { EditorStore } from './store';

export const EditorContext = createContext<EditorStore | null>(null);

/** The open editor's store hook. */
export function useEditorStore(): EditorStore {
  const s = useContext(EditorContext);
  if (!s) throw new Error('no editor');
  return s;
}

/** The edits both Modes share, routed to the Existing Plan or the open Scenario. */
export function useActions(): Actions {
  const s = useEditorStore();
  return useMemo(() => actions(s), [s]);
}
