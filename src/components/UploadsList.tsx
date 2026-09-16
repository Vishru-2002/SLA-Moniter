import { Link } from 'react-router-dom';
import { FileText, ChevronRight, AlertTriangle } from 'lucide-react';
import { useUploads } from '../hooks/useUploads';
import { formatDate, formatDateTime, formatUptime } from '../lib/utils';

/**
 * Index of past uploads. Persistence is only meaningful if the data can be
 * found again -- without this, an upload is reachable only by remembering its
 * UUID from the redirect.
 */
export function UploadsList() {
  const { uploads, loading } = useUploads();

  if (loading || uploads.length === 0) return null;

  return (
    <div className="w-full max-w-xl mx-auto mt-10">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">
        Previous uploads
      </h2>
      <div className="space-y-2">
        {uploads.map((u) => (
          <Link
            key={u.id}
            to={`/dashboard/${u.id}`}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {u.filename}
              </p>
              <p className="text-xs text-gray-500">
                {u.cleaned_rows.toLocaleString()} rows &middot; {u.service_count}{' '}
                services
                {u.date_range_start && (
                  <>
                    {' '}
                    &middot; {formatDate(u.date_range_start)} &ndash;{' '}
                    {formatDate(u.date_range_end)}
                  </>
                )}
                {' '}&middot; uploaded {formatDateTime(u.uploaded_at)}
              </p>
            </div>

            {u.breaching_count > 0 ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                <AlertTriangle className="w-3 h-3" />
                {u.breaching_count} breaching
              </span>
            ) : (
              u.worst_uptime_pct !== null && (
                <span className="text-xs font-semibold text-green-700 whitespace-nowrap">
                  {formatUptime(u.worst_uptime_pct)}
                </span>
              )
            )}
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
