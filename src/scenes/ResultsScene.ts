import { S } from '../art/common';
import { crownKey, buildStage, podiumKey } from '../art/stage';
import { PLAYER_COLORS, toCss } from '../core/palette';
import type { PlayerResult } from '../core/types';
import { CATALOG } from '../minigames/catalog';
import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { Avatar } from '../systems/players/Avatar';
import { Vfx } from '../systems/vfx/Vfx';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

/** Round results: podium, points earned, running totals. */
export class ResultsScene extends BaseScene {
  constructor() {
    super('Results');
  }

  build(data?: { gameId: string; results: PlayerResult[] }): void {
    const gameId = data?.gameId ?? '';
    const results = [...(data?.results ?? [])].sort((a, b) => a.rank - b.rank);
    const meta = CATALOG[gameId];
    const pts = Party.record(gameId, results);
    buildStage(this, this.vw, this.vh);
    Audio.playMusic('victory');
    this.time.delayedCall(2600, () => Audio.playMusic('results'));

    const cx = this.vw / 2;
    for (const [deg, y] of [[0, this.vh - 64], [180, 26]] as const) {
      txt(this, cx, y, meta ? `${meta.name} — ผลการแข่ง` : 'ผลการแข่ง', { size: 18, color: '#ffe066' }).setAngle(deg).setDepth(50);
    }
    // Podium order on screen: 3rd/1st/2nd/4th looks classic
    const slots = [1, 0, 2, 3];
    const n = results.length;
    const gap = Math.min(130, (this.vw - 80) / Math.max(1, n));
    const floorY = this.vh - 160;
    const ordered = n >= 3 ? slots.slice(0, n).map((i) => results[i]).filter(Boolean) : results;
    ordered.forEach((r, i) => {
      const x = cx + (i - (ordered.length - 1) / 2) * gap;
      const c = PLAYER_COLORS[r.player];
      const pk = podiumKey(this, r.rank, c.main);
      const pod = this.add.image(x, floorY, pk).setOrigin(0.5, 1).setScale(S).setDepth(10);
      const top = floorY - pod.displayHeight + 6;
      const av = new Avatar(this, r.player, x, top, { scale: S * 1.3, marker: true, depthSort: false });
      av.sprite.setDepth(20);
      av.marker?.setDepth(21);
      av.shadow?.setVisible(false);
      av.play(r.rank === 1 ? 'win' : r.rank === n && n > 1 ? 'lose' : 'cheer');
      this.tweens.add({ targets: [pod], scaleY: { from: 0, to: S }, duration: 400, delay: 200 + i * 120, ease: 'Back.easeOut' });
      av.sprite.setAlpha(0);
      this.time.delayedCall(450 + i * 120, () => { av.sprite.setAlpha(1); Vfx.dust(this, x, top); Audio.sfx('land'); });
      if (r.rank === 1) {
        const crown = this.add.image(x, top - 128, crownKey(this)).setScale(S * 1.2).setDepth(22);
        this.tweens.add({ targets: crown, y: crown.y - 6, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' });
        this.time.delayedCall(700, () => Vfx.confetti(this, x, top - 60, 50));
      }
      const add = pts[r.player];
      const label = txt(this, x, floorY + 18, `+${add}`, { size: 20, color: toCss(c.light) }).setDepth(30);
      this.tweens.add({ targets: label, scale: { from: 0, to: 1 }, delay: 900 + i * 100, duration: 300, ease: 'Back.easeOut' });
      txt(this, x, floorY + 40, `คะแนนเกม ${r.score}`, { size: 10, color: '#c7c9d6', strokeWidth: 2 }).setDepth(30);
      if (Party.mode === 'party') txt(this, x, floorY + 56, `รวม ${Party.totals[r.player]}`, { size: 13, color: '#ffffff' }).setDepth(30);
    });

    const by = this.vh - 26;
    const btns: { label: string; skin: string; fn: () => void }[] = [];
    if (Party.mode === 'party') {
      if (Party.over) btns.push({ label: 'ดูผู้ชนะ! ★', skin: 'ui-btn', fn: () => this.goto('Final') });
      else btns.push({ label: `รอบต่อไป (${Party.round + 1}/${Party.rounds}) ▶`, skin: 'ui-btn-mint', fn: () => this.goto('RoundIntro') });
      btns.push({ label: 'ออก', skin: 'ui-btn-grey', fn: () => this.goto('Menu') });
    } else {
      btns.push({ label: 'เล่นอีก ↻', skin: 'ui-btn-mint', fn: () => this.goto(gameId) });
      if (Party.mode === 'quick') btns.push({ label: 'สุ่มเกมใหม่', skin: 'ui-btn', fn: () => this.goto('RoundIntro') });
      else btns.push({ label: 'คลังเกม', skin: 'ui-btn-blue', fn: () => this.goto('Library') });
      btns.push({ label: 'เมนู', skin: 'ui-btn-grey', fn: () => this.goto('Menu') });
    }
    const bw = 170;
    btns.forEach((b, i) => new Button(this, cx + (i - (btns.length - 1) / 2) * (bw + 12), by, { w: bw, h: 40, label: b.label, size: 15, skin: b.skin, onTap: b.fn }).setDepth(60));
    if (Party.fast) this.time.delayedCall(400, () => (Party.mode === 'party' ? btns[0].fn() : this.goto('Menu')));
  }
}
