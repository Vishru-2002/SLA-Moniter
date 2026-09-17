import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { UploadSummary } from '../lib/types';

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadCSV(file: File) {
    setUploading(true);
    setProgress('Uploading CSV...');
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Call Supabase Edge Function
      const { data, error: fnError } = await supabase.functions.invoke(
        'upload-csv',
        { body: formData }
      );

      if (fnError) {
        throw new Error(fnError.message || 'Edge function call failed');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Upload processing failed');
      }

      setResult(data as UploadSummary);
      setProgress('Done!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setProgress('');
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setProgress('');
  }

  return { uploading, progress, result, error, uploadCSV, reset };
}
