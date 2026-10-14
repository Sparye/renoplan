# Renoplan Intent

Last updated: 2026-10-14

## Why rebuild

The pre-rebuild prototype (see `docs/legacy/`) got the intent right but the UI, UX, and the interaction for creating a design wrong. The rebuild keeps only the intent; tech stack, model, and interaction are all open to rework. **The quality of the design interaction is the primary success criterion.**

## Audience

Personal-first, product-shaped. The author is user zero: no accounts, onboarding, or analytics until the core loop proves useful — but the data model and module boundaries stay clean enough to grow into a homeowner product.

## Platform

Desktop web first. No phone or tablet design work in v1.

## What went wrong with the prototype's interaction

Dragging and attaching room blocks felt off and inflexible: blocks and lines overlapped or fought each other. The rebuild must keep the dimension-first capture the author likes while fixing that feel.

## Core loop (v1 is exactly this)

1. **Capture** the Existing Plan — built first, and must be excellent; everything downstream depends on it. Enter the Outline's outside dimensions, enter each Room's dimensions, then drag Rooms into place (ADR 0007, validated by the prototype).
2. **Create Scenarios** as tracked Changes to the Existing Plan (ADR 0001).
3. **Compare** two Scenarios side by side with linked pan/zoom, plus a summary table: area per Room, total area, Walls demolished, Walls with a Structural Mark touched, Extension area. Every Scenario also has a **Show Changes** toggle that draws Demolished Walls dashed and New Walls highlighted.
4. **Export** a Scenario or Comparison as PNG/PDF.

## v1 plan content

- Walls (orthogonal), with an optional Structural Mark
- Openings: doors, windows, plain openings
- Rooms with labels and computed areas
- Extensions beyond the Footprint are allowed in the model and flagged in the UI; polish is not a v1 goal

Next: Fixtures, plan-image tracing. Later: furniture.

## Look and feel

Architectural drawing style: white background, solid dark Walls, door swing arcs, dimension lines, soft Room tints by Room Type. Minimal chrome: a floating toolbar, one side panel, a Scenario list.

## Editing defaults

- Undo/redo: one history per Existing Plan and per Scenario, session only.
- Autosave to browser storage on every committed edit; Save/Open file for backup.
- Pan with trackpad/scroll or space-drag; zoom with pinch or ctrl/cmd+scroll.
- Keyboard: undo, redo, delete selection, escape to deselect.
- Passive warnings only: Overlap, demolishing a Wall with a Structural Mark, Extension, Conflict.
- A simple Project list on the home screen.

## Build order

1. ~~**Throwaway capture prototype** (ADR 0007)~~ — done 2026-10-14; the interaction was accepted. The code is on the branch `prototype/capture-interaction`.
2. Real core + capture.
3. Scenarios, Comparison, Export.

## Persistence

Local-first: projects live in the browser, with Save/Open as a versioned JSON file for backup and moving machines. No accounts or cloud in v1.

## Units

Metric only. Integer millimetres internally, metres for display, configurable snap step (ADR 0003).

## Non-goals

CAD-grade drafting, multi-level homes, angled or curved walls, structural assessment, code/permit compliance, cost estimation, 3D, live collaboration.
