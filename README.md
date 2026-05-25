# Renoplan

A SvelteKit prototype for simple, conceptual renovation planning.

The app helps homeowners assemble a rough existing single-level floor plan from rectangular room blocks, then explore renovation ideas like resizing rooms, marking shared walls, removing walls, and adding openings.

## Current Features

- Room tray for adding preset room blocks
- SVG floor plan canvas with grid snapping
- Room selection and approximate metric dimensions
- Dragging and resizing room blocks
- Shared walls derived when room edges touch
- Wall actions for structural marks, removal/restoration, and openings
- Undo and redo for editor changes
- Local browser persistence with `localStorage`
- Tailwind CSS styling

## Tech Stack

- SvelteKit
- TypeScript
- Tailwind CSS
- Supabase client scaffold
- Custom SVG editor

## Getting Started

Install dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

Run checks:

```sh
npm run check
npm run lint
npm run build
```

## Environment

Supabase is scaffolded but not required for the current local prototype.

Copy `.env.example` to `.env` when real Supabase credentials are available:

```sh
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```

## Project Status

This is an early prototype. It is intended for visual idea exploration, not construction drawings, code compliance, engineering review, or permit-ready plans.
