import { useState, useRef, type DragEvent } from 'react';
import { Upload, FileText } from 'lucide-react';

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
  progress: string;
}

export function FileUploader({ onUpload, uploading, progress }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  function handleSubmit() {
    if (file) onUpload(file);
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-white'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleSelect}
          className="hidden"
        />
        {file ? (
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
          className="mt-4 w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg transition-colors"
        >
          {uploading ? progress || 'Processing...' : 'Upload & Process'}
        </button>
      )}
    </div>
  );
}
