'use client';

// Ported from reference/v0.4/finnix-film.html:499-510.
// The prototype hand-managed a Chart.js instance via useRef + useEffect; here
// react-chartjs-2 owns the lifecycle. The `data`/`options` config is unchanged,
// so the rendered doughnut is visually identical (same colours, 72% cutout,
// legend hidden, 2px slice spacing, no borders).

import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

export function DoughnutChart({
  data,
  labels,
  colors,
}: {
  data: number[];
  labels: string[];
  colors: string[];
}) {
  return (
    <Doughnut
      data={{
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0, spacing: 2 }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false } },
      }}
    />
  );
}
