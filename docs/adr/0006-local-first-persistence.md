# Local-first persistence

Status: accepted

v1 stores Projects in the browser and offers Save/Open of a versioned JSON file. No accounts, backend, or sync.

## Considered Options

- Local-first with file Save/Open. **Chosen.**
- Cloud with login from day one — adds nothing for user zero.
- Local-first on a CRDT (Yjs/Automerge) — sync-ready, but costly; the Change model of ADR 0001 is already a clean unit to sync later.

## Consequences

The document format carries a schema version from the first commit, with explicit migrations.
