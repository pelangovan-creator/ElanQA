import { hbars, lines, stackedBar, stackedColumns } from './charts';

describe('charts', () => {
  it('escape text and expose title/desc for accessibility', () => {
    const svg = hbars('Defects <by> module', [{ label: 'Log<in>', value: 2 }]);
    expect(svg).toMatch(/role="img" aria-label="Defects &lt;by&gt; module"/);
    expect(svg).toContain('<desc>Log&lt;in&gt; 2</desc>');
    expect(svg).not.toContain('<in>');
  });
  it('one y-axis with whole-number ticks only', () => {
    const svg = lines('t', ['a', 'b'], [{ name: 'Opened', color: '#2a78d6', values: [0, 1] }]);
    const ticks = [...svg.matchAll(/text-anchor="end" fill="#898781"[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(ticks).toEqual(['0', '1']);
  });
  it('stacked bar shows labels and percentages in tooltips; empty data is explained', () => {
    expect(stackedBar('Status', [{ label: 'Pass', value: 3, color: '#0ca30c' }, { label: 'Fail', value: 1, color: '#d03b3b' }])).toContain('<title>Pass: 3 (75%)</title>');
    expect(stackedBar('Status', [{ label: 'Pass', value: 0, color: '#0ca30c' }])).toContain('No data yet');
  });
  it('stacked columns carry a legend for every series', () => {
    const svg = stackedColumns('Weekly', ['w1'], [{ name: 'Pass', color: '#0ca30c', values: [2] }, { name: 'Fail', color: '#d03b3b', values: [1] }]);
    expect(svg).toContain('>Pass</text>');
    expect(svg).toContain('>Fail</text>');
    expect(svg).toContain('<title>w1 · Fail: 1</title>');
  });
});
