// The "How it scales" section's pure core (docs/assets/scaling.js): every number the page prints about the benchmark
// goes through these functions, so they are tested with real values; the DOM part is covered by tests/e2e/docs.spec.ts.
import { describe, expect, it } from 'vitest';
import { splitCalls } from '../../docs/assets/dom.js';
import { chartOption, exponent, formatNs, legendText, perUnit, shape, takeaway, tooltipHtml } from '../../docs/assets/scaling.js';

const points = (xs: number[], cost: (x: number) => number) => xs.map((x) => ({ x, ns: cost(x), q1: cost(x), q3: cost(x) }));
const sizes = [10, 100, 1_000, 10_000, 100_000];

describe('benchmark formatting and growth', () => {
  it('formats nanoseconds in the unit that keeps the number below 1000', () => {
    expect(formatNs(5)).toBe('5.0 ns');
    expect(formatNs(28.74)).toBe('28.7 ns');
    expect(formatNs(999)).toBe('999 ns');
    expect(formatNs(1_430)).toBe('1.4 µs');
    expect(formatNs(25_980)).toBe('26.0 µs');
    expect(formatNs(34_247_250)).toBe('34.2 ms');
    expect(formatNs(131.4)).toBe('131 ns');
  });

  it('fits the growth exponent on the larger half of the sizes', () => {
    // A fixed overhead dominates the small sizes; the tail fit still reads the growth as linear.
    expect(exponent(points(sizes, (x) => 3 * x + 5_000))).toBeCloseTo(0.79, 2);
    expect(shape(exponent(points(sizes, (x) => 3 * x + 5_000)))).toBe('linear');
    expect(exponent(points(sizes, (x) => 2 * x))).toBeCloseTo(1, 6);
    expect(exponent(points(sizes, () => 130))).toBeCloseTo(0, 6);
    expect(exponent(points(sizes, (x) => x * x))).toBeCloseTo(2, 6);
    expect([0.1, 0.5, 1, 1.29, 1.5].map(shape)).toEqual(['flat', 'sublinear', 'linear', 'linear', 'superlinear']);
  });

  it('reports the marginal cost between the two largest sizes', () => {
    expect(perUnit(points(sizes, (x) => 3 * x + 100))).toBeCloseTo(3, 9);
  });

  it('words flat and growing series differently', () => {
    expect(takeaway('length', { label: 'get(items[last].text)', points: points(sizes, (x) => 130 + Math.log10(x)) }))
      .toBe('get(items[last].text): flat, 131 ns at 10 and 135 ns at 100,000');
    expect(takeaway('depth', { label: 'set(path, value)', points: points([1, 2, 4, 8, 16, 32, 64, 128, 256], (x) => 100 * x) }))
      .toBe('set(path, value): linear, +100 ns per segment (25.6 µs at 256)');
  });
});

describe('benchmark chart option', () => {
  const chart = { id: 'depth', x: 'path segments', series: [
    { id: 'a', label: 'get(path)', points: points([1, 2, 4], (x) => x) },
    { id: 'b', label: 'set(path, value)', points: points([1, 2, 4], (x) => 2 * x) },
  ] };

  it('draws log-log lines, one colour token and one marker shape per series', () => {
    const option = chartOption(chart) as { xAxis: { type: string; logBase: number; min: number; max: number }; yAxis: { type: string }; series: { color: string; symbol: string; data: number[][] }[] };
    expect(option.xAxis).toMatchObject({ type: 'log', logBase: 2, min: 1, max: 4 });
    expect(option.yAxis.type).toBe('log');
    expect(option.series.map((s) => s.color)).toEqual(['var(--ds-series-1)', 'var(--ds-series-2)']);
    expect(new Set(option.series.map((s) => s.symbol)).size).toBe(2);
    expect(option.series[1]!.data).toEqual([[1, 2], [2, 4], [4, 8]]);
    expect((chartOption({ ...chart, id: 'length' }) as { xAxis: { logBase: number } }).xAxis.logBase).toBe(10);
  });
});

describe('function calls set as code', () => {
  it('splits running text at every call, keeping the rest as plain text', () => {
    expect(splitCalls('set(…) + persistence to memory storage')).toEqual([{ text: 'set(…)', call: true }, { text: ' + persistence to memory storage', call: false }]);
    expect(splitCalls('3 changes via store.subscribe()')).toEqual([{ text: '3 changes via ', call: false }, { text: 'store.subscribe()', call: true }]);
    expect(splitCalls('get(items[last].text): flat').map((part) => part.call)).toEqual([true, false]);
    expect(splitCalls('no call here')).toEqual([{ text: 'no call here', call: false }]);
    expect(splitCalls('validate() checks { name } first; set() then')).toEqual([
      { text: 'validate()', call: true }, { text: ' checks { name } first; ', call: false }, { text: 'set()', call: true }, { text: ' then', call: false },
    ]);
  });

  it('marks calls in legend rich text and escapes tooltip labels', () => {
    expect(legendText('set() with selectors, one selection changes')).toBe('{code|set()} with selectors, one selection changes');
    const chart = { id: 'length', x: 'list items', series: [] };
    const html = tooltipHtml(chart, [{ marker: '<i></i>', seriesName: 'get(items[last].text) <b>', value: [100000, 139.1], axisValue: 100000 }]);
    expect(html).toBe('<div class="ds-tip-head">100,000 list items</div><div class="ds-tip-row"><i></i><span><code>get(items[last].text)</code> &#60;b&#62;</span><strong>139 ns</strong></div>');
  });
});

