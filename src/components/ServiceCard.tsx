import { CheckCircle, XCircle, Activity } from 'lucide-react';
import type { ServiceStats } from '../lib/types';
import { formatUptime, formatLatency, formatDate } from '../lib/utils';

interface Props {
  stats: ServiceStats;
}

export function ServiceCard({ stats }: Props) {
  const slaColor = stats.sla_met
    ? 'border-green-200 bg-green-50/30'
    : 'border-red-200 bg-red-50/30';

  return (
    <div
      className={`border rounded-xl p-5 ${slaColor} transition-shadow hover:shadow-md`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{stats.service_name}</h3>
          <p className="text-xs text-gray-500">{stats.service_id}</p>
        </div>
        {stats.sla_met ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full whitespace-nowrap">
            <CheckCircle className="w-3.5 h-3.5" /> SLA Met
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2.5 py-1 rounded-full whitespace-nowrap">
            <XCircle className="w-3.5 h-3.5" /> SLA Breached
          </span>
        )}
      </div>

      <div className="mb-3 flex items-baseline gap-2 flex-wrap">
        <span
          className={`text-3xl font-bold ${
            stats.sla_met ? 'text-green-700' : 'text-red-700'
          }`}
        >
          {formatUptime(stats.uptime_pct)}
        </span>
        <span className="text-sm text-gray-500">uptime</span>
        {stats.credit_pct > 0 && (
          <span className="text-xs font-semibold text-orange-800 bg-orange-100 px-2 py-0.5 rounded">
            {stats.credit_pct}% credit
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="bg-white/70 rounded-lg p-2">
          <p className="text-gray-500">Total</p>
          <p className="font-semibold">{stats.total_checks.toLocaleString()}</p>
        </div>
        <div className="bg-white/70 rounded-lg p-2">
          <p className="text-gray-500">Healthy</p>
          <p className="font-semibold text-green-600">
            {stats.healthy_checks.toLocaleString()}
          </p>
        </div>
        <div className="bg-white/70 rounded-lg p-2">
          <p className="text-gray-500">Failed</p>
          <p className="font-semibold text-red-600">
            {stats.failed_checks.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-600 mb-2">
        <Activity className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          p50 {formatLatency(stats.p50_latency_ms)} &middot; p95{' '}
          {formatLatency(stats.p95_latency_ms)} &middot; p99{' '}
          {formatLatency(stats.p99_latency_ms)}
        </span>
      </div>

      {stats.worst_day && (
        <div className="text-xs text-gray-500">
          Worst day: {formatDate(stats.worst_day)} ({stats.worst_day_failures}{' '}
          failures)
        </div>
      )}

      {stats.invalid_status_checks > 0 && (
        <div className="text-xs text-purple-700 mt-1">
          {stats.invalid_status_checks} non-HTTP status code
          {stats.invalid_status_checks > 1 ? 's' : ''} (counted as failures)
        </div>
      )}
    </div>
  );
}
