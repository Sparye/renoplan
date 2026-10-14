import { useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { emptyPlan } from '@/core';
import { type Project, type ProjectSummary, parse } from '@/persistence';
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
import { pickFile } from '../files';
import { newId, projects } from '../projects';
import { go } from '../router';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The Project list (docs/intent.md: a simple list on the home screen). */
export function Home() {
  const [list, setList] = useState<ProjectSummary[]>(() => projects.list());
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<
    { kind: 'delete'; project: ProjectSummary } | { kind: 'replace'; project: Project } | null
  >(null);
  const refresh = () => setList(projects.list());

  const create = () => {
    const now = new Date().toISOString();
    const project: Project = {
      id: newId(),
      name: 'Untitled house',
      createdAt: now,
      updatedAt: now,
      existingPlan: emptyPlan()
    };
    projects.save(project);
    go({ page: 'project', id: project.id });
  };
  const open = async () => {
    const text = await pickFile();
    if (text === null) return;
    const r = parse(text);
    if (!r.ok) return setError(r.error);
    setError('');
    if (projects.load(r.project.id)) setConfirm({ kind: 'replace', project: r.project });
    else {
      projects.save(r.project);
      go({ page: 'project', id: r.project.id });
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Renoplan</h1>
          <p className="text-muted-foreground text-sm">
            Capture your house, then explore renovation options.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={open}>
            <FolderOpen /> Open file
          </Button>
          <Button onClick={create}>
            <Plus /> New project
          </Button>
        </div>
      </header>
      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      {list.length ? (
        <ul className="divide-y rounded-lg border">
          {list.map((p) => (
            <li key={p.id} className="group flex items-center">
              <button
                className="hover:bg-accent flex flex-1 items-baseline justify-between px-4 py-3 text-left"
                onClick={() => go({ page: 'project', id: p.id })}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground text-xs">edited {when(p.updatedAt)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="mr-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Delete ${p.name}`}
                onClick={() => setConfirm({ kind: 'delete', project: p })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
          No projects yet. Start a new one, or open a file you saved.
        </div>
      )}
      <p className="text-muted-foreground mt-6 text-xs">
        Projects live in this browser. Use Save in the editor to keep a copy as a file or move it to another
        machine.
      </p>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          {confirm?.kind === 'delete' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{confirm.project.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  It is removed from this browser. A file you saved is not affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    projects.remove(confirm.project.id);
                    refresh();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirm?.kind === 'replace' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace “{confirm.project.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This browser already has this project. Opening the file replaces the copy here with the one
                  in the file.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    projects.save(confirm.project);
                    go({ page: 'project', id: confirm.project.id });
                  }}
                >
                  Replace
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
