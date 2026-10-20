import { Result, Schema } from 'effect';
import { type Plan, type Scenario, checkPlan, normalizePlan } from '@/core';

// The versioned document format (ADR 0006): what Save writes, Open reads, and browser storage holds.
// Every version stays decodable: an older document is migrated step by step to the current one.

export const FORMAT = 'renoplan';
export const VERSION = 3;

const Mm = Schema.Int;
const Id = Schema.String;

const PlanSchema = Schema.Struct({
  nodes: Schema.Record(Schema.String, Schema.Struct({ x: Mm, y: Mm })),
  walls: Schema.Record(
    Schema.String,
    Schema.Struct({
      a: Id,
      b: Id,
      thickness: Mm.check(Schema.isGreaterThanOrEqualTo(1)),
      exterior: Schema.Boolean,
      structural: Schema.Boolean,
      drawn: Schema.Boolean,
      neg: Schema.NullOr(Id),
      pos: Schema.NullOr(Id)
    })
  ),
  rooms: Schema.Record(
    Schema.String,
    Schema.Struct({
      name: Schema.String,
      type: Schema.Literals(['bedroom', 'bathroom', 'kitchen', 'living', 'laundry', 'hallway', 'other'])
    })
  ),
  openings: Schema.Record(
    Schema.String,
    Schema.Struct({
      wall: Id,
      kind: Schema.Literals(['door', 'window', 'opening']),
      at: Mm,
      width: Mm.check(Schema.isGreaterThanOrEqualTo(1)),
      swing: Schema.Literals(['neg', 'pos']),
      hinge: Schema.Literals(['start', 'end'])
    })
  ),
  defaults: Schema.Struct({ interior: Mm, exterior: Mm }),
  nextId: Mm
});

// Scenarios are stored as their Changes (ADR 0010); their plans are replayed, never stored.
const Target = Schema.Union([Id, Schema.Struct({ created: Id })]);
const Point = Schema.Struct({ x: Mm, y: Mm });
const WallRef = Schema.Struct({
  axis: Schema.Literals(['h', 'v']),
  c: Mm,
  t0: Mm,
  t1: Mm,
  neg: Schema.NullOr(Target),
  pos: Schema.NullOr(Target)
});
const OpeningKind = Schema.Literals(['door', 'window', 'opening']);
const RoomType = Schema.Literals(['bedroom', 'bathroom', 'kitchen', 'living', 'laundry', 'hallway', 'other']);
const change = <Op extends string, F extends Schema.Struct.Fields>(op: Op, fields: F) =>
  Schema.Struct({ id: Id, op: Schema.Literal(op), ...fields });
const Change = Schema.Union([
  change('demolishWall', { wall: WallRef, keep: Schema.NullOr(Target) }),
  change('drawWall', { a: Point, b: Point, thickness: Mm.check(Schema.isGreaterThanOrEqualTo(1)) }),
  change('pushWall', { wall: WallRef, delta: Mm, outline: Schema.Boolean }),
  change('setThickness', { wall: WallRef, thickness: Mm }),
  change('addOpening', { wall: WallRef, kind: OpeningKind, center: Mm }),
  change('removeOpening', { opening: Target }),
  change('modifyOpening', {
    opening: Target,
    patch: Schema.Struct({
      kind: Schema.optionalKey(OpeningKind),
      at: Schema.optionalKey(Mm),
      width: Schema.optionalKey(Mm),
      swing: Schema.optionalKey(Schema.Literals(['neg', 'pos'])),
      hinge: Schema.optionalKey(Schema.Literals(['start', 'end']))
    })
  }),
  change('nameSpace', { x: Mm, y: Mm, name: Schema.String }),
  change('drawRoom', {
    rect: Schema.Struct({ x0: Mm, y0: Mm, x1: Mm, y1: Mm }),
    name: Schema.String,
    thickness: Mm.check(Schema.isGreaterThanOrEqualTo(1))
  }),
  change('renameRoom', { room: Target, name: Schema.String }),
  change('setRoomType', { room: Target, type: RoomType }),
  change('removeRoom', { room: Target })
]);
const ScenarioSchema = Schema.Struct({
  id: Id,
  name: Schema.String,
  changes: Schema.Array(Change),
  nextId: Mm
});

export const DocumentV3 = Schema.Struct({
  format: Schema.Literal(FORMAT),
  version: Schema.Literal(3),
  project: Schema.Struct({
    id: Id,
    name: Schema.String,
    createdAt: Schema.String,
    updatedAt: Schema.String,
    existingPlan: PlanSchema,
    scenarios: Schema.Array(ScenarioSchema)
  })
});

export interface Project {
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  existingPlan: Plan;
  scenarios: Scenario[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null;

/**
 * Migrations from each older version to the next. They run before decoding, on whatever the file holds,
 * so they only reshape what is there and leave anything malformed for the decoder to reject.
 */
const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  // v2: Scenarios (ADR 0010). A Project gains an empty Scenario list; every Wall gains `drawn`, and no
  // Wall captured before Draw Wall existed was drawn.
  1(doc) {
    const project = obj(doc.project);
    if (!project) return { ...doc, version: 2 };
    const plan = obj(project.existingPlan);
    const walls = obj(plan?.walls);
    const drawn = walls
      ? Object.fromEntries(
          Object.entries(walls).map(([id, w]) => [id, obj(w) ? { ...obj(w), drawn: false } : w])
        )
      : plan?.walls;
    return {
      ...doc,
      version: 2,
      project: {
        ...project,
        existingPlan: plan ? { ...plan, walls: drawn } : project.existingPlan,
        scenarios: []
      }
    };
  },
  // v3: a Scenario can remove a Room, turning it back into Unlabelled Space. Nothing to reshape; the bump
  // makes an older Renoplan say the file is newer instead of damaged.
  2: (doc) => ({ ...doc, version: 3 })
};

export function toDocument(project: Project) {
  return { format: FORMAT, version: VERSION, project };
}

export type Opened = { ok: true; project: Project } | { ok: false; error: string };

/** Reads a document of any version: migrates it, decodes it, and checks the plan is sound. */
export function fromDocument(input: unknown): Opened {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Not a Renoplan file.' };
  let doc = input as Record<string, unknown>;
  if (doc.format !== FORMAT) return { ok: false, error: 'Not a Renoplan file.' };
  if (typeof doc.version !== 'number' || !Number.isInteger(doc.version))
    return { ok: false, error: 'The file has no version.' };
  if (doc.version > VERSION)
    return { ok: false, error: `This file is from a newer version of Renoplan (format ${doc.version}).` };
  for (let v = doc.version; v < VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, error: `Cannot read format ${v}.` };
    doc = step(doc);
  }
  const decoded = Schema.decodeUnknownResult(DocumentV3)(doc);
  if (Result.isFailure(decoded))
    return { ok: false, error: `The file is damaged: ${String(decoded.failure)}` };
  const p = decoded.success.project;
  const broken = danglingReference(p.existingPlan as Plan);
  if (broken) return { ok: false, error: `The plan in the file is inconsistent: ${broken}` };
  const plan = normalizePlan(p.existingPlan as Plan);
  const errs = checkPlan(plan);
  if (errs.length) return { ok: false, error: `The plan in the file is inconsistent: ${errs[0]}` };
  const scenarios = p.scenarios as Scenario[];
  const bad = inconsistentScenario(scenarios);
  if (bad) return { ok: false, error: `The Scenarios in the file are inconsistent: ${bad}` };
  return { ok: true, project: { ...p, existingPlan: plan, scenarios } };
}

/**
 * Ids must be unique and counters past them. What a Change points at needs no check: a Change whose
 * target is missing is a Conflict when the Scenario is replayed.
 */
function inconsistentScenario(scenarios: readonly Scenario[]): string | null {
  const ids = new Set<string>();
  for (const s of scenarios) {
    if (ids.has(s.id)) return `scenario ${s.id} appears twice`;
    ids.add(s.id);
    const changes = new Set<string>();
    for (const c of s.changes) {
      if (changes.has(c.id)) return `change ${c.id} appears twice in scenario ${s.id}`;
      changes.add(c.id);
      if (Number(c.id.slice(1)) >= s.nextId)
        return `scenario ${s.id} has nextId ${s.nextId} not past ${c.id}`;
    }
  }
  return null;
}

/** The first reference to something that isn't there, if any. */
function danglingReference(p: Plan): string | null {
  for (const [id, w] of Object.entries(p.walls)) {
    if (!p.nodes[w.a] || !p.nodes[w.b]) return `wall ${id} has a missing node`;
    for (const r of [w.neg, w.pos]) if (r && !p.rooms[r]) return `wall ${id} claims missing room ${r}`;
  }
  for (const [id, o] of Object.entries(p.openings))
    if (!p.walls[o.wall]) return `opening ${id} is on a missing wall`;
  return null;
}

export const serialize = (project: Project): string => JSON.stringify(toDocument(project), null, 2);

export function parse(text: string): Opened {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a Renoplan file.' };
  }
  return fromDocument(json);
}
