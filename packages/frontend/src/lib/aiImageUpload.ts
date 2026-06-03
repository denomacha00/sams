/** Max edge length and target size for vision uploads (under backend 5 MB limit). */
const MAX_EDGE_PX = 2048;
const TARGET_MAX_BYTES = 4.5 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not compress image'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Resize and compress photos (e.g. phone camera) so vision upload succeeds without user-facing size errors.
 */
export async function compressImageForAiUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= TARGET_MAX_BYTES && file.type === 'image/jpeg') {
    return file;
  }

  const img = await loadImageFromFile(file);
  let { width, height } = img;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  let quality = JPEG_QUALITY;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > TARGET_MAX_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToJpegBlob(canvas, quality);
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function prepareImagesForAiUpload(files: File[]): Promise<File[]> {
  const prepared: File[] = [];
  for (const file of files) {
    prepared.push(await compressImageForAiUpload(file));
  }
  return prepared;
}
