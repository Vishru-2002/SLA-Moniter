import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { filterBounds } from '../lib/types';
import type { DateFilter, ServiceStats, MonthlySla, Outage } from '../lib/types';
import { num, numOr0 } from '../lib/utils';

function toStats(r: Record<string, unknown>): ServiceStats {
  return {
    service_id: String(r.service_id),
    service_name: String(r.service_name),
    total_checks: numOr0(r.total_checks),
    healthy_checks: numOr0(r.healthy_checks),
    failed_checks: numOr0(r.failed_checks),
    invalid_status_checks: numOr0(r.invalid_status_checks),
    uptime_pct: numOr0(r.uptime_pct),
    sla_met: Boolean(r.sla_met),
    credit_pct: numOr0(r.credit_pct),
    avg_latency_ms: num(r.avg_latency_ms),
    p50_latency_ms: num(r.p50_latency_ms),
    p95_latency_ms: num(r.p95_latency_ms),
    p99_latency_ms: num(r.p99_latency_ms),
    worst_day: r.worst_day ? String(r.worst_day) : null,
    worst_day_failures: numOr0(r.worst_day_failures),
  };
}

/**
 * All SLA analytics for one upload. Every number here is computed by Postgres
 * (see migration 002) rather than in the browser, so the dashboard fetches a
 * few dozen aggregate rows instead of every check in the upload.
 *
 * Scoping, deliberately not uniform:
 *  - per-service stats follow the dashboard's date filter, so "what did last
 *    Tuesday look like" is answerable;
 *  - monthly SLA and the incident list are always whole-upload. A billing
 *    credit is settled per calendar month, so recomputing it from a filtered
 *    slice would produce a number that means nothing.
 */
export function useSlaStats(uploadId: string | null, dateFilter: DateFilter) {
  const [stats, setStats] = useState<ServiceStats[]>([]);
  const [allServices, setAllServices] = useState<{ id: string; name: string }[]>([]);
  const [monthly, setMonthly] = useState<MonthlySla[]>([]);
  const [outages, setOutages] = useState<Outage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = filterBounds(dateFilter);

  // Filtered per-service stats
  useEffect(() => {
    if (!uploadId) return;
    let cancelled = false;
    setLoading(true);

    supabase
      .rpc('service_stats', {
        p_upload_id: uploadId,
        p_start: start,
        p_end: end,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else {
          setStats((data ?? []).map(toStats));
          setError(null);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uploadId, start, end]);

  // Whole-upload data: service list for the dropdown, monthly SLA, incidents
  useEffect(() => {
    if (!uploadId) return;
    let cancelled = false;

    Promise.all([
      supabase.rpc('service_stats', { p_upload_id: uploadId }),
      supabase.rpc('monthly_sla', { p_upload_id: uploadId }),
      supabase.rpc('service_outages', { p_upload_id: uploadId }),
    ]).then(([statsRes, monthlyRes, outageRes]) => {
      if (cancelled) return;

      const rows = (statsRes.data ?? []) as Record<string, unknown>[];
      setAllServices(
        rows.map((r) => ({ id: String(r.service_id), name: String(r.service_name) }))
          .sort((a, b) => a.id.localeCompare(b.id))
      );

      setMonthly(
        ((monthlyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          service_id: String(r.service_id),
          service_name: String(r.service_name),
          month: String(r.month),
          total_checks: numOr0(r.total_checks),
          healthy_checks: numOr0(r.healthy_checks),
          failed_checks: numOr0(r.failed_checks),
          uptime_pct: numOr0(r.uptime_pct),
          sla_met: Boolean(r.sla_met),
          credit_pct: numOr0(r.credit_pct),
          days_covered: numOr0(r.days_covered),
          days_in_month: numOr0(r.days_in_month),
          is_partial_month: Boolean(r.is_partial_month),
        }))
      );

      setOutages(
        ((outageRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          service_id: String(r.service_id),
          service_name: String(r.service_name),
          started_at: String(r.started_at),
          ended_at: String(r.ended_at),
          duration_minutes: numOr0(r.duration_minutes),
          checks_in_window: numOr0(r.checks_in_window),
          failed_checks: numOr0(r.failed_checks),
          failure_rate: numOr0(r.failure_rate),
        }))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [uploadId]);

  return { stats, allServices, monthly, outages, loading, error };
}
