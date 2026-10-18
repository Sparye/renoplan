import { useMemo } from 'react';
import { cn } from '@/app/lib/utils';
import { useEditorStore } from '../editor/context';
import { Hint, Section } from '../editor/panel/fields';
import { type EditorState, comparedApplied } from '../editor/store';
import { comparisonTable } from './table';

/** The side panel in the Comparison: the summary table of both sides. */
export function CompareSummary() {
  const useEditor = useEditorStore();
  const existing = useEditor((s) => s.history.present);
  const side = (which: 'left' | 'right') => (s: EditorState) => {
    const m = s.compare?.[which] ?? { kind: 'existing' };
    return m.kind === 'scenario' ? (s.scenarios[m.id]?.present.name ?? null) : null;
  };
  const leftName = useEditor(side('left'));
  const rightName = useEditor(side('right'));
  const left = useEditor((s) => (s.compare ? comparedApplied(s, s.compare.left) : null));
  const right = useEditor((s) => (s.compare ? comparedApplied(s, s.compare.right) : null));
  const open = useEditor((s) => !!s.compare);
  const table = useMemo(
    () =>
      comparisonTable(
        existing,
        { name: leftName ?? 'Existing plan', side: left },
        { name: rightName ?? 'Existing plan', side: right }
      ),
    [existing, left, right, leftName, rightName]
  );
  if (!open) return null;
  const rooms = table.rows.filter((r) => r.section === 'rooms');
  const totals = table.rows.filter((r) => r.section === 'totals');

  return (
    <Section title="Summary">
      <table className="w-full table-fixed text-sm" aria-label="Comparison summary">
        <colgroup>
          <col className="w-[38%]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={cn('pb-1 font-medium', i > 0 && 'pl-2 text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {[rooms, totals].map((rows, g) => (
          <tbody key={g} className={cn(g === 1 && 'border-t')}>
            {rows.map((r, i) => (
              <tr key={i}>
                <th
                  scope="row"
                  className={cn('py-1 text-left font-normal', g === 1 && 'text-muted-foreground')}
                >
                  {r.cells[0]}
                </th>
                {r.cells.slice(1).map((c, j) => (
                  <td
                    key={j}
                    className={cn('py-1 pl-2 text-right tabular-nums', r.warn[j + 1] && 'text-amber-700')}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <Hint>
        Rooms are matched by the existing room they come from. A moved wall counts as demolished where it was.
        Pan and zoom either plan to move both.
      </Hint>
    </Section>
  );
}
