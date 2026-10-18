import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { Scenario } from '@/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/app/components/ui/alert-dialog';
import { Button } from '@/app/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/app/components/ui/dropdown-menu';
import { Input } from '@/app/components/ui/input';
import { cn } from '@/app/lib/utils';
import { useEditorStore } from './context';
import { applied } from './store';

/** The Scenario list: the Existing Plan, then each Scenario, as tabs along the bottom of the canvas. */
export function ScenarioTabs() {
  const useEditor = useEditorStore();
  const mode = useEditor((s) => s.mode);
  const order = useEditor((s) => s.project.scenarios);
  const histories = useEditor((s) => s.scenarios);
  const existing = useEditor((s) => s.history.present);
  const { setMode, addScenario, renameScenario, duplicateScenario, deleteScenario } = useEditor.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [doomed, setDoomed] = useState<Scenario | null>(null);

  const tab = (active: boolean) =>
    cn(
      'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap',
      active ? 'bg-foreground text-background' : 'hover:bg-accent'
    );

  return (
    <nav
      aria-label="Scenarios"
      className="bg-background/95 absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border p-1 shadow-sm backdrop-blur"
    >
      <button
        className={tab(mode.kind === 'existing')}
        aria-current={mode.kind === 'existing' ? 'page' : undefined}
        onClick={() => setMode({ kind: 'existing' })}
      >
        Existing plan
      </button>
      {order.map(({ id }) => {
        const s = histories[id]?.present;
        if (!s) return null;
        const active = mode.kind === 'scenario' && mode.id === id;
        const conflicts = applied(existing, s).conflicts.length;
        if (renaming === id)
          return (
            <Input
              key={id}
              autoFocus
              aria-label="Scenario name"
              className="h-8 w-36"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                renameScenario(id, draft);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setDraft(s.name);
                  setRenaming(null);
                }
              }}
            />
          );
        return (
          <div key={id} className={cn(tab(active), 'pr-1')}>
            <button
              className="flex items-center gap-1.5"
              aria-current={active ? 'page' : undefined}
              onClick={() => setMode({ kind: 'scenario', id })}
              onDoubleClick={() => {
                setDraft(s.name);
                setRenaming(id);
              }}
            >
              {s.name}
              {conflicts > 0 && (
                <span
                  className="rounded-full bg-amber-500 px-1.5 text-[11px] leading-4 font-semibold text-white"
                  title={`${conflicts} conflict${conflicts === 1 ? '' : 's'}`}
                >
                  {conflicts}
                </span>
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`${s.name} options`}
                  className={cn('rounded p-0.5', active ? 'hover:bg-background/20' : 'hover:bg-background')}
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(s.name);
                    setRenaming(id);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => duplicateScenario(id)}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDoomed(s)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={addScenario} aria-label="New scenario">
        <Plus /> Scenario
      </Button>

      <AlertDialog open={!!doomed} onOpenChange={(o) => !o && setDoomed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{doomed?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {doomed?.changes.length ?? 0} change{doomed?.changes.length === 1 ? '' : 's'} are removed.
              The existing plan is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => doomed && deleteScenario(doomed.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  );
}
