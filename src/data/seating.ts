import type { SeatEntry } from '../core/types';

/**
 * Seating chart of classroom 5/8 (from the class's drawing):
 *
 *            กระดาน (board)
 *  โต๊ะครู                           ประตู
 *  row 1:  2  2  2  2
 *  row 2:  2  2  2  2
 *  row 3:  2  2  3
 *  row 4:  2  2  5
 *  row 5:  2  2  3                    ประตู
 *
 * Each number is a group of desks pushed together (39 desks). Who sits at which
 * desk is not known yet — seats stay empty until the class assigns them
 * (Characters → ผังที่นั่ง). Seats are never assigned randomly.
 */
export const SEAT_LAYOUT: number[][] = [
  [2, 2, 2, 2],
  [2, 2, 2, 2],
  [2, 2, 3],
  [2, 2, 5],
  [2, 2, 3],
];

export const SEAT_ROWS = SEAT_LAYOUT.length;
export const SEAT_COLS = Math.max(...SEAT_LAYOUT.map((r) => r.reduce((a, b) => a + b, 0)));

export function rowLength(row: number): number {
  return (SEAT_LAYOUT[row] ?? []).reduce((a, b) => a + b, 0);
}

/** Group index and position inside the group of a desk. */
export function deskGroup(row: number, column: number): { group: number; index: number } {
  let c = column;
  const groups = SEAT_LAYOUT[row] ?? [];
  for (let g = 0; g < groups.length; g++) {
    if (c < groups[g]) return { group: g, index: c };
    c -= groups[g];
  }
  return { group: groups.length - 1, index: 0 };
}

/** Assigned seats only. */
export const SEATING: SeatEntry[] = [];

const STORE = 'c58-seating-v2';

export function loadSeating(): void {
  SEATING.length = 0;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const list = JSON.parse(raw) as SeatEntry[];
    if (Array.isArray(list)) SEATING.push(...list.filter((s) => s.row < SEAT_ROWS && s.column < rowLength(s.row)));
  } catch {
    /* none */
  }
}

export function saveSeating(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(SEATING));
  } catch {
    /* ignore */
  }
}

export function seatAt(row: number, column: number): SeatEntry | undefined {
  return SEATING.find((s) => s.row === row && s.column === column);
}

export function assign(row: number, column: number, characterId: string | null, name = '', number = 0): void {
  // a friend sits in one place only
  for (let i = SEATING.length - 1; i >= 0; i--) {
    const s = SEATING[i];
    if ((s.row === row && s.column === column) || (characterId && s.characterId === characterId)) SEATING.splice(i, 1);
  }
  if (characterId) SEATING.push({ row, column, characterId, name, number });
  saveSeating();
}
