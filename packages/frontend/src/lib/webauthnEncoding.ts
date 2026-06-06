function normalizeBase64(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  return padding === 0 ? base64 : `${base64}${'='.repeat(4 - padding)}`;
}

export function base64ToBuffer(value: string): Uint8Array {
  return Uint8Array.from(atob(normalizeBase64(value)), (char) => char.charCodeAt(0));
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
