import type { RoomType } from './plan';

export const ROOM_TYPES: readonly RoomType[] = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'laundry',
  'hallway',
  'other'
];

export function guessRoomType(name: string): RoomType {
  const n = name.toLowerCase();
  if (/bed|master|guest|nursery/.test(n)) return 'bedroom';
  if (/bath|toilet|wc|ensuite|shower|powder/.test(n)) return 'bathroom';
  if (/kitchen|scullery|pantry/.test(n)) return 'kitchen';
  if (/living|lounge|family|dining|rumpus|sitting|study|office/.test(n)) return 'living';
  if (/laundry|utility/.test(n)) return 'laundry';
  if (/hall|corridor|entry|foyer|landing/.test(n)) return 'hallway';
  return 'other';
}
