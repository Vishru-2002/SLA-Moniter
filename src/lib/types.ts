export interface Upload {
  id: string;
  filename: string;
  total_rows: number;
  cleaned_rows: number;
  duplicates_removed: number;
  issues: Issues;
  date_range_start: string;
  date_range_end: string;
  uploaded_at: string;
  partial_failure: boolean;
  failed_rows: number;
}

/** Row from the `upload_summaries` view, used by the upload index. */
export interface UploadListItem extends Upload {
  service_count: number;
  worst_uptime_pct: number | null;
  breaching_count: number;
}

export interface Issues {
  unix_timestamps_converted: number;
  latency_unit_normalized: number;
  missing_latency: number;
  negative_latency: number;
  invalid_status_codes: number;
  duplicates_removed: number;
  duplicate_status_conflicts: number;
}

export interface MonitoringCheck {
  id: number;
  upload_id: string;
  service_id: string;
  service_name: string;
  check_time: string;
  status_code: number;
  latency_ms: number | null;
  original_latency: string;
  original_unit: string;
  agent: string;
  region: string;
  is_healthy: boolean;
  is_valid_status: boolean;
}

/** Row from the `service_stats(upload_id, start, end)` RPC. */
export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_checks: number;
  healthy_checks: number;
  failed_checks: number;
  invalid_status_checks: number;
  uptime_pct: number;
  sla_met: boolean;
  credit_pct: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p99_latency_ms: number | null;
  worst_day: string | null;
  worst_day_failures: number;
}

/** Row from the `monthly_sla(upload_id)` RPC. */
export interface MonthlySla {
  service_id: string;
  service_name: string;
  month: string;
  total_checks: number;
  healthy_checks: number;
  failed_checks: number;
  uptime_pct: number;
  sla_met: boolean;
  credit_pct: number;
  days_covered: number;
  days_in_month: number;
  is_partial_month: boolean;
}

/** Row from the `service_outages(upload_id, window, threshold)` RPC. */
export interface Outage {
  service_id: string;
  service_name: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  checks_in_window: number;
  failed_checks: number;
  failure_rate: number;
}

export interface UploadSummary {
  success: boolean;
  upload_id: string;
  partial_failure: boolean;
  failed_rows: number;
  summary: {
    filename: string;
    total_rows_received: number;
    rows_after_cleaning: number;
    rows_inserted: number;
    date_range: { start: string; end: string };
    services: string[];
    issues_found: Issues;
  };
}

export type DateFilterMode = 'single' | 'range';

export interface DateFilter {
  mode: DateFilterMode;
  date?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Resolve a DateFilter to the inclusive [start, end] date pair the SQL
 * functions expect. Either bound may be null, meaning "unbounded".
 */
export function filterBounds(f: DateFilter): {
  start: string | null;
  end: string | null;
} {
  if (f.mode === 'single') {
    return { start: f.date || null, end: f.date || null };
  }
  return { start: f.startDate || null, end: f.endDate || null };
}
