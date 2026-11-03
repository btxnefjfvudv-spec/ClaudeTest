import Phaser from 'phaser';
import { buildCharacter } from '../art/CharacterArt';
import { S } from '../art/common';
import { PLAYER_COLORS, toCss } from '../core/palette';
import { PLAYER_INDICES, type PlayerIndex } from '../core/types';
import { CHARACTERS, characterById } from '../data/characters';
import { Audio } from '../systems/audio/AudioManager';
import { MultiTouchManager } from '../systems/input/MultiTouchManager';
import { Party } from '../systems/party/Party';
import { playerMarkerKey } from '../systems/players/Avatar';
import { saveSettings } from '../systems/settings';
import { Vfx } from '../systems/vfx/Vfx';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

interface Seat {
  joined: boolean;
  charIdx: number;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;
}

/**
 * Each player taps their own corner to join, then swipes / taps arrows to pick
 * a classmate. Seats facing the far side are rotated 180°.
 */
export class PlayerSelectScene extends BaseScene {
  private seats: Seat[] = [];
  private next = 'party';
  private touch!: MultiTouchManager;

  constructor() {
    super('PlayerSelect');
  }

  build(data?: { next?: string }): void {
    this.next = data?.next ?? 'party';
    this.cameras.main.setBackgroundColor(0x1e1f26);
    this.touch = new MultiTouchManager(this, 'quadrants');
    this.seats = [];
    Audio.playMusic('menu');

    for (const p of PLAYER_INDICES) {
      const zone = this.touch.zoneOf(p)!;
      const r = this.touch.zoneRect(zone);
      const c = PLAYER_COLORS[p];
      this.add.rectangle(r.x + 3, r.y + 3, r.width - 6, r.height - 6, c.main, 0.16).setOrigin(0).setStrokeStyle(3, c.main, 0.8);
      const cont = this.add.container(r.centerX, r.centerY).setAngle(zone.facing);
      const ch = characterById(Party.slots[p].characterId);
      const idx = Math.max(0, CHARACTERS.indexOf(ch));
      const key = buildCharacter(this, ch.id, ch.look);
      const pedestal = this.add.ellipse(0, 40, 90, 22, c.dark, 0.6);
      const sprite = this.add.sprite(0, 40, key, 0).setOrigin(0.5, 1).setScale(S * 1.6);
      sprite.play(`${key}-idle`);
      const marker = this.add.image(0, -50, playerMarkerKey(this, p)).setScale(S * 1.2);
      const label = txt(this, 0, -76, 'แตะเพื่อเข้าร่วม', { size: 16, color: toCss(c.light) });
      const name = txt(this, 0, 62, ch.name, { size: 14 });
      const left = txt(this, -86, 10, '◀', { size: 26, color: toCss(c.light) });
      const right = txt(this, 86, 10, '▶', { size: 26, color: toCss(c.light) });
      cont.add([pedestal, sprite, marker, label, name, left, right]);
      const seat: Seat = { joined: Party.slots[p].human && Party.humanCount > 0 && p === 0 ? false : false, charIdx: idx, sprite, label, name, container: cont };
      this.seats.push(seat);
      this.tweens.add({ targets: label, alpha: 0.4, yoyo: true, repeat: -1, duration: 500 });
      sprite.setAlpha(0.45);
    }

    this.touch.on('tap', (t: { player: PlayerIndex; x: number; y: number }) => this.onTap(t.player, t.x, t.y));
    this.touch.on('swipe', (t: { player: PlayerIndex }, s: { localDx: number; localDy: number }) => {
      if (Math.abs(s.localDx) > Math.abs(s.localDy)) this.cycle(t.player, s.localDx > 0 ? 1 : -1);
    });

    // Centre controls (between the two sides)
    const cx = this.vw / 2, cy = this.vh / 2;
    const go = new Button(this, cx, cy, { w: 150, h: 46, label: 'ไปต่อ ▶', size: 20, skin: 'ui-btn-mint', onTap: () => this.confirm() });
    go.setDepth(100);
    const back = new Button(this, cx - 120, cy, { w: 70, h: 36, label: '◀', size: 16, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') });
    back.setDepth(100);
    const cpu = new Button(this, cx + 130, cy, {
      w: 90, h: 36, label: Party.fillCpu ? 'CPU: เปิด' : 'CPU: ปิด', size: 12, skin: 'ui-btn-purple',
      onTap: () => { Party.fillCpu = !Party.fillCpu; cpu.setLabel(Party.fillCpu ? 'CPU: เปิด' : 'CPU: ปิด'); saveSettings(); },
    });
    cpu.setDepth(100);
    txt(this, cx, cy - 40, 'เลือกตัวละคร', { size: 14, color: '#c7c9d6' }).setAngle(180);
    txt(this, cx, cy + 40, 'เลือกตัวละคร', { size: 14, color: '#c7c9d6' });
  }

  private onTap(p: PlayerIndex, x: number, _y: number): void {
    const seat = this.seats[p];
    const zone = this.touch.zoneOf(p)!;
    const r = this.touch.zoneRect(zone);
    if (!seat.joined) {
      seat.joined = true;
      this.tweens.killTweensOf(seat.label);
      seat.label.setAlpha(1).setText(`P${p + 1} พร้อม!`);
      seat.sprite.setAlpha(1).play(`${seat.sprite.texture.key}-win`);
      this.time.delayedCall(700, () => seat.sprite.play(`${seat.sprite.texture.key}-idle`));
      Audio.sfx('power', 1 + p * 0.1);
      const wp = seat.container.getWorldTransformMatrix();
      Vfx.confetti(this, wp.tx / this.cameras.main.zoom, wp.ty / this.cameras.main.zoom, 30);
      return;
    }
    // Tap left/right third of the zone (in the player's own view) to change character.
    const localX = zone.facing === 180 ? r.right - x : x - r.x;
    if (localX < r.width * 0.33) this.cycle(p, -1);
    else if (localX > r.width * 0.67) this.cycle(p, 1);
    else {
      seat.sprite.play(`${seat.sprite.texture.key}-cheer`);
      Audio.sfx('select', 1 + p * 0.1);
    }
  }

  private cycle(p: PlayerIndex, dir: number): void {
    const seat = this.seats[p];
    if (!seat.joined) return this.onTap(p, 0, 0);
    // skip characters already taken by joined players
    for (let i = 0; i < CHARACTERS.length; i++) {
      seat.charIdx = (seat.charIdx + dir + CHARACTERS.length) % CHARACTERS.length;
      const id = CHARACTERS[seat.charIdx].id;
      const taken = this.seats.some((s, j) => j !== p && CHARACTERS[s.charIdx].id === id);
      if (!taken) break;
    }
    const ch = CHARACTERS[seat.charIdx];
    const key = buildCharacter(this, ch.id, ch.look);
    seat.sprite.setTexture(key, 0).play(`${key}-idle`);
    seat.name.setText(ch.name);
    Vfx.squash(this, seat.sprite, 1.3, 0.8, 160, S * 1.6);
    Audio.sfx('click', 1 + p * 0.1);
  }

  private confirm(): void {
    const humans = this.seats.map((s) => s.joined);
    if (!humans.some(Boolean)) humans[2] = true; // nobody joined: the near-left seat plays
    // CPUs take characters not used by humans
    const used = new Set<string>();
    this.seats.forEach((s, i) => { if (humans[i]) used.add(CHARACTERS[s.charIdx].id); });
    this.seats.forEach((s, i) => {
      let id = CHARACTERS[s.charIdx].id;
      if (!humans[i] && used.has(id)) id = CHARACTERS.find((c) => !used.has(c.id))!.id;
      used.add(id);
      Party.slots[i].characterId = id;
    });
    Party.setHumans(humans);
    saveSettings();
    this.goto('Mode', { next: this.next });
  }
}
