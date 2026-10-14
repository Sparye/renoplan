import { createContext, useContext } from 'react';
import type { EditorStore } from './store';

export const EditorContext = createContext<EditorStore | null>(null);

/** The open editor's store hook. */
export function useEditorStore(): EditorStore {
  const s = useContext(EditorContext);
  if (!s) throw new Error('no editor');
  return s;
}
