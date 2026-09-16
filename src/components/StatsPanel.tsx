import { useState } from 'react';
import { ChevronDown, ChevronUp, BarChart3, AlertTriangle } from 'lucide-react';
import { ServiceCard } from './ServiceCard';
import { MonthlySlaTable } from './MonthlySlaTable';
import { OutageList } from './OutageList';
import type { ServiceStats, MonthlySla, Outage, Upload } from '../lib/types';
import { formatDate, formatUptime } from '../lib/utils';

interface Props {
  serviceStats: ServiceStats[];
  monthly: MonthlySla[];
  outages: Outage[];
  upload: Upload | null;
  /** Human-readable description of the window serviceStats covers. */
  scopeLabel: string;
  filtered: boolean;
}

export function StatsPanel({
  serviceStats,
  monthly,
  outages,
  upload,
  scopeLabel,
  filtered,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const breaching = serviceStats.filter((s) => !s.sla_met).length;

  // Weighted by check count, not a mean of per-service percentages: services
  // can have different check counts once duplicates are removed, and averaging
  // percentages would quietly weight a thin service the same as a busy one.
  const totalChecks = serviceStats.reduce((n, s) => n + s.total_checks, 0);
  const totalHealthy = serviceStats.reduce((n, s) => n + s.healthy_checks, 0);
  const overallUptime = totalChecks > 0 ? (totalHealthy / totalChecks) * 100 : 100;

  const maxCredit = monthly.reduce((m, r) => Math.max(m, r.credit_pct), 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">SLA Overview</h2>
        </div>
        <div className="flex items-center gap-4">
          {breaching > 0 && (
            <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2.5 py-1 rounded-full">
              <AlertTriangle className="w-3.5 h-3.5" />
              {breaching} SLA breached
            </span>
          )}
          <span
            className={`text-sm font-semibold ${
              overallUptime >= 99.9 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {formatUptime(overallUptime)} overall
          </span>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-6">
          {upload && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-blue-600 text-xs font-medium">
                  Monitoring Period
                </p>
                <p className="font-semibold text-blue-900">
                  {formatDate(upload.date_range_start)} &mdash;{' '}
                  {formatDate(upload.date_range_end)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs font-medium">Services</p>
                <p className="font-semibold text-gray-900">
                  {serviceStats.length}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs font-medium">Clean rows</p>
                <p className="font-semibold text-gray-900">
                  {upload.cleaned_rows.toLocaleString()}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 ${
                  maxCredit > 0 ? 'bg-red-50' : 'bg-green-50'
                }`}
              >
                <p
                  className={`text-xs font-medium ${
                    maxCredit > 0 ? 'text-red-600' : 'text-green-600'
                  }`}
                >
                  Max monthly credit
                </p>
                <p
                  className={`font-semibold ${
                    maxCredit > 0 ? 'text-red-900' : 'text-green-900'
                  }`}
                >
                  {maxCredit > 0 ? `${maxCredit}% owed` : 'None owed'}
                </p>
              </div>
            </div>
          )}

          <MonthlySlaTable rows={monthly} />

          <OutageList outages={outages} />

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">
                Per-service detail
              </h3>
              <span
                className={`text-xs ${
                  filtered ? 'text-blue-600 font-medium' : 'text-gray-400'
                }`}
              >
                {scopeLabel}
              </span>
            </div>

            {serviceStats.length === 0 ? (
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                No checks in the selected date range.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {serviceStats.map((s) => (
                  <ServiceCard key={s.service_id} stats={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
