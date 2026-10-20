# Extensions join a Scenario's Outline

Status: accepted (2026-10-20)

CONTEXT.md defines an Extension as any part of a Scenario that lies outside the Footprint: allowed, and always flagged. ADR 0001 expected Extensions to "fall out naturally" as New Walls outside the Footprint. In practice, Draw Room (ADR 0010) could already close off a space outside the Outline and name it. But the Room came out parked ("not placed yet"), the Footprint ignored it, so Extension area was always 0, and `mergeRooms` refuses to merge across an exterior Wall. So the house could not be opened into it.

## Decision

- **An Extension joins the Scenario's Outline**, the way a wing does in capture (`addWing`). In a Scenario, a Room that Draw Room makes (or a space the user names) is *annexed* (`annexRoom`) when it lies wholly outside the Outline, touching none of the floor inside it:
  - Its own Walls with nothing on their other face become exterior. They stay `drawn`.
  - The stretch of Outline it is against stays standing as an interior Wall between it and the house, at the same thickness, so Change Status shows it Retained.
  - A Wall it shares with another Room stays as it is.
  - Annexing is declined, and the Room stays a New Room outside the Outline, if the Outline would not close around both the house and the Room. Declining is not counted as the soundness backstop.

  A free-standing Room (a shed, a studio) is annexed too, as a second loop of the Outline. Without an Outline (capture skipped it), nothing is annexed.
- **Draw Room outside the Outline draws exterior Walls.** When the rectangle's centre is outside the Outline, the Walls take the exterior default thickness (`drawRoomThickness`). A side flush with the Outline then continues the Outline Wall at the same thickness, with no jog (ADR 0009). The thickness is resolved when the Change is recorded and stored in it, so replay is deterministic.
- **An Extension's Wall is exterior and drawn** (`extensionWall`). Capture never draws, so every Outline Wall of an Existing Plan is measured, and an Extension's is not: it is being designed. So:
  - Pushing an Extension's outer Wall moves it, in a drag and in the Wall panel's dimensions, and the Extension grows or shrinks. Its Room owns it (`sharesWall`), like a Room's own Wall.
  - Outline Walls from the Existing Plan keep ADR 0007's rule: dragging one resizes the Room against it, and ⌥-drag moves the Outline.
  - A run (what a drag grabs) continues along the Outline only between Walls that are both, or both not, an Extension's.
- **Opening the house into an Extension is the ordinary demolition.** The Wall between them is interior now, so demolishing it merges the two Rooms (`mergeRooms`). Demolishing any other Outline Wall is still refused, because the Outline would be left open.
- **Normal form absorbs an Outline Wall between an Extension's Room and another Room** (a push of an Extension's side Wall can bring the two together along the old Outline). The Wall becomes interior, but only if the Outline still closes without it. This only fires where Extension Walls exist, so never in capture.
- **Soundness with several loops.** With Extensions, one loop of the Outline closing is not enough: the house's loop could open while a free-standing Extension's stays closed. So `isSound` also refuses an Outline Wall with floor outside the Outline on both faces. Without Extension Walls, the check is skipped, and capture is checked exactly as before.
- **Extension floor** (`extensionOf`) is the Scenario's Footprint outside the Existing Plan's Footprint, including the Extension's Walls. Its area is the Comparison's "Extension area", and the Scenario panel's.
- **Flagging.** `PlanDrawing` takes the Extension floor and draws it as a dashed violet outline (`--plan-extension`) over the Walls. Rooms in it get an EXTENSION tag. This shows whether Show Changes is on or off, so Overlap red and New green keep their meaning. The canvas passes it in a Scenario, as do Comparison panes and Export sheets, whose legend gains an Extension entry. The Room panel says how much of a Room is Extension.
- **No new Change kind.** Extensions use `drawRoom`, `nameSpace`, `pushWall` and `demolishWall`, so the document format stays v2.

## Considered Options

- **Keep the Existing Plan's Outline fixed**, and treat floor outside it as Extension. Demolishing the Wall between the house and an Extension would leave the Outline open, so the soundness check would need a second notion of Outline. The merged Room would also cross the Outline and show as a red Overlap.
- **A new Change kind** ("extend") that marks Walls as an Extension's. This is a format change for what Draw Room already expresses.
- **Recognising an Extension's Wall by Change Status** (exterior and New). Commands would then need the Existing Plan, and Change Status is a diff for display, not an input to commands.
- **A separate `extension` attribute on Walls.** This is a format change, and `drawn` already says the same thing for exterior Walls: capture never draws.

## Consequences

- An Extension's outer Walls show as New, and the old exterior Wall it is against as Retained until it is demolished, then Demolished. Its thickness never changes.
- Property tests add Scenario gestures that draw Rooms against the outside of exterior Walls and free-standing beyond the plan, and that demolish exterior Walls or the Wall an Extension is against. A dedicated property starts from a house with Rooms against its Outline, so the house opens into an Extension often. In three 20,000-run sessions, the soundness backstop refused 0.70–0.75% of Extension gestures (about 28,000 per session). The remaining cause is a Draw Room rectangle drawn across existing Room or Extension floor, where one of its drawn sides would leave a Room enclosing nothing. This is the same Draw Wall corner case behind the older Scenario gestures' rate, which predates this ADR (1.6–1.7% in the same sessions, mostly pushes).

Deferred:

- Pushing an Extension's side Wall past a corner of the house is refused (it does nothing): the moved Wall would leave the house's loop open. Annexing the Room's Wall that a push exposes would fix it.
- Demolishing the Wall an Extension is against where the house side is Unlabelled Space, not a Room, is still refused (ADR 0010).
- An Extension drawn against a Room that already crosses the Outline (an Existing Plan Overlap), or wedged against an Existing Plan Room not yet placed, may not be able to join. It stays a New Room outside the Outline.
- Draw Room's rectangle is where it was drawn, like a drawn Wall (ADR 0010). An Existing Plan correction that moves the Outline Wall it was drawn against leaves it standing free, a gap away.
- Making an Extension's Wall thicker keeps its outside face where it is, as for any Outline Wall.
