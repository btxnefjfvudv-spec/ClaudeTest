import type { MinigameStatus } from '../core/types';
import type { BaseMinigame } from './BaseMinigame';
import { CATALOG, CATALOG_LIST } from './catalog';
import type { MinigameMeta } from './types';
import { LastOneStanding } from './games/LastOneStanding';
import { ClassroomDash } from './games/ClassroomDash';
import { BumperBall } from './games/BumperBall';

type SceneClass = new () => BaseMinigame;

/** Implemented scenes, with their verified status. */
const IMPLEMENTED: [SceneClass, MinigameStatus][] = [
  [ClassroomDash, 'implemented'],
  [LastOneStanding, 'implemented'],
  [BumperBall, 'implemented'],
];

export const SCENES: SceneClass[] = IMPLEMENTED.map(([c]) => c);

const statusById = new Map<string, MinigameStatus>();
for (const [C, status] of IMPLEMENTED) {
  const id = (new C()).meta.id;
  statusById.set(id, status);
  CATALOG[id].status = status;
}

export function isPlayable(id: string): boolean {
  return statusById.has(id);
}

export function playableIds(): string[] {
  return CATALOG_LIST.filter((m) => isPlayable(m.id)).map((m) => m.id);
}

export function allGames(): MinigameMeta[] {
  return CATALOG_LIST;
}
