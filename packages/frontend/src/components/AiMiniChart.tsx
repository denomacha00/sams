import React from 'react';

interface BarItem {
  label: string;
  value: number;
  maxValue?: number;
  color?: string;
}

interface Props {
  bars: BarItem[];
  title?: string;
}

const CHART_COLORS = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
];

/**
 * Pure CSS bar chart — no libraries.
 * Shows up to 8 bars inline in the chat.
 * Max bar height: 64px. All relative to 100%.
 */
const AiMiniChart: React.FC<Props> = ({ bars, title }) => {
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.maxValue ?? b.value), 1);
  const displayBars = bars.slice(0, 8);

  return (
    <div className="mt-2 mb-1">
      {title && (
        <p className="text-[10px] text-ink-muted font-medium mb-1.5 uppercase tracking-wider">
          {title}
        </p>
      )}
      <div className="flex items-end gap-1.5" style={{ height: 64 }}>
        {displayBars.map((bar, i) => {
          const heightPct = (bar.value / max) * 100;
          const color = bar.color ?? CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-0.5"
            >
              <div className="w-full flex justify-center">
                <span className="text-[9px] text-ink-muted font-medium">
                  {bar.value}
                </span>
              </div>
              <div
                className={`w-full rounded-t ${color} opacity-80`}
                style={{ height: `${Math.max(heightPct, 4)}%` }}
              />
              <span
                className="text-[8px] text-ink-subtle truncate w-full text-center"
                title={bar.label}
              >
                {bar.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AiMiniChart;
