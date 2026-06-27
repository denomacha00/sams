import React from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface ChartConfig {
  type: 'bar' | 'line';
  title: string;
  data: ChartDataPoint[];
  barColor?: string;
}

// ─── SVG Bar Chart ──────────────────────────────────────────────────────────

function BarChart({ data, title }: { data: ChartDataPoint[]; title: string }) {
  const width = 340;
  const height = 180;
  const padding = { top: 20, right: 16, bottom: 40, left: 16 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(12, Math.min(40, chartW / data.length - 8));
  const gap = (chartW - barWidth * data.length) / (data.length + 1);

  return (
    <div className="mt-2 mb-1">
      <p className="text-xs font-semibold text-gray-400 mb-1 text-center">{title}</p>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartH * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#262841"
                strokeWidth={1}
              />
              <text
                x={padding.left - 4}
                y={y + 3}
                textAnchor="end"
                fill="#76799b"
                fontSize={9}
              >
                {Math.round(maxVal * ratio)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((point, i) => {
          const barH = (point.value / maxVal) * chartH;
          const x = padding.left + gap + i * (barWidth + gap);
          const y = padding.top + chartH - barH;
          const color = point.color || '#6366f1';

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={3}
                fill={color}
                opacity={0.85}
              />
              <text
                x={x + barWidth / 2}
                y={padding.top + chartH + 14}
                textAnchor="end"
                fill="#989bb3"
                fontSize={8}
                transform={`rotate(-45, ${x + barWidth / 2}, ${padding.top + chartH + 14})`}
              >
                {point.label.length > 10 ? point.label.slice(0, 10) + '…' : point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── SVG Line Chart ─────────────────────────────────────────────────────────

function LineChart({ data, title }: { data: ChartDataPoint[]; title: string }) {
  const width = 340;
  const height = 180;
  const padding = { top: 20, right: 16, bottom: 36, left: 16 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => d.value), 1);

  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH * (1 - d.value / maxVal),
    ...d,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="mt-2 mb-1">
      <p className="text-xs font-semibold text-gray-400 mb-1 text-center">{title}</p>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartH * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#262841" strokeWidth={1} />
              <text x={padding.left - 4} y={y + 3} textAnchor="end" fill="#76799b" fontSize={9}>
                {Math.round(maxVal * ratio)}
              </text>
            </g>
          );
        })}

        {/* Line */}
        <path d={pathD} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#6366f1" stroke="#181923" strokeWidth={2} />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fill="#ececf5" fontSize={9} fontWeight={600}>
              {p.value}
            </text>
          </g>
        ))}

        {/* Labels */}
        {points.map((p, i) => (
          <text
            key={`lbl-${i}`}
            x={p.x}
            y={padding.top + chartH + 14}
            textAnchor="end"
            fill="#989bb3"
            fontSize={8}
            transform={`rotate(-35, ${p.x}, ${padding.top + chartH + 14})`}
          >
            {p.label.length > 10 ? p.label.slice(0, 10) + '…' : p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Main Renderer ─────────────────────────────────────────────────────────

const AiChartRenderer: React.FC<{ content: string }> = ({ content }) => {
  // Try to find a JSON chart config block in the message
  // Expected format: <!--chart:{"type":"bar","title":"Revenue","data":[{"label":"Jan","value":100}]}-->
  const chartMatch = content.match(/<!--chart:({.+?})-->/);
  if (!chartMatch) return null;

  try {
    const config: ChartConfig = JSON.parse(chartMatch[1]);
    if (!config.data || config.data.length === 0) return null;

    return (
      <div className="my-2 rounded-lg border border-indigo-500/20 bg-indigo-950/20 p-2">
        {config.type === 'line' ? (
          <LineChart data={config.data} title={config.title} />
        ) : (
          <BarChart data={config.data} title={config.title} />
        )}
      </div>
    );
  } catch {
    return null;
  }
};

export default AiChartRenderer;
