import type { SeatEntry } from '../core/types';
import { CHARACTERS } from './characters';

/**
 * Seating chart of the real 5/8 classroom. Until the user's chart arrives this
 * is a placeholder (rows × cols filled with the placeholder characters).
 * When real data exists it must be used as-is — never shuffled.
 */
export const SEAT_ROWS = 3;
export const SEAT_COLS = 4;

export const SEATING: SeatEntry[] = [];

function defaults(): SeatEntry[] {
  const out: SeatEntry[] = [];
  let n = 0;
  for (let row = 0; row < SEAT_ROWS; row++) {
    for (let column = 0; column < SEAT_COLS; column++) {
      const c = CHARACTERS[n % CHARACTERS.length];
      out.push({ name: c.name, number: n + 1, row, column, characterId: c.id });
      n++;
    }
  }
  return out;
}

const STORE = 'c58-seating';

export function loadSeating(): void {
  SEATING.length = 0;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const list = JSON.parse(raw) as SeatEntry[];
      if (Array.isArray(list) && list.length) {
        SEATING.push(...list.filter((s) => typeof s.row === 'number' && typeof s.column === 'number'));
        return;
      }
    }
  } catch {
    /* fall through to defaults */
  }
  SEATING.push(...defaults());
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
