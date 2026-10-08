import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_STATE, type AppState, type Quote, type QuoteStatus } from '../../src/domain/types';

const artifacts = resolve(process.cwd(), 'artifacts');
const limitStockId = 'limit-up-2330';

async function updateLimitQuote(page: Page, patch: Partial<Quote>, status?: QuoteStatus) {
  await page.evaluate(({ stockId, quotePatch, quoteStatus }) => {
    const key = 'stockDesktopState.v1';
    const state = JSON.parse(localStorage.getItem(key) ?? 'null') as AppState;
    const stock = state.stocks.find((candidate) => candidate.id === stockId);
    if (!stock?.quote) throw new Error('Missing visual fixture quote');
    stock.quote = { ...stock.quote, ...quotePatch };
    if (quoteStatus) {
      stock.quoteStatus = quoteStatus;
      stock.quote.status = quoteStatus;
    }
    const value = JSON.stringify(state);
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }, { stockId: limitStockId, quotePatch: patch, quoteStatus: status });
}

test('celebrates an authoritative Taiwan limit-up quote until its flags or freshness status change', async ({ page }) => {
  const now = new Date('2026-10-08T04:00:00.000Z').getTime();
  const timestamp = now - 30_000;
  const fixture: AppState = {
    ...structuredClone(DEFAULT_STATE),
    groups: [{ id: 'group-fixture', name: '測試資料', order: 0 }, ...structuredClone(DEFAULT_STATE.groups).map((group) => ({ ...group, order: group.order + 1 }))],
    stocks: [
      {
        id: limitStockId, market: 'TW', symbol: '2330', name: '台積電測試漲停', order: 0, groupId: 'group-fixture',
        averageCost: 119, shares: 1000, gainDisplay: 'percent', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 138.5, previousClose: 137, dayChange: 1.5, dayChangePercent: 1.09, timestamp, status: 'live', source: 'Fugle', isLimitUpPrice: true, isLimitDownPrice: false, isTrial: false, isTradingHalted: false, isLimitUpHalt: false, isLimitDownHalt: false },
      },
      {
        id: 'tw-gain-19500', market: 'TW', symbol: '8042', name: '金山電', order: 1, groupId: 'group-fixture',
        averageCost: 119, shares: 1000, gainDisplay: 'money', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 138.5, previousClose: 137, dayChange: 1.5, dayChangePercent: 1.09, timestamp, status: 'live', source: 'Fugle', isLimitUpPrice: false, isLimitDownPrice: false, isTrial: false, isTradingHalted: false, isLimitUpHalt: false, isLimitDownHalt: false },
      },
      {
        id: 'us-under-100', market: 'US', symbol: 'XYZ', name: '低價測試', order: 2, groupId: 'group-fixture',
        gainDisplay: 'percent', alert: { below: 99.5 }, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 99.5, previousClose: 98.5, dayChange: 1, dayChangePercent: 1.02, timestamp, status: 'live', source: 'Finnhub' },
      },
    ],
    settings: { ...DEFAULT_STATE.settings, fugleKey: '', finnhubKey: '', notificationsEnabled: false, notificationPermission: 'unsupported', limitNotificationsEnabled: false },
  };

  await page.clock.install({ time: new Date(now) });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), fixture);
  await page.goto('/');

  const limitCard = page.getByRole('article', { name: /台積電測試漲停.*2330/ });
  const gainCard = page.getByRole('article', { name: /金山電.*8042/ });
  await expect(limitCard).toHaveClass(/is-limit-up/);
  await expect(limitCard.getByText('漲停', { exact: true })).toBeVisible();
  await expect(limitCard.locator('.stock-fireworks')).toHaveAttribute('aria-hidden', 'true');
  const motion = await limitCard.locator('.stock-fireworks .firework-burst').first().evaluate((element) => ({
    duration: getComputedStyle(element).animationDuration,
    iteration: getComputedStyle(element).animationIterationCount,
    pointerEvents: getComputedStyle(element.parentElement!).pointerEvents,
  }));
  expect(motion.duration).toBe('3.2s');
  expect(motion.iteration).toBe('infinite');
  expect(motion.pointerEvents).toBe('none');
  await expect(limitCard.locator('.current-price')).toHaveText('138');
  await expect(gainCard.locator('.current-price')).toHaveText('138');
  await expect(gainCard.locator('.day-move')).toContainText('+1.50');
  await expect(gainCard.locator('.day-move')).toContainText('1.09%');
  await expect(gainCard.locator('.gain-panel strong')).toHaveText('+$19,500');
  const lowPriceCard = page.getByRole('article', { name: /低價測試.*XYZ/ });
  await expect(lowPriceCard.locator('.current-price')).toHaveText('99.50');
  await expect(lowPriceCard.locator('.alert-summary')).toContainText('低於 US$99.50');

  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.textContent = '測試資料（非即時行情）';
    badge.setAttribute('data-test-fixture-label', 'true');
    badge.style.cssText = 'position:fixed;z-index:1000;left:18px;bottom:18px;padding:8px 12px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#182b24;color:white;font:12px sans-serif;';
    document.body.append(badge);
  });
  await mkdir(artifacts, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(artifacts, 'limit-up-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: resolve(artifacts, 'limit-up-mobile.png'), fullPage: true });
  const mobileMetrics = await limitCard.evaluate((card) => ({
    fits: card.scrollWidth <= card.clientWidth + 1,
    pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    badgeFits: card.querySelector<HTMLElement>('.limit-up-badge')!.getBoundingClientRect().right <= card.getBoundingClientRect().right,
  }));
  expect(mobileMetrics.fits).toBe(true);
  expect(mobileMetrics.pageFits).toBe(true);
  expect(mobileMetrics.badgeFits).toBe(true);

  await updateLimitQuote(page, { isLimitUpPrice: false }, 'live');
  await expect(limitCard).not.toHaveClass(/is-limit-up/);
  await expect(limitCard.getByText('漲停', { exact: true })).toHaveCount(0);

  await updateLimitQuote(page, { isLimitUpPrice: true, isTrial: false, isTradingHalted: false }, 'closed');
  await expect(limitCard).toHaveClass(/is-limit-up/);
  await expect(limitCard.getByText('漲停', { exact: true })).toBeVisible();

  await updateLimitQuote(page, {}, 'stale');
  await expect(limitCard).not.toHaveClass(/is-limit-up/);

  await updateLimitQuote(page, { isTrial: true }, 'live');
  await expect(limitCard).not.toHaveClass(/is-limit-up/);
  await updateLimitQuote(page, { isTrial: false, isTradingHalted: true }, 'live');
  await expect(limitCard).not.toHaveClass(/is-limit-up/);
  await updateLimitQuote(page, { isTradingHalted: false, isLimitUpHalt: true }, 'live');
  await expect(limitCard).not.toHaveClass(/is-limit-up/);

  await updateLimitQuote(page, { isLimitUpHalt: false, isLimitUpPrice: true }, 'live');
  await expect(limitCard).toHaveClass(/is-limit-up/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMetrics = await limitCard.evaluate((card) => ({
    fireworksDisplay: getComputedStyle(card.querySelector<HTMLElement>('.stock-fireworks')!).display,
    badgeVisible: Boolean(card.querySelector('.limit-up-badge')),
    borderColor: getComputedStyle(card).borderTopColor,
  }));
  expect(reducedMetrics.fireworksDisplay).toBe('none');
  expect(reducedMetrics.badgeVisible).toBe(true);
  expect(reducedMetrics.borderColor).not.toBe('rgba(239, 243, 229, 0.18)');
});
