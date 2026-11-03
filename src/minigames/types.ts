import type { MinigameCategory, MinigameStatus } from '../core/types';
import type { ZoneLayout } from '../systems/input/MultiTouchManager';

export interface MinigameMeta {
  /** Scene key and registry id, e.g. 'classroom-dash'. */
  id: string;
  /** 1..50, matches docs/MINIGAMES.md. */
  num: number;
  name: string;
  nameTh: string;
  category: MinigameCategory;
  /** One-line pitch (Thai). */
  blurb: string;
  /** 1–3 short how-to lines (Thai). Players should get it in 5–10 s. */
  howTo: string[];
  /** Controls summary (Thai). */
  controls: string;
  /** Seconds; 0 = ends on its own win condition. */
  duration: number;
  minPlayers: number;
  maxPlayers: number;
  team?: boolean;
  layout?: ZoneLayout;
  music?: string;
  status: MinigameStatus;
  /** Accent colour for cards / intro. */
  color: number;
}

export const CATEGORY_LABEL: Record<MinigameCategory, string> = {
  racing: 'แข่งความเร็ว',
  survival: 'เอาตัวรอด',
  'physics-fighting': 'ฟิสิกส์ & ต่อสู้',
  reflex: 'ปฏิกิริยา',
  sports: 'กีฬา',
  'cooking-coop': 'ทำอาหาร & ทีม',
  puzzle: 'ปริศนา',
  'creative-funny': 'สร้างสรรค์ & ฮา',
  'advanced-party': 'ปาร์ตี้ขั้นสูง',
  'wild-card': 'ไวลด์การ์ด',
};
