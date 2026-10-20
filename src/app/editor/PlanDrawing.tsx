import { type ReactNode, useId } from 'react';
import {
  type ChangeStatuses,
  type Plan,
  type Rect,
  derive,
  formatArea,
  formatMetres,
  intersects
} from '@/core';
import { Dimension, Label, OpeningShape, TINT, rectsPath } from './drawing';

/** Show Changes for a Scenario: the Existing Plan it changes, and the Change Status of everything. */
export interface ShownChanges {
  existing: Plan;
  statuses: ChangeStatuses;
}

export interface PlanDrawingProps {
  plan: Plan;
  /** Screen pixels per millimetre, so text and strokes keep a constant size on screen (or on the page). */
  s: number;
  /** Draws Demolished Walls and Openings dashed and New ones highlighted (Show Changes). */
  changes?: ShownChanges | null;
  /** Extension floor (outside the Existing Plan's Footprint), always flagged in a Scenario. */
  extension?: readonly Rect[] | null;
  /** The editor canvas: hit targets and cursors. A read-only drawing (Comparison, Export) has none. */
  interactive?: boolean;
  /** Whether dragging inside a Room moves it (the Existing Plan), for its cursor. */
  roomsMove?: boolean;
  /** A drag is in progress: changeable overlays (New highlights, dimensions) are hidden. */
  dragging?: boolean;
  selectedOpening?: string | null;
  /** Drawn first, under everything (the editor's grid). */
  under?: ReactNode;
  /** Drawn over the plan, under the labels (selection highlights, live dimensions). */
  overlay?: ReactNode;
  /** Drawn over the labels (snap guides, clearances). */
  top?: ReactNode;
}

/**
 * A plan as an architectural drawing, in plan millimetres: Room tints, Unlabelled Space, Walls, Openings,
 * Overlap, the Outline's dimensions and the labels. Place it inside an <svg> under a transform that maps
 * millimetres to the screen at scale `s`. The editor canvas, Comparison panes and Export all draw with it.
 */
export function PlanDrawing(props: PlanDrawingProps) {
  const { plan, s, changes, interactive = false, dragging = false } = props;
  const uid = useId();
  const hatch = `${uid}hatch`;
  const structural = `${uid}structural`;
  const D = derive(plan);
  const px = (n: number) => n / s;
  const crossing = new Set(D.crossing);
  const parked = new Set(D.parked);
  const outline = D.outline?.bounds;
  const hit = (v: string) => (interactive ? v : undefined);

  return (
    <>
      <defs>
        <pattern
          id={hatch}
          patternUnits="userSpaceOnUse"
          width="250"
          height="250"
          patternTransform="rotate(45)"
        >
          <rect width="250" height="250" fill="var(--plan-unlabelled)" />
          <line x1="0" y1="0" x2="0" y2="250" stroke="var(--plan-unlabelled-line)" strokeWidth="40" />
        </pattern>
        <pattern
          id={structural}
          patternUnits="userSpaceOnUse"
          width="80"
          height="80"
          patternTransform="rotate(45)"
        >
          <rect width="80" height="80" fill="var(--plan-wall)" />
          <line x1="0" y1="0" x2="0" y2="80" stroke="#9aa1ab" strokeWidth="18" />
        </pattern>
      </defs>
      {props.under}

      {Object.entries(D.rooms).map(([id, g]) => (
        <path
          key={id}
          d={rectsPath(g.rects)}
          fill={TINT[plan.rooms[id]!.type]}
          stroke={crossing.has(id) ? 'var(--plan-overlap)' : parked.has(id) ? '#8b939e' : 'none'}
          strokeDasharray={crossing.has(id) || parked.has(id) ? '6 4' : undefined}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          data-hit={hit(`room:${id}`)}
          style={interactive ? { cursor: props.roomsMove ? 'move' : 'default' } : undefined}
        />
      ))}

      {D.unlabelled.map((u, i) => (
        <path key={i} d={rectsPath(u.rects)} fill={`url(#${hatch})`} data-hit={hit('space')} />
      ))}

      {changes && <Demolished existing={changes.existing} demolished={changes.statuses.demolished} />}
      <path d={rectsPath(D.slivers)} fill="var(--plan-wall)" pointerEvents="none" />
      {Object.entries(D.walls).map(([id, g]) => {
        const r = g.rect;
        return (
          <rect
            key={id}
            x={r.x0}
            y={r.y0}
            width={r.x1 - r.x0}
            height={r.y1 - r.y0}
            fill={plan.walls[id]!.structural ? `url(#${structural})` : 'var(--plan-wall)'}
            stroke={interactive ? 'transparent' : undefined}
            strokeWidth={interactive ? 10 : undefined}
            vectorEffect="non-scaling-stroke"
            data-hit={hit(`wall:${id}`)}
            style={interactive ? { cursor: g.line.axis === 'h' ? 'ns-resize' : 'ew-resize' } : undefined}
          />
        );
      })}

      {changes && !dragging && <NewWalls plan={plan} walls={changes.statuses.walls} />}

      {/* Over the Walls: Extension floor reaches the outer face of its exterior Walls. */}
      {props.extension && props.extension.length > 0 && (
        <path
          d={rectsPath(props.extension)}
          fill="none"
          stroke="var(--plan-extension)"
          strokeWidth={2}
          strokeDasharray="8 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          data-testid="extension"
        />
      )}

      {Object.entries(plan.openings).map(([id, o]) => {
        const g = D.walls[o.wall];
        return g ? (
          <OpeningShape
            key={id}
            id={id}
            o={o}
            line={g.line}
            selected={props.selectedOpening === id}
            tone={changes && !dragging && changes.statuses.openings[id] === 'new' ? 'new' : undefined}
            interactive={interactive}
          />
        ) : null;
      })}
      {changes &&
        changes.statuses.demolishedOpenings.map((id) => {
          const o = changes.existing.openings[id];
          const g = o && derive(changes.existing).walls[o.wall];
          return g ? (
            <OpeningShape key={`d${id}`} id={id} o={o} line={g.line} selected={false} tone="demolished" />
          ) : null;
        })}

      <path d={rectsPath(D.overlaps)} fill="var(--plan-overlap)" fillOpacity={0.4} pointerEvents="none" />

      {outline && !dragging && (
        <>
          <Dimension axis="h" a={outline.x0} b={outline.x1} at={outline.y0} offset={-px(28)} px={px} />
          <Dimension axis="v" a={outline.y0} b={outline.y1} at={outline.x0} offset={-px(28)} px={px} />
        </>
      )}
      {props.overlay}

      <g pointerEvents="none">
        {Object.entries(D.rooms).map(([id, g]) => {
          if (!g.label || !g.bounds) return null;
          const big = g.rects.reduce((a, b) =>
            Math.min(b.x1 - b.x0, b.y1 - b.y0) > Math.min(a.x1 - a.x0, a.y1 - a.y0) ? b : a
          );
          const roomy = Math.min(big.x1 - big.x0, big.y1 - big.y0) * s > 70;
          const { x, y } = g.label;
          const fresh = changes && changes.statuses.rooms[id] === 'new';
          const extended = props.extension?.some((e) => g.rects.some((r) => intersects(r, e)));
          return (
            <g key={id}>
              {(fresh || extended) && (
                <Label
                  x={x}
                  y={y - px(roomy ? 26 : 16)}
                  size={10}
                  px={px}
                  weight={600}
                  fill={extended ? 'var(--plan-extension)' : 'var(--plan-new)'}
                >
                  {fresh && extended ? 'NEW · EXTENSION' : extended ? 'EXTENSION' : 'NEW'}
                </Label>
              )}
              <Label x={x} y={y - px(roomy ? 10 : 0)} size={13} px={px} weight={600}>
                {plan.rooms[id]!.name}
              </Label>
              {roomy && (
                <Label x={x} y={y + px(6)} size={11} px={px} fill="var(--plan-ink-soft)">
                  {formatArea(g.area)} m²
                </Label>
              )}
              {roomy && g.rectangular && (
                <Label x={x} y={y + px(20)} size={10} px={px} fill="#8b939e">
                  {formatMetres(g.bounds.x1 - g.bounds.x0)} × {formatMetres(g.bounds.y1 - g.bounds.y0)}
                </Label>
              )}
            </g>
          );
        })}
        {D.unlabelled.map((u, i) => (
          <g key={i}>
            <Label x={u.label.x} y={u.label.y - px(7)} size={11} px={px} weight={600} fill="#8a8577">
              Unlabelled
            </Label>
            <Label x={u.label.x} y={u.label.y + px(8)} size={11} px={px} fill="#8a8577">
              {formatArea(u.area)} m²
            </Label>
          </g>
        ))}
        {props.top}
      </g>
    </>
  );
}

/** The rectangle of a stretch of Wall: its centreline span, across its faces. */
function stretchRect(line: { axis: 'h' | 'v'; lo: number; hi: number }, t0: number, t1: number): Rect {
  return line.axis === 'h'
    ? { x0: t0, x1: t1, y0: line.lo, y1: line.hi }
    : { x0: line.lo, x1: line.hi, y0: t0, y1: t1 };
}

/** Show Changes: Existing Plan Wall the Scenario removes, dashed where it was. */
function Demolished({ existing, demolished }: { existing: Plan; demolished: ChangeStatuses['demolished'] }) {
  const E = derive(existing);
  const rects = Object.entries(demolished).flatMap(([id, ss]) => {
    const g = E.walls[id];
    return g ? ss.map((x) => stretchRect(g.line, x.t0, x.t1)) : [];
  });
  return (
    <path
      d={rectsPath(rects)}
      fill="var(--plan-paper)"
      stroke="var(--plan-demolished)"
      strokeWidth={1.25}
      strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
      data-testid="demolished"
    />
  );
}

/** Show Changes: the New stretches of the Scenario's Walls, highlighted. */
function NewWalls({ plan, walls }: { plan: Plan; walls: ChangeStatuses['walls'] }) {
  const D = derive(plan);
  const rects = Object.entries(walls).flatMap(([id, ss]) => {
    const g = D.walls[id];
    return g ? ss.filter((x) => x.status === 'new').map((x) => stretchRect(g.line, x.t0, x.t1)) : [];
  });
  return <path d={rectsPath(rects)} fill="var(--plan-new)" pointerEvents="none" data-testid="new-walls" />;
}
