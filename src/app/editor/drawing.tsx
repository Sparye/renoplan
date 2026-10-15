import type { ReactNode } from 'react';
import { type Line, type Opening, type Rect, type RoomType, formatMetres, point } from '@/core';

// SVG pieces of the drawing, in plan millimetres. `px` converts screen pixels to millimetres at the
// current zoom, so strokes and text stay a constant size on screen.

export const TINT: Record<RoomType, string> = {
  bedroom: 'var(--tint-bedroom)',
  bathroom: 'var(--tint-bathroom)',
  kitchen: 'var(--tint-kitchen)',
  living: 'var(--tint-living)',
  laundry: 'var(--tint-laundry)',
  hallway: 'var(--tint-hallway)',
  other: 'var(--tint-other)'
};

export const rectsPath = (rs: readonly Rect[]) =>
  rs.map((r) => `M${r.x0} ${r.y0}H${r.x1}V${r.y1}H${r.x0}Z`).join('');

export function Label(props: {
  x: number;
  y: number;
  size: number;
  px: (n: number) => number;
  weight?: number;
  fill?: string;
  children: ReactNode;
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      fontSize={props.px(props.size)}
      fontWeight={props.weight ?? 400}
      fill={props.fill ?? 'var(--plan-ink)'}
      textAnchor="middle"
      dominantBaseline="middle"
      className="plan-label"
      style={{ strokeWidth: props.px(3) }}
    >
      {props.children}
    </text>
  );
}

/** A door, window or plain opening cut into its Wall. */
export function OpeningShape({
  id,
  o,
  line,
  selected
}: {
  id: string;
  o: Opening;
  line: Line;
  selected: boolean;
}) {
  const P = (t: number, n: number) => point(line.axis, t, n);
  const pts = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');
  const { lo, hi } = line;
  const t0 = o.at;
  const t1 = o.at + o.width;
  const cut = [P(t0, lo), P(t1, lo), P(t1, hi), P(t0, hi)];
  const stroke = {
    stroke: 'var(--plan-wall)',
    strokeWidth: 1.25,
    vectorEffect: 'non-scaling-stroke' as const,
    fill: 'none'
  };
  let symbol: ReactNode;
  if (o.kind === 'door') {
    const hinge = o.hinge === 'start' ? t0 : t1;
    const jamb = o.hinge === 'start' ? t1 : t0;
    const face = o.swing === 'neg' ? lo : hi;
    const out = o.swing === 'neg' ? -o.width : o.width;
    const h = P(hinge, face);
    const tip = P(hinge, face + out);
    const j = P(jamb, face);
    const cross = (tip.x - h.x) * (j.y - h.y) - (tip.y - h.y) * (j.x - h.x);
    symbol = (
      <>
        <line x1={h.x} y1={h.y} x2={tip.x} y2={tip.y} {...stroke} strokeWidth={2} />
        <path
          d={`M${tip.x} ${tip.y}A${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${j.x} ${j.y}`}
          {...stroke}
          strokeDasharray="4 3"
        />
      </>
    );
  } else if (o.kind === 'window') {
    const a = lo + (hi - lo) * 0.35;
    const b = lo + (hi - lo) * 0.65;
    symbol = (
      <>
        <polygon points={pts(cut)} {...stroke} />
        <line x1={P(t0, a).x} y1={P(t0, a).y} x2={P(t1, a).x} y2={P(t1, a).y} {...stroke} />
        <line x1={P(t0, b).x} y1={P(t0, b).y} x2={P(t1, b).x} y2={P(t1, b).y} {...stroke} />
      </>
    );
  } else {
    symbol = (
      <>
        <line x1={P(t0, lo).x} y1={P(t0, lo).y} x2={P(t0, hi).x} y2={P(t0, hi).y} {...stroke} />
        <line x1={P(t1, lo).x} y1={P(t1, lo).y} x2={P(t1, hi).x} y2={P(t1, hi).y} {...stroke} />
      </>
    );
  }
  const reach = o.kind === 'door' ? o.width : 150;
  const hit = [P(t0, lo - reach), P(t1, lo - reach), P(t1, hi + reach), P(t0, hi + reach)];
  return (
    <g data-hit={`opening:${id}`}>
      <polygon points={pts(hit)} fill="transparent" />
      <polygon points={pts(cut)} fill={o.kind === 'window' ? '#f4f8fb' : 'var(--plan-paper)'} />
      {symbol}
      {selected && (
        <polygon
          points={pts(cut)}
          fill="none"
          stroke="var(--plan-select)"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/**
 * A dimension line between a and b (on one axis), drawn `offset` mm out along the normal, with
 * extension lines, ticks, and the length in metres.
 */
export function Dimension(props: {
  axis: 'h' | 'v';
  a: number;
  b: number;
  /** Coordinate across the axis where the measured thing sits. */
  at: number;
  /** Signed distance (mm) from `at` to the dimension line. */
  offset: number;
  px: (n: number) => number;
  color?: string;
  label?: string;
}) {
  const { axis, a, b, at, offset, px } = props;
  if (b - a < 1) return null;
  const color = props.color ?? 'var(--plan-ink-soft)';
  const c = at + offset;
  const P = (t: number, n: number) => point(axis, t, n);
  const s = {
    stroke: color,
    strokeWidth: 1,
    vectorEffect: 'non-scaling-stroke' as const
  };
  const tick = px(4);
  const p0 = P(a, c);
  const p1 = P(b, c);
  const m = P((a + b) / 2, c);
  const e0 = P(a, at);
  const e1 = P(b, at);
  return (
    <g pointerEvents="none">
      <line x1={e0.x} y1={e0.y} x2={p0.x} y2={p0.y} {...s} strokeOpacity={0.5} />
      <line x1={e1.x} y1={e1.y} x2={p1.x} y2={p1.y} {...s} strokeOpacity={0.5} />
      <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} {...s} />
      {[a, b].map((t) => {
        const q0 = P(t - tick, c + tick);
        const q1 = P(t + tick, c - tick);
        return <line key={t} x1={q0.x} y1={q0.y} x2={q1.x} y2={q1.y} {...s} strokeWidth={1.5} />;
      })}
      <Label x={m.x} y={m.y} size={10.5} px={px} fill={color}>
        {props.label ?? formatMetres(b - a)}
      </Label>
    </g>
  );
}
