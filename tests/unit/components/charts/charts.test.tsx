import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Chart.js needs a real canvas 2d context that jsdom lacks, so stub react-chartjs-2
// and capture the `data`/`options` each wrapper builds. These tests assert the
// wrappers forward the exact prototype config (colours, cutout, datasets) rather
// than exercising Chart.js itself.
// Only the fields these tests assert on are described; Chart.js passes plenty
// more, hence the index signatures rather than `any`.
type CapturedDataset = {
  label?: string;
  data?: number[];
  backgroundColor?: string | string[];
  borderDash?: number[];
  [key: string]: unknown;
};

type CapturedChart = {
  data: { labels?: unknown[]; datasets: CapturedDataset[] };
  options: {
    cutout?: string;
    plugins?: { legend?: { display?: boolean } };
    [key: string]: unknown;
  };
};

const captured: Record<string, CapturedChart> = {};
vi.mock('react-chartjs-2', () => ({
  Doughnut: (p: CapturedChart) => {
    captured.doughnut = p;
    return null;
  },
  Bar: (p: CapturedChart) => {
    captured.bar = p;
    return null;
  },
  Line: (p: CapturedChart) => {
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
    // `?.` keeps the assertion strict: a missing plugins/legend yields undefined,
    // which still fails the toBe(false).
    expect(captured.bar.options.plugins?.legend?.display).toBe(false);
  });
});

describe('LineChart', () => {
  it('builds the three revenue/expense/profit datasets', () => {
    render(<LineChart labels={['a']} revenue={[10]} expense={[6]} profit={[4]} />);
    const labels = captured.line.data.datasets.map((d) => d.label);
    expect(labels).toEqual(['รายได้', 'ค่าใช้จ่าย', 'กำไร']);
    expect(captured.line.data.datasets[1].borderDash).toEqual([4, 3]);
  });
});
