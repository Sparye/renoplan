import { extensionOf } from '@/core';
import { exportName } from '../files';
import { type EditorState, activeApplied, activeScenario } from '../editor/store';
import type { ExportFormat, Sheet } from './types';

/**
 * What the editor shows, as a sheet: the Existing Plan, or the open Scenario with Show Changes as toggled.
 * Never a drag preview: only what is committed.
 */
export function editorSheet(
  s: Pick<EditorState, 'project' | 'mode' | 'scenarios' | 'history' | 'changesHidden'>
): Sheet {
  const project = s.project.name;
  const existing = s.history.present;
  const scenario = activeScenario(s);
  const a = activeApplied(s);
  if (!scenario || !a)
    return {
      project,
      title: 'Existing plan',
      subtitle: 'The house as it is today',
      panes: [{ title: 'Existing plan', plan: existing }]
    };
  const n = scenario.changes.length;
  return {
    project,
    title: scenario.name,
    subtitle: `Scenario · ${n} ${n === 1 ? 'change' : 'changes'}`,
    panes: [
      {
        title: scenario.name,
        plan: a.plan,
        changes: s.changesHidden[scenario.id] ? null : { existing, statuses: a.statuses },
        extension: extensionOf(existing, a.plan)
      }
    ]
  };
}

/** The file an Export of the editor's view is saved as: "Home - Option A.png". */
export const editorFileName = (sheet: Sheet, format: ExportFormat) =>
  exportName(sheet.project, sheet.title, format);
