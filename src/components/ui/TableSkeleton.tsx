import React from 'react';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({ rows = 5, columns = 5 }) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
        <div className="h-4 w-36 rounded bg-slate-200 animate-pulse" />
        <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="px-5 py-3.5 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((__, cIdx) => (
              <div
                key={cIdx}
                className={`h-4 rounded bg-slate-100 animate-pulse ${cIdx === 0 ? 'w-4/5' : 'w-3/5'}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export const OverviewSkeleton: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="h-3.5 w-28 rounded bg-slate-100 animate-pulse" />
            <div className="h-8 w-20 rounded bg-slate-200 animate-pulse" />
            <div className="h-3 w-36 rounded bg-slate-100 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 rounded-xl border border-slate-200 bg-white p-5 animate-pulse" />
        <div className="h-80 rounded-xl border border-slate-200 bg-white p-5 animate-pulse" />
      </div>
    </div>
  );
};
