import type { SnapMode } from './pitch';

export type VoiceType = 'tone' | 'bass';
export type Waveform = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface Equation {
  id: string;
  text: string;
  type: VoiceType;
  color: string;
  wave: Waveform;
  /** 808 retrigger interval in beats */
  hitEvery: number;
  volume: number;
  muted: boolean;
}

export interface AppState {
  equations: Equation[];
  bpm: number;
  bars: number;
  rootMidi: number;
  snap: SnapMode;
  showBeats: boolean;
  metronome: boolean;
  theme: 'light' | 'dark';
  /** visible y range (semitones) */
  yMin: number;
  yMax: number;
}

export const PALETTE = ['#7c5cff', '#ff4d8d', '#18c3a4', '#ffae1a', '#3aa0ff', '#ff6b3d'];

const STORAGE_KEY = 'graphsheets:v1';

let counter = 0;
export function newId(): string {
  counter += 1;
  return `eq${Date.now().toString(36)}${counter}`;
}

export function makeEquation(partial: Partial<Equation> = {}, index = 0): Equation {
  return {
    id: newId(),
    text: '',
    type: 'tone',
    color: PALETTE[index % PALETTE.length],
    wave: 'triangle',
    hitEvery: 1,
    volume: 0.8,
    muted: false,
    ...partial,
  };
}

function systemTheme(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function defaultState(): AppState {
  return {
    equations: [
      makeEquation({ text: '7 sin(pi x / 4) + 3', type: 'tone', wave: 'triangle' }, 0),
      makeEquation({ text: '-12 + 5 floor(mod(x, 8) / 2)', type: 'bass', hitEvery: 1 }, 1),
    ],
    bpm: 110,
    bars: 4,
    rootMidi: 48, // C3
    snap: 'off',
    showBeats: true,
    metronome: false,
    theme: systemTheme(),
    yMin: -20,
    yMax: 20,
  };
}

export function loadState(): AppState {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<AppState>;
    const merged: AppState = { ...base, ...saved };
    if (!Array.isArray(merged.equations)) merged.equations = base.equations;
    merged.equations = merged.equations.map((e, i) => ({ ...makeEquation({}, i), ...e, id: newId() }));
    return merged;
  } catch {
    return base;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: ignore */
  }
}
