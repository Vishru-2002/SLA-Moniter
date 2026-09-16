import {
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  Ruler,
  MinusCircle,
  Hash,
  Copy,
} from 'lucide-react';
import type { UploadSummary as UploadSummaryType } from '../lib/types';
import { formatDate } from '../lib/utils';

interface Props {
  result: UploadSummaryType;
  onViewDashboard: () => void;
}

export function UploadSummary({ result, onViewDashboard }: Props) {
  const { summary } = result;
  const issues = summary.issues_found;
  const totalIssues = Object.values(issues).reduce((a, b) => a + b, 0);

  return (
    <div className="w-full max-w-xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle className="w-8 h-8 text-green-500" />
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Upload Complete
          </h3>
          <p className="text-sm text-gray-500">{summary.filename}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-gray-500">Rows received</p>
          <p className="text-xl font-bold text-gray-900">
            {summary.total_rows_received.toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-gray-500">Rows inserted</p>
          <p className="text-xl font-bold text-gray-900">
            {summary.rows_inserted.toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-gray-500">Date range</p>
          <p className="text-sm font-semibold text-gray-900">
            {formatDate(summary.date_range.start)} &mdash;{' '}
            {formatDate(summary.date_range.end)}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-gray-500">Services</p>
          <p className="text-sm font-semibold text-gray-900">
            {summary.services.length} services
          </p>
        </div>
      </div>

      {result.partial_failure && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <h4 className="font-semibold mb-1">Partial Insertion Failure</h4>
            <p>{result.failed_rows.toLocaleString()} rows failed to insert into the database during batch processing. The remaining data is available.</p>
          </div>
        </div>
      )}

      {totalIssues > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Issues Found & Fixed ({totalIssues})
          </h4>
          <div className="space-y-1.5 text-sm">
            {issues.unix_timestamps_converted > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-4 h-4 text-blue-500" />
                <span>
                  {issues.unix_timestamps_converted} Unix timestamps &rarr;
                  converted to ISO
                </span>
              </div>
            )}
            {issues.latency_unit_normalized > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <Ruler className="w-4 h-4 text-blue-500" />
                <span>
                  {issues.latency_unit_normalized} latencies in seconds &rarr;
                  normalized to ms
                </span>
              </div>
            )}
            {issues.missing_latency > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <MinusCircle className="w-4 h-4 text-amber-500" />
                <span>
                  {issues.missing_latency} missing latency values &rarr; set to
                  null
                </span>
              </div>
            )}
            {issues.negative_latency > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <MinusCircle className="w-4 h-4 text-red-500" />
                <span>
                  {issues.negative_latency} negative latency values &rarr; set
                  to null
                </span>
              </div>
            )}
            {issues.invalid_status_codes > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <Hash className="w-4 h-4 text-red-500" />
                <span>
                  {issues.invalid_status_codes} invalid status codes &rarr;
                  flagged
                </span>
              </div>
            )}
            {issues.duplicates_removed > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <Copy className="w-4 h-4 text-amber-500" />
                <span>
                  {issues.duplicates_removed} duplicate records &rarr;
                  deduplicated
                </span>
              </div>
            )}
            {issues.duplicate_status_conflicts > 0 && (
              <div className="flex items-center gap-2 text-gray-600">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span>
                  {issues.duplicate_status_conflicts} duplicate
                  {issues.duplicate_status_conflicts > 1 ? 's' : ''} where the
                  two agents disagreed &rarr; kept the valid HTTP code
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={onViewDashboard}
        className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        View Dashboard
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
