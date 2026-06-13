import React, { useEffect, useRef, useState } from 'react';

type EditMode = 'crop' | 'highlight';

interface AttachmentImageEditorProps {
  file: File;
  onCancel: () => void;
  onSave: (file: File) => void;
}

interface Point {
  x: number;
  y: number;
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image';
}

function pointerToPoint(event: React.PointerEvent<HTMLDivElement>, element: HTMLDivElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

function normalizeSelection(start: Point, end: Point): Selection {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(0.01, Math.abs(end.x - start.x)),
    height: Math.max(0.01, Math.abs(end.y - start.y)),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = url;
  });
}

async function renderEditedImage(file: File, url: string, selection: Selection, mode: EditMode): Promise<File> {
  const image = await loadImage(url);
  const sourceX = Math.round(selection.x * image.naturalWidth);
  const sourceY = Math.round(selection.y * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round(selection.width * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round(selection.height * image.naturalHeight));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not edit image');

  if (mode === 'crop') {
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
    ctx.save();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.96)';
    ctx.lineWidth = Math.max(6, Math.round(image.naturalWidth * 0.008));
    ctx.fillRect(sourceX, sourceY, sourceWidth, sourceHeight);
    ctx.strokeRect(sourceX, sourceY, sourceWidth, sourceHeight);
    ctx.restore();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Could not save image'));
    }, 'image/jpeg', 0.92);
  });

  const suffix = mode === 'crop' ? 'cropped' : 'highlighted';
  return new File([blob], `${fileBaseName(file.name)}-${suffix}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

const AttachmentImageEditor: React.FC<AttachmentImageEditorProps> = ({ file, onCancel, onSave }) => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [start, setStart] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Selection>({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 });
  const [mode, setMode] = useState<EditMode>('crop');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const beginSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    const point = pointerToPoint(event, frameRef.current);
    setStart(point);
    setSelection({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
    frameRef.current.setPointerCapture(event.pointerId);
  };

  const updateSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!frameRef.current || !start) return;
    setSelection(normalizeSelection(start, pointerToPoint(event, frameRef.current)));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const edited = await renderEditedImage(file, objectUrl, selection, mode);
      onSave(edited);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not edit image');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={onCancel} />
      <div className="relative w-full max-w-4xl rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Edit image before sending</h2>
            <p className="text-sm text-gray-400">Drag over the useful part, then crop or highlight it.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('crop')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'crop' ? 'bg-amber-600 text-white' : 'border border-gray-700 text-gray-300 hover:bg-gray-800'}`}
          >
            Crop to selection
          </button>
          <button
            type="button"
            onClick={() => setMode('highlight')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'highlight' ? 'bg-amber-600 text-white' : 'border border-gray-700 text-gray-300 hover:bg-gray-800'}`}
          >
            Highlight selection
          </button>
          <button
            type="button"
            onClick={() => setSelection({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 })}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            Reset box
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div
          ref={frameRef}
          onPointerDown={beginSelection}
          onPointerMove={updateSelection}
          onPointerUp={() => setStart(null)}
          onPointerCancel={() => setStart(null)}
          className="relative max-h-[62vh] overflow-hidden rounded-2xl border border-gray-700 bg-black touch-none"
        >
          {objectUrl && (
            <img
              src={objectUrl}
              alt={file.name}
              className="mx-auto max-h-[62vh] w-auto select-none object-contain"
              draggable={false}
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-black/20" />
          <div
            className="pointer-events-none absolute border-2 border-amber-300 bg-amber-400/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]"
            style={{
              left: `${selection.x * 100}%`,
              top: `${selection.y * 100}%`,
              width: `${selection.width * 100}%`,
              height: `${selection.height * 100}%`,
            }}
          />
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">Edited images are saved as JPEG and replace the selected attachment.</p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Use edited image'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttachmentImageEditor;
