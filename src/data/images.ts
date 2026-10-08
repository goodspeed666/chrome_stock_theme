import { readImageDimensions } from './imageDimensions';

const DB_NAME = 'stock-desktop-images';
const STORE_NAME = 'backgrounds';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 32_000_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BACKGROUND_UPDATE_EVENT = 'stock-desktop:background-updated';
const BACKGROUND_UPDATE_CHANNEL = 'stock-desktop-background-updated';

export function subscribeToBackgroundUpdates(listener: () => void): () => void {
  window.addEventListener(BACKGROUND_UPDATE_EVENT, listener);
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BACKGROUND_UPDATE_CHANNEL);
  channel?.addEventListener('message', listener);
  return () => {
    window.removeEventListener(BACKGROUND_UPDATE_EVENT, listener);
    channel?.close();
  };
}

function announceBackgroundUpdate() {
  window.dispatchEvent(new Event(BACKGROUND_UPDATE_EVENT));
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(BACKGROUND_UPDATE_CHANNEL);
  channel.postMessage('updated');
  channel.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('無法開啟本機圖片儲存區'));
  });
}

export async function validateImage(file: File): Promise<void> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('請選擇 JPEG、PNG 或 WebP 圖片');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('圖片不可超過 15 MB');

  const metadata = await readImageDimensions(file);
  validateImageDimensions(metadata.width, metadata.height);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
  } catch {
    throw new Error('無法解碼這張圖片，請改選其他檔案');
  }

  try {
    validateImageDimensions(bitmap.width, bitmap.height);
    const dimensionsMatch = bitmap.width === metadata.width && bitmap.height === metadata.height;
    if (!dimensionsMatch) throw new Error('圖片尺寸與檔案資訊不符，請改選其他檔案');
  } finally {
    bitmap.close();
  }
}

function validateImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('圖片格式或尺寸資訊有誤，請改選其他檔案');
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) throw new Error('圖片長寬不可超過 8192 像素');
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('圖片總像素不可超過 32,000,000');
}

export async function saveUploadedBackground(file: File): Promise<void> {
  await validateImage(file);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(file, 'custom');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('圖片儲存失敗'));
  });
  database.close();
  announceBackgroundUpdate();
}

export async function readUploadedBackground(): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null;
  const database = await openDatabase();
  const result = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get('custom');
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('圖片讀取失敗'));
  });
  database.close();
  return result ?? null;
}

export async function removeUploadedBackground(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete('custom');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('圖片刪除失敗'));
  });
  database.close();
}
