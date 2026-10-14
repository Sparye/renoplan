# Renoplan

Capture the existing plan of a single-level house, explore renovation options as Scenarios, and compare them side by side. Conceptual exploration only — not CAD, engineering, or permit drawings.

- Product intent and v1 scope: [`docs/intent.md`](docs/intent.md)
- Domain glossary (use these terms): [`CONTEXT.md`](CONTEXT.md)
- Decisions: [`docs/adr/`](docs/adr/)

## Layout

```
src/core/         framework-free TypeScript: Wall graph, derivation, commands, snapping, undo/redo
src/persistence/  versioned document format (Effect Schema), browser storage, file Save/Open
src/app/          React shell: SVG canvas, side panel, toolbar
e2e/              Playwright tests
```

## Development

Node is not required; everything runs on [Bun](https://bun.sh).

```sh
bun install
bun run dev        # Vite dev server
bun run test       # Vitest unit tests
bun run test:e2e   # Playwright (first time: bunx --bun playwright install chromium)
bun run check      # tsc + eslint + prettier
bun run build
```
