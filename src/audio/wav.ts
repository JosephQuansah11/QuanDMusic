/** 16-bit PCM WAV encoding, for offline practice files. */

export function encodeWav(pcm: Float32Array, sampleRate: number, channels = 1): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Decodes 16-bit PCM WAV data into mono float samples (used by tests/tools). */
export function decodeWav(buffer: ArrayBuffer): { pcm: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  const readString = (offset: number, length: number) => {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
    return out;
  };
  if (readString(0, 4) !== 'RIFF' || readString(8, 4) !== 'WAVE') throw new Error('Not a WAV file');

  let sampleRate = 44100;
  let channels = 1;
  let bits = 16;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const id = readString(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(size, buffer.byteLength - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error('WAV file has no data chunk');
  if (bits !== 16) throw new Error('Only 16-bit WAV is supported');

  const frameCount = dataSize / (channels * 2);
  const pcm = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 0x8000;
    }
    pcm[i] = sum / channels;
  }
  return { pcm, sampleRate };
}
