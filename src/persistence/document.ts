import { Result, Schema } from 'effect';
import { type Plan, checkPlan, normalizePlan } from '@/core';

// The versioned document format (ADR 0006): what Save writes, Open reads, and browser storage holds.
// Every version stays decodable: an older document is migrated step by step to the current one.

export const FORMAT = 'renoplan';
export const VERSION = 1;

const Mm = Schema.Int;
const Id = Schema.String;

const PlanV1 = Schema.Struct({
  nodes: Schema.Record(Schema.String, Schema.Struct({ x: Mm, y: Mm })),
  walls: Schema.Record(
    Schema.String,
    Schema.Struct({
      a: Id,
      b: Id,
      thickness: Mm.check(Schema.isGreaterThanOrEqualTo(1)),
      exterior: Schema.Boolean,
      structural: Schema.Boolean,
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

export const DocumentV1 = Schema.Struct({
  format: Schema.Literal(FORMAT),
  version: Schema.Literal(1),
  project: Schema.Struct({
    id: Id,
    name: Schema.String,
    createdAt: Schema.String,
    updatedAt: Schema.String,
    existingPlan: PlanV1
  })
});

export interface Project {
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  existingPlan: Plan;
}

/** Migrations from each older version to the next. Empty while v1 is the only version. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

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
  const decoded = Schema.decodeUnknownResult(DocumentV1)(doc);
  if (Result.isFailure(decoded))
    return { ok: false, error: `The file is damaged: ${String(decoded.failure)}` };
  const p = decoded.success.project;
  const broken = danglingReference(p.existingPlan as Plan);
  if (broken) return { ok: false, error: `The plan in the file is inconsistent: ${broken}` };
  const plan = normalizePlan(p.existingPlan as Plan);
  const errs = checkPlan(plan);
  if (errs.length) return { ok: false, error: `The plan in the file is inconsistent: ${errs[0]}` };
  return { ok: true, project: { ...p, existingPlan: plan } };
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
