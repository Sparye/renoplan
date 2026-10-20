# Renoplan Context

Renoplan lets a homeowner capture the existing plan of a single-level house, explore renovation options as Scenarios that change that plan, and compare them side by side. It is for conceptual exploration — not CAD, engineering, permits, or construction drawings.

Product intent and v1 scope live in `docs/intent.md`. Decisions live in `docs/adr/`. The pre-rebuild prototype's docs are kept in `docs/legacy/` for reference only; their terms (Baseline, Proposed Layout, Reference Background…) are retired.

## Language

**Project**:
One house being planned. Holds exactly one Existing Plan and any number of Scenarios.

**Existing Plan**:
The house as it is today, captured by the user. It is the thing every Scenario changes. Always editable — there is no lock and no versioning; Scenarios pick up corrections automatically (ADR 0005).
_Avoid_: baseline, original layout, current plan, locked plan

**Scenario**:
One renovation option, expressed as a set of Changes to the Existing Plan — not a separate copy of the plan.
_Avoid_: proposed layout, option copy, version

**Change**:
A single difference a Scenario makes to the Existing Plan: something Demolished, something New, or something Modified.

**Modified**:
A Change that alters an existing element in place — e.g. a Wall moved 600 mm. Stored as one Change so the element keeps its identity; drawn under Show Changes as Demolished (old position) plus New (new position), because that is what gets built.

**Show Changes**:
A per-Scenario display toggle that draws renovation styling: Demolished Walls dashed, New Walls highlighted.

**Mode**:
The editor is one editor with two Modes: **Existing Plan** and **Scenario**. Same gestures in both; in Scenario Mode, deleting an existing Wall marks it Demolished, removing the Wall between two Rooms merges them, and Draw Wall creates New Walls.
_Avoid_: baseline review, locked editor

**Change Status**:
How an element appears in a Scenario: **Retained** (exists today and stays), **Demolished** (exists today and is removed), or **New** (added by the Scenario). Mirrors the existing / demolish / new convention of renovation drawings.
_Avoid_: deleted, added, proposed

**Outline**:
The outside dimensions of the house that the user enters first during capture, measured over the exterior Walls. Because it is measured, dragging an exterior Wall resizes the Rooms against it, not the Outline (ADR 0007).
_Avoid_: whole area, space, envelope

**Unlabelled Space**:
A region enclosed by Walls that no Room claims — typically a hallway or cupboard the user never measured. Created automatically, shown with its area, ready to be named. Strips thinner than ~300 mm are measurement slop and are absorbed into the Wall instead.
_Avoid_: gap, leftover

**Overlap**:
A visible, non-blocking state where a Room sits on top of another Room or crosses the Outline. Shown in red; the app never blocks or clamps a drag to prevent it.
_Avoid_: collision

**Footprint**:
The outer boundary of the Existing Plan.
_Avoid_: bounds, shell

**Extension**:
Any part of a Scenario that lies outside the Footprint. Allowed, and always flagged in the UI. A Room drawn outside the Outline joins the Scenario's Outline. The Wall it is against stays as an interior Wall, and demolishing it opens the house into the Extension. An Extension's outer Walls are being designed, not measured, so dragging one moves it (ADR 0012).
_Avoid_: addition (ambiguous with a New element)

**Wall**:
An orthogonal (horizontal or vertical) segment of wall with a thickness. Walls are the primary geometry: Rooms are derived from them (ADR 0004). Default thickness is about 200 mm for exterior Walls and 100 mm for interior Walls, editable per Wall.

**Shared Wall**:
A single Wall separating two Rooms. There is never a double wall where two Rooms meet.

**Structural Mark**:
The user's belief that a Wall is load-bearing. It is a note, not an engineering assessment, and drives warnings such as "this Scenario demolishes a Wall marked structural".
_Avoid_: load-bearing (implies verification)

**Opening**:
A door, window, or plain opening hosted by a Wall.

**Room**:
A space enclosed by Walls, with a free-text name and an optional **Room Type** (bedroom, bathroom, kitchen, living, laundry, hallway, other — guessed from the name; drives tint now and Fixture suggestions later). Room dimensions are always inside dimensions. Its shape is derived from the Walls, so it may be any orthogonal polygon (L-shapes, notches). Its area is computed from the inside faces of its Walls.

**Conflict**:
A Change in a Scenario that no longer applies because the Existing Plan was edited underneath it (e.g. the Scenario demolishes a Wall that has since been deleted from the Existing Plan). Shown to the user to resolve.

**Fixture**:
A fixed plumbing or kitchen element (sink, toilet, shower, oven…). Planned for after v1.

**Comparison**:
A side-by-side view of two Scenarios (or a Scenario and the Existing Plan).

**Export**:
A PNG or PDF of one Scenario or one Comparison, for discussing options with other people.
