const MAX_METADATA_BYTES = 1024 * 1024;
const INVALID_METADATA_MESSAGE = '圖片格式或尺寸資訊有誤，請改選其他檔案';

export interface ImageDimensions {
  width: number;
  height: number;
}

function invalidMetadata(): never {
  throw new Error(INVALID_METADATA_MESSAGE);
}

function byteAt(bytes: Uint8Array, offset: number) {
  return bytes[offset] ?? 0;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
  return (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1);
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number) {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return ((byteAt(bytes, offset) * 0x1000000) + (byteAt(bytes, offset + 1) << 16) + (byteAt(bytes, offset + 2) << 8) + byteAt(bytes, offset + 3)) >>> 0;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (byteAt(bytes, offset) + (byteAt(bytes, offset + 1) << 8) + (byteAt(bytes, offset + 2) << 16) + (byteAt(bytes, offset + 3) * 0x1000000)) >>> 0;
}

function hasBytes(bytes: Uint8Array, offset: number, count: number) {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(count) && offset >= 0 && count >= 0 && offset + count <= bytes.length;
}

function pngCrc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= byteAt(bytes, offset);
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(bytes: Uint8Array, fileSize: number): ImageDimensions {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (fileSize < 33 || !hasBytes(bytes, 0, 33) || signature.some((byte, index) => bytes[index] !== byte)) return invalidMetadata();
  if (readUint32BigEndian(bytes, 8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return invalidMetadata();
  if (readUint32BigEndian(bytes, 29) !== pngCrc32(bytes, 12, 29)) return invalidMetadata();

  return { width: readUint32BigEndian(bytes, 16), height: readUint32BigEndian(bytes, 20) };
}

function isStartOfFrame(marker: number) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function parseJpeg(bytes: Uint8Array): ImageDimensions {
  if (!hasBytes(bytes, 0, 4) || bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalidMetadata();
  let offset = 2;

  while (offset < bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) return invalidMetadata();
    while (byteAt(bytes, offset) === 0xff) offset += 1;
    if (offset >= bytes.length) return invalidMetadata();
    const marker = byteAt(bytes, offset);
    offset += 1;
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return invalidMetadata();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (!hasBytes(bytes, offset, 2)) return invalidMetadata();

    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2) return invalidMetadata();
    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > bytes.length) return invalidMetadata();

    if (isStartOfFrame(marker)) {
      if (segmentLength < 8) return invalidMetadata();
      const componentCount = byteAt(bytes, segmentStart + 5);
      if (componentCount === 0 || segmentLength !== 8 + componentCount * 3) return invalidMetadata();
      return {
        width: readUint16BigEndian(bytes, segmentStart + 3),
        height: readUint16BigEndian(bytes, segmentStart + 1),
      };
    }
    offset = segmentEnd;
  }
  return invalidMetadata();
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8) | (byteAt(bytes, offset + 2) << 16);
}

function parseWebp(bytes: Uint8Array, fileSize: number): ImageDimensions {
  if (fileSize < 20 || !hasBytes(bytes, 0, 20) || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return invalidMetadata();
  const riffSize = readUint32LittleEndian(bytes, 4);
  if (riffSize < 12 || riffSize + 8 !== fileSize) return invalidMetadata();

  const riffEnd = Math.min(fileSize, bytes.length);
  let offset = 12;
  while (hasBytes(bytes, offset, 8) && offset + 8 <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkLength = readUint32LittleEndian(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextChunk = dataEnd + (chunkLength & 1);
    if (!Number.isSafeInteger(dataEnd) || dataEnd > fileSize || nextChunk > fileSize) return invalidMetadata();

    if (type === 'VP8X') {
      if (chunkLength !== 10 || !hasBytes(bytes, dataStart, 10)) return invalidMetadata();
      return {
        width: readUint24LittleEndian(bytes, dataStart + 4) + 1,
        height: readUint24LittleEndian(bytes, dataStart + 7) + 1,
      };
    }
    if (type === 'VP8 ') {
      if (chunkLength < 10 || !hasBytes(bytes, dataStart, 10) || byteAt(bytes, dataStart + 3) !== 0x9d
        || byteAt(bytes, dataStart + 4) !== 0x01 || byteAt(bytes, dataStart + 5) !== 0x2a) return invalidMetadata();
      return {
        width: readUint16LittleEndian(bytes, dataStart + 6) & 0x3fff,
        height: readUint16LittleEndian(bytes, dataStart + 8) & 0x3fff,
      };
    }
    if (type === 'VP8L') {
      if (chunkLength < 5 || !hasBytes(bytes, dataStart, 5) || byteAt(bytes, dataStart) !== 0x2f || (byteAt(bytes, dataStart + 4) & 0xe0) !== 0) return invalidMetadata();
      const width = 1 + byteAt(bytes, dataStart + 1) + ((byteAt(bytes, dataStart + 2) & 0x3f) << 8);
      const height = 1 + ((byteAt(bytes, dataStart + 2) & 0xc0) >> 6) + (byteAt(bytes, dataStart + 3) << 2) + ((byteAt(bytes, dataStart + 4) & 0x0f) << 10);
      return { width, height };
    }

    if (dataEnd > bytes.length) return invalidMetadata();
    offset = nextChunk;
  }
  return invalidMetadata();
}

export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  try {
    const bytes = new Uint8Array(await file.slice(0, MAX_METADATA_BYTES).arrayBuffer());
    if (file.type === 'image/png') return parsePng(bytes, file.size);
    if (file.type === 'image/jpeg') return parseJpeg(bytes);
    if (file.type === 'image/webp') return parseWebp(bytes, file.size);
    return invalidMetadata();
  } catch {
    return invalidMetadata();
  }
}
