import Phaser from 'phaser';
import { PLAYER_COLORS, toCss } from '../core/palette';
import { CATALOG } from '../minigames/catalog';
import { playableIds } from '../minigames/registry';
import { CATEGORY_LABEL } from '../minigames/types';
import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { Vfx } from '../systems/vfx/Vfx';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

/** Roulette that picks the next minigame (no immediate repeats). */
export class RoundIntroScene extends BaseScene {
  constructor() {
    super('RoundIntro');
  }

  build(data?: { gameId?: string }): void {
    new ClassroomView(this, this.vw, { rows: [300, 346, 392] });
    this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.6).setOrigin(0).setDepth(10);
    Audio.stopMusic();
    const ids = playableIds();
    const chosen = data?.gameId ?? Party.pick(ids);
    const cx = this.vw / 2, cy = this.vh / 2;
    const roundLabel = Party.mode === 'party' ? `รอบที่ ${Party.round + 1} / ${Party.rounds}` : 'เล่นด่วน';
    for (const [deg, y] of [[0, cy + 120], [180, cy - 120]] as const) {
      txt(this, cx, y, roundLabel, { size: 22, color: '#ffe066' }).setAngle(deg).setDepth(30);
    }
    if (Party.mode === 'party' && Party.round > 0) {
      const st = Party.standings();
      st.forEach((r, i) => {
        const c = PLAYER_COLORS[r.player];
        txt(this, 16, 20 + i * 20, `${r.rank}. P${r.player + 1}  ${Party.totals[r.player]}`, { size: 12, color: toCss(c.light), origin: [0, 0.5] }).setDepth(30);
      });
    }
    // Spinning card
    const card = this.add.container(cx, cy).setDepth(40);
    const bg = this.add.nineslice(0, 0, 'ui-panel', undefined, 150, 60, 6, 6, 6, 6).setScale(2);
    const strip = this.add.rectangle(0, -40, 280, 26, 0xffffff).setStrokeStyle(2, 0x1b1f3b);
    const name = txt(this, 0, -40, '', { size: 20, color: '#ffffff' });
    const th = txt(this, 0, 2, '', { size: 18, color: '#1b1f3b', strokeWidth: 0, shadow: false });
    const cat = txt(this, 0, 34, '', { size: 12, color: '#5a4fa0', strokeWidth: 0, shadow: false, bold: false });
    card.add([bg, strip, name, th, cat]);
    const show = (id: string) => {
      const m = CATALOG[id];
      strip.setFillStyle(m.color);
      name.setText(`#${m.num} ${m.name}`);
      th.setText(m.nameTh);
      cat.setText(CATEGORY_LABEL[m.category]);
    };
    const all = Object.keys(CATALOG);
    let n = 0;
    const spins = Party.fast ? 2 : 18;
    const step = () => {
      n++;
      const id = n >= spins ? chosen : all[Math.floor(Math.random() * all.length)];
      show(id);
      Audio.sfx('tick');
      this.tweens.add({ targets: card, scaleY: { from: 0.85, to: 1 }, duration: 60 });
      if (n < spins) this.time.delayedCall(40 + n * n * 1.1, step);
      else {
        Audio.sfx('power');
        Vfx.confetti(this, cx, cy - 40, 40);
        this.tweens.add({ targets: card, scale: { from: 1.25, to: 1 }, duration: 400, ease: 'Back.easeOut' });
        this.time.delayedCall(Party.fast ? 100 : 1500, () => this.goto(chosen));
      }
    };
    step();
    this.input.once(Phaser.Input.Events.POINTER_UP, () => { n = spins - 1; });
  }
}
