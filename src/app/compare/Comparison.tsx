import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { FileDown, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/app/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Separator } from '@/app/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip';
import { useEditorStore } from '../editor/context';
import { PlanDrawing } from '../editor/PlanDrawing';
import { type Mode, type View, comparedApplied } from '../editor/store';
import { type ExportFormat, exportSheet } from '../export';
import { comparisonSheet } from '../export/comparison';
import { exportName } from '../files';

/** Zooms by a factor about a point on screen, within the editor's zoom range. */
function zoomAt(v: View, mx: number, my: number, factor: number): View {
  const s = Math.min(1, Math.max(0.004, v.s * factor));
  return { s, tx: mx - (mx - v.tx) * (s / v.s), ty: my - (my - v.ty) * (s / v.s) };
}

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The Comparison: two read-only panes side by side in one shared view. It replaces the canvas. */
export function Comparison() {
  const useEditor = useEditorStore();
  const { fitCompare, setCompareView, closeCompare } = useEditor.getState();

  useEffect(() => {
    requestAnimationFrame(() => useEditor.getState().fitCompare());
  }, [useEditor]);

  const [exporting, setExporting] = useState(false);
  const exportComparison = async (format: ExportFormat) => {
    const sheet = comparisonSheet(useEditor.getState());
    if (!sheet) return;
    setExporting(true);
    try {
      await exportSheet(sheet, format, exportName(sheet.project, sheet.title, format));
    } catch (e) {
      console.error(e);
      window.alert(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const zoom = (factor: number) => {
    const { size } = useEditor.getState().compare!;
    setCompareView((v) => zoomAt(v, size.w / 2, size.h / 2, factor));
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <h1 className="mr-2 text-sm font-semibold">Comparison</h1>
        <Tip label="Fit both plans in view">
          <Button variant="ghost" size="icon-sm" aria-label="Fit" onClick={fitCompare}>
            <Maximize />
          </Button>
        </Tip>
        <Tip label="Zoom out">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>
            <ZoomOut />
          </Button>
        </Tip>
        <Tip label="Zoom in">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            <ZoomIn />
          </Button>
        </Tip>
        <div className="flex-1" />
        <DropdownMenu>
          <Tip label="Export the comparison, to share">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Export comparison" disabled={exporting}>
                <FileDown /> Export
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => exportComparison('png')}>PNG image</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportComparison('pdf')}>PDF document</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tip label="Back to the editor (Esc)">
          <Button size="sm" onClick={closeCompare}>
            Done
          </Button>
        </Tip>
      </header>
      <div className="flex min-h-0 flex-1">
        <Pane which="left" />
        <div className="w-px shrink-0 bg-border" />
        <Pane which="right" />
      </div>
    </div>
  );
}

const sideValue = (m: Mode) => (m.kind === 'existing' ? 'existing' : `scenario:${m.id}`);

function Pane({ which }: { which: 'left' | 'right' }) {
  const useEditor = useEditorStore();
  const side = useEditor((s) => s.compare![which]);
  const view = useEditor((s) => s.compare!.view);
  const existing = useEditor((s) => s.history.present);
  const a = useEditor((s) => comparedApplied(s, side));
  const order = useEditor((s) => s.project.scenarios);
  const histories = useEditor((s) => s.scenarios);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view0: View } | null>(null);
  const label = which === 'left' ? 'Left side' : 'Right side';
  const conflicts = a?.conflicts.length ?? 0;

  // Size (both panes are the same size, so the left one reports it) and wheel pan/zoom.
  useEffect(() => {
    const el = svg.current!;
    const { setCompareSize, setCompareView } = useEditor.getState();
    const measure = () => setCompareSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = which === 'left' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (ro) measure();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCompareView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect();
          return zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
        }
        return { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [useEditor, which]);

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view0: useEditor.getState().compare!.view };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    useEditor
      .getState()
      .setCompareView({ ...d.view0, tx: d.view0.tx + e.clientX - d.x, ty: d.view0.ty + e.clientY - d.y });
  };
  const onUp = () => (drag.current = null);

  return (
    <section aria-label={label} className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Select
          value={sideValue(side)}
          onValueChange={(v) =>
            useEditor
              .getState()
              .setCompareSide(
                which,
                v === 'existing'
                  ? { kind: 'existing' }
                  : { kind: 'scenario', id: v.slice('scenario:'.length) }
              )
          }
        >
          <SelectTrigger size="sm" aria-label={label} className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="existing">Existing plan</SelectItem>
            {order.map(({ id }) => {
              const sc = histories[id]?.present;
              return sc ? (
                <SelectItem key={id} value={`scenario:${id}`}>
                  {sc.name}
                </SelectItem>
              ) : null;
            })}
          </SelectContent>
        </Select>
        {conflicts > 0 && (
          <span
            role="status"
            className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
            title="Changes that no longer apply because the existing plan was edited. They are skipped here; resolve them in the scenario."
          >
            {conflicts} conflict{conflicts === 1 ? '' : 's'} skipped
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <svg
          ref={svg}
          className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ background: 'var(--plan-paper)' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          data-testid={`compare-${which}`}
        >
          <g data-view="" transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
            <PlanDrawing
              plan={a?.plan ?? existing}
              s={view.s}
              changes={a && { existing, statuses: a.statuses }}
            />
          </g>
        </svg>
      </div>
    </section>
  );
}
