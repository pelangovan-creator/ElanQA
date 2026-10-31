/**
 * Small, dependency-free SVG charts for the dashboard (inline SVG with per-mark tooltips) and report
 * exports (rendered to PNG). Palette (validated with the dataviz skill's validator, light surface #fcfcfb):
 *  - categorical slots 1/2: #2a78d6 / #eb6834 (ΔE 24.7 CVD, 33.6 normal)
 *  - ordinal blue ramp 650→250 for ordered categories (severity, priority, age buckets)
 *  - fixed status colours for test results, always with text labels (never colour alone)
 */
export const C = {
  surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
  s1: '#2a78d6', s2: '#eb6834',
  ramp: ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'],
  status: { Pass: '#0ca30c', Fail: '#d03b3b', Blocked: '#fab219', Skipped: '#898781', 'Not run': '#c3c2b7' } as Record<string, string>,
};
const FONT = 'system-ui,-apple-system,"Segoe UI",Arial,sans-serif';
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const nice = (max: number) => { if (max <= 5) return Math.max(1, Math.ceil(max)); const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const wrap = (w: number, h: number, title: string, desc: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}" font-family='${FONT}' font-size="12"><title>${esc(title)}</title><desc>${esc(desc)}</desc><rect width="${w}" height="${h}" fill="${C.surface}"/>${body}</svg>`;
/** Bar with 4px rounded data-end, square at the baseline. */
const barPath = (x: number, y: number, w: number, h: number, horizontal: boolean) => {
  const r = Math.min(4, horizontal ? h / 2 : w / 2, horizontal ? w : h);
  if (h <= 0 || w <= 0) return '';
  return horizontal
    ? `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`
    : `M${x},${y + h}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
};
const legend = (items: { label: string; color: string }[], x: number, y: number) =>
  items.map((it, i) => `<g transform="translate(${x + i * 120},${y})"><rect width="10" height="10" rx="2" fill="${it.color}"/><text x="15" y="9" fill="${C.ink2}">${esc(it.label)}</text></g>`).join('');

export interface Datum { label: string; value: number; color?: string }

/** Part-to-whole: one tall segmented bar (≤ 6 segments) with labels and a legend. */
export function stackedBar(title: string, data: Datum[], w = 640): string {
  const total = data.reduce((s, d) => s + d.value, 0);
  const h = 96, x0 = 8, bw = w - 16;
  let x = x0;
  const segs = data.filter((d) => d.value > 0).map((d) => {
    const sw = total ? (d.value / total) * bw : 0;
    const pct = total ? Math.round((d.value / total) * 100) : 0;
    const label = sw > 60 ? `<text x="${x + 6}" y="44" fill="${d.label === 'Blocked' || d.label === 'Not run' ? C.ink : '#fff'}" font-weight="600">${esc(d.label)} ${d.value}</text>` : '';
    const out = `<g><title>${esc(`${d.label}: ${d.value} (${pct}%)`)}</title><rect x="${x}" y="24" width="${Math.max(0, sw - 2)}" height="32" fill="${d.color}"/>${label}</g>`;
    x += sw;
    return out;
  }).join('');
  const desc = data.map((d) => `${d.label} ${d.value}`).join(', ');
  return wrap(w, h, title, desc, `<text x="8" y="14" fill="${C.ink}" font-weight="600">${esc(title)} (${total})</text>${total ? segs : `<text x="8" y="44" fill="${C.muted}">No data yet</text>`}${legend(data.map((d) => ({ label: `${d.label} ${d.value}`, color: d.color ?? C.s1 })), 8, 72)}`);
}

/** Horizontal bars - one series (slot 1) or an ordinal ramp passed per datum. Values labelled at the bar end. */
export function hbars(title: string, data: Datum[], w = 480): string {
  const rowH = 26, top = 26, labelW = Math.min(160, Math.max(60, ...data.map((d) => d.label.length * 7)));
  const h = top + data.length * rowH + 8;
  const max = nice(Math.max(1, ...data.map((d) => d.value)));
  const plotW = w - labelW - 50;
  const rows = data.map((d, i) => {
    const y = top + i * rowH;
    const bw = (d.value / max) * plotW;
    return `<g><title>${esc(`${d.label}: ${d.value}`)}</title><rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent"/>
      <text x="${labelW - 6}" y="${y + 16}" text-anchor="end" fill="${C.ink2}">${esc(d.label)}</text>
      <path d="${barPath(labelW, y + 5, Math.max(bw, 0.01), rowH - 10, true)}" fill="${d.color ?? C.s1}"/>
      <text x="${labelW + bw + 6}" y="${y + 16}" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${d.value}</text></g>`;
  }).join('');
  return wrap(w, h, title, data.map((d) => `${d.label} ${d.value}`).join(', '), `<text x="0" y="14" fill="${C.ink}" font-weight="600">${esc(title)}</text><line x1="${labelW}" x2="${labelW}" y1="${top}" y2="${h - 8}" stroke="${C.axis}"/>${rows}`);
}

export interface Series { name: string; color: string; values: number[]; dashed?: boolean }

/** Line chart on ONE axis (counts over time). Legend + direct label at each line's end; per-point tooltips. */
export function lines(title: string, x: string[], series: Series[], w = 640, h = 260): string {
  const l = 40, r = 90, t = 30, b = 34;
  const pw = w - l - r, ph = h - t - b;
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)));
  const X = (i: number) => l + (x.length <= 1 ? pw / 2 : (i / (x.length - 1)) * pw);
  const Y = (v: number) => t + ph - (v / max) * ph;
  // Integer counts: show the midpoint only when it is a whole number (avoids "0, 1, 1").
  const ticks = (Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max]).map((v) => `<line x1="${l}" x2="${l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? C.axis : C.grid}"/><text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="${C.muted}" style="font-variant-numeric:tabular-nums">${Math.round(v)}</text>`).join('');
  const step = Math.max(1, Math.ceil(x.length / 7));
  const xl = x.map((d, i) => (i % step === 0 || i === x.length - 1 ? `<text x="${X(i)}" y="${t + ph + 18}" text-anchor="middle" fill="${C.muted}">${esc(d)}</text>` : '')).join('');
  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
    const last = s.values.length - 1;
    const marks = s.values.map((v, i) => `<g><title>${esc(`${s.name} · ${x[i]}: ${v}`)}</title><circle cx="${X(i)}" cy="${Y(v)}" r="10" fill="transparent"/>${x.length <= 31 ? `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${s.color}" stroke="${C.surface}" stroke-width="2"/>` : ''}</g>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>${marks}
      ${last >= 0 ? `<text x="${X(last) + 8}" y="${Y(s.values[last]) + 4}" fill="${C.ink2}">${esc(s.name)} ${s.values[last]}</text>` : ''}`;
  }).join('');
  const desc = series.map((s) => `${s.name}: ${x.map((d, i) => `${d} ${s.values[i]}`).join(', ')}`).join('; ');
  return wrap(w, h, title, desc, `<text x="${l}" y="16" fill="${C.ink}" font-weight="600">${esc(title)}</text>${series.length > 1 ? legend(series.map((s) => ({ label: s.name, color: s.color })), w - 250, 6) : ''}${ticks}${xl}${paths}`);
}

/** Stacked columns per period (e.g. weekly Pass/Fail/Blocked) with a status legend. */
export function stackedColumns(title: string, x: string[], series: Series[], w = 640, h = 260): string {
  const l = 40, r = 12, t = 34, b = 34;
  const pw = w - l - r, ph = h - t - b;
  const totals = x.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const max = nice(Math.max(1, ...totals));
  const bw = Math.min(48, (pw / Math.max(1, x.length)) * 0.6);
  const Y = (v: number) => (v / max) * ph;
  const cols = x.map((d, i) => {
    const cx = l + (i + 0.5) * (pw / x.length);
    let acc = 0;
    const segs = series.map((s, si) => {
      const v = s.values[i] ?? 0;
      if (!v) return '';
      const y = t + ph - Y(acc + v);
      const hh = Y(v);
      acc += v;
      const topSeg = series.slice(si + 1).every((o) => !(o.values[i] ?? 0));
      return `<g><title>${esc(`${d} · ${s.name}: ${v}`)}</title>${topSeg ? `<path d="${barPath(cx - bw / 2, y, bw, hh - 2, false)}" fill="${s.color}"/>` : `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, hh - 2)}" fill="${s.color}"/>`}</g>`;
    }).join('');
    return `${segs}<text x="${cx}" y="${t + ph - Y(totals[i]) - 4}" text-anchor="middle" fill="${C.ink2}">${totals[i] || ''}</text><text x="${cx}" y="${t + ph + 18}" text-anchor="middle" fill="${C.muted}">${esc(d)}</text>`;
  }).join('');
  const desc = x.map((d, i) => `${d}: ${series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(', ')}`).join('; ');
  return wrap(w, h, title, desc, `<text x="${l}" y="16" fill="${C.ink}" font-weight="600">${esc(title)}</text>${legend(series.map((s) => ({ label: s.name, color: s.color })), w - series.length * 120, 6)}<line x1="${l}" x2="${l + pw}" y1="${t + ph}" y2="${t + ph}" stroke="${C.axis}"/>${cols}`);
}
