import { useState } from 'react';
import { ArrowLeft, Download, Magnet, Maximize, Redo2, Undo2 } from 'lucide-react';
import { serialize } from '@/persistence';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/app/components/ui/select';
import { Separator } from '@/app/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip';
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
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const snapStep = useEditor((s) => s.snapStep);
  const { undo, redo, fit, rename, setSnapStep } = useEditor.getState();
  const [draft, setDraft] = useState<string | null>(null);

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
    </div>
  );
}
