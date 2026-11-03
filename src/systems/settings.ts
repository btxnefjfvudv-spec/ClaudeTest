import { Audio } from './audio/AudioManager';
import { Party } from './party/Party';
import { Settings } from './vfx/Vfx';

const KEY = 'c58-settings';

/** Persist per-device preferences (volume, CPU fill, shake). Safe when storage is blocked. */
export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    Object.assign(Audio.volume, s.volume ?? {});
    if (typeof s.fillCpu === 'boolean') Party.fillCpu = s.fillCpu;
    if (typeof s.reduceShake === 'boolean') Settings.reduceShake = s.reduceShake;
    if (Array.isArray(s.chars)) s.chars.forEach((id: string, i: number) => { if (Party.slots[i] && typeof id === 'string') Party.slots[i].characterId = id; });
    Audio.applyVolume();
  } catch {
    /* storage unavailable: defaults */
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      volume: Audio.volume,
      fillCpu: Party.fillCpu,
      reduceShake: Settings.reduceShake,
      chars: Party.slots.map((s) => s.characterId),
    }));
  } catch {
    /* ignore */
  }
}
