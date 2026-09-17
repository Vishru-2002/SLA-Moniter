import { Flame, ShieldCheck, HelpCircle } from 'lucide-react';
import type { Outage } from '../lib/types';
import { formatDate, formatTime, formatDuration } from '../lib/utils';

interface Props {
  /** null = not loaded. Distinct from [], which means "none were detected". */
  outages: Outage[] | null;
}

/**
 * Incidents, as detected server-side by service_outages() (migration 003):
 * a sliding 5-check window whose failure rate exceeds 50%, with overlapping
 * windows merged into one incident.
 *
 * This is the stat that separates a real outage from background noise. Both
 * look identical in a raw uptime percentage -- 40 scattered failures and 40
 * consecutive ones give the same number, but only one of them is an incident
 * somebody got paged for.
 */
export function OutageList({ outages }: Props) {
  // "No outages" is a claim about the data, so it is only made when the query
  // actually returned. If it did not, say so rather than implying an all-clear.
  if (outages === null) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Detected incidents
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <HelpCircle className="w-4 h-4 text-gray-400" />
          Incident detection did not return &mdash; this is not an all-clear.
        </div>
      </div>
    );
  }

  if (outages.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Detected incidents
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <ShieldCheck className="w-4 h-4 text-green-600" />
          No sustained outage windows. Failures in this period are scattered,
          not clustered.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Detected incidents
        </h3>
        <span className="text-xs text-gray-400">
          sliding 5-check window, &gt;50% failure rate &middot; times UTC
        </span>
      </div>

      <div className="space-y-2">
        {outages.map((o) => (
          <div
            key={`${o.service_id}-${o.started_at}`}
            className="flex items-center gap-3 border border-red-200 bg-red-50/40 rounded-lg p-3 text-sm"
          >
            <Flame className="w-4 h-4 text-red-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">
                {o.service_name}
                <span className="ml-2 text-xs font-normal text-gray-500">
                  {formatDate(o.started_at)} &middot; {formatTime(o.started_at)}
                  &ndash;{formatTime(o.ended_at)}
                </span>
              </p>
              <p className="text-xs text-gray-600">
                {o.failed_checks} of {o.checks_in_window} checks failed (
                {o.failure_rate}% failure rate)
              </p>
            </div>
            <span className="text-sm font-semibold text-red-700 whitespace-nowrap">
              {formatDuration(o.duration_minutes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
