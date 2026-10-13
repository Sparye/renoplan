# Integer millimetres

Status: accepted

All lengths and coordinates are stored as integer millimetres. The UI displays metres. Snapping uses a configurable step (default 100 mm) applied during interaction only, so typed measurements are never rounded away.

## Consequences

Metric only. The prototype's fixed 0.25 m grid is gone. With orthogonal geometry (ADR 0002), all geometry math is exact integer arithmetic.
