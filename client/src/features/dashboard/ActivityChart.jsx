import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Segmented } from '@/components/ui';
import { formatDate } from '@/lib/utils';

// Validated pair (dataviz validator: CVD ΔE 23.5, normal ΔE 28.5, contrast ≥ 3:1 on white).
const SERIES = [
  { key: 'generated', label: 'Generated', color: '#6257E8' },
  { key: 'approved', label: 'Approved', color: '#16865C' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[150px] rounded-lg border border-line bg-surface px-3 py-2 shadow-pop">
      <div className="mb-1.5 text-xs font-semibold text-ink">{formatDate(label, 'EEE d MMM')}</div>
      {SERIES.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="font-semibold tabular-nums text-ink">{p?.value ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 14-day generated vs approved versions, with a table view for accessibility. */
export function ActivityChart({ data = [] }) {
  const [view, setView] = useState('chart');
  const totals = SERIES.map((s) => ({ ...s, total: data.reduce((sum, d) => sum + (d[s.key] || 0), 0) }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <ul className="flex flex-wrap items-center gap-5" aria-label="Legend">
          {totals.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="text-xs text-muted">{s.label}</span>
              <span className="text-[13px] font-semibold tabular-nums text-ink">{s.total}</span>
            </li>
          ))}
        </ul>
        <Segmented
          size="sm"
          ariaLabel="Chart view"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>

      {view === 'chart' ? (
        <div className="h-[248px] px-2 pb-3 pt-4" role="img" aria-label={`Bar chart of versions generated and approved per day over the last 14 days: ${totals.map((t) => `${t.total} ${t.label.toLowerCase()}`).join(', ')}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="#EEF0F6" />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, 'd MMM')}
                tickLine={false}
                axisLine={{ stroke: '#E8E9F2' }}
                tick={{ fontSize: 11, fill: '#9A9CB2' }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#9A9CB2' }} width={40} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F0EEFF', opacity: 0.6 }} />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[248px] overflow-y-auto px-5 pb-4 pt-3 scrollbar-thin">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11.5px] uppercase tracking-wide text-muted">
                <th className="py-1.5 font-semibold">Day</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1.5 text-ink">{formatDate(d.date, 'EEE d MMM')}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1.5 text-right tabular-nums text-ink">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
