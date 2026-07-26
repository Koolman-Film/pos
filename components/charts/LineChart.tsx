'use client';

// Ported from reference/v0.4/finnix-film.html:524-569.
// react-chartjs-2 owns the Chart.js lifecycle; the three datasets, colours,
// tension, fill/dash styling, bottom point-style legend, dark tooltip with the
// Thai-baht label callback, and the click-to-pin behaviour are all preserved.

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartEvent,
  type ActiveElement,
} from 'chart.js';
import { useState } from 'react';
import { Line } from 'react-chartjs-2';

import { fmt } from '@/lib/domain/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

type Picked = { label: string; revenue: number; expense: number; profit: number };

export function LineChart({
  labels,
  revenue,
  expense,
  profit,
}: {
  labels: string[];
  revenue: number[];
  expense: number[];
  profit: number[];
}) {
  const [picked, setPicked] = useState<Picked | null>(null);

  return (
    <div>
      <div className="relative h-56">
        <Line
          aria-label="กราฟรายได้ ค่าใช้จ่าย และกำไร"
          data={{
            labels,
            datasets: [
              {
                label: 'รายได้',
                data: revenue,
                borderColor: '#2563EB',
                backgroundColor: 'rgba(37,99,235,.08)',
                tension: 0.35,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
              },
              {
                label: 'ค่าใช้จ่าย',
                data: expense,
                borderColor: '#C24B57',
                backgroundColor: 'transparent',
                borderDash: [4, 3],
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 5,
              },
              {
                label: 'กำไร',
                data: profit,
                borderColor: '#2F8F82',
                backgroundColor: 'transparent',
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 5,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  boxWidth: 8,
                  boxHeight: 8,
                  usePointStyle: true,
                  font: { size: 11 },
                  color: '#8B7F76',
                },
              },
              tooltip: {
                backgroundColor: '#2A211D',
                padding: 10,
                cornerRadius: 8,
                callbacks: {
                  label: (ctx) =>
                    `${ctx.dataset.label}: ${Math.round(ctx.parsed.y ?? 0).toLocaleString('th-TH')} บาท`,
                },
              },
            },
            onClick: (_evt: ChartEvent, elements: ActiveElement[]) => {
              if (elements && elements.length) {
                const idx = elements[0].index;
                setPicked({
                  label: labels[idx],
                  revenue: revenue[idx],
                  expense: expense[idx],
                  profit: profit[idx],
                });
              }
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: '#B5AAA1', font: { size: 10 } } },
              y: {
                grid: { color: '#EBE3DA' },
                ticks: {
                  color: '#B5AAA1',
                  font: { size: 10 },
                  callback: (v) => `${Number(v) / 1000}K`,
                },
              },
            },
          }}
        />
      </div>
      {picked && (
        <div
          className="mt-3 text-xs rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1"
          style={{ background: 'var(--paper)' }}
        >
          <span className="font-semibold">{picked.label}</span>
          <span style={{ color: '#2563EB' }}>รายได้ {fmt(picked.revenue)}</span>
          <span style={{ color: '#C24B57' }}>ค่าใช้จ่าย {fmt(picked.expense)}</span>
          <span style={{ color: '#2F8F82' }}>กำไร {fmt(picked.profit)}</span>
        </div>
      )}
    </div>
  );
}
