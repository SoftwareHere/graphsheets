import './style.css';
import { AudioEngine } from './audio/engine';
import { parseEquation, type ParsedEquation } from './expr';
import { GraphView } from './graph';
import { midiToName, type SnapMode } from './pitch';
import { loadState, makeEquation, PALETTE, saveState, type Equation } from './state';
import { ICONS, renderEquations, setRowError } from './ui';

const state = loadState();
const parsed = new Map<string, ParsedEquation>();
const errors = new Map<string, string | null>();
let engine: AudioEngine | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const playBtn = $<HTMLButtonElement>('play');
const bpmInput = $<HTMLInputElement>('bpm');
const barsSel = $<HTMLSelectElement>('bars');
const rootSel = $<HTMLSelectElement>('root');
const snapSel = $<HTMLSelectElement>('snap');
const beatsBtn = $<HTMLButtonElement>('beats-toggle');
const metroBtn = $<HTMLButtonElement>('metro-toggle');
const themeBtn = $<HTMLButtonElement>('theme-toggle');
const list = $<HTMLDivElement>('eq-list');

// ---------- persistence ----------
let saveTimer = 0;
function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveState(state), 250);
}

// ---------- equations ----------
function compile(eq: Equation): void {
  const p = parseEquation(eq.text);
  parsed.set(eq.id, p);
  errors.set(eq.id, p.error);
}

function syncCurves(): void {
  graph.setCurves(
    state.equations.map((eq) => ({
      id: eq.id,
      color: eq.color,
      type: eq.type,
      muted: eq.muted,
      hitEvery: eq.hitEvery,
      evaluate: parsed.get(eq.id)?.evaluate ?? (() => NaN),
    })),
  );
  engine?.syncEquations(
    state.equations.map((eq) => ({ eq, parsed: parsed.get(eq.id) ?? parseEquation('') })),
  );
  persist();
}

function renderList(): void {
  renderEquations(list, state.equations, errors, {
    onText(id, text) {
      const eq = state.equations.find((e) => e.id === id);
      if (!eq) return;
      eq.text = text;
      compile(eq);
      setRowError(list, id, errors.get(id) ?? null);
      syncCurves();
    },
    onChange(id, patch) {
      const eq = state.equations.find((e) => e.id === id);
      if (!eq) return;
      Object.assign(eq, patch);
      syncCurves();
      // volume changes don't need a re-render (keeps the slider drag smooth)
      if (!('volume' in patch)) renderList();
    },
    onCycleColor(id) {
      const eq = state.equations.find((e) => e.id === id);
      if (!eq) return;
      const i = PALETTE.indexOf(eq.color);
      eq.color = PALETTE[(i + 1) % PALETTE.length];
      syncCurves();
      renderList();
    },
    onDelete(id) {
      state.equations = state.equations.filter((e) => e.id !== id);
      parsed.delete(id);
      errors.delete(id);
      syncCurves();
      renderList();
    },
  });
}

$('add-eq').addEventListener('click', () => {
  const used = new Set(state.equations.map((e) => e.color));
  const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[state.equations.length % PALETTE.length];
  const eq = makeEquation({ text: '', color }, state.equations.length);
  state.equations.push(eq);
  compile(eq);
  syncCurves();
  renderList();
  list.querySelector<HTMLInputElement>(`.eq[data-id="${eq.id}"] .eq-input`)?.focus();
});

// ---------- graph ----------
const graph = new GraphView(
  $<HTMLCanvasElement>('graph'),
  { bars: state.bars, yMin: state.yMin, yMax: state.yMax, rootMidi: state.rootMidi, showBeats: state.showBeats },
  (yMin, yMax) => {
    state.yMin = yMin;
    state.yMax = yMax;
    persist();
  },
);

// ---------- transport ----------
function engineSettings() {
  return { bpm: state.bpm, bars: state.bars, rootMidi: state.rootMidi, snap: state.snap, metronome: state.metronome };
}

async function ensureEngine(): Promise<AudioEngine> {
  if (!engine) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    engine = new AudioEngine(new Ctx({ latencyHint: 'interactive' }), engineSettings());
    syncCurves();
  }
  const ctx = engine.ctx as AudioContext;
  if (ctx.state !== 'running') await ctx.resume();
  return engine;
}

function updatePlayButton(): void {
  const playing = engine?.isPlaying ?? false;
  playBtn.innerHTML = playing ? ICONS.stop : ICONS.play;
  playBtn.classList.toggle('playing', playing);
  playBtn.setAttribute('aria-label', playing ? 'Stop (Space)' : 'Play (Space)');
}

async function togglePlay(): Promise<void> {
  const e = await ensureEngine();
  if (e.isPlaying) e.stop();
  else e.start();
  updatePlayButton();
}

playBtn.addEventListener('click', () => { void togglePlay(); });

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) {
    e.preventDefault();
    void togglePlay();
  }
});

// ---------- BPM ----------
function setBpm(v: number): void {
  const bpm = Math.round(Math.min(240, Math.max(40, v || 120)));
  state.bpm = bpm;
  bpmInput.value = String(bpm);
  engine?.updateSettings({ bpm });
  persist();
}
bpmInput.value = String(state.bpm);
bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value)));
$('bpm-dec').addEventListener('click', () => setBpm(state.bpm - 1));
$('bpm-inc').addEventListener('click', () => setBpm(state.bpm + 1));
bpmInput.addEventListener('wheel', (e) => {
  e.preventDefault();
  setBpm(state.bpm + (e.deltaY < 0 ? 1 : -1));
}, { passive: false });

const taps: number[] = [];
const tapBtn = $<HTMLButtonElement>('tap');
tapBtn.addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(60000 / avg);
  }
  tapBtn.classList.add('flash');
  setTimeout(() => tapBtn.classList.remove('flash'), 120);
});

// ---------- loop / root / snap ----------
barsSel.value = String(state.bars);
barsSel.addEventListener('change', () => {
  state.bars = Number(barsSel.value);
  graph.setView({ bars: state.bars });
  engine?.updateSettings({ bars: state.bars });
  syncCurves();
});

for (let m = 36; m <= 60; m++) rootSel.append(new Option(midiToName(m), String(m)));
rootSel.value = String(state.rootMidi);
rootSel.addEventListener('change', () => {
  state.rootMidi = Number(rootSel.value);
  graph.setView({ rootMidi: state.rootMidi });
  engine?.updateSettings({ rootMidi: state.rootMidi });
  persist();
});

snapSel.value = state.snap;
snapSel.addEventListener('change', () => {
  state.snap = snapSel.value as SnapMode;
  engine?.updateSettings({ snap: state.snap });
  persist();
});

// ---------- toggles ----------
function renderToggles(): void {
  beatsBtn.innerHTML = `${ICONS.grid}<span>Beats</span>`;
  beatsBtn.setAttribute('aria-pressed', String(state.showBeats));
  metroBtn.innerHTML = `${ICONS.metro}<span>Click</span>`;
  metroBtn.setAttribute('aria-pressed', String(state.metronome));
  themeBtn.innerHTML = state.theme === 'dark' ? ICONS.sun : ICONS.moon;
}

beatsBtn.addEventListener('click', () => {
  state.showBeats = !state.showBeats;
  graph.setView({ showBeats: state.showBeats });
  renderToggles();
  persist();
});

metroBtn.addEventListener('click', () => {
  state.metronome = !state.metronome;
  engine?.updateSettings({ metronome: state.metronome });
  renderToggles();
  persist();
});

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  graph.refreshTheme();
  renderToggles();
}

themeBtn.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  persist();
});

// ---------- boot ----------
state.equations.forEach(compile);
applyTheme();
renderList();
syncCurves();
updatePlayButton();

function frame(): void {
  const playing = engine?.isPlaying ?? false;
  graph.draw(playing && engine ? engine.currentBeat() : 0, playing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// small hook for automated checks
(window as unknown as { __graphsheets: unknown }).__graphsheets = {
  get engine() { return engine; },
  state,
};
