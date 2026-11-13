import { describe, expect, it } from 'vitest';
import { parseEquation } from './expr';

describe('parseEquation', () => {
  it('evaluates a plain expression', () => {
    const p = parseEquation('2x + 1');
    expect(p.ok).toBe(true);
    expect(p.evaluate(3)).toBe(7);
  });

  it('strips a leading y =', () => {
    expect(parseEquation('y = x^2').evaluate(4)).toBe(16);
    expect(parseEquation('Y=x').evaluate(2)).toBe(2);
  });

  it('supports implicit multiplication and constants', () => {
    expect(parseEquation('7 sin(pi x / 4) + 3').evaluate(2)).toBeCloseTo(10);
  });

  it('applies {a < x < b} restrictions', () => {
    const p = parseEquation('5 {2 < x < 6}');
    expect(p.evaluate(1)).toBeNaN();
    expect(p.evaluate(4)).toBe(5);
    expect(p.evaluate(6)).toBeNaN();
    expect(parseEquation('x {x >= 3}').evaluate(3)).toBe(3);
  });

  it('returns NaN where undefined', () => {
    const p = parseEquation('sqrt(x - 4)');
    expect(p.evaluate(2)).toBeNaN();
    expect(p.evaluate(8)).toBe(2);
    expect(parseEquation('1 / (x - 1)').evaluate(1)).toBeNaN();
  });

  it('reports errors for invalid input', () => {
    expect(parseEquation('2 +').ok).toBe(false);
    expect(parseEquation('2 +').error).toBeTruthy();
    const unknown = parseEquation('q * 2');
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/q/);
    expect(unknown.evaluate(1)).toBeNaN();
  });

  it('treats empty input as silent but not an error', () => {
    const p = parseEquation('  ');
    expect(p.error).toBeNull();
    expect(p.evaluate(1)).toBeNaN();
  });
});
