import {
  type ComparisonSide,
  type Plan,
  type RoomCell,
  type WallTally,
  compareRooms,
  formatArea,
  formatMetres,
  summarize
} from '@/core';

// The Comparison's summary table as plain text rows, so the view and Export draw the same thing.

export interface TableRow {
  /** The row's label, then one cell per side. */
  cells: [string, string, string];
  section: 'rooms' | 'totals';
  /** Per cell: a passive warning (a structural Wall touched, an Extension). */
  warn: [boolean, boolean, boolean];
}

export interface ComparisonTable {
  /** "Room", then each side's name. */
  columns: [string, string, string];
  rows: TableRow[];
}

export interface TableSide {
  name: string;
  side: ComparisonSide;
}

const area = (mm2: number) => `${formatArea(mm2)} m²`;
const walls = (t: WallTally) => (t.count ? `${t.count} · ${formatMetres(t.length)} m` : '0');

export function comparisonTable(existing: Plan, left: TableSide, right: TableSide): ComparisonTable {
  const a = summarize(existing, left.side);
  const b = summarize(existing, right.side);
  const room = (c: RoomCell, name: string | null): string => {
    if (c.kind === 'none') return '—';
    if (c.kind === 'gone') return c.into ? `Merged into ${c.into.name}` : 'Removed';
    const renamed = name !== null && c.room.name !== name ? ` · ${c.room.name}` : '';
    return `${c.room.status === 'new' ? 'New · ' : ''}${area(c.room.area)}${renamed}`;
  };
  const rooms = compareRooms(existing, a, b).map((r): TableRow => {
    const name = r.existing ? existing.rooms[r.existing]!.name : null;
    const label = name ?? r.cells.find((c) => c.kind === 'room')!.room.name;
    return {
      cells: [label, room(r.cells[0], name), room(r.cells[1], name)],
      section: 'rooms',
      warn: [false, false, false]
    };
  });
  const total = (label: string, cell: (s: typeof a) => string, warn = (_: typeof a) => false): TableRow => ({
    cells: [label, cell(a), cell(b)],
    section: 'totals',
    warn: [false, warn(a), warn(b)]
  });
  return {
    columns: ['Room', left.name, right.name],
    rows: [
      ...rooms,
      total('Room area', (s) => area(s.roomArea)),
      total('Walls demolished', (s) => walls(s.demolished)),
      total(
        'Structural walls touched',
        (s) => walls(s.structural),
        (s) => s.structural.count > 0
      ),
      total('New walls', (s) => `${formatMetres(s.newWalls)} m`),
      total(
        'Extension area',
        (s) => area(s.extensionArea),
        (s) => s.extensionArea > 0
      )
    ]
  };
}
