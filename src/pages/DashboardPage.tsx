import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useChecks } from '../hooks/useChecks';
import { useSlaStats } from '../hooks/useSlaStats';
import { StatsPanel } from '../components/StatsPanel';
import { DateFilter } from '../components/DateFilter';
import { LogsTable } from '../components/LogsTable';
import { filterBounds } from '../lib/types';
import type { DateFilter as DateFilterType } from '../lib/types';
import { formatDate } from '../lib/utils';

export function DashboardPage() {
  const { uploadId } = useParams<{ uploadId: string }>();

  // Filter state lives here so the stats section and the logs table stay in
  // step -- previously the stats ignored the filter entirely.
  const [dateFilter, setDateFilter] = useState<DateFilterType>({ mode: 'range' });
  const [serviceFilter, setServiceFilter] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [dateFilter, serviceFilter]);

  const { checks, upload, totalCount, totalPages, loading: logsLoading } =
    useChecks(uploadId || null, dateFilter, serviceFilter, page);

  const { stats, allServices, monthly, outages, loading: statsLoading, error } =
    useSlaStats(uploadId || null, dateFilter);

  const { start, end } = filterBounds(dateFilter);
  const filtered = Boolean(start || end);

  const scopeLabel = useMemo(() => {
    if (!filtered) return 'whole upload';
    if (start && end) {
      return start === end
        ? formatDate(`${start}T00:00:00Z`)
        : `${formatDate(`${start}T00:00:00Z`)} — ${formatDate(`${end}T00:00:00Z`)}`;
    }
    if (start) return `from ${formatDate(`${start}T00:00:00Z`)}`;
    return `up to ${formatDate(`${end}T00:00:00Z`)}`;
  }, [filtered, start, end]);

  if (statsLoading && stats.length === 0 && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4 mb-6">
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Upload
          </Link>
          <h1 className="text-xl font-bold text-gray-900">
            SLA Dashboard
            {upload && (
              <span className="text-sm font-normal text-gray-500 ml-2">
                &mdash; {upload.filename}
              </span>
            )}
          </h1>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
            <strong>Could not load stats:</strong> {error}
          </div>
        )}

        <div className="mb-6">
          <StatsPanel
            serviceStats={stats}
            monthly={monthly}
            outages={outages}
            upload={upload}
            scopeLabel={scopeLabel}
            filtered={filtered}
          />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Check Logs
          </h2>

          <div className="flex flex-wrap items-center gap-4 mb-4 pb-4 border-b border-gray-100">
            <DateFilter
              filter={dateFilter}
              onChange={setDateFilter}
              minDate={upload?.date_range_start}
              maxDate={upload?.date_range_end}
            />

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">All services</option>
              {allServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <LogsTable
            checks={checks}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            loading={logsLoading}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
}
