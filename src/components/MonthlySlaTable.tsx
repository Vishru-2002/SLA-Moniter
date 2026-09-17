import { AlertCircle } from 'lucide-react';
import type { MonthlySla } from '../lib/types';
import { formatMonth, formatUptime } from '../lib/utils';

interface Props {
  /** null = not loaded. Distinct from [], which means "no months to report". */
  rows: MonthlySla[] | null;
}

function creditBadge(pct: number) {
  if (pct === 0) return 'bg-green-100 text-green-700';
  if (pct <= 10) return 'bg-yellow-100 text-yellow-800';
  if (pct <= 25) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-700';
}

/**
 * The billing view. The SLA in the brief is a *monthly* availability
 * guarantee, so uptime is bucketed by calendar month rather than rolled up
 * over whatever window the uploaded file happens to cover.
 */
export function MonthlySlaTable({ rows }: Props) {
  // A failed query must not silently remove the billing section: an absent
  // table reads as "nothing owed", which is the one conclusion it cannot draw.
  if (rows === null) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Monthly SLA &amp; billing credit
        </h3>
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          Monthly SLA could not be loaded. No credit conclusion can be drawn
          from this view.
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  const months = [...new Set(rows.map((r) => r.month))];
  const anyPartial = rows.some((r) => r.is_partial_month);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Monthly SLA &amp; billing credit
        </h3>
        <span className="text-xs text-gray-400">
          {months.length} month{months.length > 1 ? 's' : ''} covered
        </span>
      </div>

      {anyPartial && (
        <div className="flex gap-2 mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <p>
            Months marked <strong>partial</strong> are not fully covered by this
            upload. Their uptime is real, but it is not a settled monthly SLA
            result &mdash; the rest of the month is simply not in the data.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500">
              <th className="text-left font-medium py-2 pr-4">Month</th>
              <th className="text-left font-medium py-2 pr-4">Service</th>
              <th className="text-right font-medium py-2 pr-4">Checks</th>
              <th className="text-right font-medium py-2 pr-4">Failed</th>
              <th className="text-right font-medium py-2 pr-4">Uptime</th>
              <th className="text-left font-medium py-2 pr-4">Coverage</th>
              <th className="text-right font-medium py-2">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.month}-${r.service_id}`}
                className="border-b border-gray-100"
              >
                <td className="py-2 pr-4 whitespace-nowrap text-gray-700">
                  {formatMonth(r.month)}
                </td>
                <td className="py-2 pr-4 font-medium text-gray-900">
                  {r.service_name}
                </td>
                <td className="py-2 pr-4 text-right text-gray-600">
                  {r.total_checks.toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right text-gray-600">
                  {r.failed_checks.toLocaleString()}
                </td>
                <td
                  className={`py-2 pr-4 text-right font-semibold ${
                    r.sla_met ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {formatUptime(r.uptime_pct)}
                </td>
                <td className="py-2 pr-4 text-xs whitespace-nowrap">
                  <span className="text-gray-500">
                    {r.days_covered}/{r.days_in_month}d
                  </span>
                  {r.is_partial_month && (
                    <span className="ml-1.5 text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      partial
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${creditBadge(
                      r.credit_pct
                    )}`}
                  >
                    {r.credit_pct}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
