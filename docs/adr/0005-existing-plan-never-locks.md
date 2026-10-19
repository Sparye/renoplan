# The Existing Plan never locks

Status: accepted (replaces the prototype's lock-and-version Baseline model)

The Existing Plan stays editable for the life of a Project. Because Scenarios are tracked Changes (ADR 0001), corrections to the Existing Plan flow into every Scenario automatically. A Change that no longer applies becomes a Conflict the user resolves in that Scenario.

## Considered Options

- Lock, then create a new version when editing; old Scenarios pinned to the old version — the prototype's model, which added conceptual weight.
- Lock, and discard Scenarios to edit.
- Never lock; Scenarios follow automatically. **Chosen.**

## Consequences

Capture can be imperfect the first time without penalty. The change model must be able to detect Changes whose target has moved or vanished, and present them as Conflicts.

ADR 0010 reads "moved" as moved beyond recognition: a Wall that moved but still bounds the same Rooms is followed, not a Conflict.
