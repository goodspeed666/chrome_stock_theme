import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveUploadedBackground, validateImage } from '../../src/data/images';

const validFixtures = [
  { name: 'PNG', fileName: 'icon128.png', mime: 'image/png', bytes: readFileSync(resolve('public/icons/icon128.png')), width: 128, height: 128 },
  { name: 'JPEG', fileName: '01-thumb.jpg', mime: 'image/jpeg', bytes: readFileSync(resolve('public/backgrounds/01-thumb.jpg')), width: 500, height: 332 },
  { name: 'WebP VP8', fileName: 'tiny-vp8.webp', mime: 'image/webp', bytes: Buffer.from('UklGRioAAABXRUJQVlA4IB4AAAAwAQCdASoBAAEAAUAmJQAAgAAA/vblx/wbJFNdgAA=', 'base64'), width: 1, height: 1 },
  { name: 'WebP VP8L', fileName: 'tiny-vp8l.webp', mime: 'image/webp', bytes: Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQpLq0p/+BiOh/AAA=', 'base64'), width: 1, height: 1 },
  { name: 'transparent WebP VP8L', fileName: 'tiny-transparent-vp8l.webp', mime: 'image/webp', bytes: Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'), width: 1, height: 1 },
  { name: 'WebP VP8X', fileName: 'tiny-vp8x.webp', mime: 'image/webp', bytes: Buffer.from('UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA', 'base64'), width: 1, height: 1 },
] as const;

function makeFile(bytes: Uint8Array, mime: string, name = 'upload') {
  const content = Uint8Array.from(bytes);
  const file = new File([content], name, { type: mime });
  Object.defineProperty(file, 'slice', {
    value: (start = 0, end = content.length) => {
      const part = content.slice(start, end);
      return { arrayBuffer: async () => part.buffer };
    },
  });
  return file;
}

function writeUint32BigEndian(target: number[], value: number) {
  target.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function writeUint32LittleEndian(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pngCrc32(bytes: number[]) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngHeader(width: number, height: number) {
  const ihdr = [
    ...[...Buffer.from('IHDR')],
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8, 2, 0, 0, 0,
  ];
  const chunk = [0, 0, 0, 13, ...ihdr];
  writeUint32BigEndian(chunk, pngCrc32(ihdr));
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk]);
}

function exifOrientationSegment(orientation: number) {
  const tiff = [
    0x49, 0x49, 42, 0, 8, 0, 0, 0,
    1, 0,
    0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0,
    0, 0, 0, 0,
  ];
  const data = [...Buffer.from('Exif\0\0'), ...tiff];
  return [0xff, 0xe1, ((data.length + 2) >>> 8) & 0xff, (data.length + 2) & 0xff, ...data];
}

function jpegHeader(width: number, height: number, orientation?: number) {
  const orientationSegment = orientation === undefined ? [] : exifOrientationSegment(orientation);
  return Uint8Array.from([
    0xff, 0xd8,
    ...orientationSegment,
    0xff, 0xc0, 0, 11, 8,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    1, 1, 0x11, 0,
  ]);
}

function webpChunkHeader(type: string, payload: number[]) {
  const chunk = [...Buffer.from(type), payload.length & 0xff, (payload.length >>> 8) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 24) & 0xff, ...payload];
  if (payload.length & 1) chunk.push(0);
  const riffSize = 4 + chunk.length;
  return Uint8Array.from([
    ...Buffer.from('RIFF'), ...[riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff],
    ...Buffer.from('WEBP'), ...chunk,
  ]);
}

function webpVp8Header(width: number, height: number) {
  return webpChunkHeader('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, (width >>> 8) & 0x3f, height & 0xff, (height >>> 8) & 0x3f]);
}

function webpVp8xHeader(width: number, height: number) {
  return webpChunkHeader('VP8X', [
    0, 0, 0, 0,
    (width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff,
    (height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff,
  ]);
}

function webpVp8lHeader(width: number, height: number) {
  const rawWidth = width - 1;
  const rawHeight = height - 1;
  const payload = [
    0x2f,
    rawWidth & 0xff,
    ((rawWidth >>> 8) & 0x3f) | ((rawHeight & 0x03) << 6),
    (rawHeight >>> 2) & 0xff,
    (rawHeight >>> 10) & 0x0f,
  ];
  return webpChunkHeader('VP8L', payload);
}

function webpVp8FileWithLargeChunk(payloadLength: number, fileSize = 20 + payloadLength + (payloadLength & 1)) {
  const prefix = new Uint8Array(1024 * 1024);
  const chunkLengthBytes = [payloadLength & 0xff, (payloadLength >>> 8) & 0xff, (payloadLength >>> 16) & 0xff, (payloadLength >>> 24) & 0xff];
  const riffSize = fileSize - 8;
  const riffSizeBytes = [riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff];
  prefix.set(Buffer.from('RIFF'), 0);
  prefix.set(riffSizeBytes, 4);
  prefix.set(Buffer.from('WEBP'), 8);
  prefix.set(Buffer.from('VP8 '), 12);
  prefix.set(chunkLengthBytes, 16);
  prefix.set([0, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0], 20);
  const slice = vi.fn((start: number, end: number) => {
    const part = prefix.slice(start, end);
    return { arrayBuffer: async () => part.buffer };
  });
  const file = { type: 'image/webp', size: fileSize, slice } as unknown as File;
  return { file, slice };
}

function mockDecoder(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() };
  const decoder = vi.fn(async () => bitmap);
  vi.stubGlobal('createImageBitmap', decoder);
  return { bitmap, decoder };
}

afterEach(() => vi.unstubAllGlobals());

describe('validateImage', () => {
  it.each(validFixtures)('accepts and closes a real $name fixture', async ({ name: _name, fileName, mime, bytes, width, height }) => {
    const file = makeFile(bytes, mime, fileName);
    const { bitmap, decoder } = mockDecoder(width, height);

    await expect(validateImage(file)).resolves.toBeUndefined();

    expect(decoder).toHaveBeenCalledOnce();
    expect(decoder).toHaveBeenCalledWith(file, { imageOrientation: 'none' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects dimensions beyond the per-edge cap before decoding', async () => {
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(pngHeader(8193, 1), 'image/png'))).rejects.toThrow('8192');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('accepts the exact per-edge cap', async () => {
    const { bitmap } = mockDecoder(8192, 1);

    await expect(validateImage(makeFile(pngHeader(8192, 1), 'image/png'))).resolves.toBeUndefined();

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects dimensions beyond the total-pixel cap before decoding', async () => {
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(jpegHeader(8001, 4000), 'image/jpeg'))).rejects.toThrow('32,000,000');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects oversized WebP VP8X and VP8L canvas metadata before decoding', async () => {
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(webpVp8xHeader(8000, 4001), 'image/webp'))).rejects.toThrow('32,000,000');
    await expect(validateImage(makeFile(webpVp8lHeader(8193, 1), 'image/webp'))).rejects.toThrow('8192');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects oversized WebP VP8 frame dimensions before decoding', async () => {
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(webpVp8Header(8193, 1), 'image/webp'))).rejects.toThrow('8192');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects nonzero VP8L version bits', async () => {
    const invalidHeader = webpVp8lHeader(1, 1);
    invalidHeader[24] = 0x20;
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(invalidHeader, 'image/webp'))).rejects.toThrow('尺寸資訊');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('accepts the exact total-pixel limit and checks the decoded dimensions', async () => {
    const { bitmap } = mockDecoder(8000, 4000);

    await expect(validateImage(makeFile(pngHeader(8000, 4000), 'image/png'))).resolves.toBeUndefined();

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('disables orientation transforms when comparing decoded dimensions with metadata', async () => {
    const { bitmap, decoder } = mockDecoder(500, 332);
    const file = makeFile(jpegHeader(500, 332, 6), 'image/jpeg');

    await expect(validateImage(file)).resolves.toBeUndefined();

    expect(decoder).toHaveBeenCalledWith(file, { imageOrientation: 'none' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('reads VP8 dimensions from the bounded prefix when the compressed chunk exceeds 1 MiB', async () => {
    const { file, slice } = webpVp8FileWithLargeChunk(1_500_000);
    const { bitmap, decoder } = mockDecoder(1, 1);

    await expect(validateImage(file)).resolves.toBeUndefined();

    expect(slice).toHaveBeenCalledWith(0, 1024 * 1024);
    expect(decoder).toHaveBeenCalledWith(file, { imageOrientation: 'none' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects a WebP image chunk that extends past the declared file size before decoding', async () => {
    const { file } = webpVp8FileWithLargeChunk(1_500_000, 1_500_019);
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(file)).rejects.toThrow('尺寸資訊');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects decoded dimensions that disagree with metadata and closes the bitmap', async () => {
    const { bitmap } = mockDecoder(127, 128);

    await expect(validateImage(makeFile(validFixtures[0].bytes, 'image/png'))).rejects.toThrow('尺寸');

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rejects corrupt metadata without decoding', async () => {
    const corruptHeader = pngHeader(128, 128);
    corruptHeader[29] ^= 1;
    const decoder = vi.fn();

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(makeFile(corruptHeader, 'image/png'))).rejects.toThrow('尺寸資訊');

    expect(decoder).not.toHaveBeenCalled();
  });

  it('keeps the existing uploaded background untouched when decoded dimensions mismatch', async () => {
    const openDatabase = vi.fn();
    const onUpdated = vi.fn();
    vi.stubGlobal('indexedDB', { open: openDatabase });
    window.addEventListener('stock-desktop:background-updated', onUpdated);
    mockDecoder(127, 128);

    await expect(saveUploadedBackground(makeFile(validFixtures[0].bytes, 'image/png'))).rejects.toThrow('尺寸');

    expect(openDatabase).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    window.removeEventListener('stock-desktop:background-updated', onUpdated);
  });

  it('preserves the existing 15 MB file-size cap', async () => {
    const decoder = vi.fn();
    const oversizedFile = { type: 'image/png', size: 15 * 1024 * 1024 + 1 } as File;

    vi.stubGlobal('createImageBitmap', decoder);
    await expect(validateImage(oversizedFile)).rejects.toThrow('15 MB');

    expect(decoder).not.toHaveBeenCalled();
  });
});
