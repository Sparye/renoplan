# Capture interaction: dimensions first, then arrange

Status: accepted (2026-10-14), validated by a throwaway prototype — see Outcome

The prototype's capture felt off because dragging and attaching blocks was inflexible: blocks and lines overlapped or fought each other, and moves were clamped. The new interaction keeps the author's preferred dimension-first flow but never fights the user.

## Decision

1. The user types the **Outline**'s outside dimensions (optional — if skipped, the Footprint is derived from placed Rooms). It starts as a W × L rectangle; L-shaped houses add a wing (another rectangle) to it. The Outline is **measured**, so dragging never changes it by accident: dragging an exterior Wall that has Rooms against it resizes those Rooms, and the Outline stays put. The Outline itself moves only with ⌥-drag, by dragging an exterior Wall with no Room against it, or by editing its dimensions in the side panel.
2. The user types each Room's **inside** dimensions (wall face to wall face). Rooms appear **on the canvas**, lined up beside the Outline (no side-panel tray). The add-Room form is always at the top of the side panel, whatever is selected, and Enter adds the Room and returns to the name field, so a whole house can be typed in one go.
3. The user arranges Rooms by dragging. Two gestures only, chosen by what is grabbed:
   - **Drag inside a Room** → moves it as a block (detaching it from neighbours).
   - **Drag a Wall** → pushes/pulls it, resizing the Rooms on both sides together.
   - No typing during a drag.
4. Dragging is **free**. Smart guides (magnetic edge snapping, alignment lines, live distances to neighbouring Walls) help; nothing clamps. An Overlap is shown red and left for the user to fix.
5. **Exact values** are edited after placing, in a single side panel: select a Room to edit its W × L (W grows/shrinks rightward, L downward; neighbours never move, so clashes show as Overlaps), or select a Wall to edit its distance to the opposite Wall. No on-canvas dimension editing for now.
6. **Snapping accounts for Wall thickness**: two Rooms snapped together are automatically spaced one interior Wall (~100 mm) apart and fused into one Shared Wall. The user never thinks about thickness during capture.
7. **Openings**: select a Wall → Add door / window / opening at the click point → drag along the Wall; width presets (doors 810 / 860 / custom); flip swing; exact values in the side panel.
8. Irregular Rooms: reshape on canvas, or merge two placed Rooms by removing the Wall between them.
9. Gaps between Rooms inside the Outline become **Unlabelled Space** automatically; overflows are shown as Overlaps. Strips thinner than ~300 mm are measurement slop and are absorbed into the Wall instead.

## Prototype

Throwaway, capture only (points 1–9), on the real stack, in a `prototype/` folder deleted afterwards. **Success bar:** the author captures their own house in under ~15 minutes without the app fighting them.

## Outcome

The author was happy with the prototype and accepted the interaction. No capture time was recorded against the 15-minute bar. The code is kept off `main` on the branch `prototype/capture-interaction` (commit `eba7a63`; run with `bun run prototype`) as a reference, not a base: it stores Rooms as rectangles, while the real core is a Wall graph (ADR 0004).

What the prototype settled, now folded into the Decision above:

- Free drag with magnetic snapping to wall faces, pink alignment guides, and live distances to neighbours (amber when "almost snapped, X mm off") felt right. Defaults: snap radius 8 screen px, 100 mm grid step when nothing is near, interior Wall 100 mm, exterior Wall 200 mm.
- Snapping one interior Wall apart produced Shared Walls without the user ever thinking about thickness; pushing a Shared Wall resized both sides together.
- Dragging an exterior Wall used to move the Outline too, which the author found wrong: the Outline is measured and must stay put (point 1).
- Hiding the add-Room form whenever something was selected made it look like only one Room could be added (point 2).
- Native browser form controls (datalist suggestions, selects) looked off. The real build uses shadcn/ui components, including a combobox for Room names that still accepts free text.

Not covered by the prototype, so still to design in the real build: reshaping a Room by notching it on the canvas (point 8; the prototype only merged Rooms), Structural Marks, persistence, and the Wall-graph core underneath.

## Considered Options

- Draw walls as polylines — homeowners think in rooms, not walls.
- Inventory wizard of room counts — the prototype's start; dropped.
- Tracing an image of an existing plan — deferred until after v1 (image underlay, 2-point scale calibration).
- Typing exact values during a drag — rejected as too complex.
- Clamped dragging that prevents overlap — the prototype's behaviour; the source of the "fighting".

## Consequences

The "Room block" the user drags is an interaction concept; underneath, everything is Walls (ADR 0004). Translating placed blocks into Shared Walls without leaking the graph's complexity was the main risk. The prototype retired it at the interaction level; the real core still has to do the same translation on the Wall graph.
