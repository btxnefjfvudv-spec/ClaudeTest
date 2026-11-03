import Phaser from 'phaser';
import { S } from '../art/common';
import { Audio } from '../systems/audio/AudioManager';
import { txt } from './text';

export interface ButtonOpts {
  w: number;
  h: number;
  label: string;
  sub?: string;
  skin?: string;
  size?: number;
  icon?: string;
  color?: string;
  onTap: () => void;
  sound?: string;
}

/** Chunky pixel button: idle / hover / press / disabled, with sound + squash. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.NineSlice;
  private label: Phaser.GameObjects.Text;
  private sub?: Phaser.GameObjects.Text;
  private icon?: Phaser.GameObjects.Image;
  private skin: string;
  private pressed = false;
  private enabledState = true;
  private readonly o: ButtonOpts;

  constructor(scene: Phaser.Scene, x: number, y: number, o: ButtonOpts) {
    super(scene, x, y);
    this.o = o;
    this.skin = o.skin ?? 'ui-btn';
    this.bg = scene.add.nineslice(0, 0, this.skin, undefined, o.w / S, o.h / S, 6, 6, 6, 8).setScale(S);
    this.add(this.bg);
    const ly = this.labelY();
    if (o.icon) {
      this.icon = scene.add.image(-o.w / 2 + 22, -3, o.icon).setScale(S).setTint(0x1b1f3b);
      this.add(this.icon);
    }
    this.label = txt(scene, o.icon ? 10 : 0, ly, o.label, { size: o.size ?? 18, color: o.color ?? '#1b1f3b', stroke: '#ffffff', strokeWidth: 0, shadow: false });
    this.add(this.label);
    if (o.sub) {
      this.sub = txt(scene, o.icon ? 10 : 0, ly + this.subGap(), o.sub, { size: 11, color: '#3b3f63', strokeWidth: 0, shadow: false, bold: false });
      this.add(this.sub);
    }
    this.setSize(o.w, o.h);
    this.setInteractive({ useHandCursor: true });
    this.on(Phaser.Input.Events.POINTER_OVER, () => this.enabledState && !this.pressed && this.bg.setTint(0xfff6d8));
    this.on(Phaser.Input.Events.POINTER_OUT, () => {
      this.bg.clearTint();
      if (this.pressed) this.release(false);
    });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!this.enabledState) return;
      this.pressed = true;
      this.bg.setTexture(`${this.skin}-down`);
      this.label.y = ly + 2;
      if (this.sub) this.sub.y = ly + this.subGap() + 2;
      if (this.icon) this.icon.y = -1;
      Audio.sfx('click');
    });
    this.on(Phaser.Input.Events.POINTER_UP, () => this.pressed && this.release(true));
    scene.add.existing(this);
  }

  private labelY(): number {
    return this.o.sub ? -3 - this.o.h * 0.16 : -3;
  }

  private subGap(): number {
    return Math.max(13, this.o.h * 0.34);
  }

  private release(fire: boolean): void {
    const ly = this.labelY();
    this.pressed = false;
    this.bg.setTexture(this.skin);
    this.label.y = ly;
    if (this.sub) this.sub.y = ly + this.subGap();
    if (this.icon) this.icon.y = -3;
    if (!fire) return;
    this.scene.tweens.add({ targets: this, scaleX: { from: 1.08, to: 1 }, scaleY: { from: 0.92, to: 1 }, duration: 180, ease: 'Back.easeOut' });
    Audio.sfx(this.o.sound ?? 'select');
    this.o.onTap();
  }

  setEnabled(on: boolean): this {
    this.enabledState = on;
    this.setAlpha(on ? 1 : 0.45);
    return this;
  }

  setLabel(s: string): this {
    this.label.setText(s);
    return this;
  }

  setSkin(skin: string): this {
    this.skin = skin;
    this.bg.setTexture(skin);
    return this;
  }
}
