// The "How it scales" section: charts, takeaways and a table, all computed from assets/bench.json, the snapshot
// `npm run bench:scaling -- --out docs/assets/bench.json` writes. Nothing numeric is hand-written into the page, so the
// text cannot drift from the measurements. The pure part (formatting, growth, chart options) is unit-tested in
// tests/unit/docs-scaling.test.ts; the DOM part below it is covered by tests/e2e/docs.spec.ts.
// Why ECharts is loaded on demand: the defuss-shadcn chart component draws with it, and the file is about 1.1 MB;
// VERIFIED: chart.js resolves globalThis.echarts only when a chart mounts, so a late script tag is enough.

import { h, splitCalls, withCode } from './dom.js';

export const ECHARTS = {
  src: 'https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js',
  integrity: 'sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD',
};
// Literal series colours (assets/site.css): the theme's --chart-* tokens are one blue ramp, and the dataviz palette
// validator failed them as categories (normal-vision ΔE 7.8). These three passed it on both card surfaces.
const COLORS = ['var(--ds-series-1)', 'var(--ds-series-2)', 'var(--ds-series-3)'];
// A second cue besides colour: every series has its own marker shape.
const SYMBOLS = ['circle', 'rect', 'triangle'];
const UNITS = { depth: 'segment', length: 'item', subscribers: 'subscriber' };

/** 28.7 ns, 1.4 µs, 25.3 ms: three significant digits at most, in the unit that keeps the number below 1000. */
export function formatNs(ns) {
  const [value, unit] = ns < 1e3 ? [ns, 'ns'] : ns < 1e6 ? [ns / 1e3, 'µs'] : [ns / 1e6, 'ms'];
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/** Axis ticks are round numbers: 10 µs, not 10.0 µs. */
const formatTick = (ns) => formatNs(ns).replace('.0 ', ' ');

/**
 * Growth exponent: the least-squares slope of log(time) over log(size), fitted on the larger half of the points
 * (how the cost behaves as the input grows, not the fixed overhead at small sizes). 0 is flat, 1 is linear.
 */
export function exponent(points) {
  const tail = points.slice(Math.floor(points.length / 2));
  const xs = tail.map((p) => Math.log(p.x));
  const ys = tail.map((p) => Math.log(p.ns));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const varX = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return cov / varX;
}

export const shape = (k) => (k < 0.25 ? 'flat' : k < 0.75 ? 'sublinear' : k <= 1.3 ? 'linear' : 'superlinear');

/** Marginal cost between the two largest sizes: what one more unit costs out there. */
export function perUnit(points) {
  const [a, b] = points.slice(-2);
  return (b.ns - a.ns) / (b.x - a.x);
}

/** One sentence per series, e.g. "set(path, value): linear, +101 ns per segment (26 µs at 256)". */
export function takeaway(chartId, series) {
  const first = series.points[0];
  const last = series.points.at(-1);
  const kind = shape(exponent(series.points));
  const size = last.x.toLocaleString('en-US');
  if (kind === 'flat') return `${series.label}: flat, ${formatNs(first.ns)} at ${first.x.toLocaleString('en-US')} and ${formatNs(last.ns)} at ${size}`;
  return `${series.label}: ${kind}, +${formatNs(perUnit(series.points))} per ${UNITS[chartId]} (${formatNs(last.ns)} at ${size})`;
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A legend entry in ECharts rich text: function calls in the {code|…} style (SVG text cannot hold <code>). */
export const legendText = (label) => splitCalls(label).map((part) => (part.call ? `{code|${part.text}}` : part.text)).join('');

/**
 * The crosshair tooltip as HTML: the size, then one row per series with its marker, its label (function calls in
 * <code>) and its time. Labels and numbers are escaped; `marker` is ECharts' own swatch markup.
 */
export function tooltipHtml(chart, params) {
  const rows = params.map((p) => {
    const label = splitCalls(p.seriesName).map((part) => (part.call ? `<code>${escapeHtml(part.text)}</code>` : escapeHtml(part.text))).join('');
    return `<div class="ds-tip-row">${p.marker}<span>${label}</span><strong>${escapeHtml(formatNs(p.value[1]))}</strong></div>`;
  });
  return `<div class="ds-tip-head">${escapeHtml(`${Number(params[0].axisValue).toLocaleString('en-US')} ${chart.x}`)}</div>${rows.join('')}`;
}

/**
 * The ECharts option for one chart: log-log lines, a crosshair tooltip, a legend and labels at the line ends.
 * `mono` is the page's monospace font for the calls in the legend.
 */
export function chartOption(chart, { mono = 'monospace' } = {}) {
  const xs = chart.series[0].points.map((p) => p.x);
  const base = chart.id === 'depth' ? 2 : 10;
  return {
    // ECharts writes its aria description into the mount's aria-label; give it the plain-language summary instead of
    // its generated data dump (VERIFIED: without label.description it replaced the summary).
    aria: { enabled: true, label: { description: ariaLabel(chart) } },
    animation: false,
    grid: { left: 12, right: 64, top: 64, bottom: 36, containLabel: true },
    legend: {
      top: 0, left: 0, orient: 'vertical', itemGap: 4, formatter: legendText,
      textStyle: { color: 'var(--muted-foreground)', rich: { code: { fontFamily: mono, color: 'var(--muted-foreground)' } } },
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line' }, formatter: (params) => tooltipHtml(chart, params) },
    xAxis: {
      type: 'log', logBase: base, min: xs[0], max: xs.at(-1),
      name: chart.x, nameLocation: 'middle', nameGap: 26,
      axisLabel: { formatter: (value) => Number(value).toLocaleString('en-US') },
    },
    yAxis: { type: 'log', logBase: 10, axisLabel: { formatter: formatTick } },
    series: chart.series.map((series, i) => ({
      id: series.id,
      name: series.label,
      type: 'line',
      data: series.points.map((p) => [p.x, p.ns]),
      color: COLORS[i],
      symbol: SYMBOLS[i],
      symbolSize: 8,
      lineStyle: { width: 2 },
      endLabel: { show: true, color: 'var(--muted-foreground)', formatter: ({ value }) => formatNs(value[1]) },
      // Lines that end close together (listeners and selectors at 10,000) would print their labels on top of each other.
      labelLayout: { moveOverlap: 'shiftY' },
    })),
  };
}

/** Plain-language summary for the chart's aria-label: what is measured, and how each series grows. */
export const ariaLabel = (chart) => `Log-log line chart of time per operation against ${chart.x}. ${chart.series.map((s) => takeaway(chart.id, s)).join('. ')}.`;

// ---- DOM -------------------------------------------------------------------------------------------------------
function loadEcharts() {
  if (globalThis.echarts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: ECHARTS.src, integrity: ECHARTS.integrity, crossOrigin: 'anonymous' });
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('ECharts did not load')));
    document.head.append(script);
  });
}

function render(section, result) {
  const { environment: env } = result;
  section.querySelector('#bench-meta').textContent =
    `Measured ${result.measuredAt.slice(0, 10)} on ${env.cpu}, ${env.os}, Node ${env.node}, ${result.package}: ${result.method}.`;
  for (const chart of result.charts) {
    const frame = section.querySelector(`[data-bench="${chart.id}"]`);
    frame.querySelector('.ds-takeaways').replaceChildren(...chart.series.map((s) => h('li', {}, withCode(takeaway(chart.id, s)))));
    frame.querySelector('.chart').setAttribute('aria-label', ariaLabel(chart));
  }
  const rows = result.charts.flatMap((chart) => chart.series.flatMap((s) => s.points.map((p) => [chart.x, s.label, p.x.toLocaleString('en-US'), formatNs(p.ns), `${formatNs(p.q1)} – ${formatNs(p.q3)}`])));
  section.querySelector('#bench-table tbody').replaceChildren(...rows.map((cells) => h('tr', { class: 'table-row' }, cells.map((text) => h('td', { class: 'table-cell' }, withCode(text))))));
}

/** Fetch the snapshot and fill the section once it nears the viewport; the charts follow when ECharts arrives. */
export function initScaling(section) {
  const start = async () => {
    let result;
    try {
      const response = await fetch(new URL('bench.json', import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = await response.json();
    } catch {
      section.querySelector('#bench-meta').textContent = 'The measurements could not be loaded. The benchmark source and its method are linked below.';
      return;
    }
    render(section, result);
    try {
      await loadEcharts();
    } catch {
      section.querySelector('#bench-charts-failed').hidden = false;
      return;
    }
    // VERIFIED: defuss-shadcn 0.9.8 exposes the chart API as df$.shadcn.chart (df$.chart is undefined in the page).
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';
    for (const chart of result.charts) df$.shadcn.chart.mount(section.querySelector(`[data-bench="${chart.id}"] .chart`), chartOption(chart, { mono }));
    section.dataset.ready = '';
  };
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    void start();
  }, { rootMargin: '600px 0px' });
  observer.observe(section);
}
