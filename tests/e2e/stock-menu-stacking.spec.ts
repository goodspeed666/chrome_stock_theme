import { expect, test } from '@playwright/test';
import { APPEARANCE_THEMES, DEFAULT_STATE, type AppState } from '../../src/domain/types';

test('stock card menu controls stay on top across themes and viewport sizes', async ({ page }) => {
  const timestamp = new Date('2026-10-08T04:00:00.000Z').getTime();
  const fixture: AppState = {
    ...structuredClone(DEFAULT_STATE),
    settings: { ...DEFAULT_STATE.settings, appearanceTheme: 'sky' },
    stocks: [
      {
        id: 'limit-up-2330', market: 'TW', symbol: '2330', name: '測試漲停', order: 0, groupId: 'group-tw',
        averageCost: 119, shares: 1000, gainDisplay: 'percent', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 138.5, previousClose: 137, dayChange: 1.5, dayChangePercent: 1.09, timestamp, status: 'live', source: 'Fugle', isLimitUpPrice: true },
      },
      {
        id: 'regular-8042', market: 'TW', symbol: '8042', name: '一般股票', order: 1, groupId: 'group-tw',
        averageCost: 119, shares: 1000, gainDisplay: 'money', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 138.5, previousClose: 137, dayChange: 1.5, dayChangePercent: 1.09, timestamp, status: 'live', source: 'Fugle' },
      },
    ],
  };

  await page.clock.install({ time: new Date(timestamp + 30_000) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), fixture);
  await page.goto('/');

  const cards = [
    page.getByRole('article', { name: /測試漲停.*2330/ }),
    page.getByRole('article', { name: /一般股票.*8042/ }),
  ];
  const viewports = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const theme of APPEARANCE_THEMES) {
      await page.locator('html').evaluate((element, value) => { element.dataset.theme = value; }, theme);
      for (const card of cards) {
        await card.scrollIntoViewIfNeeded();
        const menu = card.locator('.card-menu');
        await menu.locator('summary').click();
        const popover = menu.locator('.card-menu-popover');
        await expect(popover).toBeVisible();

        const hitChecks = await popover.locator('button').evaluateAll((buttons) => buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            label: button.textContent?.trim(),
            receivesPointer: Boolean(hit && (hit === button || button.contains(hit))),
          };
        }));
        expect(hitChecks, `${viewport.name}, ${theme}, ${await card.getAttribute('aria-label')}`).toEqual([
          { label: '🖊️編輯', receivesPointer: true },
          { label: '🏷️已賣出', receivesPointer: true },
          { label: '⬆️上移', receivesPointer: true },
          { label: '⬇️下移', receivesPointer: true },
          { label: '🗑️移除股票', receivesPointer: true },
        ]);

        if (viewport.name === 'desktop' && theme === 'sky' && card === cards[0]) {
          const nextMenu = cards[1].locator('.card-menu');
          const nextSummary = nextMenu.locator('summary');
          await nextSummary.click();
          await expect(popover).not.toBeVisible();
          await expect(nextMenu.locator('.card-menu-popover')).toBeVisible();

          await page.keyboard.press('Escape');
          await expect(nextMenu.locator('.card-menu-popover')).not.toBeVisible();
          await expect(nextSummary).toBeFocused();

          await menu.locator('summary').click();
          await expect(popover).toBeVisible();
          if (process.env.STOCK_MENU_SCREENSHOT) await popover.screenshot({ path: process.env.STOCK_MENU_SCREENSHOT });
        }

        await menu.locator('summary').click();
        await expect(menu).not.toHaveAttribute('open', '');
      }
    }
  }
});
