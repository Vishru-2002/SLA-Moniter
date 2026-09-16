import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { filterBounds } from '../lib/types';
import type { MonitoringCheck, DateFilter, Upload } from '../lib/types';

const PAGE_SIZE = 50;

/**
 * The logs table: one page of raw checks at a time.
 *
 * This deliberately does NOT load the whole upload. Aggregates come from the
 * SQL functions in useSlaStats; this hook only ever holds PAGE_SIZE rows.
 */
export function useChecks(
  uploadId: string | null,
  dateFilter: DateFilter,
  serviceFilter: string,
  page: number
) {
  const [checks, setChecks] = useState<MonitoringCheck[]>([]);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uploadId) return;
    supabase
      .from('uploads')
      .select('*')
      .eq('id', uploadId)
      .maybeSingle()
      .then(({ data }) => setUpload((data as Upload) ?? null));
  }, [uploadId]);

  const { start, end } = filterBounds(dateFilter);

  const fetchPage = useCallback(async () => {
    if (!uploadId) return;
    setLoading(true);

    let query = supabase
      .from('monitoring_checks')
      .select('*', { count: 'exact' })
      .eq('upload_id', uploadId)
      .order('check_time', { ascending: true })
      .order('service_id', { ascending: true });

    // Bounds are built in UTC to match how check_time is stored. `end` is an
    // inclusive date, so compare against the start of the following day.
    if (start) query = query.gte('check_time', `${start}T00:00:00Z`);
    if (end) {
      const next = new Date(`${end}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      query = query.lt('check_time', next.toISOString());
    }
    if (serviceFilter) query = query.eq('service_id', serviceFilter);

    const from = page * PAGE_SIZE;
    const { data, count } = await query.range(from, from + PAGE_SIZE - 1);

    setChecks((data as MonitoringCheck[]) ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [uploadId, start, end, serviceFilter, page]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  return {
    checks,
    upload,
    totalCount,
    loading,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(totalCount / PAGE_SIZE),
  };
}
