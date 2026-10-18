import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import {
  type Clearance,
  type Mm,
  type MovePrep,
  type Plan,
  type PushPrep,
  type Rect,
  applyMove,
  applyPush,
  clearances,
  derive,
  drawRoom,
  drawWall,
  formatArea,
  formatMetres,
  moveOpening,
  prepareMove,
  preparePush,
  point,
  runOf,
  snapMove,
  snapPush,
  usableSpan,
  wallAtPoint
} from '@/core';
import { NEW_ROOM } from './actions';
import { useActions, useEditorStore } from './context';
import { Dimension, Label, OpeningShape, TINT, rectsPath } from './drawing';
import { type Selection, type View, activeApplied, currentPlan, shownPlan } from './store';

/** Snap radius in screen pixels (validated by the prototype). */
const SNAP_PX = 8;
/** Pointer travel before a press becomes a drag. */
const DRAG_PX = 3;

type Pt = { x: number; y: number };
type DragBase = { client: Pt; start: Pt; moved: boolean };
type Drag = DragBase &
  (
    | { kind: 'pan'; view0: View; click: Selection | 'keep' }
    | { kind: 'room'; id: string; prep: MovePrep | null }
    | {
        kind: 'wall';
        id: string;
        at: Mm;
        c: Mm;
        delta: Mm;
        axis: 'h' | 'v';
        outline: boolean;
        prep: PushPrep | null;
      }
    | { kind: 'opening'; id: string; at0: Mm; at: Mm; axis: 'h' | 'v'; base: Plan }
    | { kind: 'draw'; a: Pt; b: Pt | null; base: Plan }
    | { kind: 'drawRoom'; a: Pt; rect: Rect | null; base: Plan }
  );

export function Canvas() {
  const useEditor = useEditorStore();
  const act = useActions();
  const plan = useEditor(shownPlan);
  const scenario = useEditor((s) => s.mode.kind === 'scenario');
  const tool = useEditor((s) => s.tool);
  const changes = useEditor((s) =>
    s.mode.kind === 'scenario' && !s.changesHidden[s.mode.id] ? activeApplied(s) : null
  );
  const existing = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const preview = useEditor((s) => s.preview);
  const view = useEditor((s) => s.view);
  const size = useEditor((s) => s.size);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const D = derive(plan);
  const px = (n: number) => n / view.s;

  // Size, wheel pan/zoom, and space-drag panning.
  useEffect(() => {
    const el = svg.current!;
    const { setSize, setView } = useEditor.getState();
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const s = Math.min(1, Math.max(0.004, v.s * Math.exp(-e.deltaY * 0.01)));
          return { s, tx: mx - (mx - v.tx) * (s / v.s), ty: my - (my - v.ty) * (s / v.s) };
        }
        return { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
      });
    };
    const typing = (e: KeyboardEvent) =>
      (e.target as HTMLElement).closest('input, textarea, select, [role="combobox"]');
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e)) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [useEditor]);

  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const v = useEditor.getState().view;
    return { x: (e.clientX - r.left - v.tx) / v.s, y: (e.clientY - r.top - v.ty) / v.s };
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const st = useEditor.getState();
    const base = currentPlan(st);
    const p = toMm(e);
    const hit = (e.target as Element).closest('[data-hit]')?.getAttribute('data-hit') ?? '';
    const b: DragBase = { client: { x: e.clientX, y: e.clientY }, start: p, moved: false };
    if (e.button === 1 || space.current) {
      drag.current = { ...b, kind: 'pan', view0: st.view, click: 'keep' };
      return;
    }
    if (st.tool === 'drawWall') {
      const a = snapPoint(base, p, SNAP_PX / st.view.s, st.snapStep);
      drag.current = { ...b, kind: 'draw', a, b: null, base };
      return;
    }
    if (st.tool === 'drawRoom') {
      const a = snapPoint(base, p, SNAP_PX / st.view.s, st.snapStep);
      drag.current = { ...b, kind: 'drawRoom', a, rect: null, base };
      return;
    }
    const [kind, id] = hit.split(':') as [string, string | undefined];
    if (kind === 'opening' && id && base.openings[id]) {
      st.select({ kind: 'opening', id });
      const axis = derive(base).walls[base.openings[id].wall]!.line.axis;
      const at0 = base.openings[id].at;
      drag.current = { ...b, kind: 'opening', id, at0, at: at0, axis, base };
      return;
    }
    if (kind === 'wall' && id && base.walls[id]) {
      const { axis, c } = derive(base).walls[id]!.line;
      const at = Math.round(axis === 'h' ? p.x : p.y);
      st.select({ kind: 'wall', id, at });
      const prep = preparePush(base, id, { outline: e.altKey });
      drag.current = { ...b, kind: 'wall', id, at, c, delta: 0, axis, outline: e.altKey, prep };
      return;
    }
    if (kind === 'room' && id && base.rooms[id]) {
      st.select({ kind: 'room', id });
      // A Scenario has no Change that moves a Room: dragging inside one pans.
      if (st.mode.kind === 'scenario') drag.current = { ...b, kind: 'pan', view0: st.view, click: 'keep' };
      else drag.current = { ...b, kind: 'room', id, prep: prepareMove(base, id) };
      return;
    }
    const click: Selection = kind === 'space' ? { kind: 'space', x: p.x, y: p.y } : null;
    drag.current = { ...b, kind: 'pan', view0: st.view, click };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.client.x;
    const dyPx = e.clientY - d.client.y;
    if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_PX) return;
    d.moved = true;
    const st = useEditor.getState();
    if (d.kind === 'pan') {
      st.setView({ ...d.view0, tx: d.view0.tx + dxPx, ty: d.view0.ty + dyPx });
      return;
    }
    const p = toMm(e);
    const dx = Math.round(p.x - d.start.x);
    const dy = Math.round(p.y - d.start.y);
    const opts = { threshold: SNAP_PX / st.view.s, grid: st.snapStep };
    if (d.kind === 'room' && d.prep) {
      const s = snapMove(d.prep.plan, d.id, dx, dy, opts);
      const next = applyMove(d.prep, s.dx, s.dy);
      st.setPreview({ plan: next, guides: s.guides, clearances: clearances(next, d.id) });
    } else if (d.kind === 'wall' && d.prep) {
      const s = snapPush(d.prep, d.axis === 'v' ? dx : dy, opts);
      d.delta = s.delta;
      st.setPreview({ plan: applyPush(d.prep, s.delta), guides: s.guides, clearances: [] });
    } else if (d.kind === 'opening') {
      const along = d.axis === 'h' ? dx : dy;
      const step = Math.max(10, Math.round(st.snapStep / 10));
      d.at = Math.round((d.at0 + along) / step) * step;
      st.setPreview({ plan: moveOpening(d.base, d.id, d.at), guides: [], clearances: [] });
    } else if (d.kind === 'draw') {
      // Straight along whichever way the pointer went further; the end snaps to a Wall across its way.
      const axis = Math.abs(p.x - d.a.x) >= Math.abs(p.y - d.a.y) ? 'h' : 'v';
      const threshold = SNAP_PX / st.view.s;
      const end =
        axis === 'h'
          ? { x: snapAlong(d.base, 'v', p.x, threshold, st.snapStep), y: d.a.y }
          : { x: d.a.x, y: snapAlong(d.base, 'h', p.y, threshold, st.snapStep) };
      d.b = end.x === d.a.x && end.y === d.a.y ? null : end;
      const drawn = d.b ? drawWall(d.base, d.a, d.b).plan : d.base;
      const measure = d.b ? { a: d.a, b: d.b } : undefined;
      st.setPreview({ plan: drawn, guides: [], clearances: [], measure });
    } else if (d.kind === 'drawRoom') {
      // The corner opposite the start snaps onto Walls too, so the Room's sides land on the Walls there.
      const b = snapPoint(d.base, p, SNAP_PX / st.view.s, st.snapStep);
      const rect = {
        x0: Math.min(d.a.x, b.x),
        y0: Math.min(d.a.y, b.y),
        x1: Math.max(d.a.x, b.x),
        y1: Math.max(d.a.y, b.y)
      };
      d.rect = rect.x1 > rect.x0 && rect.y1 > rect.y0 ? rect : null;
      const r = d.rect ? drawRoom(d.base, d.rect, NEW_ROOM) : { plan: d.base, id: null };
      const room = r.id ? (derive(r.plan).rooms[r.id]?.bounds ?? null) : null;
      st.setPreview({
        plan: r.plan,
        guides: [],
        clearances: [],
        drawing: d.rect ? { rect: d.rect, room } : undefined
      });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useEditor.getState();
    if (d.kind === 'pan') {
      if (!d.moved && d.click !== 'keep') st.select(d.click);
      return;
    }
    const pv = st.preview;
    if (!d.moved || !pv) {
      st.setPreview(null);
      return;
    }
    if (d.kind === 'draw') {
      if (!d.b || !act.drawWall(d.a, d.b)) st.setPreview(null);
      return;
    }
    if (d.kind === 'drawRoom') {
      if (!d.rect || !act.drawRoom(d.rect)) st.setPreview(null);
      return;
    }
    if (st.mode.kind === 'scenario') {
      // In a Scenario the gesture is recorded as a Change, which replays it on the Scenario's plan.
      if (d.kind === 'wall') act.pushWall(d.id, d.delta, d.at, d.outline);
      else if (d.kind === 'opening') act.updateOpening(d.id, { at: d.at });
      else st.setPreview(null);
      return;
    }
    if (d.kind === 'wall') {
      // Wall ids change as a push detaches and re-fuses: find the Wall where the grabbed point went.
      const moved = point(d.axis, d.at, d.c + d.delta);
      const id = wallAtPoint(pv.plan, moved.x, moved.y);
      st.commit(pv.plan, id ? { kind: 'wall', id, at: d.at } : null);
    } else st.commit(pv.plan);
  };

  // ---------- what to draw ----------

  const vis = { x0: -view.tx / view.s, y0: -view.ty / view.s, x1: 0, y1: 0 };
  vis.x1 = vis.x0 + size.w / view.s;
  vis.y1 = vis.y0 + size.h / view.s;
  const gridStep = view.s * 1000 < 12 ? 5000 : 1000;
  let gridPath = '';
  for (let x = Math.floor(vis.x0 / gridStep) * gridStep; x < vis.x1; x += gridStep)
    gridPath += `M${x} ${vis.y0}V${vis.y1}`;
  for (let y = Math.floor(vis.y0 / gridStep) * gridStep; y < vis.y1; y += gridStep)
    gridPath += `M${vis.x0} ${y}H${vis.x1}`;

  const sel = selection;
  const selRoom = sel?.kind === 'room' ? D.rooms[sel.id] : undefined;
  const selRun = sel?.kind === 'wall' && plan.walls[sel.id] ? runOf(plan, sel.id) : [];
  const selSpace = sel?.kind === 'space' ? D.unlabelled[D.spaceAt(sel.x, sel.y)] : undefined;
  const crossing = new Set(D.crossing);
  const parked = new Set(D.parked);
  const outline = D.outline?.bounds;
  const dragging = !!preview;

  return (
    <svg
      ref={svg}
      className="absolute inset-0 h-full w-full touch-none select-none"
      style={{
        background: 'var(--plan-paper)',
        cursor: tool !== 'select' ? 'crosshair' : dragging ? 'grabbing' : 'default'
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="canvas"
    >
      <defs>
        <pattern
          id="hatch"
          patternUnits="userSpaceOnUse"
          width="250"
          height="250"
          patternTransform="rotate(45)"
        >
          <rect width="250" height="250" fill="var(--plan-unlabelled)" />
          <line x1="0" y1="0" x2="0" y2="250" stroke="var(--plan-unlabelled-line)" strokeWidth="40" />
        </pattern>
        <pattern
          id="structural"
          patternUnits="userSpaceOnUse"
          width="80"
          height="80"
          patternTransform="rotate(45)"
        >
          <rect width="80" height="80" fill="var(--plan-wall)" />
          <line x1="0" y1="0" x2="0" y2="80" stroke="#9aa1ab" strokeWidth="18" />
        </pattern>
      </defs>
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
        <path
          d={gridPath}
          stroke="var(--plan-grid)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />

        {Object.entries(D.rooms).map(([id, g]) => (
          <path
            key={id}
            d={rectsPath(g.rects)}
            fill={TINT[plan.rooms[id]!.type]}
            stroke={crossing.has(id) ? 'var(--plan-overlap)' : parked.has(id) ? '#8b939e' : 'none'}
            strokeDasharray={crossing.has(id) || parked.has(id) ? '6 4' : undefined}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            data-hit={`room:${id}`}
            style={{ cursor: scenario ? 'default' : 'move' }}
          />
        ))}

        {D.unlabelled.map((s, i) => (
          <path key={i} d={rectsPath(s.rects)} fill="url(#hatch)" data-hit="space" />
        ))}

        {changes && <Demolished existing={existing} demolished={changes.statuses.demolished} />}
        <path d={rectsPath(D.slivers)} fill="var(--plan-wall)" pointerEvents="none" />
        {Object.entries(D.walls).map(([id, g]) => {
          const r = g.rect;
          const horizontal = g.line.axis === 'h';
          return (
            <rect
              key={id}
              x={r.x0}
              y={r.y0}
              width={r.x1 - r.x0}
              height={r.y1 - r.y0}
              fill={plan.walls[id]!.structural ? 'url(#structural)' : 'var(--plan-wall)'}
              stroke="transparent"
              strokeWidth={10}
              vectorEffect="non-scaling-stroke"
              data-hit={`wall:${id}`}
              style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
            />
          );
        })}

        {changes && !dragging && <NewWalls plan={plan} walls={changes.statuses.walls} />}

        {Object.entries(plan.openings).map(([id, o]) => {
          const g = D.walls[o.wall];
          return g ? (
            <OpeningShape
              key={id}
              id={id}
              o={o}
              line={g.line}
              selected={sel?.kind === 'opening' && sel.id === id}
              tone={changes && !dragging && changes.statuses.openings[id] === 'new' ? 'new' : undefined}
            />
          ) : null;
        })}
        {changes &&
          changes.statuses.demolishedOpenings.map((id) => {
            const o = existing.openings[id];
            const g = o && derive(existing).walls[o.wall];
            return g ? (
              <OpeningShape key={`d${id}`} id={id} o={o} line={g.line} selected={false} tone="demolished" />
            ) : null;
          })}

        <path d={rectsPath(D.overlaps)} fill="var(--plan-overlap)" fillOpacity={0.4} pointerEvents="none" />

        {selRoom && (
          <path
            d={rectsPath(selRoom.rects)}
            fill="var(--plan-select)"
            fillOpacity={0.07}
            stroke="var(--plan-select)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {selRun.map((id) => {
          const r = D.walls[id]!.rect;
          return (
            <rect
              key={id}
              x={r.x0}
              y={r.y0}
              width={r.x1 - r.x0}
              height={r.y1 - r.y0}
              fill="var(--plan-select)"
              fillOpacity={0.75}
              pointerEvents="none"
            />
          );
        })}
        {selSpace && (
          <path
            d={rectsPath(selSpace.rects)}
            fill="none"
            stroke="var(--plan-select)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}

        {outline && !dragging && (
          <>
            <Dimension axis="h" a={outline.x0} b={outline.x1} at={outline.y0} offset={-px(28)} px={px} />
            <Dimension axis="v" a={outline.y0} b={outline.y1} at={outline.x0} offset={-px(28)} px={px} />
          </>
        )}
        {selRoom?.rectangular && selRoom.bounds && !dragging && <RoomDimensions r={selRoom.bounds} px={px} />}
        {preview?.measure && <DrawDimension {...preview.measure} px={px} />}
        {preview?.drawing && <DrawingRoom {...preview.drawing} px={px} />}
        {sel?.kind === 'opening' && plan.openings[sel.id] && (
          <OpeningDimensions plan={plan} id={sel.id} px={px} />
        )}

        <g pointerEvents="none">
          {Object.entries(D.rooms).map(([id, g]) => {
            if (!g.label || !g.bounds) return null;
            const big = g.rects.reduce((a, b) =>
              Math.min(b.x1 - b.x0, b.y1 - b.y0) > Math.min(a.x1 - a.x0, a.y1 - a.y0) ? b : a
            );
            const roomy = Math.min(big.x1 - big.x0, big.y1 - big.y0) * view.s > 70;
            const { x, y } = g.label;
            const fresh = changes && changes.statuses.rooms[id] === 'new';
            return (
              <g key={id}>
                {fresh && (
                  <Label
                    x={x}
                    y={y - px(roomy ? 26 : 16)}
                    size={10}
                    px={px}
                    weight={600}
                    fill="var(--plan-new)"
                  >
                    NEW
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
          {D.unlabelled.map((s, i) => (
            <g key={i}>
              <Label x={s.label.x} y={s.label.y - px(7)} size={11} px={px} weight={600} fill="#8a8577">
                Unlabelled
              </Label>
              <Label x={s.label.x} y={s.label.y + px(8)} size={11} px={px} fill="#8a8577">
                {formatArea(s.area)} m²
              </Label>
            </g>
          ))}
          {preview?.guides.map((g, i) => {
            const ext = px(24);
            return g.axis === 'v' ? (
              <line
                key={i}
                x1={g.c}
                x2={g.c}
                y1={g.a - ext}
                y2={g.b + ext}
                stroke="var(--plan-guide)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <line
                key={i}
                y1={g.c}
                y2={g.c}
                x1={g.a - ext}
                x2={g.b + ext}
                stroke="var(--plan-guide)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {preview?.clearances.map((c, i) => (
            <ClearanceLine key={i} c={c} px={px} />
          ))}
        </g>
      </g>
    </svg>
  );
}

function RoomDimensions({ r, px }: { r: Rect; px: (n: number) => number }) {
  return (
    <>
      <Dimension axis="h" a={r.x0} b={r.x1} at={r.y0} offset={px(16)} px={px} color="var(--plan-select)" />
      <Dimension axis="v" a={r.y0} b={r.y1} at={r.x0} offset={px(16)} px={px} color="var(--plan-select)" />
    </>
  );
}

/** Distances from an Opening to the ends of its Wall's clear span. */
function OpeningDimensions({ plan, id, px }: { plan: Plan; id: string; px: (n: number) => number }) {
  const o = plan.openings[id]!;
  const g = derive(plan).walls[o.wall];
  if (!g) return null;
  const { line } = g;
  const [u0, u1] = usableSpan(plan, o.wall);
  const at = line.lo;
  const props = { axis: line.axis, at, offset: -px(18), px, color: 'var(--plan-select)' } as const;
  return (
    <>
      <Dimension {...props} a={u0} b={o.at} />
      <Dimension {...props} a={o.at + o.width} b={u1} />
    </>
  );
}

function ClearanceLine({ c, px }: { c: Clearance; px: (n: number) => number }) {
  const color = c.tone === 'bad' ? 'var(--plan-overlap)' : c.tone === 'warn' ? 'var(--plan-warn)' : '#64748b';
  const label =
    c.tone === 'bad'
      ? `${Math.round(-c.distance)} mm too close`
      : c.tone === 'warn'
        ? `${Math.round(c.distance)} mm off`
        : `${formatMetres(c.clear)} m clear`;
  return (
    <g>
      <line
        x1={c.from.x}
        y1={c.from.y}
        x2={c.to.x}
        y2={c.to.y}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <Label
        x={(c.from.x + c.to.x) / 2}
        y={(c.from.y + c.to.y) / 2}
        size={11}
        px={px}
        weight={600}
        fill={color}
      >
        {label}
      </Label>
    </g>
  );
}

/** Snaps a coordinate to the nearest centreline of Walls along `axis` within the threshold, else the grid. */
function snapAlong(p: Plan, axis: 'h' | 'v', v: number, threshold: number, grid: number): Mm {
  let best: number | null = null;
  for (const g of Object.values(derive(p).walls))
    if (
      g.line.axis === axis &&
      Math.abs(g.line.c - v) <= threshold &&
      (best === null || Math.abs(g.line.c - v) < Math.abs(best - v))
    )
      best = g.line.c;
  return best ?? Math.round(v / grid) * grid;
}

/** Where a drawn Wall starts: on a Wall's centreline when near one (so it joins it), else on the grid. */
function snapPoint(p: Plan, q: Pt, threshold: number, grid: number): Pt {
  return { x: snapAlong(p, 'v', q.x, threshold, grid), y: snapAlong(p, 'h', q.y, threshold, grid) };
}

/** The rectangle of a stretch of Wall: its centreline span, across its faces. */
function stretchRect(line: { axis: 'h' | 'v'; lo: number; hi: number }, t0: number, t1: number): Rect {
  return line.axis === 'h'
    ? { x0: t0, x1: t1, y0: line.lo, y1: line.hi }
    : { x0: line.lo, x1: line.hi, y0: t0, y1: t1 };
}

/** Show Changes: Existing Plan Wall the Scenario removes, dashed where it was. */
function Demolished({
  existing,
  demolished
}: {
  existing: Plan;
  demolished: Record<string, { t0: number; t1: number }[]>;
}) {
  const E = derive(existing);
  const rects = Object.entries(demolished).flatMap(([id, ss]) => {
    const g = E.walls[id];
    return g ? ss.map((s) => stretchRect(g.line, s.t0, s.t1)) : [];
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
function NewWalls({
  plan,
  walls
}: {
  plan: Plan;
  walls: Record<string, { t0: number; t1: number; status: string }[]>;
}) {
  const D = derive(plan);
  const rects = Object.entries(walls).flatMap(([id, ss]) => {
    const g = D.walls[id];
    return g ? ss.filter((s) => s.status === 'new').map((s) => stretchRect(g.line, s.t0, s.t1)) : [];
  });
  return <path d={rectsPath(rects)} fill="var(--plan-new)" pointerEvents="none" data-testid="new-walls" />;
}

/** The live length of a Wall being drawn. */
function DrawDimension({ a, b, px }: { a: Pt; b: Pt; px: (n: number) => number }) {
  const axis = a.y === b.y ? 'h' : 'v';
  const [t0, t1] =
    axis === 'h' ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const at = axis === 'h' ? a.y : a.x;
  return <Dimension axis={axis} a={t0} b={t1} at={at} offset={-px(22)} px={px} color="var(--plan-select)" />;
}

/** A Room being drawn: the rectangle, and the inside W × L of the Room it makes (red if it makes none). */
function DrawingRoom({ rect, room, px }: { rect: Rect; room: Rect | null; px: (n: number) => number }) {
  return (
    <g pointerEvents="none">
      <rect
        x={rect.x0}
        y={rect.y0}
        width={rect.x1 - rect.x0}
        height={rect.y1 - rect.y0}
        fill="none"
        stroke={room ? 'var(--plan-select)' : 'var(--plan-overlap)'}
        strokeWidth={1}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
      {room && <RoomDimensions r={room} px={px} />}
    </g>
  );
}
