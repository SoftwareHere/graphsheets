export type SnapMode = 'off' | 'chromatic' | 'major' | 'minor' | 'pentatonic';

export const SCALES: Record<Exclude<SnapMode, 'off' | 'chromatic'>, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const m = Math.round(midi);
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

/** Snap a semitone offset (relative to the root) to the chosen scale. */
export function snapSemitone(semi: number, snap: SnapMode): number {
  if (snap === 'off') return semi;
  if (snap === 'chromatic') return Math.round(semi);
  const scale = SCALES[snap];
  const octave = Math.floor(semi / 12);
  const within = semi - octave * 12;
  let best = scale[0];
  let bestDist = Infinity;
  // include the next octave's root so values near 12 snap upward correctly
  for (const s of [...scale, 12]) {
    const d = Math.abs(within - s);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return octave * 12 + best;
}

/** Map a graph y value (semitones above the root) to a frequency in Hz. */
export function yToFreq(y: number, rootMidi: number, snap: SnapMode = 'off'): number {
  return midiToFreq(rootMidi + snapSemitone(y, snap));
}
