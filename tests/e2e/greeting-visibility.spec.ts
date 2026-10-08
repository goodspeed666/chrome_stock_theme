import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';

const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifacts');

function stateWithTrackedTaiwanStock(): AppState {
  return {
    ...structuredClone(DEFAULT_STATE),
    stocks: [{
      id: 'greeting-test-stock', market: 'TW', symbol: '2330', name: '測試股票', order: 0, groupId: 'group-tw',
      gainDisplay: 'percent', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected',
    }],
  };
}

test('hides the welcome at market open and restores it at close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install({ time: new Date('2026-10-08T02:00:00Z') });
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), stateWithTrackedTaiwanStock());
  await page.goto('/');
  await expect(page.locator('.loading-note')).toHaveCount(0);
  await expect(page.locator('.welcome')).toHaveCount(0);
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'greeting-market-open.png'), fullPage: true, animations: 'disabled' });

  await page.clock.setSystemTime(new Date('2026-10-08T05:30:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: '午安，從容掌握市場變化。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '隱藏問候區' })).toBeVisible();
  const phoneOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(phoneOverflows).toBe(false);
});

test('persists manual hide until settings restore automatic visibility', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install({ time: new Date('2026-10-10T02:00:00Z') });
  await page.addInitScript((state) => {
    if (sessionStorage.getItem('greeting-fixture-seeded')) return;
    localStorage.setItem('stockDesktopState.v1', JSON.stringify(state));
    sessionStorage.setItem('greeting-fixture-seeded', 'true');
  }, structuredClone(DEFAULT_STATE));
  await page.goto('/');
  await expect(page.locator('.loading-note')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /讓時間，留給\s*真正重要的事。/ })).toBeVisible();
  await page.getByRole('button', { name: '隱藏問候區' }).click();
  await expect(page.locator('.welcome')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.loading-note')).toHaveCount(0);
  await expect(page.locator('.welcome')).toHaveCount(0);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? 'null') as AppState | null);
  expect(persisted?.settings.welcomeManuallyHidden).toBe(true);

  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByRole('button', { name: '恢復問候區自動顯示' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'greeting-visibility.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '恢復問候區自動顯示' }).click();
  await expect(page.getByRole('heading', { name: /讓時間，留給\s*真正重要的事。/ })).toBeVisible();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? 'null') as AppState | null);
  expect(restored?.settings.welcomeManuallyHidden).toBe(false);
});
