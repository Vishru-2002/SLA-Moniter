import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { MonitoringCheck } from '../lib/types';
import { formatDateTime, formatLatency, getStatusBg } from '../lib/utils';

interface Props {
  checks: MonitoringCheck[];
  page: number;
  totalPages: number;
  totalCount: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
}

export function LogsTable({
  checks,
  page,
  totalPages,
  totalCount,
  loading = false,
  onPageChange,
}: Props) {
  if (checks.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading records&hellip;
          </>
        ) : (
          'No records found for the selected filters.'
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Time
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Service
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Status
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Latency
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Agent
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">
                Region
              </th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr
                key={check.id}
                className="border-b border-gray-100 hover:bg-gray-50"
              >
                <td className="py-2.5 px-4 text-gray-700 whitespace-nowrap">
                  {formatDateTime(check.check_time)}
                </td>
                <td className="py-2.5 px-4">
                  <span className="font-medium text-gray-900">
                    {check.service_name}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getStatusBg(check.status_code)}`}
                  >
                    {check.status_code}
                  </span>
                </td>
                <td
                  className="py-2.5 px-4 text-gray-700"
                  /* provenance: what the agent actually reported, before
                     unit normalisation or nulling-out */
                  title={
                    check.original_latency
                      ? `reported: ${check.original_latency} ${check.original_unit}`
                      : 'not reported'
                  }
                >
                  {formatLatency(check.latency_ms)}
                  {check.latency_ms === null && check.original_latency && (
                    <span className="ml-1 text-xs text-amber-600">
                      (bad value)
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-gray-500">{check.agent}</td>
                <td className="py-2.5 px-4 text-gray-500">{check.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm">
        <span className="text-gray-500">
          {totalCount.toLocaleString()} records total
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 0}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-gray-600">
            Page {page + 1} of {Math.max(1, totalPages)}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
