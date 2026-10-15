# Walls are primary; Rooms are derived

Status: accepted

The plan is stored as a graph of orthogonal Walls, each with a thickness. Rooms are the regions the Walls enclose, carrying only a label (and later metadata). Whatever the capture interaction looks like, it creates and edits Walls underneath.

## Considered Options

- Rooms primary, Walls derived from touching edges — the prototype's model. Wall metadata (Structural Mark, Openings) was lost whenever Rooms moved, and irregular Rooms were bolted on.
- Walls primary, Rooms derived. **Chosen.**
- Store both and keep them in sync — two sources of truth.

## Consequences

- Walls have identities, but normal form renumbers them, so Scenario Changes find Walls by where they are (ADR 0010).
- Irregular (orthogonal polygon) Rooms come for free.
- Room areas are computed from inside Wall faces, so Walls must have thickness — they do (default ~200 mm exterior, ~100 mm interior).
- Touching Rooms share one Wall, never two.
- The capture UI's notion of a "room block" must be translated into Walls; the interaction must not leak the graph's complexity to the user.
