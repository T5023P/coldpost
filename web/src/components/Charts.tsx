import { useId } from 'react';

const palette = ['#b4471f', '#16130f', '#a67c2e', '#2f6b4f', '#2d5c8a', '#8a6a9e', '#c68a5a'];

export function BarChart({ data, height = 190, format }: { data: { label: string; value: number; hint?: string }[]; height?: number; format?: (n: number) => string }) {
  if (!data.length) return <div className="empty small">No data for this period</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height, paddingTop: 18 }}>
        {data.map((item, index) => {
          const h = Math.max((item.value / max) * (height - 46), item.value > 0 ? 3 : 0);
          return (
            <div key={item.label + index} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }} title={`${item.label}: ${format ? format(item.value) : item.value}`}>
              <span className="xsmall" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                {item.value ? (format ? format(item.value) : item.value) : ''}
              </span>
              <div style={{ width: '100%', maxWidth: 46, height: h, background: index === 0 ? 'var(--accent)' : 'var(--ink)', borderRadius: '4px 4px 0 0', opacity: 0.92 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        {data.map((item, index) => (
          <div key={item.label + index} className="xsmall muted" style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({
  data,
  height = 200,
  format,
  compare,
}: {
  data: { label: string; value: number; value2?: number }[];
  height?: number;
  format?: (n: number) => string;
  compare?: string;
}) {
  const gradientId = useId().replace(/:/g, '');
  if (data.length < 2) return <div className="empty small">Add a few orders to see the trend</div>;
  const width = 620;
  const padX = 8;
  const padY = 18;
  const max = Math.max(...data.map((d) => Math.max(d.value, d.value2 ?? 0)), 1);
  const points = data.map((d, i) => {
    const x = padX + (i * (width - padX * 2)) / (data.length - 1);
    const y = height - padY - (d.value / max) * (height - padY * 2);
    return [x, y] as const;
  });
  const points2 = data.map((d, i) => {
    const x = padX + (i * (width - padX * 2)) / (data.length - 1);
    const y = height - padY - ((d.value2 ?? 0) / max) * (height - padY * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${points[points.length - 1][0].toFixed(1)},${height - padY} L${points[0][0].toFixed(1)},${height - padY} Z`;
  const path2 = points2.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Trend chart">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1={0} x2={width} y1={height - padY - ratio * (height - padY * 2)} y2={height - padY - ratio * (height - padY * 2)} stroke="#ece5d8" strokeDasharray="2 4" />
        ))}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b4471f" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#b4471f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke="#b4471f" strokeWidth="2" strokeLinejoin="round" />
        {compare ? <path d={path2} fill="none" stroke="#16130f" strokeWidth="1.4" strokeDasharray="4 3" opacity="0.55" /> : null}
        {points.map(([x, y], index) => (
          <g key={index}>
            <circle cx={x} cy={y} r="3" fill="#fffdf8" stroke="#b4471f" strokeWidth="1.6" />
            <title>{`${data[index].label}: ${format ? format(data[index].value) : data[index].value}`}</title>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {data.map((d, i) => (
          <span key={d.label + i} className="xsmall muted" style={{ flex: 1, textAlign: i === 0 ? 'left' : i === data.length - 1 ? 'right' : 'center' }}>
            {d.label}
          </span>
        ))}
      </div>
      {compare ? (
        <div className="legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: '#b4471f' }} />Revenue</span>
          <span><i style={{ background: '#16130f', opacity: 0.55 }} />{compare}</span>
        </div>
      ) : null}
    </div>
  );
}

export function Donut({ data, size = 150, centerLabel, centerValue }: { data: { label: string; value: number }[]; size?: number; centerLabel?: string; centerValue?: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!total) return <div className="empty small">No data yet</div>;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="row" style={{ alignItems: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: size, height: size, flex: `0 0 ${size}px` }}>
        <svg viewBox="0 0 150 150" width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#efe9dc" strokeWidth="18" />
          {data.map((item, index) => {
            const fraction = item.value / total;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={item.label}
                cx="75"
                cy="75"
                r={radius}
                fill="none"
                stroke={palette[index % palette.length]}
                strokeWidth="18"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return element;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{centerValue ?? total}</div>
          <div className="xsmall muted">{centerLabel ?? 'total'}</div>
        </div>
      </div>
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        {data.map((item, index) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
            <i style={{ width: 7, height: 7, borderRadius: 2, background: palette[index % palette.length], flex: '0 0 auto' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.label}>{item.label}</span>
            <span className="mono muted">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HBar({ data, format }: { data: { label: string; value: number; hint?: string }[]; format?: (n: number) => string }) {
  if (!data.length) return <div className="empty small">No data yet</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {data.map((item) => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            <span className="mono muted">{format ? format(item.value) : item.value}</span>
          </div>
          <div className="progress">
            <span style={{ width: `${(item.value / max) * 100}%`, background: 'var(--ink)' }} />
          </div>
          {item.hint ? <div className="xsmall muted" style={{ marginTop: 2 }}>{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
