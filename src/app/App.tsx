import { TooltipProvider } from '@/app/components/ui/tooltip';
import { Button } from '@/app/components/ui/button';
import { Editor } from './editor/Editor';
import { Home } from './home/Home';
import { projects } from './projects';
import { go, useRoute } from './router';

export function App() {
  const route = useRoute();
  let page = <Home />;
  if (route.page === 'project') {
    const project = projects.load(route.id);
    page = project ? (
      <Editor key={project.id} project={project} />
    ) : (
      <div className="grid h-full place-items-center">
        <div className="space-y-3 text-center">
          <p className="text-muted-foreground text-sm">That project isn’t in this browser.</p>
          <Button variant="outline" onClick={() => go({ page: 'home' })}>
            All projects
          </Button>
        </div>
      </div>
    );
  }
  return <TooltipProvider delayDuration={400}>{page}</TooltipProvider>;
}
