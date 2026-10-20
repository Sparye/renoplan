import { extensionOf } from '@/core';
import { comparisonTable } from '../compare/table';
import { type EditorState, type Mode, comparedApplied } from '../editor/store';
import type { Pane, Sheet } from './types';

/**
 * The open Comparison as a sheet: both sides side by side (Scenarios with Show Changes), and the summary
 * table the side panel shows. Null when no Comparison is open.
 */
export function comparisonSheet(
  s: Pick<EditorState, 'project' | 'compare' | 'scenarios' | 'history'>
): Sheet | null {
  if (!s.compare) return null;
  const existing = s.history.present;
  const name = (m: Mode) =>
    m.kind === 'scenario' ? (s.scenarios[m.id]?.present.name ?? 'Existing plan') : 'Existing plan';
  const pane = (m: Mode): Pane => {
    const a = comparedApplied(s, m);
    return {
      title: name(m),
      plan: a?.plan ?? existing,
      changes: a ? { existing, statuses: a.statuses } : null,
      extension: a ? extensionOf(existing, a.plan) : null
    };
  };
  const { left, right } = s.compare;
  const table = comparisonTable(
    existing,
    { name: name(left), side: comparedApplied(s, left) },
    { name: name(right), side: comparedApplied(s, right) }
  );
  return {
    project: s.project.name,
    title: `${name(left)} vs ${name(right)}`,
    subtitle: 'Comparison',
    panes: [pane(left), pane(right)],
    table: { columns: table.columns, rows: table.rows.map((r) => r.cells) }
  };
}
