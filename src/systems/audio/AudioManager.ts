import Phaser from 'phaser';

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

/**
 * Synth-based audio on top of Phaser's Web Audio context.
 * Safari only allows sound after a user gesture: call unlock() from a tap handler.
 */
export class AudioManager {
  private ctx?: AudioContext;
  private masterGain?: GainNode;
  private sfxGain?: GainNode;
  private musicGain?: GainNode;
  readonly volume: VolumeSettings = { master: 0.8, music: 0.6, sfx: 0.9, muted: false };

  init(game: Phaser.Game): void {
    const sm = game.sound;
    if (!(sm instanceof Phaser.Sound.WebAudioSoundManager)) return;
    this.ctx = sm.context;
    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.applyVolume();
  }

  /** Must run inside a touch/click handler on iOS Safari. */
  unlock(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  applyVolume(): void {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) return;
    this.masterGain.gain.value = this.volume.muted ? 0 : this.volume.master;
    this.sfxGain.gain.value = this.volume.sfx;
    this.musicGain.gain.value = this.volume.music;
  }

  /** Short synthesized blip with a pitch slide. */
  blip(freq: number, duration = 0.08, type: OscillatorType = 'square', slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}

export const Audio = new AudioManager();
