export type RoomType =
  | 'bedroom'
  | 'kitchen'
  | 'living'
  | 'wet'
  | 'utility'
  | 'generic';

export type SetupRoomKind =
  | 'bedroom'
  | 'toilet'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'dining'
  | 'laundry'
  | 'storage'
  | 'garage'
  | 'other';

export type WallKind = 'shared' | 'exterior';

export type OpeningKind = 'door' | 'sliding-door' | 'opening' | 'window';

export type PlanObjectKind =
  | 'fridge'
  | 'stove'
  | 'sink'
  | 'dishwasher'
  | 'counter'
  | 'toilet'
  | 'shower'
  | 'bath'
  | 'vanity'
  | 'bed'
  | 'wardrobe'
  | 'sofa'
  | 'dining-table'
  | 'desk';

export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Room extends PlanRect {
  id: string;
  name: string;
  type: RoomType;
}

export type ProposedRoom = Room;

export interface Wall {
  id: string;
  kind: WallKind;
  roomIds: string[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  structural: boolean;
  removed: boolean;
}

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  offset: number;
  width: number;
}

export interface PlanObject extends PlanRect {
  id: string;
  kind: PlanObjectKind;
  roomId?: string;
  rotation: 0 | 90 | 180 | 270;
}

export interface PlanDocument {
  id: string;
  rooms: Room[];
  proposedRooms: ProposedRoom[];
  walls: Wall[];
  openings: Opening[];
  objects: PlanObject[];
}

export interface BaselineVersion {
  id: string;
  name: string;
  locked: boolean;
  plan: PlanDocument;
  createdAt: string;
}

export interface Scenario {
  id: string;
  baselineId: string;
  name: string;
  plan: PlanDocument;
  updatedAt: string;
}

export interface RoomInventoryItem {
  id: string;
  kind: SetupRoomKind;
  label: string;
  type: RoomType;
  width: number;
  height: number;
  measured: boolean;
}
