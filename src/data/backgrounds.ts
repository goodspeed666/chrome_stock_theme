export interface BackgroundImage {
  id: string;
  label: string;
  author: string;
  source: string;
  license: string;
  licenseUrl: string;
  width: number;
  height: number;
  asset: string;
  thumbnail: string;
}

export async function loadBackgroundCatalog(): Promise<BackgroundImage[]> {
  const response = await fetch('/backgrounds/catalog.json');
  if (!response.ok) throw new Error('背景清單載入失敗');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('背景清單格式錯誤');
  return payload as BackgroundImage[];
}
