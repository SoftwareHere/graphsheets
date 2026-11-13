import { midiToName } from './pitch';

export interface CurveInfo {
  id: string;
  color: string;
  type: 'tone' | 'bass';
  muted: boolean;
  hitEvery: number;
  evaluate: (x: number) => number;
}

export interface ViewSettings {
  bars: number;
  yMin: number;
  yMax: number;
  rootMidi: number;
  showBeats: boolean;
}

interface Theme {
  plotBg: string;
  grid: string;
  gridStrong: string;
  axis: string;
  label: string;
  labelStrong: string;
  barShade: string;
  beat: string;
  bar: string;
  accent: string;
  playhead: string;
  glow: number;
}

interface CurveCache {
  ys: Float64Array;
  breakAfter: Uint8Array;
}

const M = { l: 58, t: 34, r: 14, b: 14 };
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

export class GraphView {
  private ctx: CanvasRenderingContext2D;
  private theme!: Theme;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private curves: CurveInfo[] = [];
  private cache = new Map<string, CurveCache>();
  private cacheKey = '';
  private overlayAlpha = 1;
  private hover: { x: number; y: number } | null = null;
  view: ViewSettings;

  constructor(
    private canvas: HTMLCanvasElement,
    view: ViewSettings,
    private onViewChange: (yMin: number, yMax: number) => void,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.view = { ...view };
    this.overlayAlpha = view.showBeats ? 1 : 0;
    this.refreshTheme();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.bindPointer();
  }

  refreshTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    this.theme = {
      plotBg: v('--plot-bg'),
      grid: v('--grid'),
      gridStrong: v('--grid-strong'),
      axis: v('--axis'),
      label: v('--label'),
      labelStrong: v('--label-strong'),
      barShade: v('--bar-shade'),
      beat: v('--beat-line'),
      bar: v('--bar-line'),
      accent: v('--accent'),
      playhead: v('--playhead'),
      glow: parseFloat(v('--glow')) || 0,
    };
  }

  setView(view: Partial<ViewSettings>): void {
    this.view = { ...this.view, ...view };
  }

  setCurves(curves: CurveInfo[]): void {
    this.curves = curves;
    this.cacheKey = '';
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(100, Math.floor(rect.width));
    this.h = Math.max(100, Math.floor(rect.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.cacheKey = '';
  }

  // ---- coordinate helpers -------------------------------------------------
  private get plotW(): number { return this.w - M.l - M.r; }
  private get plotH(): number { return this.h - M.t - M.b; }
  private get beats(): number { return this.view.bars * 4; }
  private xToPx(beat: number): number { return M.l + (beat / this.beats) * this.plotW; }
  private pxToX(px: number): number { return ((px - M.l) / this.plotW) * this.beats; }
  private yToPx(y: number): number {
    const { yMin, yMax } = this.view;
    return M.t + ((yMax - y) / (yMax - yMin)) * this.plotH;
  }
  private pxToY(py: number): number {
    const { yMin, yMax } = this.view;
    return yMax - ((py - M.t) / this.plotH) * (yMax - yMin);
  }

  // ---- interaction --------------------------------------------------------
  private bindPointer(): void {
    const c = this.canvas;
    let drag: { y: number; yMin: number; yMax: number } | null = null;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const anchor = this.pxToY(e.clientY - rect.top);
      const { yMin, yMax } = this.view;
      let span = (yMax - yMin) * Math.exp(e.deltaY * 0.0015);
      span = Math.min(120, Math.max(6, span));
      const ratio = (anchor - yMin) / (yMax - yMin);
      const nMin = anchor - ratio * span;
      this.applyView(nMin, nMin + span);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, yMin: this.view.yMin, yMax: this.view.yMax };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!drag) return;
      const semisPerPx = (drag.yMax - drag.yMin) / this.plotH;
      const dy = (e.clientY - drag.y) * semisPerPx;
      this.applyView(drag.yMin + dy, drag.yMax + dy);
    });
    const end = () => {
      drag = null;
      c.classList.remove('dragging');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('dblclick', () => this.applyView(-20, 20));
  }

  private applyView(yMin: number, yMax: number): void {
    this.view.yMin = yMin;
    this.view.yMax = yMax;
    this.cacheKey = '';
    this.onViewChange(yMin, yMax);
  }

  // ---- sampling -----------------------------------------------------------
  private ensureCache(): void {
    const key = `${this.w}x${this.h}|${this.view.yMin}|${this.view.yMax}|${this.view.bars}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.cache.clear();
    const n = Math.max(2, Math.ceil(this.plotW));
    for (const c of this.curves) {
      const ys = new Float64Array(n + 1);
      const breakAfter = new Uint8Array(n + 1);
      for (let i = 0; i <= n; i++) ys[i] = c.evaluate((i / n) * this.beats);
      for (let i = 0; i < n; i++) {
        const a = ys[i];
        const b = ys[i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b)) { breakAfter[i] = 1; continue; }
        const d = Math.abs(a - b);
        if (d > 0.6) {
          // jump test: a continuous curve passes through the middle
          const m = c.evaluate(((i + 0.5) / n) * this.beats);
          if (!Number.isFinite(m) || Math.min(Math.abs(m - a), Math.abs(m - b)) < 0.12 * d) breakAfter[i] = 1;
        }
      }
      this.cache.set(c.id, { ys, breakAfter });
    }
  }

  // ---- drawing ------------------------------------------------------------
  draw(beat: number, playing: boolean): void {
    const ctx = this.ctx;
    const th = this.theme;
    const target = this.view.showBeats ? 1 : 0;
    this.overlayAlpha += (target - this.overlayAlpha) * 0.18;
    if (Math.abs(target - this.overlayAlpha) < 0.01) this.overlayAlpha = target;

    this.ensureCache();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // plot background
    ctx.fillStyle = th.plotBg;
    roundRect(ctx, 0, 0, this.w, this.h, 0);
    ctx.fill();

    this.drawPitchGrid();
    if (this.overlayAlpha > 0) this.drawBeatOverlay(beat, playing, this.overlayAlpha);
    this.drawCurves();
    this.drawPlayhead(beat, playing);
    this.drawHover();
  }

  private drawPitchGrid(): void {
    const ctx = this.ctx;
    const th = this.theme;
    const { yMin, yMax, rootMidi } = this.view;
    const semiPx = this.plotH / (yMax - yMin);
    const labelStep = [1, 2, 3, 4, 6, 12, 24].find((s) => s * semiPx >= 18) ?? 24;

    ctx.save();
    ctx.font = `500 10.5px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let s = Math.ceil(yMin); s <= Math.floor(yMax); s++) {
      const py = Math.round(this.yToPx(s)) + 0.5;
      const isOct = (((rootMidi + s) % 12) + 12) % 12 === 0;
      const isLabel = s % labelStep === 0 || isOct;
      if (!isLabel && semiPx < 5) continue;
      ctx.strokeStyle = s === 0 ? th.axis : isOct ? th.gridStrong : th.grid;
      ctx.lineWidth = s === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(M.l, py);
      ctx.lineTo(this.w - M.r, py);
      ctx.stroke();
      if (isLabel && (s % labelStep === 0 || labelStep <= 12)) {
        ctx.fillStyle = s === 0 || isOct ? th.labelStrong : th.label;
        ctx.fillText(midiToName(rootMidi + s), M.l - 10, py);
      }
    }
    ctx.restore();
  }

  private drawBeatOverlay(beat: number, playing: boolean, alpha: number): void {
    const ctx = this.ctx;
    const th = this.theme;
    const beats = this.beats;
    const beatPx = this.plotW / beats;
    const top = M.t;
    const bottom = this.h - M.b;

    ctx.save();
    ctx.globalAlpha = alpha;

    // alternating bar shading
    ctx.fillStyle = th.barShade;
    for (let bar = 0; bar < this.view.bars; bar += 2) {
      const x0 = this.xToPx(bar * 4);
      ctx.fillRect(x0, top, beatPx * 4, bottom - top);
    }

    // current beat highlight
    if (playing) {
      const cur = Math.floor(beat);
      const frac = beat - cur;
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = alpha * (0.06 + 0.1 * Math.exp(-frac * 4));
      ctx.fillRect(this.xToPx(cur), top, beatPx, bottom - top);
      ctx.globalAlpha = alpha;
    }

    // subdivisions
    if (beatPx / 4 >= 10) {
      ctx.strokeStyle = th.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      for (let i = 0; i < beats * 4; i++) {
        if (i % 4 === 0) continue;
        const px = Math.round(this.xToPx(i / 4)) + 0.5;
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // beat + bar lines
    for (let i = 0; i <= beats; i++) {
      const px = Math.round(this.xToPx(i)) + 0.5;
      const isBar = i % 4 === 0;
      ctx.strokeStyle = isBar ? th.bar : th.beat;
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(px, isBar ? top - 8 : top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
    }

    // ruler labels
    ctx.font = `600 11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const cur = playing ? Math.floor(beat) : -1;
    for (let i = 0; i < beats; i++) {
      const isBar = i % 4 === 0;
      if (!isBar && beatPx < 22) continue;
      const px = this.xToPx(i);
      const label = isBar ? `${i / 4 + 1}` : `.${(i % 4) + 1}`;
      ctx.fillStyle = i === cur ? th.accent : isBar ? th.labelStrong : th.label;
      ctx.font = `${isBar ? 700 : 500} ${isBar ? 12 : 10.5}px ${FONT}`;
      ctx.fillText(label, px + 5, top - 13);
    }
    ctx.restore();
  }

  private curvePath(cache: CurveCache, close: boolean): Path2D {
    const path = new Path2D();
    const n = cache.ys.length - 1;
    const bottom = this.h - M.b;
    let open = false;
    let startX = 0;
    let lastX = 0;
    const finish = () => {
      if (open && close) {
        path.lineTo(lastX, bottom);
        path.lineTo(startX, bottom);
        path.closePath();
      }
      open = false;
    };
    for (let i = 0; i <= n; i++) {
      const y = cache.ys[i];
      if (!Number.isFinite(y)) { finish(); continue; }
      const px = M.l + (i / n) * this.plotW;
      const py = this.yToPx(y);
      if (!open) {
        if (close) { path.moveTo(px, bottom); path.lineTo(px, py); } else path.moveTo(px, py);
        open = true;
        startX = px;
      } else {
        path.lineTo(px, py);
      }
      lastX = px;
      if (cache.breakAfter[i]) finish();
    }
    finish();
    return path;
  }

  private drawCurves(): void {
    const ctx = this.ctx;
    const th = this.theme;
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, M.t - 2, this.plotW, this.plotH + 4);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const c of this.curves) {
      const cache = this.cache.get(c.id);
      if (!cache) continue;
      const alpha = c.muted ? 0.3 : 1;

      if (c.type === 'bass') {
        const grad = ctx.createLinearGradient(0, M.t, 0, this.h - M.b);
        grad.addColorStop(0, withAlpha(c.color, 0.28 * alpha));
        grad.addColorStop(1, withAlpha(c.color, 0));
        ctx.fillStyle = grad;
        ctx.fill(this.curvePath(cache, true));
      }

      const line = this.curvePath(cache, false);
      if (c.muted) ctx.setLineDash([6, 6]);
      if (th.glow > 0 && !c.muted) {
        ctx.shadowColor = c.color;
        ctx.shadowBlur = 14 * th.glow;
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.type === 'bass' ? 3.5 : 3;
      ctx.stroke(line);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawPlayhead(beat: number, playing: boolean): void {
    const ctx = this.ctx;
    const th = this.theme;
    const px = this.xToPx(beat);
    const top = M.t;
    const bottom = this.h - M.b;

    ctx.save();
    ctx.globalAlpha = playing ? 1 : 0.45;
    if (th.glow > 0) {
      ctx.shadowColor = th.playhead;
      ctx.shadowBlur = 16 * th.glow;
    }
    ctx.strokeStyle = th.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
    ctx.stroke();

    // ruler marker
    ctx.fillStyle = th.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 6, top - 8);
    ctx.lineTo(px + 6, top - 8);
    ctx.lineTo(px, top);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (!playing) return;

    // dots riding each curve
    for (const c of this.curves) {
      if (c.muted) continue;
      const y = c.evaluate(beat);
      if (!Number.isFinite(y) || y < this.view.yMin || y > this.view.yMax) continue;
      const py = this.yToPx(y);
      let pulse = 0;
      if (c.type === 'bass') {
        const phase = (beat % c.hitEvery) / c.hitEvery;
        pulse = Math.exp(-phase * 6);
        ctx.save();
        ctx.strokeStyle = c.color;
        ctx.globalAlpha = pulse * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 8 + (1 - pulse) * 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(px, py, 6 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHover(): void {
    const h = this.hover;
    if (!h || h.x < M.l || h.x > this.w - M.r || h.y < M.t || h.y > this.h - M.b) return;
    const ctx = this.ctx;
    const th = this.theme;
    const x = this.pxToX(h.x);
    const y = this.pxToY(h.y);
    const text = `beat ${(Math.floor(x / 4) + 1)}.${Math.floor(x % 4) + 1}  ·  ${midiToName(this.view.rootMidi + Math.round(y))}`;
    ctx.save();
    ctx.font = `600 11px ${FONT}`;
    const w = ctx.measureText(text).width + 16;
    let bx = h.x + 12;
    let by = h.y - 30;
    if (bx + w > this.w - M.r) bx = h.x - w - 12;
    if (by < M.t) by = h.y + 12;
    ctx.fillStyle = th.plotBg;
    ctx.strokeStyle = th.gridStrong;
    ctx.globalAlpha = 0.92;
    roundRect(ctx, bx, by, w, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.labelStrong;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 8, by + 11);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
