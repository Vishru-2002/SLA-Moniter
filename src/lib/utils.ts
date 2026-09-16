import { format, parseISO } from 'date-fns';

export function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}

export function formatMonth(iso: string): string {
  try {
    return format(parseISO(iso), 'MMMM yyyy');
  } catch {
    return iso;
  }
}

export function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm');
  } catch {
    return iso;
  }
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
