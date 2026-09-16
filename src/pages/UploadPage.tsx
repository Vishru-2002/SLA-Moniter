import { useNavigate } from 'react-router-dom';
import { FileUploader } from '../components/FileUploader';
import { UploadSummary } from '../components/UploadSummary';
import { UploadsList } from '../components/UploadsList';
import { useUpload } from '../hooks/useUpload';
import { Activity } from 'lucide-react';

export function UploadPage() {
  const navigate = useNavigate();
  const { uploading, progress, result, error, uploadCSV, reset } = useUpload();

  function handleViewDashboard() {
    if (result?.upload_id) {
      navigate(`/dashboard/${result.upload_id}`);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-3xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Activity className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              EarthRe SLA Monitor
            </h1>
          </div>
          <p className="text-gray-600 max-w-md mx-auto">
            Upload health-check monitoring logs to analyze service availability,
            detect SLA breaches, and inspect cleaned data.
          </p>
        </div>

        {/* Upload or Result */}
        {result ? (
          <div>
            <UploadSummary
              result={result}
              onViewDashboard={handleViewDashboard}
            />
            <button
              onClick={reset}
              className="mt-4 w-full max-w-xl mx-auto block text-sm text-gray-500 hover:text-gray-700"
            >
              Upload another file
            </button>
          </div>
        ) : (
          <div>
            <FileUploader
              onUpload={uploadCSV}
              uploading={uploading}
              progress={progress}
            />
            {error && (
              <div className="mt-4 max-w-xl mx-auto bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
                <strong>Error:</strong> {error}
              </div>
            )}
            <UploadsList />
          </div>
        )}
      </div>
    </div>
  );
}
