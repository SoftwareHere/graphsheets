import type { Equation } from './state';

export const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9 4v16M15 4v16"/></svg>',
  metro: '<svg viewBox="0 0 24 24"><path d="M9 3h6l4 18H5L9 3z"/><path d="M12 16l5-9"/><path d="M7.5 16h9"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9.5 7V4.5h5V7"/></svg>',
};

export interface EquationHandlers {
  onText(id: string, text: string): void;
  onChange(id: string, patch: Partial<Equation>): void;
  onCycleColor(id: string): void;
  onDelete(id: string): void;
}

const WAVES: [Equation['wave'], string][] = [
  ['sine', 'Sine'],
  ['triangle', 'Triangle'],
  ['sawtooth', 'Saw'],
  ['square', 'Square'],
];

const HITS: [number, string][] = [
  [0.5, 'Hit ½ beat'],
  [1, 'Hit every beat'],
  [2, 'Hit every 2'],
  [4, 'Hit every bar'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function renderEquations(
  container: HTMLElement,
  equations: Equation[],
  errors: Map<string, string | null>,
  h: EquationHandlers,
): void {
  container.replaceChildren();
  equations.forEach((eq) => {
    const row = el('div', 'eq');
    row.dataset.id = eq.id;
    row.style.setProperty('--c', eq.color);
    row.classList.toggle('muted', eq.muted);

    const swatch = el('button', 'swatch');
    swatch.title = 'Change colour';
    swatch.setAttribute('aria-label', 'Change colour');
    swatch.onclick = () => h.onCycleColor(eq.id);

    const main = el('div', 'eq-main');
    const wrap = el('label', 'eq-input-wrap');
    wrap.append(el('span', 'eq-prefix', 'y =&nbsp;'));
    const input = el('input', 'eq-input');
    input.value = eq.text;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'e.g. 5 sin(x)';
    input.setAttribute('aria-label', 'Equation');
    input.oninput = () => h.onText(eq.id, input.value);
    wrap.append(input);

    const err = el('div', 'eq-error');
    err.textContent = errors.get(eq.id) ?? '';
    row.classList.toggle('invalid', !!errors.get(eq.id));

    const controls = el('div', 'eq-controls');
    const seg = el('div', 'seg');
    for (const [type, label] of [['tone', 'Tone'], ['bass', '808']] as const) {
      const b = el('button', type === eq.type ? 'active' : '', label);
      b.title = type === 'tone' ? 'Smooth tone that follows the pitch' : '808 bass that hits on the beat';
      b.onclick = () => { if (eq.type !== type) h.onChange(eq.id, { type }); };
      seg.append(b);
    }

    const sel = el('select');
    if (eq.type === 'tone') {
      sel.setAttribute('aria-label', 'Waveform');
      for (const [v, l] of WAVES) sel.append(new Option(l, v, false, v === eq.wave));
      sel.onchange = () => h.onChange(eq.id, { wave: sel.value as Equation['wave'] });
    } else {
      sel.setAttribute('aria-label', '808 hit rate');
      for (const [v, l] of HITS) sel.append(new Option(l, String(v), false, v === eq.hitEvery));
      sel.onchange = () => h.onChange(eq.id, { hitEvery: Number(sel.value) });
    }

    const vol = el('input', 'vol');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.01';
    vol.value = String(eq.volume);
    vol.title = 'Volume';
    vol.setAttribute('aria-label', 'Volume');
    vol.style.setProperty('--p', `${eq.volume * 100}%`);
    vol.oninput = () => {
      vol.style.setProperty('--p', `${Number(vol.value) * 100}%`);
      h.onChange(eq.id, { volume: Number(vol.value) });
    };

    const mute = el('button', 'icon-btn', eq.muted ? ICONS.mute : ICONS.speaker);
    mute.title = eq.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-label', mute.title);
    mute.onclick = () => h.onChange(eq.id, { muted: !eq.muted });

    const del = el('button', 'icon-btn del', ICONS.trash);
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete equation');
    del.onclick = () => h.onDelete(eq.id);

    controls.append(seg, sel);
    const mix = el('div', 'eq-mix');
    mix.append(vol, mute, del);
    main.append(wrap, err, controls, mix);
    row.append(swatch, main);
    container.append(row);
  });
}

/** Update just the error line of a row without re-rendering (keeps input focus). */
export function setRowError(container: HTMLElement, id: string, error: string | null): void {
  const row = container.querySelector<HTMLElement>(`.eq[data-id="${id}"]`);
  if (!row) return;
  row.classList.toggle('invalid', !!error);
  const err = row.querySelector('.eq-error');
  if (err) err.textContent = error ?? '';
}
