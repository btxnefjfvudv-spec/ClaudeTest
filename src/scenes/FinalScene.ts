import { S } from '../art/common';
import { buildStage, crownKey, podiumKey } from '../art/stage';
import { PLAYER_COLORS, toCss } from '../core/palette';
import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { Avatar } from '../systems/players/Avatar';
import { Vfx, burst } from '../systems/vfx/Vfx';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { CATALOG } from '../minigames/catalog';

/** Winner ceremony after the last party round. */
export class FinalScene extends BaseScene {
  constructor() {
    super('Final');
  }

  build(): void {
    buildStage(this, this.vw, this.vh);
    Audio.playMusic('victory');
    this.time.delayedCall(3000, () => Audio.playMusic('results'));
    const st = Party.standings();
    const cx = this.vw / 2;
    const champ = st[0];
    const cc = PLAYER_COLORS[champ.player];
    for (const [deg, y] of [[0, this.vh - 86], [180, 36]] as const) {
      const t = txt(this, cx, y, `★ P${champ.player + 1} แชมป์ห้อง 5/8! ★`, { size: 24, color: toCss(cc.light), strokeWidth: 7 }).setAngle(deg).setDepth(50);
      this.tweens.add({ targets: t, scale: { from: 0.2, to: 1 }, duration: 600, delay: 1800, ease: 'Back.easeOut' });
      t.setScale(0);
    }
    const floorY = this.vh - 150;
    const order = [1, 0, 2, 3].map((i) => st[i]).filter(Boolean);
    const gap = Math.min(140, (this.vw - 80) / order.length);
    order.forEach((r, i) => {
      const x = cx + (i - (order.length - 1) / 2) * gap;
      const c = PLAYER_COLORS[r.player];
      const pod = this.add.image(x, floorY, podiumKey(this, r.rank, c.main)).setOrigin(0.5, 1).setScale(S * 1.2).setDepth(10);
      const top = floorY - pod.displayHeight + 8;
      const av = new Avatar(this, r.player, x, top, { scale: S * 1.5, depthSort: false });
      av.shadow?.setVisible(false);
      av.sprite.setDepth(20);
      av.marker?.setDepth(21);
      // Reveal from last place to first
      const delay = (4 - r.rank) * 500 + 300;
      av.setVisible(false);
      this.time.delayedCall(delay, () => {
        av.setVisible(true);
        av.play(r.rank === 1 ? 'win' : r.rank === order.length ? 'lose' : 'cheer');
        Audio.sfx(r.rank === 1 ? 'power' : 'land');
        Vfx.dust(this, x, top);
        if (r.rank === 1) {
          const crown = this.add.image(x, top - 110, crownKey(this)).setScale(S * 1.6).setDepth(25);
          this.tweens.add({ targets: crown, y: crown.y - 8, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
          Vfx.confetti(this, x, top - 80, 90);
        }
      });
      txt(this, x, floorY + 18, `${Party.totals[r.player]} แต้ม`, { size: 16, color: toCss(c.light) }).setDepth(30);
      txt(this, x, floorY + 38, `ชนะ ${Party.wins[r.player]} เกม`, { size: 11, color: '#c7c9d6', strokeWidth: 2 }).setDepth(30);
    });
    // Fireworks loop
    this.time.addEvent({
      delay: 700, loop: true, startAt: -2000, callback: () => {
        const x = 40 + Math.random() * (this.vw - 80), y = 60 + Math.random() * 120;
        burst(this, x, y, { tex: 'spark', count: 26, tint: [PLAYER_COLORS[champ.player].main, 0xffe066, 0xffffff], speed: [60, 180], life: 900, gravity: 120 });
        Audio.sfx('pop', 0.6 + Math.random() * 0.6);
      },
    });
    // Round history ribbon
    const hist = Party.history.map((h, i) => `${i + 1}.${CATALOG[h.gameId]?.name ?? h.gameId} → P${(h.results.find((r) => r.rank === 1)?.player ?? 0) + 1}`).join('   ');
    txt(this, cx, this.vh - 58, hist, { size: 9, color: '#c7c9d6', strokeWidth: 2, wrap: this.vw - 40 }).setDepth(30);
    new Button(this, cx - 100, this.vh - 26, { w: 180, h: 40, label: 'เล่นอีกปาร์ตี้ ↻', size: 15, skin: 'ui-btn-mint', onTap: () => { Party.start('party', Party.rounds); this.goto('RoundIntro'); } }).setDepth(60);
    new Button(this, cx + 100, this.vh - 26, { w: 180, h: 40, label: 'กลับเมนู', size: 15, skin: 'ui-btn-grey', onTap: () => this.goto('Menu') }).setDepth(60);
    if (Party.fast) this.time.delayedCall(600, () => this.goto('Menu'));
  }
}
