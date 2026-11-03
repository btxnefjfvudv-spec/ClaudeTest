import type { PlayerIndex, PlayerResult } from '../../core/types';
import { PLAYER_INDICES } from '../../core/types';
import { CHARACTERS } from '../../data/characters';

export type PartyMode = 'party' | 'quick' | 'free' | 'practice';

export interface Slot {
  index: PlayerIndex;
  characterId: string;
  /** Human-controlled; otherwise a CPU fills the seat. */
  human: boolean;
  /** Seat in use at all (CPU or human). */
  active: boolean;
}

export interface RoundRecord {
  gameId: string;
  results: PlayerResult[];
  points: number[];
}

/** Rank values with ties sharing a rank. higherIsBetter for scores, false for times. */
export function rankBy(players: PlayerIndex[], value: (p: PlayerIndex) => number, higherIsBetter = true): PlayerResult[] {
  const sorted = [...players].sort((a, b) => (higherIsBetter ? value(b) - value(a) : value(a) - value(b)));
  const out: PlayerResult[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const rank = prev && value(p) === value(sorted[i - 1]) ? prev.rank : i + 1;
    out.push({ player: p, rank, score: value(p) });
  });
  return out;
}

class PartyState {
  slots: Slot[] = PLAYER_INDICES.map((i) => ({ index: i, characterId: CHARACTERS[i].id, human: i === 0, active: true }));
  mode: PartyMode = 'quick';
  rounds = 5;
  round = 0;
  points = [10, 7, 5, 3];
  totals = [0, 0, 0, 0];
  wins = [0, 0, 0, 0];
  history: RoundRecord[] = [];
  /** Fill empty seats with CPU players. */
  fillCpu = true;
  /** Games used recently (no immediate repeats). */
  recent: string[] = [];
  /** For automated tests: skip intros/waits. */
  fast = false;
  /** For automated tests: gameplay sub-steps per frame (time acceleration). */
  speed = 1;

  get activePlayers(): PlayerIndex[] {
    return this.slots.filter((s) => s.active).map((s) => s.index);
  }

  get humanCount(): number {
    return this.slots.filter((s) => s.active && s.human).length;
  }

  isCpu(p: PlayerIndex): boolean {
    return !this.slots[p].human;
  }

  setHumans(humans: boolean[]): void {
    this.slots.forEach((s, i) => {
      s.human = humans[i];
      s.active = humans[i] || this.fillCpu;
    });
    if (!this.slots.some((s) => s.active)) this.slots[0].active = true;
  }

  start(mode: PartyMode, rounds = 5): void {
    this.mode = mode;
    this.rounds = rounds;
    this.round = 0;
    this.totals = [0, 0, 0, 0];
    this.wins = [0, 0, 0, 0];
    this.history = [];
  }

  /** Pick a random game from ids, avoiding recent ones. */
  pick(ids: string[]): string {
    const fresh = ids.filter((id) => !this.recent.includes(id));
    const pool = fresh.length ? fresh : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    this.recent.push(id);
    const keep = Math.min(Math.floor(ids.length / 2), 8);
    while (this.recent.length > keep) this.recent.shift();
    return id;
  }

  record(gameId: string, results: PlayerResult[]): number[] {
    const pts = [0, 0, 0, 0];
    for (const r of results) {
      pts[r.player] = this.points[Math.min(this.points.length - 1, r.rank - 1)] ?? 0;
      if (r.rank === 1) this.wins[r.player]++;
    }
    if (this.mode === 'party') {
      for (let i = 0; i < 4; i++) this.totals[i] += pts[i];
      this.round++;
    }
    this.history.push({ gameId, results, points: pts });
    return pts;
  }

  get over(): boolean {
    return this.mode === 'party' && this.round >= this.rounds;
  }

  /** Final standings: total points, then wins, then best recent rank. */
  standings(): PlayerResult[] {
    const players = this.activePlayers;
    const key = (p: PlayerIndex) => this.totals[p] * 10000 + this.wins[p] * 100 + this.lastRankBonus(p);
    return rankBy(players, key).map((r) => ({ ...r, score: this.totals[r.player] }));
  }

  private lastRankBonus(p: PlayerIndex): number {
    const last = this.history[this.history.length - 1];
    const r = last?.results.find((x) => x.player === p)?.rank ?? 4;
    return 5 - r;
  }
}

export const Party = new PartyState();
