function makeDriveCurve(amount: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  return curve;
}

/**
 * An 808-style bass: sine + soft 2nd harmonic through saturation,
 * with a pitch "punch" and click on every hit and a long boomy tail.
 * The pitch keeps gliding along the curve between hits.
 */
export class BassVoice {
  private osc1: OscillatorNode;
  private osc2: OscillatorNode;
  private amp: GainNode;
  private clickBuffer: AudioBuffer;
  readonly out: GainNode;
  private sounding = false;
  private lastFreq = 0;

  constructor(private ctx: BaseAudioContext, dest: AudioNode) {
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sine';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sine';

    const harm = ctx.createGain();
    harm.gain.value = 0.18;
    const drive = ctx.createGain();
    drive.gain.value = 1.6;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(2.4) as Float32Array<ArrayBuffer>;
    shaper.oversample = '4x';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.5;

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;

    this.osc1.connect(drive);
    this.osc2.connect(harm).connect(drive);
    drive.connect(shaper).connect(lp).connect(this.amp).connect(this.out).connect(dest);

    // short decaying noise burst for the beater click
    const len = Math.floor(ctx.sampleRate * 0.012);
    this.clickBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.clickBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);

    this.osc1.start();
    this.osc2.start();
  }

  private setFreq(t: number, freq: number, jumpOk: boolean): void {
    const jump = this.lastFreq ? Math.abs(12 * Math.log2(freq / this.lastFreq)) : Infinity;
    for (const [osc, mul] of [[this.osc1, 1], [this.osc2, 2]] as const) {
      if (jumpOk || jump > 0.75) osc.frequency.setValueAtTime(freq * mul, t);
      else osc.frequency.linearRampToValueAtTime(freq * mul, t);
    }
    this.lastFreq = freq;
  }

  /** Fire a new 808 hit at time t. `length` is seconds until the next hit. */
  trigger(t: number, freq: number, length: number): void {
    this.setFreq(t, freq, true);

    // pitch punch: start ~1.4 octaves up and fall quickly into the note
    for (const osc of [this.osc1, this.osc2]) {
      osc.detune.setValueAtTime(1700, t);
      osc.detune.setTargetAtTime(0, t, 0.014);
    }

    const g = this.amp.gain;
    g.setTargetAtTime(0, Math.max(0, t - 0.008), 0.002); // tuck the old tail away
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 0.004);
    const decay = Math.max(0.08, Math.min(0.9, length * 0.38));
    g.setTargetAtTime(0.0, t + 0.03, decay);

    const click = this.ctx.createBufferSource();
    click.buffer = this.clickBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const cg = this.ctx.createGain();
    cg.gain.value = 0.22;
    click.connect(hp).connect(cg).connect(this.out);
    click.start(t);
    click.onended = () => cg.disconnect();

    this.sounding = true;
  }

  /** Glide the pitch along the curve between hits, or mute in gaps. */
  setPoint(t: number, freq: number | null): void {
    if (freq === null) {
      if (this.sounding) {
        this.amp.gain.setTargetAtTime(0, t, 0.01);
        this.sounding = false;
      }
      return;
    }
    if (this.sounding) this.setFreq(t, freq, false);
  }

  isSounding(): boolean {
    return this.sounding;
  }

  silence(): void {
    const now = this.ctx.currentTime;
    for (const osc of [this.osc1, this.osc2]) {
      osc.frequency.cancelScheduledValues(now);
      osc.detune.cancelScheduledValues(now);
      osc.detune.setValueAtTime(0, now);
    }
    this.amp.gain.cancelScheduledValues(now);
    this.amp.gain.setTargetAtTime(0, now, 0.01);
    this.sounding = false;
    this.lastFreq = 0;
  }

  dispose(): void {
    this.silence();
    const stopAt = this.ctx.currentTime + 0.1;
    this.osc1.stop(stopAt);
    this.osc2.stop(stopAt);
    this.osc1.onended = () => this.out.disconnect();
  }
}
