import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Chart.js needs a real canvas 2d context that jsdom lacks, so stub react-chartjs-2
// and capture the `data`/`options` each wrapper builds. These tests assert the
// wrappers forward the exact prototype config (colours, cutout, datasets) rather
// than exercising Chart.js itself.
const captured: Record<string, { data: any; options: any }> = {};
vi.mock('react-chartjs-2', () => ({
  Doughnut: (p: any) => {
    captured.doughnut = p;
    return null;
  },
  Bar: (p: any) => {
    captured.bar = p;
    return null;
  },
  Line: (p: any) => {
    captured.line = p;
    return null;
  },
}));

import { BarChart } from '@/components/charts/BarChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { LineChart } from '@/components/charts/LineChart';

describe('DoughnutChart', () => {
  it('forwards data, colours and the 72% cutout', () => {
    render(<DoughnutChart data={[1, 2]} labels={['a', 'b']} colors={['#111', '#222']} />);
    expect(captured.doughnut.data.datasets[0].data).toEqual([1, 2]);
    expect(captured.doughnut.data.datasets[0].backgroundColor).toEqual(['#111', '#222']);
    expect(captured.doughnut.options.cutout).toBe('72%');
  });
});

describe('BarChart', () => {
  it('uses the prototype bar colour and hides the legend', () => {
    render(<BarChart labels={['a']} data={[5]} />);
    expect(captured.bar.data.datasets[0].backgroundColor).toBe('#7A2333');
    expect(captured.bar.options.plugins.legend.display).toBe(false);
  });
});

describe('LineChart', () => {
  it('builds the three revenue/expense/profit datasets', () => {
    render(<LineChart labels={['a']} revenue={[10]} expense={[6]} profit={[4]} />);
    const labels = captured.line.data.datasets.map((d: any) => d.label);
    expect(labels).toEqual(['รายได้', 'ค่าใช้จ่าย', 'กำไร']);
    expect(captured.line.data.datasets[1].borderDash).toEqual([4, 3]);
  });
});
