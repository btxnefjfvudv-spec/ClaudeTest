import Phaser from 'phaser';

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

type Wave = OscillatorType;

/** Note name → frequency. "C4", "F#5", "Bb3"; "-" = rest. */
function freq(note: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) return 0;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let n = base[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  n += (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

export interface Track {
  bpm: number;
  /** Each string = one 8th-note step per space-separated token. */
  lead: string;
  bass: string;
  drums?: string; // k = kick, s = snare, h = hat, - = rest
  leadWave?: Wave;
  loop?: boolean;
}

/** Chiptune tracks. Original compositions. */
export const TRACKS: Record<string, Track> = {
  menu: {
    bpm: 128,
    lead: 'E5 - G5 E5 C5 - D5 E5 F5 - A5 F5 D5 - E5 F5 G5 - B5 G5 E5 - G5 A5 B5 C6 B5 A5 G5 - - - ' +
      'E5 - G5 E5 C5 - D5 E5 F5 - A5 F5 D5 - E5 F5 G5 A5 G5 F5 E5 D5 C5 D5 C5 - - - - - - -',
    bass: 'C3 - C4 - C3 - C4 - F2 - F3 - F2 - F3 - G2 - G3 - G2 - G3 - G2 - G3 - B2 - G2 - ' +
      'C3 - C4 - C3 - C4 - F2 - F3 - F2 - F3 - G2 - G3 - G2 - G3 - C3 - G2 - C3 - - -',
    drums: 'k - h - s - h - k - h k s - h - k - h - s - h - k - h k s - h s ' +
      'k - h - s - h - k - h k s - h - k - h - s - h - k - h k s - s s',
    leadWave: 'square',
    loop: true,
  },
  game: {
    bpm: 150,
    lead: 'A4 C5 E5 A5 G5 E5 C5 E5 G4 B4 D5 G5 F5 D5 B4 D5 F4 A4 C5 F5 E5 C5 A4 C5 E4 G#4 B4 E5 D5 B4 G#4 B4',
    bass: 'A2 - A2 A3 A2 - A2 A3 G2 - G2 G3 G2 - G2 G3 F2 - F2 F3 F2 - F2 F3 E2 - E2 E3 E2 - G#2 B2',
    drums: 'k h s h k k s h k h s h k k s h k h s h k k s h k h s h k s s s',
    leadWave: 'square',
    loop: true,
  },
  game2: {
    bpm: 136,
    lead: 'C5 - E5 G5 - E5 A5 G5 F5 - A5 C6 - A5 G5 F5 E5 - G5 C6 - G5 E5 D5 C5 D5 E5 - D5 - - -',
    bass: 'C3 G2 C3 G2 C3 G2 C3 G2 F2 C3 F2 C3 F2 C3 F2 C3 C3 G2 C3 G2 C3 G2 C3 G2 G2 D3 G2 D3 G2 - G2 -',
    drums: 'k - h k s - h - k - h k s - h h k - h k s - h - k k h - s - s s',
    leadWave: 'triangle',
    loop: true,
  },
  tension: {
    bpm: 170,
    lead: 'D5 - D5 F5 - D5 G5 F5 D5 - D5 A5 - G5 F5 E5 C#5 - C#5 E5 - C#5 G5 E5 D5 - - - A4 - - -',
    bass: 'D2 D3 D2 D3 D2 D3 D2 D3 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 Bb1 Bb2 A1 A2 A1 A2 A1 A2 A1 A2 A1 A2 A1 A2 C#2 E2 A2 -',
    drums: 'k h k h s h k h k h k h s h k h k h k h s h k h k k s h s s s s',
    leadWave: 'sawtooth',
    loop: true,
  },
  victory: {
    bpm: 150,
    lead: 'C5 E5 G5 C6 - G5 C6 - - A5 F5 A5 C6 - D6 E6 - - - - -',
    bass: 'C3 - C3 - - C3 E3 - - F2 - F2 - - G2 C3 - - - - -',
    drums: 'k - s - k s k - - k - s - k s s - - - - -',
    leadWave: 'square',
    loop: false,
  },
  results: {
    bpm: 112,
    lead: 'G4 - B4 D5 - B4 C5 - E5 - D5 - C5 B4 A4 - G4 - B4 D5 - G5 F#5 - E5 - D5 - - - - -',
    bass: 'G2 - D3 - G2 - D3 - C3 - G3 - C3 - G3 - G2 - D3 - E3 - B2 - C3 - D3 - G2 - - -',
    drums: 'k - h - s - h - k - h - s - h h k - h - s - h - k - h - s - s -',
    leadWave: 'triangle',
    loop: true,
  },
};

/**
 * All sound is synthesized (no files): SFX presets + a small chiptune sequencer.
 * Safari only allows sound after a user gesture: unlock() is called on first tap.
 */
export class AudioManager {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private musicBus?: GainNode;
  private noise?: AudioBuffer;
  readonly volume: VolumeSettings = { master: 0.8, music: 0.5, sfx: 0.9, muted: false };

  private track?: Track;
  private trackName = '';
  private step = 0;
  private nextTime = 0;
  private timer?: number;

  init(game: Phaser.Game): void {
    const sm = game.sound;
    if (!(sm instanceof Phaser.Sound.WebAudioSoundManager)) return;
    this.ctx = sm.context;
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
    // Resume after iOS interrupts audio (calls, app switch).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.unlock();
    });
  }

  unlock(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  applyVolume(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.volume.muted ? 0 : this.volume.master;
    this.sfxBus.gain.value = this.volume.sfx;
    this.musicBus.gain.value = this.volume.music * 0.55;
  }

  private tone(f: number, dur: number, type: Wave, vol: number, bus: GainNode, at?: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private hiss(dur: number, vol: number, bus: GainNode, at?: number, filterFreq = 3000, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  blip(f: number, dur = 0.08, type: Wave = 'square', slideTo?: number, vol = 0.2): void {
    if (!this.ready || !this.sfxBus) return;
    this.tone(f, dur, type, vol, this.sfxBus, undefined, slideTo);
  }

  /** Named sound effects. `pitch` varies by player so 4 players sound distinct. */
  sfx(name: string, pitch = 1): void {
    if (!this.ready || !this.sfxBus) return;
    const b = this.sfxBus;
    const t = this.ctx!.currentTime;
    const p = pitch;
    switch (name) {
      case 'click': this.tone(880 * p, 0.05, 'square', 0.12, b); break;
      case 'select': this.tone(660 * p, 0.06, 'square', 0.14, b); this.tone(990 * p, 0.08, 'square', 0.12, b, t + 0.05); break;
      case 'back': this.tone(520, 0.08, 'square', 0.12, b, t, 300); break;
      case 'jump': this.tone(300 * p, 0.16, 'square', 0.14, b, t, 720 * p); break;
      case 'land': this.hiss(0.06, 0.18, b, t, 900, 'lowpass'); break;
      case 'hit': this.hiss(0.12, 0.35, b, t, 1800); this.tone(200 * p, 0.12, 'square', 0.18, b, t, 70); break;
      case 'bigHit': this.hiss(0.25, 0.5, b, t, 900, 'lowpass'); this.tone(140, 0.25, 'sawtooth', 0.22, b, t, 40); break;
      case 'coin': this.tone(988 * p, 0.06, 'square', 0.13, b); this.tone(1319 * p, 0.14, 'square', 0.13, b, t + 0.06); break;
      case 'power': [523, 659, 784, 1047].forEach((f, i) => this.tone(f * p, 0.09, 'square', 0.12, b, t + i * 0.05)); break;
      case 'explode': this.hiss(0.6, 0.6, b, t, 600, 'lowpass'); this.tone(90, 0.5, 'sawtooth', 0.25, b, t, 30); break;
      case 'whoosh': this.hiss(0.22, 0.2, b, t, 1200); break;
      case 'throw': this.hiss(0.12, 0.16, b, t, 2400); this.tone(500 * p, 0.1, 'triangle', 0.1, b, t, 900 * p); break;
      case 'splash': this.hiss(0.4, 0.35, b, t, 1400); break;
      case 'pop': this.tone(1200 * p, 0.05, 'square', 0.14, b, t, 400); this.hiss(0.05, 0.2, b, t, 4000); break;
      case 'tick': this.tone(1500, 0.03, 'square', 0.08, b); break;
      case 'count': this.tone(660, 0.14, 'square', 0.18, b); break;
      case 'go': this.tone(990, 0.08, 'square', 0.2, b); this.tone(1320, 0.3, 'square', 0.2, b, t + 0.08); break;
      case 'finish': [784, 659, 523, 1047].forEach((f, i) => this.tone(f, 0.12, 'square', 0.18, b, t + i * 0.09)); break;
      case 'wrong': this.tone(180, 0.25, 'sawtooth', 0.2, b, t, 120); break;
      case 'right': this.tone(784 * p, 0.07, 'square', 0.14, b); this.tone(1175 * p, 0.12, 'square', 0.14, b, t + 0.07); break;
      case 'lose': [392, 370, 349, 262].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.18, b, t + i * 0.16)); break;
      case 'dash': this.hiss(0.15, 0.25, b, t, 2000); this.tone(400 * p, 0.12, 'square', 0.1, b, t, 1000 * p); break;
      case 'stun': [0, 1, 2].forEach((i) => this.tone(1400 - i * 200, 0.08, 'triangle', 0.1, b, t + i * 0.07)); break;
      case 'shoot': this.tone(880 * p, 0.12, 'square', 0.12, b, t, 220); this.hiss(0.06, 0.15, b, t, 5000); break;
      case 'bounce': this.tone(220 * p, 0.1, 'triangle', 0.22, b, t, 440 * p); break;
      case 'freeze': this.tone(2000, 0.3, 'triangle', 0.08, b, t, 3000); break;
      case 'drum': this.tone(120, 0.12, 'sine', 0.4, b, t, 50); break;
      default: this.tone(600 * p, 0.06, 'square', 0.1, b);
    }
  }

  playMusic(name: string): void {
    if (this.trackName === name && this.timer !== undefined) return;
    this.stopMusic();
    const tr = TRACKS[name];
    if (!tr || !this.ctx) return;
    this.track = tr;
    this.trackName = name;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.trackName = '';
  }

  private schedule(): void {
    const ctx = this.ctx, tr = this.track, bus = this.musicBus;
    if (!ctx || !tr || !bus || ctx.state !== 'running') return;
    const lead = tr.lead.split(' ');
    const bass = tr.bass.split(' ');
    const drums = (tr.drums ?? '').split(' ');
    const len = Math.max(lead.length, bass.length);
    const stepDur = 60 / tr.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.step >= len) {
        if (!tr.loop) { this.stopMusic(); return; }
        this.step = 0;
      }
      const i = this.step;
      const t = this.nextTime;
      const ln = lead[i % lead.length];
      if (ln && ln !== '-') {
        let hold = 1;
        while (lead[(i + hold) % lead.length] === '-' && hold < 4) hold++;
        this.tone(freq(ln), stepDur * hold * 0.9, tr.leadWave ?? 'square', 0.09, bus, t);
      }
      const bn = bass[i % bass.length];
      if (bn && bn !== '-') this.tone(freq(bn), stepDur * 0.9, 'triangle', 0.22, bus, t);
      const dn = drums[i % (drums.length || 1)];
      if (dn === 'k') this.tone(130, 0.11, 'sine', 0.45, bus, t, 45);
      else if (dn === 's') this.hiss(0.1, 0.22, bus, t, 1800);
      else if (dn === 'h') this.hiss(0.03, 0.08, bus, t, 8000, 'highpass');
      this.nextTime += stepDur;
      this.step++;
    }
  }
}

export const Audio = new AudioManager();
