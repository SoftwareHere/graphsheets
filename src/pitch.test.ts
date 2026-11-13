import { describe, expect, it } from 'vitest';
import { midiToFreq, midiToName, snapSemitone, yToFreq } from './pitch';

describe('pitch', () => {
  it('maps midi to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });

  it('names notes', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(48)).toBe('C3');
    expect(midiToName(61)).toBe('C#4');
  });

  it('maps y in semitones above the root', () => {
    expect(yToFreq(12, 57)).toBeCloseTo(440);
    expect(yToFreq(-12, 69)).toBeCloseTo(220);
    expect(yToFreq(0.5, 69)).toBeCloseTo(440 * Math.pow(2, 0.5 / 12));
  });

  it('snaps to scales', () => {
    expect(snapSemitone(0.4, 'off')).toBe(0.4);
    expect(snapSemitone(0.6, 'chromatic')).toBe(1);
    expect(snapSemitone(1, 'major')).toBe(0); // tie goes to the lower degree
    expect(snapSemitone(3.2, 'major')).toBe(4);
    expect(snapSemitone(3.2, 'minor')).toBe(3);
    expect(snapSemitone(11.8, 'major')).toBe(12);
    expect(snapSemitone(-1.2, 'major')).toBe(-1);
  });
});
