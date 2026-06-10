# Empty Proposed Layout Scenarios

Status: accepted

Renoplan scenarios start with an empty Proposed Layout inside the selected Baseline's Footprint, while the locked Baseline can appear as a highly subdued, toggleable Reference Background. This favors free redesign over incremental editing of copied existing rooms, and it keeps Baseline rooms from participating in proposed-room collision rules.

## Considered Options

- Copy Baseline rooms into each Scenario and edit them directly.
- Start each Scenario with an empty Proposed Layout and show the Baseline only as a non-editable reference.

## Consequences

Proposed Rooms are manually added first, may overlap the Reference Background, and are prevented from overlapping other Proposed Rooms or leaving the Footprint. The Reference Background is visible by default, saved per Scenario, shows only unlabeled Baseline room rectangles, and can be hidden without hiding the Footprint boundary. Existing local prototype scenarios created as Baseline copies can be reset during this model change.
