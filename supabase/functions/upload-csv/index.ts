import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseCSV, missingColumns, cleanRows, dateRange } from './clean.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Upload size guard. The whole file is read into memory, so an unbounded
 * upload is a way to knock the function over. The largest sample file is
 * ~1 MB; 25 MB leaves generous headroom.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const BATCH_SIZE = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // Service role: this function is the only writer, and RLS leaves the
      // anon key read-only (migration 002).
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return json(
        { error: 'No file provided. Send a CSV file in the "file" field.' },
        400
      );
    }

    if (file.size > MAX_BYTES) {
      return json(
        {
          error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${
            MAX_BYTES / 1024 / 1024
          } MB.`,
        },
        413
      );
    }

    const rawRows = parseCSV(await file.text());
    if (rawRows.length === 0) {
      return json({ error: 'CSV file is empty or has no data rows.' }, 400);
    }

    const missing = missingColumns(rawRows);
    if (missing.length > 0) {
      return json(
        { error: `Missing required columns: ${missing.join(', ')}` },
        400
      );
    }

    const { cleaned, issues } = cleanRows(rawRows);
    if (cleaned.length === 0) {
      return json({ error: 'No usable rows after cleaning.' }, 400);
    }

    const { start: minDate, end: maxDate } = dateRange(cleaned);

    const { data: upload, error: uploadError } = await supabase
      .from('uploads')
      .insert({
        filename: file.name,
        total_rows: rawRows.length,
        cleaned_rows: cleaned.length,
        duplicates_removed: issues.duplicates_removed,
        issues,
        date_range_start: minDate,
        date_range_end: maxDate,
      })
      .select()
      .single();

    if (uploadError) {
      return json(
        {
          error: 'Failed to create upload record',
          details: uploadError.message,
        },
        500
      );
    }

    // Insert in batches. A failed batch is recorded and the rest continue, so a
    // partial failure yields a usable upload that is visibly flagged as partial
    // rather than a silent hole in the data.
    let insertedCount = 0;
    let failedRowsCount = 0;

    for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
      const batch = cleaned
        .slice(i, i + BATCH_SIZE)
        .map((row) => ({ upload_id: upload.id, ...row }));

      const { error: insertError } = await supabase
        .from('monitoring_checks')
        .insert(batch);

      if (insertError) {
        console.error(`Batch insert failed at offset ${i}:`, insertError.message);
        failedRowsCount += batch.length;
      } else {
        insertedCount += batch.length;
      }
    }

    if (failedRowsCount > 0) {
      await supabase
        .from('uploads')
        .update({ partial_failure: true, failed_rows: failedRowsCount })
        .eq('id', upload.id);
    }

    return json({
      success: true,
      upload_id: upload.id,
      partial_failure: failedRowsCount > 0,
      failed_rows: failedRowsCount,
      summary: {
        filename: file.name,
        total_rows_received: rawRows.length,
        rows_after_cleaning: cleaned.length,
        rows_inserted: insertedCount,
        date_range: { start: minDate, end: maxDate },
        services: [...new Set(cleaned.map((r) => r.service_id))],
        issues_found: issues,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: 'Internal server error', details: message }, 500);
  }
});
