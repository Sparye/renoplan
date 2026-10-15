# Renoplan Context

Renoplan helps homeowners model an existing single-level floor plan, lock it as a baseline, and explore conceptual renovation scenarios inside the same footprint.

## Language

**Existing Layout**:
The user's current home layout as assembled from room blocks before renovation exploration begins. A locked Existing Layout is used as reference material for renovation scenarios.
_Avoid_: original layout, current plan, old plan

**Baseline**:
A locked version of an Existing Layout, including its room arrangement and derived footprint. A Baseline is not directly edited by renovation scenario work.
_Avoid_: master plan, source plan

**Footprint**:
The outer boundary derived from a Baseline. Renovation scenarios are prevented from leaving the Footprint unless the product explicitly supports footprint-changing work later, and the Footprint remains visible even when the Reference Background is hidden.
_Avoid_: bounds, canvas bounds, shell

**Scenario**:
A proposed renovation layout inside a Baseline's Footprint. A Scenario contains proposed layout work and may show the Baseline as a non-editable reference background.
_Avoid_: copy of baseline, edited baseline

**Baseline Review**:
The mode where a locked Baseline is viewed as the existing layout. It is distinct from Scenario editing, where the Proposed Layout is changed.
_Avoid_: scenario review, locked editor

**Reference Background**:
A scenario-specific, toggleable, non-editable display of unlabeled Baseline room rectangles inside a Scenario. It is visible by default, visually subdued, and helps the user compare against the Existing Layout without causing proposed rooms to collide with existing rooms.
_Avoid_: background layer, ghost plan, overlay

**Proposed Layout**:
The editable room arrangement created inside a Scenario. It starts empty when a Scenario is created and is separate from the Baseline's existing rooms.
_Avoid_: scenario copy, new scenario, proposed rooms layer

**Proposed Room**:
An editable room rectangle that belongs to a Proposed Layout. Proposed Rooms are separate from the rooms captured in a Baseline.
_Avoid_: copied room, baseline room

**Proposed Wall Surface**:
A door-placement surface derived from a Proposed Room rectangle. Proposed Wall Surfaces do not need to model shared-wall relationships between adjacent Proposed Rooms.
_Avoid_: shared proposed wall, shared wall model

**Proposed Room Collision**:
A conflict between editable proposed rooms in a Proposed Layout. Proposed Room Collisions are prevented by clamping moves and resizes to the nearest valid position; Baseline rooms shown in the Reference Background are not collision participants.
_Avoid_: existing room collision, background collision

## Example Dialogue

Designer: "After the homeowner locks the Existing Layout, we create a Baseline from it."

Developer: "When they open a Scenario, do we copy the Baseline rooms into the editable plan?"

Designer: "No. The Scenario starts with an empty Proposed Layout. The Baseline can be shown as a Reference Background, but those existing rooms are not editable and do not collide with proposed rooms."

Developer: "So collision checks for proposed rooms should compare against the Proposed Layout and Footprint, not the Baseline rooms."

Designer: "Yes. Doors can attach to Proposed Wall Surfaces, but we do not need shared-wall modelling for Proposed Rooms yet."
