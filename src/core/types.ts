/** Shared contracts for every system and all 50 minigames. */

export type PlayerIndex = 0 | 1 | 2 | 3;
export const PLAYER_INDICES: readonly PlayerIndex[] = [0, 1, 2, 3];

export interface PlayerResult {
  player: PlayerIndex;
  /** 1 = first place. Ties share a rank. */
  rank: number;
  /** Game-specific score, shown on the results screen. */
  score: number;
  /** Team id for team games (e.g. TEAMWORK TUG). */
  team?: number;
}

export type MinigameCategory =
  | 'racing'
  | 'survival'
  | 'physics-fighting'
  | 'reflex'
  | 'sports'
  | 'cooking-coop'
  | 'puzzle'
  | 'creative-funny'
  | 'advanced-party'
  | 'wild-card';

export type MinigameStatus =
  | 'planned'
  | 'prototype'
  | 'in-development'
  | 'implemented'
  | 'playtested'
  | 'verified';

/**
 * Central standard for all minigames. Each minigame is a Phaser scene that
 * implements this contract; the party flow only talks to minigames through it.
 */
export interface MinigameDefinition {
  id: string;
  name: string;
  category: MinigameCategory;
  minPlayers: number;
  maxPlayers: number;
  /** Seconds. 0 = ends by its own win condition. */
  duration: number;
  preload(): Promise<void>;
  create(): void;
  start(): void;
  update(delta: number): void;
  pause(): void;
  resume(): void;
  reset(): void;
  destroy(): void;
  getResults(): PlayerResult[];
}

/** One seat in the real 5/8 classroom, taken from the user's seating chart. */
export interface SeatEntry {
  name: string;
  /** Class number (เลขที่). */
  number: number;
  row: number;
  column: number;
  characterId: string;
}

/** A friend's pixel-art character. Only fields backed by user references. */
export interface CharacterDefinition {
  id: string;
  displayName: string;
  hairStyle: string;
  hairColor: string;
  outfit: string;
  signatureColor: string;
  traits: string[];
  /** True until the user has sent references and approved the design. */
  placeholder: boolean;
}
