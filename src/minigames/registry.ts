import type { MinigameStatus } from '../core/types';
import type { BaseMinigame } from './BaseMinigame';
import { CATALOG, CATALOG_LIST } from './catalog';
import type { MinigameMeta } from './types';

type SceneClass = (new () => BaseMinigame) & { status?: MinigameStatus };

/**
 * Every file in ./games/ default-exports one minigame scene class.
 * They are discovered automatically (no manual registration needed).
 * A class may declare `static status` (defaults to 'implemented').
 */
const modules = import.meta.glob<{ default: SceneClass }>('./games/*.ts', { eager: true });

export const SCENES: SceneClass[] = [];
const statusById = new Map<string, MinigameStatus>();

for (const [path, mod] of Object.entries(modules)) {
  const C = mod.default;
  if (typeof C !== 'function') {
    console.warn(`[registry] ${path} has no default export`);
    continue;
  }
  const id = new C().meta.id;
  if (!CATALOG[id]) {
    console.warn(`[registry] ${path}: unknown game id ${id}`);
    continue;
  }
  const status = C.status ?? 'implemented';
  statusById.set(id, status);
  CATALOG[id].status = status;
  SCENES.push(C);
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
