import { browser } from '$app/environment';
import { derived, writable } from 'svelte/store';
import type {
  Opening,
  PlanDocument,
  PlanPoint,
  PlanRect,
  ProposedRoom,
  Room,
  RoomInventoryItem,
  RoomType,
  SetupRoomKind,
  Wall
} from '$lib/domain/types';

export const GRID_SIZE = 24;
export const METRES_PER_GRID = 0.25;

const STORAGE_KEY = 'renoplan.editor.v1';
const ENVELOPE_VERSION = 1;
const MIN_ROOM_SIZE = GRID_SIZE * 2;

export type ActiveMode = 'baseline' | 'scenario';

export interface PlanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LockedBaseline {
  id: string;
  name: string;
  version: number;
  locked: true;
  createdAt: string;
  bounds: PlanBounds;
  plan: PlanDocument;
}

export interface SavedScenario {
  id: string;
  name: string;
  plan: PlanDocument;
  showReferenceBackground: boolean;
  updatedAt: string;
}

export interface SavedBaseline extends LockedBaseline {
  scenarios: SavedScenario[];
}

export interface EditorEnvelope {
  version: 1;
  draftProjectName: string;
  baselinePlan: PlanDocument;
  draftPlan: PlanDocument | null;
  lockedBaseline: LockedBaseline | null;
  scenarioPlan: PlanDocument | null;
  showReferenceBackground: boolean;
  baselines: SavedBaseline[];
  activeBaselineId: string | null;
  activeScenarioId: string | null;
  activeMode: ActiveMode;
}

export interface EditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyPlan: PlanDocument = {
  id: 'existing-v1-plan',
  rooms: [],
  proposedRooms: [],
  walls: [],
  openings: [],
  objects: []
};

const emptyScenarioPlan = (): PlanDocument => ({
  id: 'renovation-plan',
  rooms: [],
  proposedRooms: [],
  walls: [],
  openings: [],
  objects: []
});

export const roomSetupOptions: {
  kind: SetupRoomKind;
  label: string;
  type: RoomType;
  width: number;
  height: number;
}[] = [
  {
    kind: 'bedroom',
    label: 'Bedroom',
    type: 'bedroom',
    width: 144,
    height: 144
  },
  { kind: 'toilet', label: 'Toilet', type: 'wet', width: 72, height: 96 },
  { kind: 'bathroom', label: 'Bathroom', type: 'wet', width: 120, height: 96 },
  {
    kind: 'kitchen',
    label: 'Kitchen',
    type: 'kitchen',
    width: 168,
    height: 144
  },
  {
    kind: 'living',
    label: 'Living room',
    type: 'living',
    width: 240,
    height: 168
  },
  {
    kind: 'dining',
    label: 'Dining room',
    type: 'living',
    width: 168,
    height: 144
  },
  {
    kind: 'laundry',
    label: 'Laundry',
    type: 'utility',
    width: 120,
    height: 96
  },
  { kind: 'storage', label: 'Storage', type: 'utility', width: 96, height: 96 },
  { kind: 'garage', label: 'Garage', type: 'generic', width: 240, height: 240 },
  {
    kind: 'other',
    label: 'Other room',
    type: 'generic',
    width: 144,
    height: 120
  }
];

export type SetupStep =
  | 'dashboard'
  | 'project-details'
  | 'counts'
  | 'measurements'
  | 'editor';

export interface EditorState extends EditorEnvelope {
  plan: PlanDocument;
  setupStep: SetupStep;
  inventory: RoomInventoryItem[];
  selectedRoomId: string | null;
  selectedProposedRoomId: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
  saveState: 'saved' | 'saving' | 'offline';
  baselinePast: PlanDocument[];
  baselineFuture: PlanDocument[];
  scenarioPast: PlanDocument[];
  scenarioFuture: PlanDocument[];
  past: PlanDocument[];
  future: PlanDocument[];
}

export interface CreateEditorStoreOptions {
  storage?: EditorStorage | null;
  now?: () => string;
  createId?: (prefix: string) => string;
}

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const clonePlan = (plan: PlanDocument): PlanDocument => ({
  ...plan,
  rooms: plan.rooms.map((room) => ({
    ...room,
    shape: room.shape?.map((point) => ({ ...point }))
  })),
  proposedRooms: (plan.proposedRooms ?? []).map((room) => ({
    ...room,
    shape: room.shape?.map((point) => ({ ...point }))
  })),
  walls: plan.walls.map((wall) => ({ ...wall, roomIds: [...wall.roomIds] })),
  openings: plan.openings.map((opening) => ({ ...opening })),
  objects: plan.objects.map((object) => ({ ...object }))
});

const wallId = (
  firstRoomId: string,
  secondRoomId: string,
  orientation: 'horizontal' | 'vertical'
) => `wall-${[firstRoomId, secondRoomId].sort().join('-')}-${orientation}`;

const exteriorWallId = (
  roomId: string,
  side: 'north' | 'east' | 'south' | 'west',
  start: number,
  end: number
) => `wall-${roomId}-${side}-${Math.round(start)}-${Math.round(end)}`;

const wallLength = (wall: Wall) =>
  Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);

const clampOpeningOffset = (
  wall: Wall,
  opening: Pick<Opening, 'offset' | 'width'>
) =>
  Math.min(
    Math.max(0, opening.offset),
    Math.max(0, wallLength(wall) - opening.width)
  );

const overlap = (
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
) => {
  const start = Math.max(firstStart, secondStart);
  const end = Math.min(firstEnd, secondEnd);
  return end > start ? { start, end } : null;
};

const same = (first: number, second: number) =>
  Math.abs(first - second) < 0.001;

const roomShape = (room: PlanRect & { shape?: PlanPoint[] }) =>
  room.shape && room.shape.length >= 3
    ? room.shape
    : [
        { x: room.x, y: room.y },
        { x: room.x + room.width, y: room.y },
        { x: room.x + room.width, y: room.y + room.height },
        { x: room.x, y: room.y + room.height }
      ];

function boundsFromPoints(points: PlanPoint[]): PlanRect {
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function withRoomBounds<T extends Room | ProposedRoom>(room: T): T {
  if (!room.shape || room.shape.length < 3) return room;

  return {
    ...room,
    ...boundsFromPoints(room.shape)
  };
}

function translateRoom<T extends Room | ProposedRoom>(
  room: T,
  x: number,
  y: number
): T {
  const dx = x - room.x;
  const dy = y - room.y;

  return {
    ...room,
    x,
    y,
    shape: room.shape?.map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    }))
  };
}

function reshapeRoom<T extends Room | ProposedRoom>(
  room: T,
  rect: PlanRect
): T {
  if (!room.shape || room.shape.length < 3) {
    return {
      ...room,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }

  const widthScale = room.width === 0 ? 1 : rect.width / room.width;
  const heightScale = room.height === 0 ? 1 : rect.height / room.height;

  return {
    ...room,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    shape: room.shape.map((point) => ({
      x: rect.x + (point.x - room.x) * widthScale,
      y: rect.y + (point.y - room.y) * heightScale
    }))
  };
}

function rectsTouchOrOverlap(first: PlanRect, second: PlanRect) {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

function polygonFromRectUnion(first: PlanRect, second: PlanRect) {
  if (!rectsTouchOrOverlap(first, second)) return null;

  const xs = [
    first.x,
    first.x + first.width,
    second.x,
    second.x + second.width
  ].sort((a, b) => a - b);
  const ys = [
    first.y,
    first.y + first.height,
    second.y,
    second.y + second.height
  ].sort((a, b) => a - b);
  const uniqueXs = [...new Set(xs)];
  const uniqueYs = [...new Set(ys)];
  const covered = new Set<string>();

  for (let xIndex = 0; xIndex < uniqueXs.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < uniqueYs.length - 1; yIndex += 1) {
      const cell = {
        x: uniqueXs[xIndex],
        y: uniqueYs[yIndex],
        width: uniqueXs[xIndex + 1] - uniqueXs[xIndex],
        height: uniqueYs[yIndex + 1] - uniqueYs[yIndex]
      };
      const coveredByFirst =
        cell.x >= first.x &&
        cell.x + cell.width <= first.x + first.width &&
        cell.y >= first.y &&
        cell.y + cell.height <= first.y + first.height;
      const coveredBySecond =
        cell.x >= second.x &&
        cell.x + cell.width <= second.x + second.width &&
        cell.y >= second.y &&
        cell.y + cell.height <= second.y + second.height;

      if (coveredByFirst || coveredBySecond) {
        covered.add(`${xIndex},${yIndex}`);
      }
    }
  }

  const edges: { start: PlanPoint; end: PlanPoint }[] = [];
  for (const key of covered) {
    const [xIndex, yIndex] = key.split(',').map(Number);
    const left = uniqueXs[xIndex];
    const right = uniqueXs[xIndex + 1];
    const top = uniqueYs[yIndex];
    const bottom = uniqueYs[yIndex + 1];

    if (!covered.has(`${xIndex},${yIndex - 1}`)) {
      edges.push({ start: { x: left, y: top }, end: { x: right, y: top } });
    }
    if (!covered.has(`${xIndex + 1},${yIndex}`)) {
      edges.push({ start: { x: right, y: top }, end: { x: right, y: bottom } });
    }
    if (!covered.has(`${xIndex},${yIndex + 1}`)) {
      edges.push({
        start: { x: right, y: bottom },
        end: { x: left, y: bottom }
      });
    }
    if (!covered.has(`${xIndex - 1},${yIndex}`)) {
      edges.push({ start: { x: left, y: bottom }, end: { x: left, y: top } });
    }
  }

  if (edges.length === 0) return null;

  const pointKey = (point: PlanPoint) => `${point.x},${point.y}`;
  const remaining = [...edges];
  const firstEdge = remaining.shift();
  if (!firstEdge) return null;

  const points = [firstEdge.start, firstEdge.end];
  while (remaining.length > 0) {
    const last = points.at(-1);
    const nextIndex = remaining.findIndex(
      (edge) => last && pointKey(edge.start) === pointKey(last)
    );
    if (nextIndex === -1) return null;

    const [next] = remaining.splice(nextIndex, 1);
    if (pointKey(next.end) === pointKey(points[0])) break;
    points.push(next.end);
  }

  const isCollinear = (
    previous: PlanPoint,
    current: PlanPoint,
    next: PlanPoint
  ) =>
    (same(previous.x, current.x) && same(current.x, next.x)) ||
    (same(previous.y, current.y) && same(current.y, next.y));

  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return !isCollinear(previous, point, next);
  });
}

export const snapValue = (value: number, enabled = true) =>
  enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;

export const pixelsToMetres = (value: number) =>
  (value / GRID_SIZE) * METRES_PER_GRID;

export const metresToPixels = (value: number) =>
  Math.max(MIN_ROOM_SIZE, (value / METRES_PER_GRID) * GRID_SIZE);

const setupOptionFor = (kind: SetupRoomKind) =>
  roomSetupOptions.find((option) => option.kind === kind) ??
  roomSetupOptions[0];

function roomLabel(kind: SetupRoomKind, index: number, count: number) {
  const option = setupOptionFor(kind);
  return count > 1 ? `${option.label} ${index + 1}` : option.label;
}

function inventoryFromCounts(counts: Record<SetupRoomKind, number>) {
  return roomSetupOptions.flatMap((option) => {
    const count = Math.max(0, Math.floor(counts[option.kind] ?? 0));

    return Array.from({ length: count }, (_, index) => ({
      id: `${option.kind}-${index + 1}`,
      kind: option.kind,
      label: roomLabel(option.kind, index, count),
      type: option.type,
      width: option.width,
      height: option.height,
      measured: false
    }));
  });
}

function planFromInventory(inventory: RoomInventoryItem[]): PlanDocument {
  const margin = GRID_SIZE * 2;
  const gap = GRID_SIZE;
  const maxWidth = 840;

  let x = margin;
  let y = margin;
  let rowHeight = 0;

  const rooms = inventory.map((item) => {
    if (x + item.width > maxWidth) {
      x = margin;
      y += rowHeight + gap;
      rowHeight = 0;
    }

    const room: Room = {
      id: item.id,
      name: item.label,
      type: item.type,
      x,
      y,
      width: item.width,
      height: item.height
    };

    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);

    return room;
  });

  return normalisePlan({
    ...emptyPlan,
    rooms
  });
}

function planFromWholeArea(width: number, height: number): PlanDocument {
  return normalisePlan({
    ...emptyPlan,
    rooms: [
      {
        id: 'whole-area',
        name: 'Whole area',
        type: 'generic',
        x: GRID_SIZE * 2,
        y: GRID_SIZE * 2,
        width,
        height
      }
    ]
  });
}

function proposedRoomLabel(plan: PlanDocument, kind: SetupRoomKind) {
  const option = setupOptionFor(kind);
  const count =
    plan.proposedRooms.filter((room) => room.type === option.type).length + 1;
  return `${option.label} ${count}`;
}

export function derivePlanBounds(plan: PlanDocument): PlanBounds | null {
  if (plan.rooms.length === 0) return null;

  const rooms = plan.rooms.map(withRoomBounds);
  const left = Math.min(...rooms.map((room) => room.x));
  const top = Math.min(...rooms.map((room) => room.y));
  const right = Math.max(...rooms.map((room) => room.x + room.width));
  const bottom = Math.max(...rooms.map((room) => room.y + room.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function deriveSharedWalls(plan: PlanDocument): Wall[] {
  const previousWalls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const walls: Wall[] = [];
  const rooms = plan.rooms.map(withRoomBounds);

  for (let firstIndex = 0; firstIndex < rooms.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < rooms.length;
      secondIndex += 1
    ) {
      const first = rooms[firstIndex];
      const second = rooms[secondIndex];
      if (first.shape || second.shape) continue;
      const firstRight = first.x + first.width;
      const secondRight = second.x + second.width;
      const firstBottom = first.y + first.height;
      const secondBottom = second.y + second.height;

      if (same(firstRight, second.x) || same(secondRight, first.x)) {
        const yOverlap = overlap(first.y, firstBottom, second.y, secondBottom);
        if (yOverlap) {
          const x = same(firstRight, second.x) ? firstRight : secondRight;
          const id = wallId(first.id, second.id, 'vertical');
          const previous = previousWalls.get(id);
          walls.push({
            id,
            kind: 'shared',
            roomIds: [first.id, second.id],
            x1: x,
            y1: yOverlap.start,
            x2: x,
            y2: yOverlap.end,
            structural: previous?.structural ?? false,
            removed: previous?.removed ?? false
          });
        }
      }

      if (same(firstBottom, second.y) || same(secondBottom, first.y)) {
        const xOverlap = overlap(first.x, firstRight, second.x, secondRight);
        if (xOverlap) {
          const y = same(firstBottom, second.y) ? firstBottom : secondBottom;
          const id = wallId(first.id, second.id, 'horizontal');
          const previous = previousWalls.get(id);
          walls.push({
            id,
            kind: 'shared',
            roomIds: [first.id, second.id],
            x1: xOverlap.start,
            y1: y,
            x2: xOverlap.end,
            y2: y,
            structural: previous?.structural ?? false,
            removed: previous?.removed ?? false
          });
        }
      }
    }
  }

  return walls;
}

function subtractSegments(
  segment: { start: number; end: number },
  cuts: { start: number; end: number }[]
) {
  return cuts.reduce(
    (segments, cut) =>
      segments.flatMap((candidate) => {
        const start = Math.max(candidate.start, cut.start);
        const end = Math.min(candidate.end, cut.end);

        if (end <= start) return [candidate];

        return [
          { start: candidate.start, end: start },
          { start: end, end: candidate.end }
        ].filter((next) => next.end > next.start);
      }),
    [segment]
  );
}

export function deriveWalls(plan: PlanDocument): Wall[] {
  const previousWalls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const sharedWalls = deriveSharedWalls(plan);
  const exteriorWalls: Wall[] = [];

  for (const room of plan.rooms.map(withRoomBounds)) {
    if (room.shape && room.shape.length >= 3) {
      const points = roomShape(room);
      points.forEach((point, index) => {
        const nextPoint = points[(index + 1) % points.length];
        const id = `wall-${room.id}-edge-${index}`;
        const previous = previousWalls.get(id);
        exteriorWalls.push({
          id,
          kind: 'exterior',
          roomIds: [room.id],
          x1: point.x,
          y1: point.y,
          x2: nextPoint.x,
          y2: nextPoint.y,
          structural: previous?.structural ?? false,
          removed: previous?.removed ?? false
        });
      });
      continue;
    }

    const right = room.x + room.width;
    const bottom = room.y + room.height;
    const sides = [
      {
        side: 'north' as const,
        orientation: 'horizontal' as const,
        line: room.y,
        start: room.x,
        end: right,
        makeWall: (start: number, end: number) => ({
          x1: start,
          y1: room.y,
          x2: end,
          y2: room.y
        })
      },
      {
        side: 'south' as const,
        orientation: 'horizontal' as const,
        line: bottom,
        start: room.x,
        end: right,
        makeWall: (start: number, end: number) => ({
          x1: start,
          y1: bottom,
          x2: end,
          y2: bottom
        })
      },
      {
        side: 'west' as const,
        orientation: 'vertical' as const,
        line: room.x,
        start: room.y,
        end: bottom,
        makeWall: (start: number, end: number) => ({
          x1: room.x,
          y1: start,
          x2: room.x,
          y2: end
        })
      },
      {
        side: 'east' as const,
        orientation: 'vertical' as const,
        line: right,
        start: room.y,
        end: bottom,
        makeWall: (start: number, end: number) => ({
          x1: right,
          y1: start,
          x2: right,
          y2: end
        })
      }
    ];

    for (const side of sides) {
      const cuts = sharedWalls
        .filter((wall) => {
          if (!wall.roomIds.includes(room.id)) return false;

          if (side.orientation === 'horizontal') {
            return same(wall.y1, side.line) && same(wall.y2, side.line);
          }

          return same(wall.x1, side.line) && same(wall.x2, side.line);
        })
        .map((wall) =>
          side.orientation === 'horizontal'
            ? {
                start: Math.min(wall.x1, wall.x2),
                end: Math.max(wall.x1, wall.x2)
              }
            : {
                start: Math.min(wall.y1, wall.y2),
                end: Math.max(wall.y1, wall.y2)
              }
        );

      for (const segment of subtractSegments(
        { start: side.start, end: side.end },
        cuts
      )) {
        const id = exteriorWallId(
          room.id,
          side.side,
          segment.start,
          segment.end
        );
        const previous = previousWalls.get(id);
        exteriorWalls.push({
          id,
          kind: 'exterior',
          roomIds: [room.id],
          ...side.makeWall(segment.start, segment.end),
          structural: previous?.structural ?? false,
          removed: previous?.removed ?? false
        });
      }
    }
  }

  return [...sharedWalls, ...exteriorWalls];
}

function normalisePlan(plan: PlanDocument): PlanDocument {
  const shapedPlan = {
    ...plan,
    rooms: plan.rooms.map(withRoomBounds),
    proposedRooms: (plan.proposedRooms ?? []).map(withRoomBounds)
  };
  const walls = deriveWalls(shapedPlan);
  const wallIds = new Set(walls.map((wall) => wall.id));
  const openings = shapedPlan.openings.filter((opening) =>
    wallIds.has(opening.wallId)
  );

  return {
    ...clonePlan(shapedPlan),
    walls,
    openings
  };
}

function normaliseSavedBaseline(baseline: SavedBaseline): SavedBaseline {
  const plan = normalisePlan(baseline.plan);
  return {
    ...baseline,
    bounds: derivePlanBounds(plan) ?? baseline.bounds,
    plan,
    scenarios: (baseline.scenarios ?? []).map((scenario) => ({
      ...scenario,
      plan: normalisePlan(scenario.plan),
      showReferenceBackground: scenario.showReferenceBackground ?? true
    }))
  };
}

function upsertSavedBaseline(
  baselines: SavedBaseline[],
  baseline: LockedBaseline,
  scenarios: SavedScenario[] = []
) {
  const existing = baselines.find((candidate) => candidate.id === baseline.id);
  const nextBaseline = normaliseSavedBaseline({
    ...baseline,
    scenarios: existing?.scenarios ?? scenarios
  });

  return existing
    ? baselines.map((candidate) =>
        candidate.id === baseline.id ? nextBaseline : candidate
      )
    : [...baselines, nextBaseline];
}

function normaliseEnvelope(envelope: EditorEnvelope): EditorEnvelope {
  const draftProjectName =
    typeof envelope.draftProjectName === 'string' &&
    envelope.draftProjectName.trim().length > 0
      ? envelope.draftProjectName
      : 'Untitled renovation';
  const draftPlan = envelope.draftPlan
    ? normalisePlan(envelope.draftPlan)
    : null;
  const baselinePlan = normalisePlan(draftPlan ?? envelope.baselinePlan);
  let baselines = ((envelope.baselines as SavedBaseline[] | undefined) ?? [])
    .filter((baseline) => baseline?.locked)
    .map(normaliseSavedBaseline);
  const lockedBaseline = envelope.lockedBaseline
    ? {
        ...envelope.lockedBaseline,
        bounds:
          derivePlanBounds(envelope.lockedBaseline.plan) ??
          envelope.lockedBaseline.bounds,
        plan: normalisePlan(envelope.lockedBaseline.plan)
      }
    : null;
  const scenarioPlan = envelope.scenarioPlan
    ? normalisePlan(envelope.scenarioPlan)
    : null;
  const scenarioIsLegacyBaselineCopy =
    Boolean(lockedBaseline && scenarioPlan) &&
    scenarioPlan?.proposedRooms.length === 0 &&
    JSON.stringify(scenarioPlan?.rooms) ===
      JSON.stringify(lockedBaseline?.plan.rooms);
  const nextScenarioPlan = scenarioIsLegacyBaselineCopy ? null : scenarioPlan;
  const activeBaselineId =
    envelope.activeBaselineId ?? lockedBaseline?.id ?? null;
  const activeScenarioId = envelope.activeScenarioId ?? null;

  if (lockedBaseline) {
    const scenario =
      nextScenarioPlan && activeScenarioId
        ? [
            {
              id: activeScenarioId,
              name: 'Renovation plan',
              plan: nextScenarioPlan,
              showReferenceBackground: envelope.showReferenceBackground ?? true,
              updatedAt: new Date().toISOString()
            }
          ]
        : [];
    baselines = upsertSavedBaseline(baselines, lockedBaseline, scenario);
  }

  return {
    version: ENVELOPE_VERSION,
    draftProjectName,
    baselinePlan,
    draftPlan,
    lockedBaseline,
    scenarioPlan: nextScenarioPlan,
    showReferenceBackground: envelope.showReferenceBackground ?? true,
    baselines,
    activeBaselineId,
    activeScenarioId: nextScenarioPlan ? activeScenarioId : null,
    activeMode:
      envelope.activeMode === 'scenario' && nextScenarioPlan
        ? 'scenario'
        : 'baseline'
  };
}

function isPlanDocument(value: unknown): value is PlanDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PlanDocument).rooms) &&
    Array.isArray((value as PlanDocument).walls) &&
    Array.isArray((value as PlanDocument).openings) &&
    Array.isArray((value as PlanDocument).objects)
  );
}

function ensurePlanDocument(value: PlanDocument): PlanDocument {
  return {
    ...value,
    proposedRooms: value.proposedRooms ?? []
  };
}

function isEditorEnvelope(value: unknown): value is EditorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EditorEnvelope).version === ENVELOPE_VERSION &&
    isPlanDocument((value as EditorEnvelope).baselinePlan)
  );
}

export function createEnvelopeFromPlan(plan: PlanDocument): EditorEnvelope {
  return {
    version: ENVELOPE_VERSION,
    draftProjectName: 'Untitled renovation',
    baselinePlan: normalisePlan(ensurePlanDocument(plan)),
    draftPlan: null,
    lockedBaseline: null,
    scenarioPlan: null,
    showReferenceBackground: true,
    baselines: [],
    activeBaselineId: null,
    activeScenarioId: null,
    activeMode: 'baseline'
  };
}

export function parseEditorEnvelope(raw: string | null): EditorEnvelope {
  if (!raw) return createEnvelopeFromPlan(emptyPlan);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isEditorEnvelope(parsed)) return normaliseEnvelope(parsed);
    if (isPlanDocument(parsed)) return createEnvelopeFromPlan(parsed);
  } catch {
    return createEnvelopeFromPlan(emptyPlan);
  }

  return createEnvelopeFromPlan(emptyPlan);
}

function getDefaultStorage(): EditorStorage | null {
  if (!browser) return null;
  return localStorage;
}

function loadEnvelope(storage: EditorStorage | null) {
  if (!storage) return createEnvelopeFromPlan(emptyPlan);
  return parseEditorEnvelope(storage.getItem(STORAGE_KEY));
}

function persistEnvelope(
  storage: EditorStorage | null,
  envelope: EditorEnvelope
) {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(normaliseEnvelope(envelope)));
}

function activePlan(state: EditorEnvelope) {
  return state.activeMode === 'scenario' && state.scenarioPlan
    ? state.scenarioPlan
    : state.baselinePlan;
}

function activePast(state: EditorState) {
  return state.activeMode === 'scenario'
    ? state.scenarioPast
    : state.baselinePast;
}

function activeFuture(state: EditorState) {
  return state.activeMode === 'scenario'
    ? state.scenarioFuture
    : state.baselineFuture;
}

function withComputedState(
  state: Omit<EditorState, 'plan' | 'past' | 'future'>
) {
  return {
    ...state,
    plan: activePlan(state),
    past: activePast(state as EditorState),
    future: activeFuture(state as EditorState)
  };
}

function envelopeFromState(state: EditorState): EditorEnvelope {
  return {
    version: ENVELOPE_VERSION,
    draftProjectName: state.draftProjectName,
    baselinePlan: state.baselinePlan,
    draftPlan:
      !state.lockedBaseline && state.baselinePlan.rooms.length > 0
        ? state.baselinePlan
        : state.draftPlan,
    lockedBaseline: state.lockedBaseline,
    scenarioPlan: state.scenarioPlan,
    showReferenceBackground: state.showReferenceBackground,
    baselines: state.baselines,
    activeBaselineId: state.activeBaselineId,
    activeScenarioId: state.activeScenarioId,
    activeMode: state.activeMode
  };
}

function constrainRect(rect: PlanRect): PlanRect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(MIN_ROOM_SIZE, rect.width),
    height: Math.max(MIN_ROOM_SIZE, rect.height)
  };
}

type ShapedRect = PlanRect & { shape?: PlanPoint[] };

function clampRectToBounds<T extends PlanRect>(
  rect: T,
  bounds: PlanBounds | null
): T {
  if (!bounds) return rect;

  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;

  const x = Math.min(Math.max(rect.x, bounds.x), maxX);
  const y = Math.min(Math.max(rect.y, bounds.y), maxY);
  const dx = x - rect.x;
  const dy = y - rect.y;

  return {
    ...rect,
    x,
    y,
    width,
    height,
    shape: (rect as ShapedRect).shape?.map((point) => ({
      x: point.x + dx,
      y: point.y + dy
    }))
  };
}

function rectsOverlap(first: PlanRect, second: PlanRect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]) {
  let inside = false;

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function polygonsOverlap(first: PlanPoint[], second: PlanPoint[]) {
  const xs = [...new Set([...first, ...second].map((point) => point.x))].sort(
    (a, b) => a - b
  );
  const ys = [...new Set([...first, ...second].map((point) => point.y))].sort(
    (a, b) => a - b
  );

  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      if (
        same(xs[xIndex], xs[xIndex + 1]) ||
        same(ys[yIndex], ys[yIndex + 1])
      ) {
        continue;
      }

      const midpoint = {
        x: (xs[xIndex] + xs[xIndex + 1]) / 2,
        y: (ys[yIndex] + ys[yIndex + 1]) / 2
      };

      if (pointInPolygon(midpoint, first) && pointInPolygon(midpoint, second)) {
        return true;
      }
    }
  }

  return false;
}

function roomsOverlap(first: ShapedRect, second: ShapedRect) {
  if (!rectsOverlap(first, second)) return false;
  if (!first.shape && !second.shape) return true;

  return polygonsOverlap(roomShape(first), roomShape(second));
}

function snapRectToRoomEdges(
  rect: ShapedRect,
  roomId: string,
  rooms: ProposedRoom[],
  enabled: boolean
) {
  if (!enabled) return rect;

  const threshold = GRID_SIZE / 2;
  const movingRoom = rooms.find((room) => room.id === roomId);
  if (!movingRoom) return rect;
  const otherRooms = rooms.filter((room) => room.id !== roomId);
  let nextRect = { ...rect };

  for (const room of otherRooms) {
    const movingPoints = roomShape(
      translateRoom(movingRoom, nextRect.x, nextRect.y)
    );
    const roomPoints = roomShape(room);
    const horizontalSnaps = movingPoints
      .flatMap((movingPoint) =>
        roomPoints.map((roomPoint) => ({
          distance: Math.abs(movingPoint.x - roomPoint.x),
          x: nextRect.x + roomPoint.x - movingPoint.x
        }))
      )
      .filter((snap) => snap.distance <= threshold)
      .sort((first, second) => first.distance - second.distance);

    const verticalSnaps = movingPoints
      .flatMap((movingPoint) =>
        roomPoints.map((roomPoint) => ({
          distance: Math.abs(movingPoint.y - roomPoint.y),
          y: nextRect.y + roomPoint.y - movingPoint.y
        }))
      )
      .filter((snap) => snap.distance <= threshold)
      .sort((first, second) => first.distance - second.distance);

    nextRect = {
      ...nextRect,
      x: horizontalSnaps[0]?.x ?? nextRect.x,
      y: verticalSnaps[0]?.y ?? nextRect.y
    };
  }

  return nextRect;
}

function clampProposedRect(
  rect: ShapedRect,
  roomId: string,
  rooms: ProposedRoom[],
  bounds: PlanBounds | null
) {
  const candidate = clampRectToBounds(rect, bounds);
  const otherRooms = rooms.filter((room) => room.id !== roomId);

  for (let attempt = 0; attempt < otherRooms.length; attempt += 1) {
    const overlapRoom = otherRooms.find((room) =>
      roomsOverlap(candidate, room)
    );
    if (!overlapRoom) return candidate;

    const candidates = [
      { ...candidate, x: overlapRoom.x - candidate.width },
      { ...candidate, x: overlapRoom.x + overlapRoom.width },
      { ...candidate, y: overlapRoom.y - candidate.height },
      { ...candidate, y: overlapRoom.y + overlapRoom.height }
    ]
      .map((next) => clampRectToBounds(next, bounds))
      .filter((next) => otherRooms.every((room) => !roomsOverlap(next, room)))
      .sort(
        (first, second) =>
          (first.x - rect.x) ** 2 +
          (first.y - rect.y) ** 2 -
          ((second.x - rect.x) ** 2 + (second.y - rect.y) ** 2)
      );

    if (candidates[0]) return candidates[0];
  }

  return candidate;
}

function resizeRect(
  room: PlanRect,
  handle: ResizeHandle,
  x: number,
  y: number
): PlanRect {
  const right = room.x + room.width;
  const bottom = room.y + room.height;

  if (handle === 'e') {
    return constrainRect({ ...room, width: x - room.x });
  }

  if (handle === 's') {
    return constrainRect({ ...room, height: y - room.y });
  }

  if (handle === 'se') {
    return constrainRect({ ...room, width: x - room.x, height: y - room.y });
  }

  if (handle === 'w') {
    const width = right - x;
    return width < MIN_ROOM_SIZE
      ? { ...room, width: MIN_ROOM_SIZE }
      : { ...room, x, width };
  }

  if (handle === 'n') {
    const height = bottom - y;
    return height < MIN_ROOM_SIZE
      ? { ...room, height: MIN_ROOM_SIZE }
      : { ...room, y, height };
  }

  if (handle === 'nw') {
    const width = right - x;
    const height = bottom - y;
    return {
      x: width < MIN_ROOM_SIZE ? right - MIN_ROOM_SIZE : x,
      y: height < MIN_ROOM_SIZE ? bottom - MIN_ROOM_SIZE : y,
      width: Math.max(MIN_ROOM_SIZE, width),
      height: Math.max(MIN_ROOM_SIZE, height)
    };
  }

  if (handle === 'ne') {
    const height = bottom - y;
    return {
      x: room.x,
      y: height < MIN_ROOM_SIZE ? bottom - MIN_ROOM_SIZE : y,
      width: Math.max(MIN_ROOM_SIZE, x - room.x),
      height: Math.max(MIN_ROOM_SIZE, height)
    };
  }

  const width = right - x;
  return {
    x: width < MIN_ROOM_SIZE ? right - MIN_ROOM_SIZE : x,
    y: room.y,
    width: Math.max(MIN_ROOM_SIZE, width),
    height: Math.max(MIN_ROOM_SIZE, y - room.y)
  };
}

function canEditGeometry(state: EditorState) {
  return state.activeMode === 'scenario' || !state.lockedBaseline;
}

function canEditWalls(state: EditorState) {
  return state.activeMode === 'scenario' || !state.lockedBaseline;
}

function projectName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled renovation';
}

function scenarioName(index: number) {
  return `Renovation ${index}`;
}

export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

export function createEditorStore(options: CreateEditorStoreOptions = {}) {
  const storage = options.storage ?? getDefaultStorage();
  const now = options.now ?? (() => new Date().toISOString());
  const makeId = options.createId ?? createRuntimeId;
  const startingEnvelope = loadEnvelope(storage);
  const store = writable<EditorState>(
    withComputedState({
      ...startingEnvelope,
      setupStep: 'dashboard',
      inventory: [],
      selectedRoomId: null,
      selectedProposedRoomId: null,
      selectedWallId: null,
      snapToGrid: true,
      saveState: 'saved',
      baselinePast: [],
      baselineFuture: [],
      scenarioPast: [],
      scenarioFuture: []
    })
  );

  function saveState(state: EditorState) {
    persistEnvelope(storage, envelopeFromState(state));
  }

  function updateState(updater: (state: EditorState) => EditorState) {
    store.update((state) => withComputedState(updater(state)));
  }

  function syncActiveScenario(
    state: EditorState,
    plan: PlanDocument | null = state.scenarioPlan
  ) {
    if (!state.activeBaselineId || !state.activeScenarioId || !plan) {
      return state.baselines;
    }

    return state.baselines.map((baseline) =>
      baseline.id === state.activeBaselineId
        ? {
            ...baseline,
            scenarios: baseline.scenarios.map((scenario) =>
              scenario.id === state.activeScenarioId
                ? {
                    ...scenario,
                    plan: clonePlan(plan),
                    showReferenceBackground: state.showReferenceBackground,
                    updatedAt: now()
                  }
                : scenario
            )
          }
        : baseline
    );
  }

  function mutatePlan(
    updater: (plan: PlanDocument, state: EditorState) => PlanDocument,
    options: {
      history?: boolean;
      selectedRoomId?: string | null;
      selectedProposedRoomId?: string | null;
      selectedWallId?: string | null;
    } = {}
  ) {
    updateState((state) => {
      const previousPlan = activePlan(state);
      const nextPlan = normalisePlan(updater(clonePlan(previousPlan), state));
      const nextState = { ...state, saveState: 'saving' as const };

      if (state.activeMode === 'scenario') {
        nextState.scenarioPlan = nextPlan;
        nextState.baselines = syncActiveScenario(
          nextState as EditorState,
          nextPlan
        );
        nextState.scenarioPast = options.history
          ? [...state.scenarioPast, clonePlan(previousPlan)].slice(-50)
          : state.scenarioPast;
        nextState.scenarioFuture = options.history ? [] : state.scenarioFuture;
      } else {
        nextState.baselinePlan = nextPlan;
        if (!state.lockedBaseline) {
          nextState.draftPlan = nextPlan;
        }
        nextState.baselinePast = options.history
          ? [...state.baselinePast, clonePlan(previousPlan)].slice(-50)
          : state.baselinePast;
        nextState.baselineFuture = options.history ? [] : state.baselineFuture;
      }

      nextState.selectedRoomId = options.selectedRoomId ?? state.selectedRoomId;
      nextState.selectedProposedRoomId =
        options.selectedProposedRoomId ?? state.selectedProposedRoomId;
      nextState.selectedWallId = options.selectedWallId ?? state.selectedWallId;
      saveState(nextState);

      return nextState;
    });
  }

  return {
    subscribe: store.subscribe,
    openDashboard() {
      updateState((state) => {
        const nextState = {
          ...state,
          setupStep: 'dashboard' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
        saveState(nextState);
        return nextState;
      });
    },
    startNewBaseline() {
      updateState((state) => {
        const envelope = {
          ...createEnvelopeFromPlan(emptyPlan),
          baselines: state.baselines
        };
        const nextState = {
          ...state,
          ...envelope,
          setupStep: 'project-details' as const,
          inventory: [],
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          scenarioPast: [],
          scenarioFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    updateDraftProjectName(name: string) {
      updateState((state) => {
        const nextState = {
          ...state,
          draftProjectName: name,
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    continueProjectDetails() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        const nextState = {
          ...state,
          draftProjectName: projectName(state.draftProjectName),
          setupStep: 'counts' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    openDraftProject() {
      updateState((state) => {
        if (!state.draftPlan || state.draftPlan.rooms.length === 0) {
          return {
            ...state,
            setupStep: 'project-details' as const,
            selectedRoomId: null,
            selectedProposedRoomId: null,
            selectedWallId: null
          };
        }

        const nextState = {
          ...state,
          baselinePlan: clonePlan(state.draftPlan),
          lockedBaseline: null,
          scenarioPlan: null,
          activeBaselineId: null,
          activeScenarioId: null,
          activeMode: 'baseline' as const,
          setupStep: 'editor' as const,
          selectedRoomId: state.draftPlan.rooms[0]?.id ?? null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
        saveState(nextState);
        return nextState;
      });
    },
    openBaseline(baselineId: string) {
      updateState((state) => {
        const baseline = state.baselines.find(
          (candidate) => candidate.id === baselineId
        );
        if (!baseline) return state;

        const nextState = {
          ...state,
          baselinePlan: clonePlan(baseline.plan),
          draftPlan: state.draftPlan,
          lockedBaseline: {
            id: baseline.id,
            name: baseline.name,
            version: baseline.version,
            locked: true as const,
            createdAt: baseline.createdAt,
            bounds: baseline.bounds,
            plan: clonePlan(baseline.plan)
          },
          scenarioPlan: null,
          showReferenceBackground: true,
          activeBaselineId: baseline.id,
          activeScenarioId: null,
          activeMode: 'baseline' as const,
          setupStep: 'editor' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          scenarioPast: [],
          scenarioFuture: []
        };
        saveState(nextState);
        return nextState;
      });
    },
    openScenario(baselineId: string, scenarioId: string) {
      updateState((state) => {
        const baseline = state.baselines.find(
          (candidate) => candidate.id === baselineId
        );
        const scenario = baseline?.scenarios.find(
          (candidate) => candidate.id === scenarioId
        );
        if (!baseline || !scenario) return state;

        const nextState = {
          ...state,
          baselinePlan: clonePlan(baseline.plan),
          draftPlan: state.draftPlan,
          lockedBaseline: {
            id: baseline.id,
            name: baseline.name,
            version: baseline.version,
            locked: true as const,
            createdAt: baseline.createdAt,
            bounds: baseline.bounds,
            plan: clonePlan(baseline.plan)
          },
          scenarioPlan: clonePlan(scenario.plan),
          showReferenceBackground: scenario.showReferenceBackground,
          activeBaselineId: baseline.id,
          activeScenarioId: scenario.id,
          activeMode: 'scenario' as const,
          setupStep: 'editor' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          scenarioPast: [],
          scenarioFuture: []
        };
        saveState(nextState);
        return nextState;
      });
    },
    createInventory(counts: Record<SetupRoomKind, number>) {
      updateState((state) => {
        if (state.lockedBaseline) return state;
        const inventory = inventoryFromCounts(counts);

        return {
          ...state,
          inventory,
          setupStep: inventory.length > 0 ? 'measurements' : 'counts',
          saveState: 'saved'
        };
      });
    },
    returnToCounts() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          setupStep: 'counts',
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
      });
    },
    updateInventoryRoom(
      roomId: string,
      patch: Pick<
        Partial<RoomInventoryItem>,
        'label' | 'width' | 'height' | 'measured'
      >
    ) {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          inventory: state.inventory.map((item) =>
            item.id === roomId ? { ...item, ...patch } : item
          )
        };
      });
    },
    startEditorFromInventory() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        const plan = planFromInventory(state.inventory);
        const nextState = {
          ...state,
          baselinePlan: plan,
          draftPlan: plan,
          activeMode: 'baseline' as const,
          setupStep: 'editor' as const,
          selectedRoomId: plan.rooms[0]?.id ?? null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    startEditorFromWholeArea(width: number, height: number) {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        const plan = planFromWholeArea(width, height);
        const nextState = {
          ...state,
          baselinePlan: plan,
          draftPlan: plan,
          activeMode: 'baseline' as const,
          setupStep: 'editor' as const,
          selectedRoomId: plan.rooms[0]?.id ?? null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    returnToSetup() {
      updateState((state) => {
        if (state.lockedBaseline) return state;

        return {
          ...state,
          setupStep: state.inventory.length > 0 ? 'measurements' : 'counts',
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
      });
    },
    lockBaseline() {
      updateState((state) => {
        if (
          state.activeMode !== 'baseline' ||
          state.baselinePlan.rooms.length === 0
        ) {
          return state;
        }

        const plan = normalisePlan(state.baselinePlan);
        const bounds = derivePlanBounds(plan);
        if (!bounds) return state;
        const baselineId = makeId('baseline');
        const lockedBaseline: LockedBaseline = {
          id: baselineId,
          name: projectName(state.draftProjectName),
          version: state.baselines.length + 1,
          locked: true,
          createdAt: now(),
          bounds,
          plan: clonePlan(plan)
        };

        const nextState = {
          ...state,
          baselinePlan: plan,
          draftPlan: null,
          lockedBaseline,
          baselines: upsertSavedBaseline(state.baselines, lockedBaseline),
          activeBaselineId: baselineId,
          activeScenarioId: null,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    unlockBaseline() {
      updateState((state) => {
        if (!state.lockedBaseline || state.scenarioPlan) return state;

        const plan = clonePlan(state.lockedBaseline.plan);
        const nextState = {
          ...state,
          baselinePlan: plan,
          lockedBaseline: null,
          activeMode: 'baseline' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          baselinePast: [],
          baselineFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    createRenovationPlan() {
      updateState((state) => {
        if (!state.lockedBaseline) return state;

        const scenarioId = makeId('scenario');
        const plan = emptyScenarioPlan();
        const scenarioCount =
          state.baselines.find(
            (baseline) => baseline.id === state.lockedBaseline?.id
          )?.scenarios.length ?? 0;
        const scenario: SavedScenario = {
          id: scenarioId,
          name: scenarioName(scenarioCount + 1),
          plan: normalisePlan(plan),
          showReferenceBackground: true,
          updatedAt: now()
        };
        const nextState = {
          ...state,
          scenarioPlan: scenario.plan,
          showReferenceBackground: true,
          baselines: state.baselines.map((baseline) =>
            baseline.id === state.lockedBaseline?.id
              ? {
                  ...baseline,
                  scenarios: [...baseline.scenarios, scenario]
                }
              : baseline
          ),
          activeBaselineId: state.lockedBaseline.id,
          activeScenarioId: scenarioId,
          activeMode: 'scenario' as const,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          scenarioPast: [],
          scenarioFuture: [],
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    renameScenario(scenarioId: string, name: string) {
      updateState((state) => {
        if (!state.activeBaselineId) return state;

        const trimmed = name.trim();
        const scenarioName = trimmed.length > 0 ? trimmed : 'Untitled scenario';
        const nextState = {
          ...state,
          baselines: state.baselines.map((baseline) =>
            baseline.id === state.activeBaselineId
              ? {
                  ...baseline,
                  scenarios: baseline.scenarios.map((scenario) =>
                    scenario.id === scenarioId
                      ? {
                          ...scenario,
                          name: scenarioName,
                          updatedAt: now()
                        }
                      : scenario
                  )
                }
              : baseline
          ),
          saveState: 'saving' as const
        };
        saveState(nextState);
        return nextState;
      });
    },
    toggleReferenceBackground() {
      updateState((state) => {
        if (state.activeMode !== 'scenario' || !state.scenarioPlan) {
          return state;
        }

        const nextState = {
          ...state,
          showReferenceBackground: !state.showReferenceBackground,
          saveState: 'saving' as const
        };
        nextState.baselines = syncActiveScenario(nextState as EditorState);
        saveState(nextState);
        return nextState;
      });
    },
    switchMode(mode: ActiveMode) {
      updateState((state) => {
        if (mode === 'scenario' && !state.scenarioPlan) return state;

        const nextState = {
          ...state,
          activeMode: mode,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        };
        saveState(nextState);
        return nextState;
      });
    },
    moveRoom(
      roomId: string,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditGeometry(state)) return plan;
          const bounds =
            state.activeMode === 'scenario'
              ? (state.lockedBaseline?.bounds ?? null)
              : null;

          return {
            ...plan,
            rooms: plan.rooms.map((room) =>
              room.id === roomId
                ? translateRoom(
                    room,
                    clampRectToBounds(
                      {
                        ...room,
                        x: snapValue(x, state.snapToGrid),
                        y: snapValue(y, state.snapToGrid)
                      },
                      bounds
                    ).x,
                    clampRectToBounds(
                      {
                        ...room,
                        x: snapValue(x, state.snapToGrid),
                        y: snapValue(y, state.snapToGrid)
                      },
                      bounds
                    ).y
                  )
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: roomId,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    resizeRoom(
      roomId: string,
      handle: ResizeHandle,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditGeometry(state)) return plan;
          const bounds =
            state.activeMode === 'scenario'
              ? (state.lockedBaseline?.bounds ?? null)
              : null;

          return {
            ...plan,
            rooms: plan.rooms.map((room) =>
              room.id === roomId
                ? reshapeRoom(
                    room,
                    clampRectToBounds(
                      resizeRect(
                        room,
                        handle,
                        snapValue(x, state.snapToGrid),
                        snapValue(y, state.snapToGrid)
                      ),
                      bounds
                    )
                  )
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: roomId,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    mergeRoom(roomId: string, otherRoomId: string) {
      mutatePlan(
        (plan, state) => {
          if (!canEditGeometry(state)) return plan;
          const room = plan.rooms.find((candidate) => candidate.id === roomId);
          const otherRoom = plan.rooms.find(
            (candidate) => candidate.id === otherRoomId
          );
          if (!room || !otherRoom || room.shape || otherRoom.shape) return plan;

          const shape = polygonFromRectUnion(room, otherRoom);
          if (!shape) return plan;
          const bounds = boundsFromPoints(shape);
          const mergedRoom: Room = {
            ...room,
            name: `${room.name} + ${otherRoom.name}`,
            type: room.type,
            ...bounds,
            shape
          };

          return {
            ...plan,
            rooms: plan.rooms
              .filter((candidate) => candidate.id !== otherRoomId)
              .map((candidate) =>
                candidate.id === roomId ? mergedRoom : candidate
              )
          };
        },
        {
          history: true,
          selectedRoomId: roomId,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    updateWall(
      wallId: string,
      patch: Pick<Partial<Wall>, 'structural' | 'removed'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;

          return {
            ...plan,
            walls: plan.walls.map((wall) =>
              wall.id === wallId ? { ...wall, ...patch } : wall
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: wallId
        }
      );
    },
    addProposedRoom(kind: SetupRoomKind) {
      const roomId = makeId('proposed-room');
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds;
          if (!bounds) return plan;

          const option = setupOptionFor(kind);
          const width = Math.min(option.width, bounds.width);
          const height = Math.min(option.height, bounds.height);
          const proposedRoom: ProposedRoom = {
            id: roomId,
            name: proposedRoomLabel(plan, kind),
            type: option.type,
            ...clampProposedRect(
              {
                x: snapValue(bounds.x + (bounds.width - width) / 2),
                y: snapValue(bounds.y + (bounds.height - height) / 2),
                width,
                height
              },
              roomId,
              plan.proposedRooms,
              bounds
            )
          };

          return {
            ...plan,
            proposedRooms: [...plan.proposedRooms, proposedRoom]
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    moveProposedRoom(
      roomId: string,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) => {
              if (room.id !== roomId) return room;

              const snappedRect = snapRectToRoomEdges(
                {
                  ...room,
                  x: snapValue(x, state.snapToGrid),
                  y: snapValue(y, state.snapToGrid)
                },
                room.id,
                plan.proposedRooms,
                state.snapToGrid
              );
              const nextRect = clampProposedRect(
                translateRoom(room, snappedRect.x, snappedRect.y),
                room.id,
                plan.proposedRooms,
                bounds
              );

              return translateRoom(room, nextRect.x, nextRect.y);
            })
          };
        },
        {
          history: options.history,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    resizeProposedRoom(
      roomId: string,
      handle: ResizeHandle,
      x: number,
      y: number,
      options: { history?: boolean } = {}
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) =>
              room.id === roomId
                ? reshapeRoom(
                    room,
                    clampProposedRect(
                      resizeRect(
                        room,
                        handle,
                        snapValue(x, state.snapToGrid),
                        snapValue(y, state.snapToGrid)
                      ),
                      room.id,
                      plan.proposedRooms,
                      bounds
                    )
                  )
                : room
            )
          };
        },
        {
          history: options.history,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    updateProposedRoom(
      roomId: string,
      patch: Pick<Partial<ProposedRoom>, 'name' | 'width' | 'height'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const bounds = state.lockedBaseline?.bounds ?? null;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.map((room) =>
              room.id === roomId
                ? reshapeRoom(
                    {
                      ...room,
                      ...patch
                    },
                    clampProposedRect(
                      {
                        ...room,
                        width: Math.max(
                          MIN_ROOM_SIZE,
                          patch.width ?? room.width
                        ),
                        height: Math.max(
                          MIN_ROOM_SIZE,
                          patch.height ?? room.height
                        )
                      },
                      room.id,
                      plan.proposedRooms,
                      bounds
                    )
                  )
                : room
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    mergeProposedRoom(roomId: string, otherRoomId: string) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;
          const room = plan.proposedRooms.find(
            (candidate) => candidate.id === roomId
          );
          const otherRoom = plan.proposedRooms.find(
            (candidate) => candidate.id === otherRoomId
          );
          if (!room || !otherRoom || room.shape || otherRoom.shape) return plan;

          const shape = polygonFromRectUnion(room, otherRoom);
          if (!shape) return plan;
          const bounds = boundsFromPoints(shape);
          const mergedRoom: ProposedRoom = {
            ...room,
            name: `${room.name} + ${otherRoom.name}`,
            type: room.type,
            ...bounds,
            shape
          };

          return {
            ...plan,
            proposedRooms: plan.proposedRooms
              .filter((candidate) => candidate.id !== otherRoomId)
              .map((candidate) =>
                candidate.id === roomId ? mergedRoom : candidate
              )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: roomId,
          selectedWallId: null
        }
      );
    },
    deleteProposedRoom(roomId: string) {
      mutatePlan(
        (plan, state) => {
          if (state.activeMode !== 'scenario') return plan;

          return {
            ...plan,
            proposedRooms: plan.proposedRooms.filter(
              (room) => room.id !== roomId
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null
        }
      );
    },
    addOpening(wallId: string, offset?: number) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;
          const wall = plan.walls.find((candidate) => candidate.id === wallId);
          if (!wall || wall.removed) return plan;

          const opening: Opening = {
            id: makeId('opening'),
            wallId,
            kind: 'door',
            offset: 0,
            width: GRID_SIZE * 2
          };
          opening.offset = clampOpeningOffset(wall, {
            ...opening,
            offset: offset ?? wallLength(wall) / 2 - opening.width / 2
          });

          return {
            ...plan,
            openings: [...plan.openings, opening]
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: wallId
        }
      );
    },
    updateOpening(
      openingId: string,
      patch: Pick<Partial<Opening>, 'offset' | 'width'>
    ) {
      mutatePlan(
        (plan, state) => {
          if (!canEditWalls(state)) return plan;

          const opening = plan.openings.find(
            (candidate) => candidate.id === openingId
          );
          if (!opening) return plan;

          const wall = plan.walls.find(
            (candidate) => candidate.id === opening.wallId
          );
          if (!wall || wall.removed) return plan;

          const nextOpening = {
            ...opening,
            ...patch,
            width: Math.min(
              Math.max(GRID_SIZE, patch.width ?? opening.width),
              wallLength(wall)
            )
          };
          nextOpening.offset = clampOpeningOffset(wall, nextOpening);

          return {
            ...plan,
            openings: plan.openings.map((candidate) =>
              candidate.id === openingId ? nextOpening : candidate
            )
          };
        },
        {
          history: true,
          selectedRoomId: null,
          selectedProposedRoomId: null
        }
      );
    },
    selectRoom(roomId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: roomId,
        selectedProposedRoomId: null,
        selectedWallId: null
      }));
    },
    selectProposedRoom(roomId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: null,
        selectedProposedRoomId: roomId,
        selectedWallId: null
      }));
    },
    selectWall(wallId: string | null) {
      updateState((state) => ({
        ...state,
        selectedRoomId: null,
        selectedProposedRoomId: null,
        selectedWallId: wallId
      }));
    },
    toggleSnap() {
      updateState((state) => ({ ...state, snapToGrid: !state.snapToGrid }));
    },
    undo() {
      updateState((state) => {
        const previous = activePast(state).at(-1);
        if (!previous) return state;

        const plan = normalisePlan(previous);
        const currentPlan = activePlan(state);
        const nextState = {
          ...state,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };

        if (state.activeMode === 'scenario') {
          nextState.scenarioPlan = plan;
          nextState.baselines = syncActiveScenario(
            nextState as EditorState,
            plan
          );
          nextState.scenarioPast = state.scenarioPast.slice(0, -1);
          nextState.scenarioFuture = [
            clonePlan(currentPlan),
            ...state.scenarioFuture
          ].slice(0, 50);
        } else {
          nextState.baselinePlan = plan;
          nextState.baselinePast = state.baselinePast.slice(0, -1);
          nextState.baselineFuture = [
            clonePlan(currentPlan),
            ...state.baselineFuture
          ].slice(0, 50);
        }

        saveState(nextState);
        return nextState;
      });
    },
    redo() {
      updateState((state) => {
        const next = activeFuture(state)[0];
        if (!next) return state;

        const plan = normalisePlan(next);
        const currentPlan = activePlan(state);
        const nextState = {
          ...state,
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          saveState: 'saving' as const
        };

        if (state.activeMode === 'scenario') {
          nextState.scenarioPlan = plan;
          nextState.baselines = syncActiveScenario(
            nextState as EditorState,
            plan
          );
          nextState.scenarioPast = [
            ...state.scenarioPast,
            clonePlan(currentPlan)
          ].slice(-50);
          nextState.scenarioFuture = state.scenarioFuture.slice(1);
        } else {
          nextState.baselinePlan = plan;
          nextState.baselinePast = [
            ...state.baselinePast,
            clonePlan(currentPlan)
          ].slice(-50);
          nextState.baselineFuture = state.baselineFuture.slice(1);
        }

        saveState(nextState);
        return nextState;
      });
    },
    markSaved() {
      updateState((state) => ({ ...state, saveState: 'saved' }));
    },
    resetLocalPlan() {
      updateState((state) => {
        const envelope = {
          ...createEnvelopeFromPlan(emptyPlan),
          baselines: state.baselines,
          draftPlan: null
        };
        const nextState = {
          ...state,
          ...envelope,
          setupStep: 'counts' as const,
          inventory: [],
          selectedRoomId: null,
          selectedProposedRoomId: null,
          selectedWallId: null,
          snapToGrid: true,
          saveState: 'saving' as const,
          baselinePast: [],
          baselineFuture: [],
          scenarioPast: [],
          scenarioFuture: []
        };
        saveState(nextState);
        return nextState;
      });
    }
  };
}

export const editor = createEditorStore();

export const selectedRoom = derived(editor, ($editor) =>
  $editor.plan.rooms.find((room) => room.id === $editor.selectedRoomId)
);

export const selectedProposedRoom = derived(editor, ($editor) =>
  $editor.plan.proposedRooms.find(
    (room) => room.id === $editor.selectedProposedRoomId
  )
);

export const selectedWall = derived(editor, ($editor) =>
  $editor.plan.walls.find((wall) => wall.id === $editor.selectedWallId)
);
