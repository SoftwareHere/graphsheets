import type { ParsedEquation } from '../expr';
import { yToFreq, type SnapMode } from '../pitch';
import type { Equation } from '../state';
import { BassVoice } from './bassVoice';
import { ToneVoice } from './toneVoice';

/** Scheduler resolution: steps per beat. */
export const STEPS_PER_BEAT = 32;
const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 25;
const MIN_FREQ = 20;
const MAX_FREQ = 8000;

interface Track {
  eq: Equation;
  parsed: ParsedEquation;
  voice: ToneVoice | BassVoice;
  type: Equation['type'];
}

export interface EngineSettings {
  bpm: number;
  bars: number;
  rootMidi: number;
  snap: SnapMode;
  metronome: boolean;
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  private master: GainNode;
  private tracks = new Map<string, Track>();
  private settings: EngineSettings;
  private playing = false;
  private timer: number | null = null;

  // tempo map: beat = anchorBeat + (t - anchorTime) * bpm / 60
  private anchorBeat = 0;
  private anchorTime = 0;
  private nextStep = 0; // absolute (unwrapped) step index
  private nextStepTime = 0;

  constructor(ctx: BaseAudioContext, settings: EngineSettings) {
    this.ctx = ctx;
    this.settings = { ...settings };
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
  }

  get loopBeats(): number {
    return this.settings.bars * 4;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private get secPerBeat(): number {
    return 60 / this.settings.bpm;
  }

  /** Current (wrapped) playhead position in beats. */
  currentBeat(): number {
    if (!this.playing) return 0;
    const b = this.anchorBeat + (this.ctx.currentTime - this.anchorTime) / this.secPerBeat;
    const L = this.loopBeats;
    return ((Math.max(0, b) % L) + L) % L;
  }

  updateSettings(next: Partial<EngineSettings>): void {
    const now = this.ctx.currentTime;
    if (next.bpm !== undefined && next.bpm !== this.settings.bpm && this.playing) {
      // re-anchor the tempo map so the playhead doesn't jump
      const beatNow = this.anchorBeat + (now - this.anchorTime) / this.secPerBeat;
      this.settings.bpm = next.bpm;
      this.anchorBeat = beatNow;
      this.anchorTime = now;
      this.nextStepTime = this.anchorTime + (this.nextStep / STEPS_PER_BEAT - this.anchorBeat) * this.secPerBeat;
    }
    this.settings = { ...this.settings, ...next };
  }

  /** Keep voices in sync with the equation list. */
  syncEquations(list: { eq: Equation; parsed: ParsedEquation }[]): void {
    const seen = new Set<string>();
    for (const { eq, parsed } of list) {
      seen.add(eq.id);
      let track = this.tracks.get(eq.id);
      if (track && track.type !== eq.type) {
        track.voice.dispose();
        this.tracks.delete(eq.id);
        track = undefined;
      }
      if (!track) {
        const voice = eq.type === 'tone'
          ? new ToneVoice(this.ctx, this.master, eq.wave)
          : new BassVoice(this.ctx, this.master);
        track = { eq, parsed, voice, type: eq.type };
        this.tracks.set(eq.id, track);
      }
      track.eq = eq;
      track.parsed = parsed;
      if (track.voice instanceof ToneVoice) track.voice.setWave(eq.wave);
      const gain = eq.muted ? 0 : eq.volume;
      track.voice.out.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
    }
    for (const [id, track] of this.tracks) {
      if (!seen.has(id)) {
        track.voice.dispose();
        this.tracks.delete(id);
      }
    }
  }

  /** Start from the far left of the graph (beat 0). */
  start(): void {
    if (this.playing) return;
    const ctx = this.ctx;
    this.playing = true;
    this.anchorBeat = 0;
    this.anchorTime = ctx.currentTime + 0.06;
    this.nextStep = 0;
    this.nextStepTime = this.anchorTime;
    if (typeof window !== 'undefined' && ctx instanceof AudioContext) {
      this.timer = window.setInterval(() => this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD), TICK_MS);
    }
    this.scheduleUntil(ctx.currentTime + LOOKAHEAD);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const t of this.tracks.values()) t.voice.silence();
  }

  /** Schedule every step whose start time is before `until`. */
  scheduleUntil(until: number): void {
    if (!this.playing) return;
    const spb = this.secPerBeat;
    const stepDur = spb / STEPS_PER_BEAT;
    const loopSteps = this.loopBeats * STEPS_PER_BEAT;
    const { rootMidi, snap } = this.settings;

    // if the timer was throttled (background tab), skip ahead instead of bursting
    const behind = this.ctx.currentTime - this.nextStepTime;
    if (behind > 0.1) {
      const skip = Math.ceil(behind / stepDur);
      this.nextStep += skip;
      this.nextStepTime += skip * stepDur;
    }

    while (this.nextStepTime < until) {
      const t = this.nextStepTime;
      const local = this.nextStep % loopSteps;
      const x = local / STEPS_PER_BEAT;

      for (const track of this.tracks.values()) {
        const y = track.parsed.evaluate(x);
        let freq: number | null = null;
        if (Number.isFinite(y)) {
          const f = yToFreq(y, rootMidi, snap);
          if (f >= MIN_FREQ && f <= MAX_FREQ) freq = f;
        }
        const v = track.voice;
        if (v instanceof BassVoice) {
          const hitSteps = Math.max(1, Math.round(track.eq.hitEvery * STEPS_PER_BEAT));
          const isHit = local % hitSteps === 0;
          if (freq !== null && (isHit || !v.isSounding())) {
            const stepsLeft = hitSteps - (local % hitSteps);
            v.trigger(t, freq, stepsLeft * stepDur);
          } else {
            v.setPoint(t, freq);
          }
        } else {
          v.setPoint(t, freq);
        }
      }

      if (this.settings.metronome && local % STEPS_PER_BEAT === 0) {
        this.click(t, local % (STEPS_PER_BEAT * 4) === 0);
      }

      this.nextStep += 1;
      this.nextStepTime += stepDur;
    }
  }

  private click(t: number, accent: boolean): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => g.disconnect();
  }
}
