import type { Waveform } from '../state';

/** A continuous oscillator whose pitch glides along the curve. */
export class ToneVoice {
  private osc: OscillatorNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  readonly out: GainNode;
  private sounding = false;
  private lastFreq = 0;
  private curLevel = 0;

  constructor(private ctx: BaseAudioContext, dest: AudioNode, wave: Waveform) {
    this.osc = ctx.createOscillator();
    this.osc.type = wave;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = 3000;
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.osc.connect(this.filter).connect(this.amp).connect(this.out).connect(dest);
    this.osc.start();
  }

  setWave(wave: Waveform): void {
    this.osc.type = wave;
  }

  /** Level depends on waveform so saws/squares don't overpower sines. */
  private level(): number {
    switch (this.osc.type) {
      case 'sine': return 0.42;
      case 'triangle': return 0.42;
      case 'sawtooth': return 0.2;
      case 'square': return 0.17;
      default: return 0.3;
    }
  }

  setPoint(t: number, freq: number | null): void {
    const f = this.osc.frequency;
    const g = this.amp.gain;
    if (freq === null) {
      if (this.sounding) {
        g.setTargetAtTime(0, t, 0.008);
        this.sounding = false;
      }
      return;
    }
    if (!this.sounding) {
      f.setValueAtTime(freq, t);
      this.curLevel = this.level();
      g.setTargetAtTime(this.curLevel, t, 0.006);
      this.sounding = true;
    } else {
      const jump = Math.abs(12 * Math.log2(freq / this.lastFreq));
      if (jump > 0.75) f.setValueAtTime(freq, t);
      else f.linearRampToValueAtTime(freq, t);
      // keep the level in step with any waveform change
      if (this.level() !== this.curLevel) {
        this.curLevel = this.level();
        g.setTargetAtTime(this.curLevel, t, 0.02);
      }
    }
    this.filter.frequency.setTargetAtTime(Math.min(12000, freq * 8 + 400), t, 0.02);
    this.lastFreq = freq;
  }

  silence(): void {
    const now = this.ctx.currentTime;
    this.osc.frequency.cancelScheduledValues(now);
    this.amp.gain.cancelScheduledValues(now);
    this.amp.gain.setTargetAtTime(0, now, 0.01);
    this.filter.frequency.cancelScheduledValues(now);
    this.sounding = false;
  }

  dispose(): void {
    this.silence();
    const stopAt = this.ctx.currentTime + 0.1;
    this.osc.stop(stopAt);
    this.osc.onended = () => this.out.disconnect();
  }
}
