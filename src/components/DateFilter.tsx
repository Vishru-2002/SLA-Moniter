import { Calendar } from 'lucide-react';
import type { DateFilter as DateFilterType } from '../lib/types';

interface Props {
  filter: DateFilterType;
  onChange: (filter: DateFilterType) => void;
  minDate?: string;
  maxDate?: string;
}

export function DateFilter({ filter, onChange, minDate, maxDate }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Calendar className="w-4 h-4 text-gray-500" />

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
        <button
          onClick={() =>
            onChange({ mode: 'single', date: filter.date || filter.startDate })
          }
          className={`px-3 py-1.5 ${
            filter.mode === 'single'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Single Date
        </button>
        <button
          onClick={() =>
            onChange({
              mode: 'range',
              startDate: filter.startDate || filter.date,
              endDate: filter.endDate,
            })
          }
          className={`px-3 py-1.5 ${
            filter.mode === 'range'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Date Range
        </button>
      </div>

      {/* Date inputs */}
      {filter.mode === 'single' ? (
        <input
          type="date"
          value={filter.date || ''}
          min={minDate}
          max={maxDate}
          onChange={(e) => onChange({ ...filter, date: e.target.value })}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filter.startDate || ''}
            min={minDate}
            max={maxDate}
            onChange={(e) =>
              onChange({ ...filter, startDate: e.target.value })
            }
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={filter.endDate || ''}
            min={minDate}
            max={maxDate}
            onChange={(e) =>
              onChange({ ...filter, endDate: e.target.value })
            }
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
      )}

      {/* Clear filter */}
      {(filter.date || filter.startDate || filter.endDate) && (
        <button
          onClick={() => onChange({ mode: filter.mode })}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}
