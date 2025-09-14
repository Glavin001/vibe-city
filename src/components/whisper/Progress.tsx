import React from 'react';

function formatBytes(size: number): string {
  const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  return +(size / Math.pow(1024, i)).toFixed(2) * 1 + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

interface ProgressProps {
  text: string;
  percentage?: number;
  total?: number;
}

export function Progress({ text, percentage = 0, total }: ProgressProps) {
  return (
    <div className="w-full bg-gray-100 dark:bg-gray-700 text-left rounded-lg overflow-hidden mb-0.5">
      <div className="bg-blue-400 whitespace-nowrap px-1 text-sm" style={{ width: `${percentage}%` }}>
        {text} ({percentage.toFixed(2)}%{isNaN(total as number) ? '' : ` of ${formatBytes(total as number)}`})
      </div>
    </div>
  );
}