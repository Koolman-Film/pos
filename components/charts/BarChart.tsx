'use client';

// Ported from reference/v0.4/finnix-film.html:511-523.
// react-chartjs-2 replaces the manual ref/lifecycle; the config is identical, so
// the bars keep the same colour (#7A2333), 6px corner radius, 22px max thickness,
// hidden legend, hidden y-axis and muted x-tick styling.

import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

export function BarChart({ labels, data }: { labels: string[]; data: number[] }) {
  return (
    <Bar
      data={{
        labels,
        datasets: [{ data, backgroundColor: '#7A2333', borderRadius: 6, maxBarThickness: 22 }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#B5AAA1', font: { size: 10 } } },
          y: { display: false },
        },
      }}
    />
  );
}
