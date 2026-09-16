import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { UploadListItem } from '../lib/types';
import { num, numOr0 } from '../lib/utils';

/**
 * Every upload that has been processed, newest first. Without this the only way
 * back to an upload is remembering its UUID.
 */
export function useUploads(limit = 10) {
  const [uploads, setUploads] = useState<UploadListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('upload_summaries')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    setUploads(
      ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        ...(r as unknown as UploadListItem),
        service_count: numOr0(r.service_count),
        worst_uptime_pct: num(r.worst_uptime_pct),
        breaching_count: numOr0(r.breaching_count),
      }))
    );
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { uploads, loading, reload: load };
}
