import { useState, useRef, type DragEvent } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
  progress: string;
}

export function FileUploader({ onUpload, uploading, progress }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // While an upload is in flight the whole drop zone is inert. Previously only
  // the submit button was disabled, so the zone still opened the file picker and
  // still accepted drops -- which swapped the displayed filename while the
  // *original* file was the one actually being processed.
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (uploading) return;
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  function handleSubmit() {
    if (file && !uploading) onUpload(file);
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        aria-busy={uploading}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          uploading
            ? 'cursor-not-allowed border-gray-200 bg-gray-50'
            : dragOver
              ? 'cursor-pointer border-blue-500 bg-blue-50'
              : 'cursor-pointer border-gray-300 hover:border-gray-400 bg-white'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleSelect}
          disabled={uploading}
          className="hidden"
        />
        {uploading && file ? (
          // Name the file that is actually in flight, so the zone cannot appear
          // to be processing something other than what was submitted.
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <p className="font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-500">
              {progress || 'Processing…'}
            </p>
          </div>
        ) : file ? (
          <div className="flex flex-col items-center gap-3">
            <FileText className="w-12 h-12 text-blue-500" />
            <p className="font-medium text-gray-800">{file.name}</p>
            <p className="text-sm text-gray-500">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-gray-400" />
            <p className="font-medium text-gray-600">
              Drop a CSV file here, or click to browse
            </p>
            <p className="text-sm text-gray-400">
              Health-check monitoring logs (.csv)
            </p>
          </div>
        )}
      </div>

      {file && (
        <button
          onClick={handleSubmit}
          disabled={uploading}
          className="mt-4 w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
          {uploading ? progress || 'Processing…' : 'Upload & Process'}
        </button>
      )}
    </div>
  );
}
