# Scenarios are tracked Changes to the Existing Plan

Status: accepted (supersedes legacy ADR 0001, "Empty Proposed Layout Scenarios")

A Scenario is a set of Changes against the Existing Plan, not a blank layout and not an independent copy. Every element in a Scenario has a Change Status — Retained, Demolished, or New — mirroring renovation drawing conventions.

## Considered Options

- Blank slate inside the Footprint, Existing Plan shown as a faded background (the prototype's model).
- Fork the Existing Plan and edit the copy freely, with no tracking.
- Fork with tracked Changes. **Chosen.**

## Consequences

- A renovation is inherently a diff against what exists; tracking it lets the app say "demolishes 2 Walls, 1 with a Structural Mark" and makes Comparisons meaningful.
- Elements of the Existing Plan need stable identities, since Changes refer to them.
- Extensions fall out naturally: New Walls outside the Footprint are just New elements, flagged as Extension.
- What happens to Scenarios when the Existing Plan is edited later is a follow-on decision.
