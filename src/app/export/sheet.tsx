import { renderToStaticMarkup } from 'react-dom/server';
import { type Plan, planBounds } from '@/core';
import { PlanDrawing } from '../editor/PlanDrawing';
import { TOKENS, flattenDrawing, resolveVars } from './flatten';
import type { Pane, Paper, Sheet, SheetPage } from './types';

// A sheet is laid out in CSS pixels (96 per inch) on a landscape page: a title block, the panes side by side,
// each with its caption and Show Changes legend, then the table.

const PX_PER_MM = 96 / 25.4;
const PAGES: Record<Paper, { w: number; h: number }> = {
  a4: { w: 1123, h: 794 },
  a3: { w: 1587, h: 1123 }
};
/** Architectural scales, largest first: a pane uses the largest one its plan fits at. */
const SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
const MARGIN = 40;
const GAP = 24;
const HEADER = 76;
const CAPTION = 28;
const LEGEND = 28;
const ROW = 22;
/** Room around a plan inside its pane: plan millimetres, plus screen pixels for the Outline's dimensions. */
const AROUND_MM = 1000;
const AROUND_PX = 40;
const FONT = 'Helvetica, Arial, sans-serif';

const C = {
  ink: TOKENS['plan-ink'] ?? '#2b2f36',
  soft: TOKENS['plan-ink-soft'] ?? '#6b7280',
  rule: '#e5e7eb',
  paper: TOKENS['plan-paper'] ?? '#ffffff'
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/** What a pane must show: its plan, and the Existing Plan Walls that Show Changes draws as Demolished. */
function extent(pane: Pane): Box | null {
  const bs = [planBounds(pane.plan), pane.changes ? planBounds(pane.changes.existing) : null].filter(
    (b): b is Box => !!b
  );
  if (!bs.length) return null;
  return {
    x0: Math.min(...bs.map((b) => b.x0)),
    y0: Math.min(...bs.map((b) => b.y0)),
    x1: Math.max(...bs.map((b) => b.x1)),
    y1: Math.max(...bs.map((b) => b.y1))
  };
}

/** The largest architectural scale (1:N) at which every extent fits its area, or null if none does. */
export function chooseScale(extents: readonly (Box | null)[], area: { w: number; h: number }): number | null {
  const fits = (n: number) =>
    extents.every((b) => {
      if (!b) return true;
      const k = PX_PER_MM / n;
      return (
        (b.x1 - b.x0 + 2 * AROUND_MM) * k + 2 * AROUND_PX <= area.w &&
        (b.y1 - b.y0 + 2 * AROUND_MM) * k + 2 * AROUND_PX <= area.h
      );
    });
  return SCALES.find(fits) ?? null;
}

/** One pane's drawing, standalone, in plan millimetres at `k` px per mm. */
function drawing(plan: Plan, pane: Pane, k: number, index: number): string {
  const markup = renderToStaticMarkup(
    <PlanDrawing
      plan={plan}
      s={k}
      changes={pane.changes ?? null}
      extension={pane.extension ?? null}
      interactive={false}
    />,
    { identifierPrefix: `pane${index}-` }
  );
  return flattenDrawing(markup, k);
}

function Text(props: {
  x: number;
  y: number;
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  children: React.ReactNode;
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      fontSize={props.size}
      fontWeight={props.weight ?? 400}
      fill={props.fill ?? C.ink}
      textAnchor={props.anchor ?? 'start'}
    >
      {props.children}
    </text>
  );
}

/** Retained, Demolished and New Walls, as Show Changes draws them, and Extension floor if there is any. */
function Legend({
  x,
  y,
  changes,
  extension
}: {
  x: number;
  y: number;
  changes: boolean;
  extension: boolean;
}) {
  const swatch = { y: y - 9, width: 22, height: 10 };
  const ex = changes ? x + 280 : x;
  return (
    <g data-testid="legend">
      {changes && (
        <>
          <rect x={x} {...swatch} fill={TOKENS['plan-wall']} />
          <Text x={x + 28} y={y} size={11} fill={C.soft}>
            Retained
          </Text>
          <rect
            x={x + 96}
            {...swatch}
            fill={C.paper}
            stroke={TOKENS['plan-demolished']}
            strokeWidth={1.25}
            strokeDasharray="5 4"
          />
          <Text x={x + 124} y={y} size={11} fill={C.soft}>
            Demolished
          </Text>
          <rect x={x + 206} {...swatch} fill={TOKENS['plan-new']} />
          <Text x={x + 234} y={y} size={11} fill={C.soft}>
            New
          </Text>
        </>
      )}
      {extension && (
        <>
          <rect
            x={ex}
            {...swatch}
            fill={C.paper}
            stroke={TOKENS['plan-extension']}
            strokeWidth={1.25}
            strokeDasharray="8 4"
          />
          <Text x={ex + 28} y={y} size={11} fill={C.soft}>
            Extension
          </Text>
        </>
      )}
    </g>
  );
}

function Table({ table, x, y, w }: { table: NonNullable<Sheet['table']>; x: number; y: number; w: number }) {
  const n = table.columns.length;
  const first = n > 1 ? Math.max(w * 0.3, w / n) : w;
  const rest = n > 1 ? (w - first) / (n - 1) : 0;
  const colX = (i: number) => (i === 0 ? x : x + first + (i - 1) * rest);
  const cells = (row: readonly string[], ty: number, weight: number) =>
    row.map((c, i) => (
      <Text
        key={i}
        x={i === 0 ? colX(0) : colX(i) + rest}
        y={ty}
        size={12}
        weight={weight}
        anchor={i === 0 ? 'start' : 'end'}
      >
        {c}
      </Text>
    ));
  return (
    <g data-testid="table">
      {cells(table.columns, y + 15, 600)}
      <line x1={x} x2={x + w} y1={y + ROW} y2={y + ROW} stroke={C.ink} strokeWidth={1} />
      {table.rows.map((r, j) => (
        <g key={j}>
          {cells(r, y + ROW * (j + 1) + 15, 400)}
          <line
            x1={x}
            x2={x + w}
            y1={y + ROW * (j + 2)}
            y2={y + ROW * (j + 2)}
            stroke={C.rule}
            strokeWidth={1}
          />
        </g>
      ))}
    </g>
  );
}

const formatDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Lays out a sheet as a standalone SVG document: A4 landscape for a single pane, A3 for two panes or a
 * table. Every pane shares one architectural scale, the largest at which all of them fit.
 */
export function buildSheet(sheet: Sheet): SheetPage {
  if (sheet.panes.length < 1 || sheet.panes.length > 2) throw new Error('a sheet has one or two panes');
  const paper: Paper = sheet.panes.length > 1 || sheet.table ? 'a3' : 'a4';
  const { w: W, h: H } = PAGES[paper];
  const inner = W - 2 * MARGIN;
  const tableH = sheet.table ? ROW * (sheet.table.rows.length + 1) + GAP : 0;
  const top = MARGIN + HEADER;
  const bottom = H - MARGIN - tableH;
  const n = sheet.panes.length;
  const paneW = (inner - GAP * (n - 1)) / n;
  const extended = (p: Pane) => !!p.extension?.length;
  const legend = sheet.panes.some((p) => p.changes || extended(p)) ? LEGEND : 0;
  const area = { w: paneW, h: bottom - top - CAPTION - legend };
  const extents = sheet.panes.map(extent);
  const scale = chooseScale(extents, area);
  /** px per mm: the scale's, or (for a plan too big for any) whatever fits. */
  const k = scale
    ? PX_PER_MM / scale
    : Math.min(
        ...extents.flatMap((b) =>
          b
            ? [
                (area.w - 2 * AROUND_PX) / (b.x1 - b.x0 + 2 * AROUND_MM),
                (area.h - 2 * AROUND_PX) / (b.y1 - b.y0 + 2 * AROUND_MM)
              ]
            : []
        )
      );
  const scaleText = scale ? `Scale 1:${scale} at ${paper.toUpperCase()}` : 'Not to scale';

  const panes = sheet.panes.map((pane, i) => {
    const x = MARGIN + i * (paneW + GAP);
    const y = top + CAPTION;
    const b = extents[i];
    const tx = b ? x + (area.w - (b.x1 - b.x0) * k) / 2 - b.x0 * k : 0;
    const ty = b ? y + (area.h - (b.y1 - b.y0) * k) / 2 - b.y0 * k : 0;
    return (
      <g key={i} data-testid="pane" data-x={x}>
        {(n > 1 || pane.title !== sheet.title) && (
          <Text x={x} y={top + 17} size={15} weight={600}>
            {pane.title}
          </Text>
        )}
        <Text x={x + paneW} y={top + 17} size={11} fill={C.soft} anchor="end">
          {scaleText}
        </Text>
        <rect x={x} y={y} width={paneW} height={area.h} fill="none" stroke={C.rule} strokeWidth={1} />
        {b ? (
          <g
            transform={`translate(${+tx.toFixed(2)} ${+ty.toFixed(2)}) scale(${k})`}
            dangerouslySetInnerHTML={{ __html: drawing(pane.plan, pane, k, i) }}
          />
        ) : (
          <Text x={x + paneW / 2} y={y + area.h / 2} size={13} fill={C.soft} anchor="middle">
            Nothing drawn yet
          </Text>
        )}
        {(pane.changes || extended(pane)) && (
          <Legend x={x} y={y + area.h + 20} changes={!!pane.changes} extension={extended(pane)} />
        )}
      </g>
    );
  });

  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT}>
      <rect width={W} height={H} fill={C.paper} />
      <Text x={MARGIN} y={MARGIN + 22} size={24} weight={700}>
        {sheet.title}
      </Text>
      {sheet.subtitle && (
        <Text x={MARGIN} y={MARGIN + 46} size={13} fill={C.soft}>
          {sheet.subtitle}
        </Text>
      )}
      <Text x={W - MARGIN} y={MARGIN + 22} size={13} weight={600} anchor="end">
        {sheet.project}
      </Text>
      <Text x={W - MARGIN} y={MARGIN + 42} size={11} fill={C.soft} anchor="end">
        {formatDate(sheet.date ?? new Date())} · Renoplan · conceptual, not for construction
      </Text>
      <line
        x1={MARGIN}
        x2={W - MARGIN}
        y1={MARGIN + HEADER - 16}
        y2={MARGIN + HEADER - 16}
        stroke={C.ink}
        strokeWidth={1}
      />
      {panes}
      {sheet.table && <Table table={sheet.table} x={MARGIN} y={bottom + GAP} w={inner} />}
    </svg>
  );
  return { svg: resolveVars(markup), paper, width: W, height: H, scale };
}
