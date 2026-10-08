import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { DEFAULT_STATE, type AppState, type SaleRecord } from '../../src/domain/types';

const storageKey = 'stockDesktopState.v1';

function sampleSale(id: string, symbol: string, saleDate: string, groupId = 'group-us', originalGroupName = '美股'): SaleRecord {
  const stock: SaleRecord['stock'] = {
    id: `stock-${id}`,
    market: 'US',
    symbol,
    name: symbol === 'AAPL' ? 'Apple Inc.' : 'Microsoft Corporation',
    groupId,
    order: 0,
    averageCost: 200,
    shares: 5,
    gainDisplay: 'percent',
    alert: { below: 180 },
  };
  return { id, stock, originalGroupName, salePrice: 205, saleDate };
}

function makeState(theme: AppState['settings']['appearanceTheme'] = 'sand'): AppState {
  return {
    ...structuredClone(DEFAULT_STATE),
    stocks: [{
      id: 'active-aapl', market: 'US', symbol: 'AAPL', name: 'Apple Inc.', order: 0, groupId: 'group-us',
      averageCost: 200, shares: 5, gainDisplay: 'percent', alert: { below: 180 }, alertLatches: { above: false, below: false },
      quoteStatus: 'live', notificationFailure: 'fixture notification', pendingNotification: { rule: 'above', threshold: 210, price: 211, quoteTimestamp: 1 },
      quote: { price: 210.5, previousClose: 208, dayChange: 2.5, dayChangePercent: 1.2, timestamp: Date.parse('2026-10-09T03:59:00.000Z'), status: 'live', source: 'Finnhub' },
    }],
    salesHistory: [sampleSale('sale-august', 'MSFT', '2026-08-20')],
    settings: { ...DEFAULT_STATE.settings, appearanceTheme: theme },
  };
}

test('saves, reloads, filters, edits, and restores a whole position', async ({ page }) => {
  const state = makeState();
  await page.clock.install({ time: new Date('2026-10-09T04:00:00.000Z') });
  await page.addInitScript(({ initial, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial)); }, { initial: state, key: storageKey });
  await page.goto('/');

  const portfolio = page.getByRole('region', { name: '美股分區' });
  const card = portfolio.getByRole('article', { name: 'Apple Inc.，美股 AAPL' });
  await card.getByRole('button', { name: 'Apple Inc.的操作選單' }).click();
  await page.getByRole('button', { name: '已賣出' }).click();

  const saleDialog = page.getByRole('dialog', { name: '標記為已賣出' });
  await expect(saleDialog.getByLabel(/每股賣出價格/)).toHaveValue('210.5');
  await expect(saleDialog.getByLabel('賣出日期')).toHaveValue('2026-10-09');
  await saleDialog.getByLabel(/每股賣出價格/).fill('212.5');
  await saleDialog.getByRole('button', { name: '確認已賣出' }).click();
  await expect(portfolio.getByRole('article')).toHaveCount(0);

  await page.getByRole('button', { name: '歷史記錄' }).click();
  let history = page.getByRole('dialog', { name: '歷史記錄' });
  await expect(history.locator('.sales-history-row')).toHaveCount(1);
  await expect(history.locator('.sales-history-row')).toContainText('AAPL');
  await expect(history.locator('.sales-history-row')).toContainText('USD 212.50');
  await expect(history.locator('.sales-history-row')).toContainText('+US$62.50');
  await expect(history.locator('.sales-history-row')).not.toContainText('fixture notification');

  await page.reload();
  await page.getByRole('button', { name: '歷史記錄' }).click();
  history = page.getByRole('dialog', { name: '歷史記錄' });
  await expect(history.locator('.sales-history-row')).toHaveCount(1);
  await history.getByLabel('顯示期間').selectOption('2026-08');
  await expect(history.locator('.sales-history-row')).toHaveCount(1);
  await expect(history.locator('.sales-history-row')).toContainText('MSFT');
  await history.getByLabel('顯示期間').selectOption('2026-10');
  await expect(history.locator('.sales-history-row')).toContainText('AAPL');

  await history.getByRole('button', { name: '編輯賣出資料' }).click();
  const editDialog = page.getByRole('dialog', { name: '編輯賣出資料' });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await editDialog.getByLabel(/每股賣出價格/).fill('214');
  await editDialog.getByLabel('賣出日期').fill('2026-10-08');
  await editDialog.getByRole('button', { name: '儲存變更' }).click();

  history = page.getByRole('dialog', { name: '歷史記錄' });
  await expect(history.locator('.sales-history-row')).toContainText('USD 214.00');
  await expect(history.locator('.sales-history-row')).toContainText('2026/10/08');
  await history.getByRole('button', { name: '還原持倉' }).click();
  await expect(history.locator('.sales-history-row')).toHaveCount(0);
  const historyFilter = history.getByLabel('顯示期間');
  await expect(historyFilter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect.poll(() => history.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  const restored = portfolio.getByRole('article', { name: /Apple Inc.*AAPL/ });
  await expect(restored).toBeVisible();
  await expect(restored.locator('.price-placeholder')).toHaveText('—');
  await expect(restored.locator('.notification-failure')).toHaveCount(0);
});

test('requires a destination group when the original group has been deleted', async ({ page }) => {
  const state = makeState();
  state.stocks = [];
  state.salesHistory = [sampleSale('sale-orphan', 'AAPL', '2026-10-08', 'deleted-group', '長期成長')];
  await page.clock.install({ time: new Date('2026-10-09T04:00:00.000Z') });
  await page.addInitScript(({ initial, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial)); }, { initial: state, key: storageKey });
  await page.goto('/');
  await page.getByRole('button', { name: '歷史記錄' }).click();

  const history = page.getByRole('dialog', { name: '歷史記錄' });
  const row = history.locator('.sales-history-row');
  const restore = row.getByRole('button', { name: '還原持倉' });
  await expect(restore).toBeDisabled();
  await row.getByLabel(/還原 AAPL/).selectOption('group-us');
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('region', { name: '美股分區' }).getByRole('article', { name: /AAPL/ })).toBeVisible();
});

test('renders the history dialog without horizontal overflow in light and dark themes', async ({ page }) => {
  const screenshotDir = '/tmp/stock-sales-history';
  await mkdir(screenshotDir, { recursive: true });
  const state = makeState('sand');
  state.salesHistory = [sampleSale('sale-screenshot', 'AAPL', '2026-10-08')];
  await page.clock.install({ time: new Date('2026-10-09T04:00:00.000Z') });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(({ initial, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial)); }, { initial: state, key: storageKey });
  await page.goto('/');
  await page.getByRole('button', { name: '歷史記錄' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sand');
  await page.locator('.sales-history-dialog').evaluate(async (dialog) => Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: `${screenshotDir}/desktop-light.png` });

  await page.getByRole('dialog', { name: '歷史記錄' }).getByRole('button', { name: '關閉視窗' }).click();
  const portfolio = page.getByRole('region', { name: '美股分區' });
  const card = portfolio.getByRole('article', { name: 'Apple Inc.，美股 AAPL' });
  await card.getByRole('button', { name: 'Apple Inc.的操作選單' }).click();
  await page.getByRole('button', { name: '已賣出' }).click();
  const saleDialog = page.getByRole('dialog', { name: '標記為已賣出' });
  await expect(saleDialog.getByLabel(/每股賣出價格/)).toHaveCSS('font-size', '17px');
  await page.locator('.sale-form-dialog').evaluate(async (dialog) => Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: `${screenshotDir}/desktop-sale-form.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${screenshotDir}/mobile-sale-form.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await saleDialog.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '歷史記錄' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.sales-history-dialog').evaluate(async (dialog) => Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: `${screenshotDir}/mobile-light.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const darkState = { ...state, settings: { ...state.settings, appearanceTheme: 'dusk' as const } };
  await page.evaluate((next) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(next)), darkState);
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
  await page.getByRole('button', { name: '歷史記錄' }).click();
  await page.locator('.sales-history-dialog').evaluate(async (dialog) => Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
  await page.screenshot({ path: `${screenshotDir}/desktop-dark.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${screenshotDir}/mobile-dark.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
