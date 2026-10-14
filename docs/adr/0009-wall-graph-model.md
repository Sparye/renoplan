# Wall graph model: nodes, centrelines, and Rooms that claim Wall faces

Status: accepted (2026-10-14)

ADR 0004 makes Walls primary and Rooms derived. ADR 0007 needs an Overlap to persist: a Room dropped on another Room, or a W × L edit that never moves neighbours, stays visibly on top of it until the user fixes it. A model where Rooms are only labels on the regions the Walls enclose cannot represent two Rooms on the same floor, so Rooms must know which Wall faces bound them.

## Decision

- The plan is a graph: **nodes** (integer mm points) and **Walls** (an orthogonal centreline between two nodes, with a thickness). Faces sit at `c − ⌊t/2⌋` and `c + ⌈t/2⌉`, so they are integers for any thickness.
- Each Wall face records the Room it bounds, or none: `neg` (left/top face) and `pos` (right/bottom face). A Room is the region inside the loop of faces it claims. Geometry lives only in the Walls; a Room record holds a name and a Room Type.
- A **Shared Wall** is a Wall with a Room on both faces. A **run** — collinear Walls with the same centreline and thickness, joined through nodes — is what a push/pull moves.
- Every command ends in a **normal form**: coincident nodes merge, a Wall is split where a node sits on its centreline (a T-junction), collinear Walls through a degree-2 node merge when all their attributes match, and a Room's own Wall whose inside face lies exactly on another Wall's free face is **fused** into that Wall. Walls that cross mid-span (an Overlap) are left alone.
- Everything else is derived by exact flood fill over a coordinate-compressed grid: Room regions and areas, Unlabelled Space, absorbed strips, Overlap, the Footprint.
- Ids come from a counter in the plan, so commands are pure, deterministic functions. Openings are positioned by an absolute coordinate along their Wall, so splitting and merging Walls never has to recompute them.

## Considered Options

- Rooms are faces of a planar graph, carrying only a label — cannot represent an Overlap.
- Overlapping Rooms held outside the graph as floating blocks until resolved — two representations of a Room, and every command has to know which one it is touching.
- Wall segments stored as material rectangles with junctions derived from contact — avoids half-millimetre faces, but a push/pull has to move split points on other Walls by hand. Nodes make that automatic.
- Rooms store their loop of Wall ids — the same information as face claims, but non-local: splitting a Wall means rewriting Room records.

## Consequences

- Snapping a Room one interior Wall from another makes its inside face land on the neighbour's free face, so fusion produces a Shared Wall without the user thinking about thickness. Snapping against the Outline makes the exterior Wall bound the Room.
- Moving a Room first detaches it: the neighbour keeps each Shared Wall (with its id and Openings) and the moving Room gets a copy.
- When a Wall splits, the piece that stays put keeps the id. Scenario Changes refer to Wall ids, so Existing Plan edits can still retire ids; ADR 0005's Conflicts cover that.
