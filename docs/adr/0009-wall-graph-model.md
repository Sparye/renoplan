# Wall graph model: nodes, centrelines, and Rooms that claim Wall faces

Status: accepted (2026-10-14)

ADR 0004 makes Walls primary and Rooms derived. ADR 0007 needs an Overlap to persist: a Room dropped on another Room, or a W × L edit that never moves neighbours, stays visibly on top of it until the user fixes it. A model where Rooms are only labels on the regions the Walls enclose cannot represent two Rooms on the same floor, so Rooms must know which Wall faces bound them.

## Decision

- The plan is a graph: **nodes** (integer mm points) and **Walls** (an orthogonal centreline between two nodes, with a thickness). Faces sit at `c − ⌊t/2⌋` and `c + ⌈t/2⌉`, so they are integers for any thickness.
- Each Wall face records the Room it bounds, or none: `neg` (left/top face) and `pos` (right/bottom face). A Room is the region inside the loop of faces it claims: the floor its own Walls enclose beside those faces. A pocket they enclose only behind unclaimed faces, such as the inside of an island of Walls standing in the Room, is not the Room's. Geometry lives only in the Walls; a Room record holds a name and a Room Type.
- A **Shared Wall** is a Wall with a Room on both faces. A **run** is what a push/pull grabs: collinear Walls joined through nodes, continuing past a junction only where the same Room (or the Outline) continues along one side — two Rooms whose walls merely line up are not one Wall, as in the prototype.
- A Room claims a face exactly where the face borders its region, bridging only junction material (Walls perpendicular to it), never a parallel neighbour's Wall alongside. Where a parallel Wall's material covers a Wall right across (a Room's own Wall pushed into the Outline from outside), naming the space claims the covering Wall, never the buried one, so two Rooms are never joined through the Outline.
- Every command ends in a **normal form**: coincident nodes merge, a Wall is split where a node sits on its centreline (a T-junction), collinear Walls through a degree-2 node merge when all their attributes match, a Room's own Wall whose inside face lies exactly on another Wall's free face is **fused** into that Wall, stale claims are trimmed to the stretch that borders the Room, and interior Walls bounding no Room are dropped unless they were drawn with Draw Wall (ADR 0010). Walls that cross mid-span (an Overlap) are left alone, and a node where two such straight pairs merely cross is undone, so it never cuts an Opening.
- Moving, resizing and pushing all **detach** the Rooms involved first (each gets its own copy of every Wall it shares, and its own nodes), edit, then let normal form fuse everything back. T-junctions therefore never slide along a neighbour's Wall.
- A command never makes a sound plan unsound: if its result would leave a Room enclosing nothing, a broken Outline, or a claim off its Room, it is a no-op. Property tests over random capture sessions keep this backstop rare (about 1 in 10,000 commands, all in corner cases such as Rooms crossing the Outline at odd Wall thicknesses).
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
- When a Wall splits, the piece that stays put keeps the id, but normal form still retires and renumbers Wall ids freely (pushing a Shared Wall, resizing a Room, detach/re-fuse). So Scenario Changes do not refer to Wall ids: they find their Wall by where it is (ADR 0010).
- Walls of different thickness meeting end to end on one face (a jog) are joined only geometrically, not through a node. Commands avoid creating them (a wing keeps the Wall under a Room, and a wing side flush with the Outline takes the thickness of the Outline Wall it continues; detached copies are never thicker than the exterior Wall they replace); the soundness backstop covers what remains.
