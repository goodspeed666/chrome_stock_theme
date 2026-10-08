import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';

const artifacts = resolve(process.cwd(), 'artifacts');

test('persists limit notice and refresh interval settings in the drawer', async ({ page }) => {
  const fixture: AppState = {
    ...structuredClone(DEFAULT_STATE),
    settings: {
      ...DEFAULT_STATE.settings,
      fugleKey: '',
      finnhubKey: '',
      notificationsEnabled: false,
      limitNotificationsEnabled: true,
      quoteRefreshSeconds: 30,
    },
  };
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), fixture);
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  const drawer = page.getByRole('dialog', { name: '設定' });
  const limitToggle = drawer.getByRole('checkbox', { name: '台股漲跌停通知' });
  const refreshInterval = drawer.getByLabel('行情更新間隔');
  await expect(limitToggle).toBeChecked();
  await expect(refreshInterval).toHaveValue('30');
  await expect(drawer.getByText('僅限台股，每檔每方向每日一次；須開啟到價提醒並允許瀏覽器通知。')).toBeVisible();
  await expect(drawer.getByText('依來源額度輪替候選股票，不保證每檔都按固定間隔更新。')).toBeVisible();

  await refreshInterval.scrollIntoViewIfNeeded();
  await expect(limitToggle).toBeVisible();
  await expect(refreshInterval).toBeVisible();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'limit-notification-settings.png'), fullPage: true });

  await refreshInterval.selectOption('120');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? 'null')?.settings.quoteRefreshSeconds)).toBe(120);
  await limitToggle.uncheck();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? 'null')?.settings.limitNotificationsEnabled)).toBe(false);
});
