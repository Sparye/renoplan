# Capture interaction: dimensions first, then arrange

Status: proposed — must be validated by a throwaway prototype before the real build

The prototype's capture felt off because dragging and attaching blocks was inflexible: blocks and lines overlapped or fought each other, and moves were clamped. The new interaction keeps the author's preferred dimension-first flow but never fights the user.

## Decision

1. The user types the **Outline**'s outside dimensions (optional — if skipped, the Footprint is derived from placed Rooms). It starts as a W × L rectangle and is reshaped like a Room.
2. The user types each Room's **inside** dimensions (wall face to wall face). Rooms appear **on the canvas**, lined up beside the Outline (no side-panel tray).
3. The user arranges Rooms by dragging. Two gestures only, chosen by what is grabbed:
   - **Drag inside a Room** → moves it as a block (detaching it from neighbours).
   - **Drag a Wall** → pushes/pulls it, resizing the Rooms on both sides together.
   - No typing during a drag.
4. Dragging is **free**. Smart guides (magnetic edge snapping, alignment lines, live distances to neighbouring Walls) help; nothing clamps. An Overlap is shown red and left for the user to fix.
5. **Exact values** are edited after placing, in a single side panel: select a Room to edit its W × L (W grows/shrinks rightward, L downward; neighbours never move, so clashes show as Overlaps), or select a Wall to edit its distance to the opposite Wall. No on-canvas dimension editing for now.
6. **Snapping accounts for Wall thickness**: two Rooms snapped together are automatically spaced one interior Wall (~100 mm) apart and fused into one Shared Wall. The user never thinks about thickness during capture.
7. **Openings**: select a Wall → Add door / window / opening at the click point → drag along the Wall; width presets (doors 810 / 860 / custom); flip swing; exact values in the side panel.
8. Irregular Rooms: reshape on canvas, or merge two placed Rooms by removing the Wall between them.
9. Gaps between Rooms inside the Outline become **Unlabelled Space** automatically; overflows are shown as Overlaps.

## Prototype

Throwaway, capture only (points 1–9), on the real stack, in a `prototype/` folder deleted afterwards. **Success bar:** the author captures their own house in under ~15 minutes without the app fighting them. Accept or revise this ADR based on the result.

## Considered Options

- Draw walls as polylines — homeowners think in rooms, not walls.
- Inventory wizard of room counts — the prototype's start; dropped.
- Tracing an image of an existing plan — deferred until after v1 (image underlay, 2-point scale calibration).
- Typing exact values during a drag — rejected as too complex.
- Clamped dragging that prevents overlap — the prototype's behaviour; the source of the "fighting".

## Consequences

The "Room block" the user drags is an interaction concept; underneath, everything is Walls (ADR 0004). Translating placed blocks into Shared Walls without leaking the graph's complexity is the main risk the prototype must retire.
