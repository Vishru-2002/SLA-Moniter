/**
 * Pure parsing/cleaning logic for the upload pipeline.
 *
 * Kept separate from index.ts (the HTTP handler) so it has no dependency on
 * Deno, the network or the database, and can therefore be imported directly by
 * scripts/verify-sql.mjs. The verification scripts exercise this exact code
 * rather than a reimplementation of it.
 */

export interface RawRow {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: string;
  latency: string;
  latency_unit: string;
  agent: string;
  region: string;
}

export interface CleanedRow {
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

export interface Issues {
  unix_timestamps_converted: number;
  latency_unit_normalized: number;
  missing_latency: number;
  negative_latency: number;
  invalid_status_codes: number;
  duplicates_removed: number;
  duplicate_status_conflicts: number;
  rejected_rows: number;
}

/** A row that could not be cleaned, kept so the upload can report it. */
export interface RejectedRow {
  /** 1-based line number in the source file (line 1 is the header). */
  line: number;
  reason: string;
  value: string;
}

export const REQUIRED_COLUMNS = [
  'service_id',
  'service_name',
  'timestamp',
  'status_code',
  'latency',
  'latency_unit',
  'agent',
  'region',
] as const;

const VALID_HTTP_CODES = new Set([
  200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 408, 429, 500, 502,
  503, 504,
]);

/**
 * Minimal CSV reader: splits on commas, no quoted-field support.
 *
 * That is sufficient for this data -- none of the sample files contain quoted
 * fields, embedded newlines or a BOM -- but it is a real limitation and is
 * called out in the README rather than left to be discovered.
 */
export function parseCSV(text: string): RawRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(',').map((h) => h.trim());
  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row as unknown as RawRow);
  }

  return rows;
}

export function missingColumns(rows: RawRow[]): string[] {
  if (rows.length === 0) return [...REQUIRED_COLUMNS];
  const first = rows[0] as unknown as Record<string, string>;
  return REQUIRED_COLUMNS.filter((col) => !(col in first));
}

/**
 * The timestamp column mixes three formats: ISO-8601 UTC, bare Unix epoch
 * seconds, and ISO-8601 with a +05:30 offset. All three are normalised to an
 * absolute UTC instant here, before deduplication -- which matters, because
 * some duplicate pairs are written in *different* formats and would not match
 * each other as raw strings.
 */
/**
 * Returns null rather than throwing on an unparseable value. A single bad
 * timestamp used to take the whole upload down with it: new Date() produced an
 * Invalid Date, .toISOString() threw, and the error reached the top-level
 * handler. One malformed row in 15,000 is not a reason to reject the other
 * 14,999 -- it is quarantined and reported instead.
 */
export function convertTimestamp(
  ts: string
): { iso: string; wasUnix: boolean } | null {
  const raw = ts?.trim();
  if (!raw) return null;

  if (/^\d{9,11}$/.test(raw)) {
    const epoch = parseInt(raw, 10);
    const d = new Date(epoch * 1000);
    return Number.isNaN(d.getTime())
      ? null
      : { iso: d.toISOString(), wasUnix: true };
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? null
    : { iso: d.toISOString(), wasUnix: false };
}

export function cleanRows(rawRows: RawRow[]): {
  cleaned: CleanedRow[];
  issues: Issues;
  rejected: RejectedRow[];
} {
  const issues: Issues = {
    unix_timestamps_converted: 0,
    latency_unit_normalized: 0,
    missing_latency: 0,
    negative_latency: 0,
    invalid_status_codes: 0,
    duplicates_removed: 0,
    duplicate_status_conflicts: 0,
    rejected_rows: 0,
  };

  const cleaned: CleanedRow[] = [];
  const rejected: RejectedRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]!;

    // 1. Timestamp -> UTC. An unparseable value quarantines just this row.
    const ts = convertTimestamp(raw.timestamp);
    if (!ts) {
      issues.rejected_rows++;
      rejected.push({
        line: i + 2, // +1 for the header, +1 for 1-based lines
        reason: raw.timestamp?.trim()
          ? 'unparseable timestamp'
          : 'missing timestamp',
        value: (raw.timestamp ?? '').slice(0, 64),
      });
      continue;
    }
    const { iso, wasUnix } = ts;
    if (wasUnix) issues.unix_timestamps_converted++;

    // 2. Status code. 999 appears once per file and is not an HTTP code; it is
    //    flagged, and counts as a failed check because it is not evidence the
    //    service was up.
    let statusCode = parseInt(raw.status_code, 10);
    if (isNaN(statusCode)) statusCode = 0;
    const isValidStatus = VALID_HTTP_CODES.has(statusCode);
    if (!isValidStatus) issues.invalid_status_codes++;

    // 3. Latency -> milliseconds. Missing and negative are tracked separately:
    //    absence is not the same failure mode as corruption.
    let latencyMs: number | null = null;
    const rawLatency = raw.latency?.trim();

    if (!rawLatency) {
      issues.missing_latency++;
    } else {
      let val = parseFloat(rawLatency);
      if (isNaN(val)) {
        issues.missing_latency++;
      } else if (val < 0) {
        issues.negative_latency++;
      } else {
        if (raw.latency_unit?.trim().toLowerCase() === 's') {
          issues.latency_unit_normalized++;
          val = val * 1000;
        }
        latencyMs = Math.round(val * 100) / 100;
      }
    }

    cleaned.push({
      service_id: raw.service_id?.trim(),
      service_name: raw.service_name?.trim(),
      check_time: iso,
      status_code: statusCode,
      latency_ms: latencyMs,
      original_latency: rawLatency || '',
      original_unit: raw.latency_unit?.trim() || '',
      agent: raw.agent?.trim(),
      region: raw.region?.trim(),
      is_healthy: statusCode >= 200 && statusCode < 400,
      is_valid_status: isValidStatus,
    });
  }

  // 4. Deduplicate on (service_id, check_time), AFTER normalisation.
  //
  //    Tie-break, in order:
  //      a. prefer a valid HTTP status over a sentinel like 999. The agents
  //         usually agree, but where they disagree it is because one failed to
  //         record a real code, and the real code is the better evidence of
  //         whether the service was actually up;
  //      b. then prefer the row that carries a latency.
  const seen = new Map<string, number>();
  const deduped: CleanedRow[] = [];

  for (const row of cleaned) {
    const key = `${row.service_id}|${row.check_time}`;
    const existingIdx = seen.get(key);

    if (existingIdx === undefined) {
      seen.set(key, deduped.length);
      deduped.push(row);
      continue;
    }

    issues.duplicates_removed++;
    const kept = deduped[existingIdx]!;

    if (kept.status_code !== row.status_code) {
      issues.duplicate_status_conflicts++;
    }

    const preferForStatus = !kept.is_valid_status && row.is_valid_status;
    const preferForLatency =
      kept.is_valid_status === row.is_valid_status &&
      kept.latency_ms === null &&
      row.latency_ms !== null;

    if (preferForStatus || preferForLatency) {
      deduped[existingIdx] = row;
    }
  }

  // 5. Chronological order. The outage detector is sequence-sensitive, and the
  //    source rows arrive shuffled.
  deduped.sort(
    (a, b) => new Date(a.check_time).getTime() - new Date(b.check_time).getTime()
  );

  return { cleaned: deduped, issues, rejected };
}

/** Inclusive UTC date range (YYYY-MM-DD) spanned by the cleaned rows. */
export function dateRange(cleaned: CleanedRow[]): { start: string; end: string } {
  let min = Infinity;
  let max = -Infinity;
  // A reduce rather than Math.min(...array): the spread form blows the call
  // stack on large uploads.
  for (const row of cleaned) {
    const t = new Date(row.check_time).getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return {
    start: new Date(min).toISOString().split('T')[0]!,
    end: new Date(max).toISOString().split('T')[0]!,
  };
}
