# Orthogonal geometry only

Status: accepted

All Walls are horizontal or vertical. Rooms may be any orthogonal polygon (L-shapes, notches, alcoves), but there are no angled or curved walls.

## Considered Options

- Rectangles only — the prototype's original rule, which it outgrew in practice (it later bolted on irregular shapes).
- Orthogonal polygons. **Chosen.**
- Arbitrary angles and curves — the path to CAD complexity.

## Consequences

Most houses fit. Combined with integer millimetres (ADR 0003), orthogonal geometry stays exact: no floating-point intersection bugs. An occasional bay window or angled wall must be approximated.
