// ---------------------------------------------------------------------------
// Date/time rendering — everything is displayed in UTC.
//
// The whole pipeline is UTC: check_time is stored UTC, the SQL anchors windows
// with AT TIME ZONE 'UTC', and monthly buckets and worst-day are computed in
// UTC. Rendering with the browser's local clock therefore made the table
// disagree with the filters -- at +05:30 a check stored 19:45Z displayed as
// "May 9, 01:15", so filtering to May 8 returned rows labelled May 9. These
// read UTC components explicitly so there is no offset to get wrong.
//
// A bare YYYY-MM-DD (worst_day, month, date_range_*) carries no time and must
// NOT be shifted: parsing it as local midnight and re-reading it as UTC moves
// it back a day for any positive offset. It is anchored at UTC midnight instead.
// ---------------------------------------------------------------------------
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(DATE_ONLY.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** e.g. "May 8, 2025" (UTC). */
export function formatDate(iso: string): string {
  const d = utcDate(iso);
  if (!d) return iso;
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** 24-hour clock with seconds, e.g. "May 8, 2025 19:45:00" (UTC). */
export function formatDateTime(iso: string): string {
  const d = utcDate(iso);
  if (!d) return iso;
  return (
    `${formatDate(iso)} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** e.g. "May 2025" (UTC). */
export function formatMonth(iso: string): string {
  const d = utcDate(iso);
  if (!d) return iso;
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 24-hour clock, e.g. "19:45" (UTC). */
export function formatTime(iso: string): string {
  const d = utcDate(iso);
  if (!d) return iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatUptime(pct: number | null): string {
  if (pct === null || pct === undefined) return '—';
  return `${pct.toFixed(3)}%`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function getStatusBg(code: number): string {
  if (code >= 200 && code < 300) return 'bg-green-50 text-green-700';
  if (code >= 300 && code < 400) return 'bg-blue-50 text-blue-700';
  if (code >= 400 && code < 500) return 'bg-yellow-50 text-yellow-700';
  if (code >= 500 && code < 600) return 'bg-red-50 text-red-700';
  // 999 and friends: not a real HTTP code at all
  return 'bg-purple-50 text-purple-700';
}

/**
 * Postgres `numeric` can arrive as a string depending on how the value is
 * serialised on the way out. Everything downstream does arithmetic on these,
 * so coerce once at the boundary rather than sprinkling Number() around.
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function numOr0(v: unknown): number {
  return num(v) ?? 0;
}
