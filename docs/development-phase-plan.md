# Renoplan Development Phase Plan

Last updated: 2026-05-25

## Product Direction

Build a desktop web app for homeowners who want to explore conceptual renovation options for an existing single-level house. The app is not a CAD, engineering, permit, or construction drawing tool. Its job is to help a homeowner assemble their current floor plan from rectangular room blocks, lock that existing baseline, then create and compare renovation scenarios inside the same footprint.

## Confirmed MVP Decisions

- Platform: desktop web first.
- Stack: SvelteKit, TypeScript, Supabase, custom SVG editor.
- Backend: Supabase-first; no separate custom API server for MVP.
- Auth: Google social login only.
- Data storage: relational metadata plus JSON plan documents.
- Rendering: SVG editor, not Konva/canvas for MVP.
- House model: single-level only.
- Units: metric only.
- Plan model: rectangular room blocks only.
- Grid: 0.25m conceptual increments, snap enabled by default and toggleable.
- Existing plan setup: user enters room inventory, app generates room blocks into a left tray, user assembles them on the canvas, footprint is derived from assembled blocks, then user locks the baseline.
- Baseline editing: unlocking creates a new baseline version; existing scenarios stay attached to the old baseline.
- Scenario model: scenarios start as full copies of a baseline.
- Scenario edits: move shared walls, split rooms, open/remove walls, add/remove doors/openings, move objects, and rename room uses while keeping exterior footprint locked.
- New rooms: created only by splitting/relabeling existing space.
- Wall model: shared walls can be marked structural, removed/restored, and given doors/openings.
- Doors/openings: move and resize along wall.
- Object library: kitchen appliances, bathroom fixtures, basic furniture, doors/openings/windows.
- Object behavior: preset sizes, user-resizable, 90-degree rotation only.
- Constraints: soft/passive warnings only; do not block edits.
- Validation: no required validation before locking baseline.
- Undo/redo: editor actions use local browser history.
- Save: debounced autosave plus immediate save for major actions.
- Offline: local edits continue, sync later.
- Sync conflict policy: last write wins silently for MVP.
- Comparison: side-by-side scenario compare; cross-baseline comparison allowed with warning.

## Already Complete

These items exist in the current repository and should be treated as completed foundation work, not planned work.

- SvelteKit project scaffold exists at `/Users/samuelchen/Dev/renoplan`.
- Dependencies are installed and locked in `package-lock.json`.
- Tailwind CSS, shadcn-svelte scaffold, Inter font, and lucide dependency are present.
- Supabase client scaffold exists at `src/lib/supabase.ts`.
- Domain types exist at `src/lib/domain/types.ts` for rooms, walls, openings, plan objects, plan documents, baseline versions, scenarios, and tray templates.
- Editor store exists at `src/lib/editor/editorStore.ts`.
- Current editor state supports:
  - initial sample plan
  - tray room templates
  - localStorage persistence
  - room add from tray
  - room move
  - room resize with handles
  - grid snapping
  - selected room and selected wall state
  - shared wall derivation when room edges touch
  - wall structural flag
  - wall removed/restored flag
  - adding openings to walls
  - undo/redo stacks
  - simulated saved/saving status
- Main page exists at `src/routes/+page.svelte` with:
  - left room tray
  - setup checklist
  - selected room panel
  - selected wall panel
  - undo/redo buttons
  - snap toggle
  - reset button
  - SVG canvas with room blocks, labels, resize handles, shared walls, removed walls, and opening rendering
- `README.md` documents current features and commands.
- `npm run check` passes with 0 errors and 0 warnings.
- `npm run build` succeeds.

## Current Gaps

- There is no project dashboard.
- There is no real Google login flow.
- Supabase credentials/schema/RLS are not configured.
- Editor data is localStorage-only.
- There is no project/baseline/scenario route structure yet.
- Room inventory entry is not implemented; tray templates are static.
- Placed tray blocks are not tracked against an inventory source of truth.
- Footprint derivation is not implemented as a first-class model.
- Baseline lock/unlock and baseline versioning are not implemented.
- Scenario creation, grouping, and side-by-side comparison are not implemented.
- Shared wall resize does not yet push/pull the neighboring room as a single boundary operation.
- Room splitting is not implemented.
- Door/opening move/resize is not implemented.
- Object/furniture library is not implemented.
- Passive warnings are not implemented.
- Offline sync queue is not implemented.
- Autosave is simulated locally, not cloud-backed.
- There are no unit tests for geometry/editor rules.
- There are no browser tests for core editor workflows.

## Phase 0: Foundation Hardening

Goal: make the current prototype easier to extend safely before adding more product surface.

Scope:

- Split large `+page.svelte` into focused components:
  - `RoomTray.svelte`
  - `EditorToolbar.svelte`
  - `FloorCanvas.svelte`
  - `RoomLayer.svelte`
  - `WallLayer.svelte`
  - `SelectionPanel.svelte`
- Move geometry helpers out of the store into `src/lib/geometry`.
- Keep the canonical domain model independent from Svelte components and SVG rendering.
- Add basic unit tests for pure geometry functions.
- Add a small sample plan fixture for tests and development.
- Decide and document route conventions.

Deliverables:

- Componentized editor shell.
- Pure geometry module.
- First unit test suite.
- Clean `npm run check`, `npm run build`, and test command.

Exit criteria:

- Existing drag, resize, wall derivation, wall actions, opening rendering, undo/redo, and local persistence still work.
- Geometry logic can be tested without rendering Svelte.

## Phase 1: Existing Plan Setup From Inventory

Goal: replace static tray templates with the real baseline setup flow.

Scope:

- Add an initial project setup route or state:
  - project name
  - room inventory counts
  - room types: bedroom, toilet, bathroom, kitchen, living, dining, laundry, storage, garage, generic
- Generate room blocks from inventory:
  - Bedroom 1, Bedroom 2, etc.
  - sensible default dimensions per type
  - generated templates appear in the room tray
- Track inventory item status:
  - unplaced
  - placed
  - selected
- Allow revising inventory before baseline lock.
- Remove or mark tray blocks as placed when added to the canvas.
- Allow returning placed blocks to the tray.
- Rename rooms during setup.

Deliverables:

- Inventory-driven room tray.
- Baseline setup flow inside editor.
- Room status state in the plan/setup model.

Exit criteria:

- A user can create a new local project, enter existing room counts, get generated room blocks, assemble them, resize them, and revise the inventory before locking.

## Phase 2: Geometry Model And Footprint

Goal: make the rectangular room model robust enough for baseline locking and scenario constraints.

Scope:

- Add explicit footprint model derived from assembled rooms.
- Define exterior wall detection separately from shared wall detection.
- Preserve wall metadata when room geometry changes where possible.
- Implement overlap detection for rooms.
- Implement rectangular enclosed gap detection for future hallway suggestions.
- Add a first version of footprint boundary rendering.
- Add passive warning types:
  - room overlap
  - object outside room
  - object overlap
  - room outside locked footprint
  - opening without wall
- Add no-blocker warning UI.

Deliverables:

- `Footprint` type and derivation function.
- Exterior/shared wall distinction in plan document.
- Warning calculation module.
- Footprint overlay on canvas.

Exit criteria:

- The app can derive and render the existing footprint from room blocks.
- Warnings can be computed without blocking baseline lock.

## Phase 3: Baseline Locking And Versioning

Goal: turn the setup canvas into a real existing-plan baseline that can be locked and versioned.

Scope:

- Add baseline state:
  - draft setup
  - locked baseline
  - unlocked editing creates new baseline version
- Add lock baseline action.
- Add unlock baseline action.
- Implement "create new baseline version" from an existing baseline.
- Add baseline version metadata:
  - name
  - version number
  - created at
  - locked state
- Add project tree UI with grouped baseline versions and child scenarios.
- Keep old scenarios attached to their original baseline.

Deliverables:

- Baseline lock/unlock/versioning model.
- Project tree UI shell.
- Baseline version selection.

Exit criteria:

- A user can lock an existing plan, later create a revised baseline version, and still see old scenarios grouped under the old baseline.

## Phase 4: Renovation Scenario Editing

Goal: support the core renovation actions inside a locked footprint.

Scope:

- Create scenario as full copy of selected baseline.
- Implement scenario rename/delete.
- Enforce exterior footprint lock for normal scenario edits.
- Implement shared wall resize:
  - dragging a shared wall adjusts both neighboring rectangles
  - the total footprint area does not expand
  - minimum room sizes are respected
- Implement full vertical/horizontal room split.
- Implement room relabel/rename.
- Keep open connection as a wall state; do not true-merge rooms.
- Improve wall action panel:
  - mark structural
  - remove wall
  - restore wall
  - add door/opening
- Add passive warnings for structural wall removal.

Deliverables:

- Scenario CRUD in local state.
- Shared wall push/pull resize.
- Full room split action.
- Locked footprint constraints for scenario edits.

Exit criteria:

- A user can create "Option A" from a locked baseline, split a living room into a bedroom, move an internal shared wall, remove/open a kitchen-living wall, and keep the exterior footprint unchanged.

## Phase 5: Doors, Openings, Windows, And Wall Editing Polish

Goal: make walls useful enough for renovation planning.

Scope:

- Add selectable opening objects.
- Move opening along a wall.
- Resize opening along a wall.
- Support opening kinds:
  - standard door
  - sliding door
  - plain opening
  - window
- Render door/window symbols in a clean architectural style.
- Prevent opening geometry from exceeding wall bounds by clamping, with passive warning if needed.
- Allow deleting openings.
- Make removed wall and opening states visually distinct.

Deliverables:

- Opening selection panel.
- Opening move/resize interactions.
- Window support.
- Better architectural symbols.

Exit criteria:

- A user can add a door to a shared wall, drag it along that wall, resize it, change it to an opening/window, and delete it.

## Phase 6: Furniture, Appliances, And Fixtures

Goal: let homeowners test whether rooms remain usable after reorganization.

Scope:

- Add object library:
  - fridge
  - stove/oven
  - sink
  - dishwasher
  - counter
  - toilet
  - shower
  - bath
  - vanity/sink
  - bed
  - wardrobe
  - sofa
  - dining table
  - desk
- Preset default sizes for each object.
- Drag objects from library onto canvas.
- Move, resize, and rotate objects in 90-degree increments.
- Snap objects to grid.
- Optional snap to walls for appliances/fixtures.
- Add passive warnings for object overlaps, objects crossing walls, and objects outside rooms.

Deliverables:

- Object library panel.
- Object rendering and selection.
- Object move/resize/rotate.
- Object warnings.

Exit criteria:

- A user can move the fridge, place a bed in a newly split bedroom, rotate furniture, and see passive warnings for obvious layout conflicts.

## Phase 7: Scenario Comparison

Goal: support the core reason for scenarios: comparing renovation options.

Scope:

- Add side-by-side compare view.
- Select any two scenarios for comparison.
- Allow cross-baseline compare with a clear warning.
- Keep compare read-only for MVP.
- Show scenario names, baseline version labels, and updated dates.
- Add synced pan/zoom only if needed after basic compare works.

Deliverables:

- Compare route or compare mode.
- Two read-only SVG plan views.
- Cross-baseline warning.

Exit criteria:

- A user can compare "Existing v1 / Option A" and "Existing v1 / Option B" side by side, and can compare across baselines with a warning.

## Phase 8: Supabase Auth And Cloud Persistence

Goal: replace local-only prototype storage with production-shaped accounts and cloud save.

Scope:

- Configure Supabase project.
- Add Google OAuth.
- Add auth callback route.
- Add authenticated app shell.
- Add database tables:
  - `profiles`
  - `projects`
  - `baseline_versions`
  - `scenarios`
  - `plan_snapshots` or JSON columns on baseline/scenario rows
- Add Row Level Security so users can access only their own projects.
- Store relational metadata in columns.
- Store plan JSON in Supabase.
- Add project dashboard backed by Supabase.
- Add autosave to Supabase:
  - debounced saves for ordinary edits
  - immediate saves for major actions
- Keep localStorage/IndexedDB as local draft cache.

Deliverables:

- Google login.
- Project dashboard.
- Cloud-backed project/baseline/scenario storage.
- RLS policies and migration SQL.

Exit criteria:

- A signed-in user can create a project, edit a plan, leave, return later, and see the saved project from Supabase.

## Phase 9: Offline Editing And Autosave Trust

Goal: make long-running homeowner projects resilient.

Scope:

- Replace localStorage-only persistence with IndexedDB draft storage.
- Queue pending saves while offline.
- Show save status:
  - saved
  - saving
  - offline changes
  - sync error
- Sync queued changes when online.
- Use last-write-wins for MVP conflicts.
- Add "last saved at" metadata.
- Add recovery behavior for failed saves.

Deliverables:

- Offline draft queue.
- Visible save state.
- Retry behavior.

Exit criteria:

- A user can keep editing when offline and have changes sync once the connection returns.

## Phase 10: Product Polish And Usability

Goal: make the MVP feel like a coherent homeowner tool instead of a geometry demo.

Scope:

- Add empty states and first-use guidance without turning the app into a landing page.
- Improve toolbar with icons and tooltips.
- Add pan and zoom.
- Add keyboard shortcuts:
  - undo
  - redo
  - delete selected
  - escape deselect
  - rotate object
- Improve selected panels for room, wall, opening, and object.
- Improve color palette by room type while keeping the architectural style calm.
- Add project tree interactions.
- Add accessible names and keyboard affordances for primary controls.
- Add browser tests for the main happy paths.

Deliverables:

- Polished desktop editor shell.
- Keyboard support.
- Playwright/browser workflow tests.

Exit criteria:

- The main workflows are understandable without developer explanation and pass visual/browser smoke checks.

## Phase 11: MVP Beta Readiness

Goal: prepare for real homeowner testing.

Scope:

- Add analytics events for core funnels:
  - project created
  - baseline locked
  - scenario created
  - room split
  - wall removed
  - compare opened
- Add error monitoring.
- Add backup/export of project JSON for support.
- Add privacy/security review for Supabase RLS.
- Add seed/demo project for demos.
- Write user-facing limitations:
  - conceptual only
  - not engineering advice
  - verify structural changes with professionals
- Add deployment target and adapter configuration.

Deliverables:

- Beta deployment.
- Demo project.
- Monitoring.
- Support/export path.

Exit criteria:

- A small group of users can sign in, create projects, save work, return later, and compare renovation options without developer intervention.

## Recommended Implementation Order

1. Refactor current editor into components and geometry modules.
2. Add tests around shared walls, snapping, resizing, and wall metadata preservation.
3. Implement inventory-driven setup and tray placement.
4. Add footprint derivation and baseline lock.
5. Add local scenario model and scenario creation.
6. Implement shared-wall push/pull resize and full room split.
7. Add movable/resizable openings.
8. Add object library.
9. Add side-by-side compare.
10. Add Supabase auth and cloud persistence.
11. Add offline sync queue.
12. Polish, test, and deploy beta.

## Suggested Near-Term Milestone

The next milestone should be "Local Baseline MVP":

- Inventory entry creates tray blocks.
- User assembles room blocks.
- Footprint is derived.
- Baseline can be locked locally.
- Scenario can be created from locked baseline.
- Scenario can split a room and remove a wall.
- Everything remains local-only but covered by tests.

This milestone proves the product's core renovation loop before investing in Supabase schema and cloud save.

## Test Strategy

- Unit tests for pure geometry:
  - snap value
  - rectangle overlap
  - shared wall detection
  - exterior wall detection
  - footprint derivation
  - room split
  - shared wall resize
  - opening bounds
- Store tests for editor actions:
  - history capture
  - undo/redo
  - scenario creation
  - baseline versioning
  - local persistence
- Browser tests for workflows:
  - create inventory and place rooms
  - drag/resize room
  - select shared wall and remove it
  - add/move opening
  - create scenario and compare
  - autosave status changes

## Risks To Watch

- Geometry complexity can creep beyond rectangles. Hold the line until MVP proves value.
- Shared wall metadata can be lost when IDs change. Preserve IDs or migrate metadata deliberately.
- SVG interactions can get tangled if rendering and domain state are mixed. Keep domain logic pure.
- Supabase JSON shape can drift. Version plan documents early.
- Autosave plus undo/redo can create confusing save states. Define exactly when history and saves are captured.
- Baseline versioning can confuse users. Keep the project tree simple and visible.
- Passive warnings can become noisy. Prioritize warnings that help renovation decisions.

## Out Of Scope For MVP

- CAD-grade drafting.
- Multi-level homes.
- Image/PDF floor plan tracing.
- AI floor plan extraction.
- Freeform polygon rooms.
- Angled walls.
- True room merging.
- Extensions outside the existing footprint.
- Live collaboration.
- Sharing/export.
- Cost estimation.
- Structural safety assessment.
- Permit/code compliance.
- 3D rendering.
