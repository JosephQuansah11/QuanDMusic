/** Small browser helpers: downloads and file type detection. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, mime = 'application/xml'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export type DetectedFileType = 'midi' | 'musicxml' | 'audio' | 'unknown';

/** Sniffs the file type from its name and first bytes instead of trusting the MIME type. */
export async function detectFileType(file: File): Promise<DetectedFileType> {
  const name = file.name.toLowerCase();
  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const magic = String.fromCharCode(...header.slice(0, 4));

  if (name.endsWith('.mid') || name.endsWith('.midi') || magic === 'MThd') return 'midi';
  if (name.endsWith('.xml') || name.endsWith('.musicxml') || name.endsWith('.mxl')) {
    if (magic.startsWith('PK')) return 'unknown'; // compressed .mxl needs unzipping
    return 'musicxml';
  }
  if (file.type.startsWith('audio/') || name.match(/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/)) return 'audio';
  const text = new TextDecoder().decode(header);
  if (text.includes('score-partwise')) return 'musicxml';
  return 'unknown';
}

export function readAsText(file: File): Promise<string> {
  return file.text();
}

export function formatTime(beats: number, tempo: number): string {
  const seconds = (beats * 60) / Math.max(1, tempo);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
