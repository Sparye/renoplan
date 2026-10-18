import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  Magnet,
  Maximize,
  PenLine,
  Redo2,
  Share,
  SquarePlus,
  Undo2
} from 'lucide-react';
import { serialize } from '@/persistence';
import { Button } from '@/app/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/app/components/ui/dropdown-menu';
import { Input } from '@/app/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/app/components/ui/select';
import { Separator } from '@/app/components/ui/separator';
import { Toggle } from '@/app/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip';
import { type ExportFormat, exportSheet } from '../export';
import { editorFileName, editorSheet } from '../export/editor';
import { download, fileName } from '../files';
import { go } from '../router';
import { useEditorStore } from './context';

const STEPS = [10, 50, 100, 250, 500];

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The floating toolbar over the canvas. */
export function Toolbar() {
  const useEditor = useEditorStore();
  const project = useEditor((s) => s.project);
  const history = useEditor((s) => (s.mode.kind === 'scenario' ? s.scenarios[s.mode.id] : s.history));
  const canUndo = !!history?.past.length;
  const canRedo = !!history?.future.length;
  const snapStep = useEditor((s) => s.snapStep);
  const scenario = useEditor((s) => (s.mode.kind === 'scenario' ? s.mode.id : null));
  const tool = useEditor((s) => s.tool);
  const showChanges = useEditor((s) => !!scenario && !s.changesHidden[scenario]);
  const { undo, redo, fit, rename, setSnapStep, setTool, toggleChanges } = useEditor.getState();
  const [draft, setDraft] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportView = async (format: ExportFormat) => {
    const sheet = editorSheet(useEditor.getState());
    setExporting(true);
    try {
      await exportSheet(sheet, format, editorFileName(sheet, format));
    } catch (e) {
      console.error(e);
      window.alert(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-background/95 absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border p-1 shadow-sm backdrop-blur">
      <Tip label="All projects">
        <Button variant="ghost" size="icon-sm" aria-label="All projects" onClick={() => go({ page: 'home' })}>
          <ArrowLeft />
        </Button>
      </Tip>
      <Input
        aria-label="Project name"
        className="h-8 w-44 border-transparent shadow-none hover:border-input"
        value={draft ?? project.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) rename(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tip label="Undo (⌘Z)">
        <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </Button>
      </Tip>
      <Tip label="Redo (⇧⌘Z)">
        <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </Button>
      </Tip>
      <Tip label="Fit the plan in view">
        <Button variant="ghost" size="icon-sm" aria-label="Fit" onClick={fit}>
          <Maximize />
        </Button>
      </Tip>
      <Select value={String(snapStep)} onValueChange={(v) => setSnapStep(Number(v))}>
        <Tip label="Snap step when nothing is near">
          <SelectTrigger size="sm" className="border-transparent shadow-none" aria-label="Snap step">
            <Magnet className="size-4" />
            <span className="tabular-nums">{snapStep} mm</span>
          </SelectTrigger>
        </Tip>
        <SelectContent>
          {STEPS.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s} mm
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scenario && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tip label="Draw a new wall (W)">
            <Toggle
              size="sm"
              aria-label="Draw wall"
              pressed={tool === 'drawWall'}
              onPressedChange={(on) => setTool(on ? 'drawWall' : 'select')}
            >
              <PenLine /> Draw wall
            </Toggle>
          </Tip>
          <Tip label="Draw a new room: drag a rectangle (R)">
            <Toggle
              size="sm"
              aria-label="Draw room"
              pressed={tool === 'drawRoom'}
              onPressedChange={(on) => setTool(on ? 'drawRoom' : 'select')}
            >
              <SquarePlus /> Draw room
            </Toggle>
          </Tip>
          <Tip label="Show demolished walls dashed and new walls highlighted">
            <Toggle size="sm" aria-label="Show changes" pressed={showChanges} onPressedChange={toggleChanges}>
              {showChanges ? <Eye /> : <EyeOff />} Changes
            </Toggle>
          </Tip>
        </>
      )}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tip label="Save a copy as a file">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const p = useEditor.getState().project;
            download(fileName(p.name), serialize(p));
          }}
        >
          <Download /> Save
        </Button>
      </Tip>
      <DropdownMenu>
        <Tip label="Export what is on screen, to share">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={exporting}>
              <Share /> Export
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => exportView('png')}>
            <FileImage /> PNG image
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportView('pdf')}>
            <FileText /> PDF document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
