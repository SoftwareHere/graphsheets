import { create, all, type EvalFunction } from 'mathjs';

const math = create(all, {});

export interface ParsedEquation {
  ok: boolean;
  error: string | null;
  /** Returns y for a given x, or NaN where the curve is undefined. */
  evaluate: (x: number) => number;
}

interface Bound {
  value: EvalFunction;
  op: '<' | '<=' | '>' | '>=';
}

const NAN_EQ: ParsedEquation = { ok: false, error: null, evaluate: () => NaN };

/**
 * Parses a single restriction like `2 < x < 6`, `x > 3`, or `x <= 8`.
 * Returns predicate functions that must all hold.
 */
function parseRestriction(src: string): ((x: number) => boolean)[] {
  const parts = src.split(/(<=|>=|<|>)/).map((p) => p.trim());
  if (parts.length < 3 || parts.length % 2 === 0) {
    throw new Error(`Invalid restriction "{${src}}"`);
  }
  const preds: ((x: number) => boolean)[] = [];
  for (let i = 0; i + 2 < parts.length; i += 2) {
    const left = parts[i];
    const op = parts[i + 1] as Bound['op'];
    const right = parts[i + 2];
    const l = math.compile(left);
    const r = math.compile(right);
    preds.push((x: number) => {
      const a = Number(l.evaluate({ x }));
      const b = Number(r.evaluate({ x }));
      switch (op) {
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
      }
    });
  }
  return preds;
}

export function parseEquation(text: string): ParsedEquation {
  let src = text.trim();
  if (!src) return NAN_EQ;

  // strip a leading "y =" (or "f(x) =")
  src = src.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '');

  // pull out Desmos-style {restrictions}
  const preds: ((x: number) => boolean)[] = [];
  try {
    src = src.replace(/\{([^}]*)\}/g, (_m, inner: string) => {
      for (const piece of inner.split(',')) {
        if (piece.trim()) preds.push(...parseRestriction(piece));
      }
      return '';
    }).trim();
  } catch (e) {
    return { ok: false, error: (e as Error).message, evaluate: () => NaN };
  }

  if (!src) return { ok: false, error: 'Missing expression', evaluate: () => NaN };

  let compiled: EvalFunction;
  try {
    const node = math.parse(src);
    const symbols = node
      .filter((n) => (n as { isSymbolNode?: boolean }).isSymbolNode === true)
      .map((n) => (n as unknown as { name: string }).name);
    for (const name of symbols) {
      if (name === 'x') continue;
      const known = name in math || name === 'e' || name === 'pi';
      if (!known) throw new Error(`Unknown variable "${name}"`);
    }
    compiled = node.compile();
    // dry run to surface errors (e.g. wrong argument counts) early
    compiled.evaluate({ x: 0.5 });
  } catch (e) {
    return { ok: false, error: (e as Error).message, evaluate: () => NaN };
  }

  const evaluate = (x: number): number => {
    try {
      for (const p of preds) if (!p(x)) return NaN;
      const v = compiled.evaluate({ x });
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? NaN : Number(v);
      return Number.isFinite(n) ? n : NaN;
    } catch {
      return NaN;
    }
  };

  return { ok: true, error: null, evaluate };
}
