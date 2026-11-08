import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DataCard, EmptyState } from './UI';

const cn = (...inputs) => twMerge(clsx(inputs));

const SERIES = ['#009689', '#5dbe9a', '#22ab9d', '#0f766e', '#99f6e4'];
const GRID = '#e8f2f0';
const AXIS = '#8a9c9b';

const tooltipProps = {
  cursor: { fill: '#f2f8f7' },
  contentStyle: {
    backgroundColor: '#ffffff',
    border: '1px solid #dce8e7',
    borderRadius: 12,
    boxShadow: '0 14px 30px -18px rgba(8,94,85,0.45)',
    color: '#0f2b2a',
    fontSize: 12,
    padding: '8px 12px',
  },
  itemStyle: { color: '#0f2b2a', fontSize: 12 },
  labelStyle: { color: '#5b706f', fontSize: 11, fontWeight: 600, marginBottom: 2 },
};

function BarGradient() {
  return (
    <defs>
      <linearGradient id="mczenBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#22ab9d" />
        <stop offset="100%" stopColor="#00786f" />
      </linearGradient>
    </defs>
  );
}

export function AnalyticsChart({ title, subtitle, type = 'bar', data, dataKey, nameKey, height = 'h-64', action }) {
  if (!data || data.length === 0) {
    return (
      <DataCard title={title} subtitle={subtitle} action={action}>
        <EmptyState>No data available for the selected range.</EmptyState>
      </DataCard>
    );
  }

  return (
    <DataCard title={title} subtitle={subtitle} action={action}>
      <div className={cn('w-full', height)}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'bar' ? (
            <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <BarGradient />
              <CartesianGrid strokeDasharray="4 6" stroke={GRID} vertical={false} />
              <XAxis dataKey={nameKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} dy={6} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey={dataKey} fill="url(#mczenBar)" radius={[7, 7, 0, 0]} maxBarSize={46} />
            </BarChart>
          ) : type === 'area' ? (
            <AreaChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="mczenArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22ab9d" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#22ab9d" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke={GRID} vertical={false} />
              <XAxis dataKey={nameKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} dy={6} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="#009689"
                strokeWidth={2.5}
                fill="url(#mczenArea)"
                dot={{ r: 3, fill: '#fff', stroke: '#009689', strokeWidth: 2 }}
                activeDot={{ r: 5.5, fill: '#009689', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          ) : type === 'line' ? (
            <LineChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 6" stroke={GRID} vertical={false} />
              <XAxis dataKey={nameKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} dy={6} />
              <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke="#009689"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#fff', stroke: '#009689', strokeWidth: 2 }}
                activeDot={{ r: 5.5, fill: '#009689', stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="47%"
                innerRadius={56}
                outerRadius={82}
                paddingAngle={4}
                stroke="#fff"
                strokeWidth={2}
                dataKey={dataKey}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={SERIES[index % SERIES.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipProps} />
              <Legend
                verticalAlign="bottom"
                height={30}
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span style={{ color: '#5b706f', fontSize: 11.5 }}>{v}</span>}
              />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </DataCard>
  );
}
