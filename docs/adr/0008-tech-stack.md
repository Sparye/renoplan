# Tech stack

Status: accepted

- **React + TypeScript + Vite** for the app shell. Replaces SvelteKit, mainly for the larger canvas/editor ecosystem.
- **A framework-free TypeScript core** — geometry, the Wall graph, the Change model, commands and undo/redo — as plain pure functions with exhaustive unit tests. The UI is a thin shell over it.
- **SVG rendering** — easy to style, hit-test, and export to PNG/PDF.
- **Effect Schema** for the versioned document format (decoding and migrations). Effect may also be used in the persistence/export layer. Effect is *not* used in the core or in React components: the core is synchronous pure logic where Effect adds weight without safety.
- **Zustand** for UI state, **Tailwind + shadcn/ui** for chrome, **Vitest + Playwright** for tests.

- **Hosting**: static deploy of `main` to Cloudflare Pages (free tier); GitHub Pages as the fallback. Projects remain per-browser; Save/Open moves them between machines.
- **Clean slate**: the prototype's SvelteKit `src/`, configs, and tests are deleted when the real build starts (git history keeps them).

## Considered Options

- Staying on SvelteKit.
- tldraw SDK as the canvas foundation — free pan/zoom/selection, but a paid production licence and a data model that fights ours.
- Canvas/PixiJS rendering — unnecessary at house-plan scale.
- Effect throughout — wrong fit for pure synchronous geometry.
