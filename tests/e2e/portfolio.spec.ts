import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { DEFAULT_STATE, type AppState } from '../../src/domain/types';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(here, '../../artifacts');

test('shows the Gregorian and lunar date clearly on desktop and at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.clock.install({ time: new Date('2026-10-07T17:00:00.000Z') });
  const screenshotState: AppState = {
    ...structuredClone(DEFAULT_STATE),
    stocks: [{
      id: 'date-preview-fixture', market: 'TW', symbol: 'DEMO', name: '測試用資料', order: 0, groupId: 'group-tw',
      gainDisplay: 'percent', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected',
    }],
  };
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), screenshotState);
  await page.goto('/');
  const date = page.locator('.date-label');
  await expect(date.locator('.date-gregorian')).toHaveText(/^\d{4}年\d{1,2}月\d{1,2}日（[一二三四五六日]）$/);
  await expect(date.locator('.date-lunar')).toHaveText(/^農曆 .+$/);
  await expect(date.locator('.date-gregorian')).toHaveText('2026年10月8日（四）');
  await expect(page.getByRole('heading', { name: '夜深了，留點時間好好休息。' })).toBeVisible();
  await expect(page.getByRole('article', { name: /測試用資料.*DEMO/ })).toBeVisible();
  const disclaimer = page.locator('.disclaimer');
  const buildMeta = disclaimer.locator('.build-meta');
  await expect(buildMeta).toHaveText(/^（v\d+\.\d+\.\d+ · \d{2}\/\d{2} \d{2}:\d{2}）$/);
  await expect(buildMeta).toHaveAttribute('aria-label', /^版本 \d+\.\d+\.\d+，更新於 \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}（台北時間）$/);
  await expect(buildMeta).toHaveAttribute('title', await buildMeta.getAttribute('aria-label'));
  await expect(disclaimer).toContainText('個人觀察用途 · 價格依行情來源更新 · 損益不含交易成本與股息');
  await expect(page.locator('.credit .build-meta')).toHaveCount(0);
  const buildMetaText = await buildMeta.textContent();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'date-lunar-desktop.png') });
  await page.screenshot({ path: resolve(artifacts, 'footer-version.png'), fullPage: true });

  await page.clock.setSystemTime(new Date('2026-10-08T15:59:59.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.date-gregorian')).toHaveText('2026年10月8日（四）');
  await page.clock.setSystemTime(new Date('2026-10-08T16:00:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.date-gregorian')).toHaveText('2026年10月9日（五）');
  await page.clock.setSystemTime(new Date('2026-10-08T21:00:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '早安，準備好掌握今天了嗎？' })).toBeVisible();
  expect(await buildMeta.textContent()).toBe(buildMetaText);

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(date).toBeVisible();
    const metrics = await page.evaluate(() => {
      const dateBox = document.querySelector('.date-label')!.getBoundingClientRect();
      const brandBox = document.querySelector('.brand')!.getBoundingClientRect();
      const actionsBox = document.querySelector('.top-actions')!.getBoundingClientRect();
      const buildMeta = document.querySelector<HTMLElement>('.build-meta')!;
      const buildMetaBox = buildMeta.getBoundingClientRect();
      const disclaimer = document.querySelector<HTMLElement>('.disclaimer')!;
      const disclaimerBox = disclaimer.getBoundingClientRect();
      const photoCredit = document.querySelector<HTMLElement>('.photo-credit')!;
      const photoCreditBox = photoCredit.getBoundingClientRect();
      const credit = document.querySelector<HTMLElement>('.credit')!;
      const creditBox = credit.getBoundingClientRect();
      const photoCreditInset = window.innerWidth <= 700 ? 17 : 0;
      const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return {
        centerError: Math.abs((dateBox.left + dateBox.right) / 2 - window.innerWidth / 2),
        dateOverlapsBrand: overlaps(dateBox, brandBox),
        dateOverlapsActions: overlaps(dateBox, actionsBox),
        buildMetaFontSize: getComputedStyle(buildMeta).fontSize,
        buildMetaFits: disclaimer.scrollWidth <= disclaimer.clientWidth + 1,
        buildMetaWithinDisclaimer: buildMetaBox.left >= disclaimerBox.left - 1 && buildMetaBox.right <= disclaimerBox.right + 1,
        photoCreditAlignsRight: Math.abs(photoCreditBox.right - (creditBox.right - photoCreditInset)) <= 1,
        footerFits: credit.scrollWidth <= credit.clientWidth + 1,
        photoCreditFits: photoCredit.scrollWidth <= photoCredit.clientWidth + 1,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(metrics.centerError, `date center at ${width}px`).toBeLessThanOrEqual(1);
    expect(metrics.dateOverlapsBrand, `date overlaps brand at ${width}px`).toBe(false);
    expect(metrics.dateOverlapsActions, `date overlaps actions at ${width}px`).toBe(false);
    expect(metrics.buildMetaFontSize, `footer font size at ${width}px`).toBe('12px');
    expect(metrics.buildMetaFits, `footer text fits at ${width}px`).toBe(true);
    expect(metrics.buildMetaWithinDisclaimer, `version stays within disclaimer at ${width}px`).toBe(true);
    expect(metrics.photoCreditAlignsRight, `photo credit remains at right footer edge at ${width}px`).toBe(true);
    expect(metrics.footerFits, `footer row fits at ${width}px`).toBe(true);
    expect(metrics.photoCreditFits, `photo credit fits at ${width}px`).toBe(true);
    expect(metrics.horizontalOverflow, `horizontal overflow at ${width}px`).toBe(false);
  }
});

test('shows compact cards for quotes, gains, empty symbols, long names, alerts, and stale data', async ({ page }) => {
  const now = new Date('2026-10-08T04:00:00.000Z').getTime();
  const fixture: AppState = {
    ...structuredClone(DEFAULT_STATE),
    groups: [
      { id: 'group-fixture', name: '測試資料', order: 0 },
      ...structuredClone(DEFAULT_STATE.groups).map((group) => ({ ...group, order: group.order + 1 })),
    ],
    stocks: [
      {
        id: 'compact-tw-live', market: 'TW', symbol: '2330', name: '台積電測試資料', order: 0, groupId: 'group-fixture',
        averageCost: 900, shares: 100, gainDisplay: 'percent', alert: { above: 1100, below: 850 }, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 1005.5, previousClose: 990, dayChange: 15.5, dayChangePercent: 1.57, timestamp: now - 30_000, status: 'live', source: 'Fugle' },
      },
      {
        id: 'compact-tw-empty', market: 'TW', symbol: '0050', name: '元大台灣50 ETF 長期退休投資觀察', customLabel: '測試長名稱：退休帳戶的長期追蹤', order: 1, groupId: 'group-fixture',
        gainDisplay: 'percent', alert: { below: 130 }, alertLatches: { above: false, below: false }, quoteStatus: 'not-connected',
      },
      {
        id: 'compact-us-live', market: 'US', symbol: 'BRK.B', name: 'Berkshire Hathaway Class B 測試資料', order: 2, groupId: 'group-fixture',
        averageCost: 490000, shares: 0.25, gainDisplay: 'money', alert: { above: 520000, below: 475000 }, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 512345.67, previousClose: 510000, dayChange: 2345.67, dayChangePercent: 0.46, timestamp: now - 25_000, status: 'live', source: 'Finnhub' },
      },
      {
        id: 'compact-us-stale', market: 'US', symbol: 'TSLA', name: 'Tesla 測試報價', order: 3, groupId: 'group-fixture',
        averageCost: 420, shares: 3, gainDisplay: 'percent', alert: { above: 450, below: 380 }, alertLatches: { above: false, below: false }, quoteStatus: 'stale', quoteError: 'rate-limited', notificationFailure: '通知傳送失敗，請重試',
        quote: { price: 401.2, previousClose: 412, dayChange: -10.8, dayChangePercent: -2.62, timestamp: now - 180_000, status: 'stale', source: 'Finnhub' },
      },
      {
        id: 'compact-tw-huge-gain', market: 'TW', symbol: '9999', name: '極端損益測試', order: 4, groupId: 'group-fixture',
        averageCost: 1, shares: 1e100, gainDisplay: 'money', alert: {}, alertLatches: { above: false, below: false }, quoteStatus: 'live',
        quote: { price: 100, previousClose: 99, dayChange: 1, dayChangePercent: 1.01, timestamp: now - 30_000, status: 'live', source: 'Fugle' },
      },
    ],
    settings: { ...DEFAULT_STATE.settings, fugleKey: '', finnhubKey: '', notificationsEnabled: false },
  };
  await page.clock.install({ time: new Date(now) });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), fixture);
  await page.goto('/');

  const group = page.getByRole('region', { name: '測試資料分區' });
  await expect(group.locator('.stock-card')).toHaveCount(5);
  const taiwan = group.getByRole('article', { name: /台積電測試資料.*2330/ });
  const empty = group.getByRole('article', { name: /測試長名稱.*0050/ });
  const berkshire = group.getByRole('article', { name: /Berkshire Hathaway.*BRK\.B/ });
  const stale = group.getByRole('article', { name: /Tesla 測試報價.*TSLA/ });
  const hugeGain = group.getByRole('article', { name: /極端損益測試.*9999/ });
  await expect(taiwan.getByText('NT$1,005.50')).toBeVisible();
  await expect(taiwan.getByRole('button', { name: /損益顯示切換/ })).toBeVisible();
  await expect(empty.getByText('尚未連接行情')).toBeVisible();
  await expect(berkshire.getByText('US$512,345.67')).toBeVisible();
  await expect(stale.locator('.quote-error-note')).toContainText('最近成交仍保留');
  await expect(stale.getByRole('button', { name: '重試' })).toBeVisible();

  const desktopMetrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.stock-grid .stock-card')];
    const grid = document.querySelector<HTMLElement>('.stock-grid')!;
    const cardBySymbol = (symbol: string) => cards.find((card) => card.getAttribute('aria-label')?.includes(symbol));
    const geometry = (card: HTMLElement) => {
      const name = card.querySelector<HTMLElement>('.stock-name')!;
      const ticker = card.querySelector<HTMLElement>('.stock-symbol')!;
      const price = card.querySelector<HTMLElement>('.current-price');
      const quote = card.querySelector<HTMLElement>('.stock-quote-block');
      const gain = card.querySelector<HTMLElement>('.gain-panel');
      const gainValue = card.querySelector<HTMLElement>('.gain-panel strong');
      const quoteBox = quote?.getBoundingClientRect();
      const gainBox = gain?.getBoundingClientRect();
      return {
        height: Math.round(card.getBoundingClientRect().height),
        nameFont: getComputedStyle(name).fontSize,
        tickerFont: getComputedStyle(ticker).fontSize,
        textFits: [name, card.querySelector<HTMLElement>('.under-name')].filter(Boolean).every((element) => element!.scrollWidth <= element!.clientWidth + 1),
        priceFits: !price || price.clientHeight <= Number.parseFloat(getComputedStyle(price).lineHeight) + 1,
        gainValueFits: !gainValue || gainValue.scrollWidth <= gainValue.clientWidth + 1,
        quoteGainOverlap: Boolean(quoteBox && gainBox && quoteBox.right > gainBox.left + 1 && quoteBox.left < gainBox.right - 1),
      };
    };
    const noQuote = cardBySymbol('0050')!;
    const live = cardBySymbol('2330')!;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      noQuote: geometry(noQuote),
      live: geometry(live),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(desktopMetrics.columns).toBe(4);
  expect(desktopMetrics.noQuote.nameFont).toBe('20px');
  expect(desktopMetrics.noQuote.tickerFont).toBe('14px');
  expect(desktopMetrics.noQuote.textFits).toBe(true);
  expect(desktopMetrics.noQuote.height).toBeLessThan(220);
  expect(desktopMetrics.live.quoteGainOverlap).toBe(false);
  expect(desktopMetrics.live.priceFits).toBe(true);
  expect(desktopMetrics.live.gainValueFits).toBe(true);
  expect(desktopMetrics.live.height).toBeLessThan(250);
  const longPriceMetrics = await berkshire.evaluate((card) => {
    const price = card.querySelector<HTMLElement>('.current-price')!;
    const gain = card.querySelector<HTMLElement>('.gain-panel strong')!;
    return {
      priceFits: price.clientHeight <= Number.parseFloat(getComputedStyle(price).lineHeight) + 1,
      gainFits: gain.scrollWidth <= gain.clientWidth + 1,
      gainHeight: gain.clientHeight,
      gainLineHeight: Number.parseFloat(getComputedStyle(gain).lineHeight),
    };
  });
  expect(longPriceMetrics.priceFits).toBe(true);
  expect(longPriceMetrics.gainFits).toBe(true);
  expect(longPriceMetrics.gainHeight).toBeLessThanOrEqual(longPriceMetrics.gainLineHeight + 1);
  const hugeGainMetrics = await hugeGain.evaluate((card) => {
    const value = card.querySelector<HTMLElement>('.gain-panel strong')!;
    const panel = card.querySelector<HTMLElement>('.gain-panel')!;
    return {
      valueFits: value.scrollWidth <= value.clientWidth + 1,
      panelFits: panel.scrollWidth <= panel.clientWidth + 1,
      wrapped: value.clientHeight > Number.parseFloat(getComputedStyle(value).lineHeight) + 1,
      overflowWrap: getComputedStyle(value).overflowWrap,
      whiteSpace: getComputedStyle(value).whiteSpace,
    };
  });
  expect(hugeGainMetrics.valueFits).toBe(true);
  expect(hugeGainMetrics.panelFits).toBe(true);
  expect(hugeGainMetrics.wrapped).toBe(true);
  expect(hugeGainMetrics.overflowWrap).toBe('anywhere');
  expect(hugeGainMetrics.whiteSpace).toBe('normal');
  expect(desktopMetrics.horizontalOverflow).toBe(false);

  await group.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.textContent = '測試資料（非即時行情）';
    badge.setAttribute('data-test-fixture-label', 'true');
    badge.style.cssText = 'position:fixed;z-index:1000;left:18px;bottom:18px;padding:8px 12px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#182b24;color:white;font:12px sans-serif;';
    document.body.append(badge);
  });
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'compact-stock-cards.png'), fullPage: true });
  await page.locator('[data-test-fixture-label]').evaluate((element) => element.remove());

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector<HTMLElement>('.stock-grid')!).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(metrics.overflow, `horizontal overflow at ${width}px`).toBe(false);
    if (width === 375) expect(metrics.columns).toBe(1);
    if (width === 768) expect(metrics.columns).toBe(2);
    if (width === 1440) expect(metrics.columns).toBe(4);
  }

  const singleTab = await page.context().newPage();
  await singleTab.setViewportSize({ width: 1440, height: 900 });
  await singleTab.addInitScript((state) => localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)), { ...fixture, stocks: [fixture.stocks[0]!] });
  await singleTab.goto('/');
  const singleCard = singleTab.locator('.stock-card');
  await expect(singleCard).toHaveCount(1);
  const singleCardWidth = await singleCard.evaluate((card) => card.getBoundingClientRect().width);
  expect(singleCardWidth).toBeGreaterThanOrEqual(280);
  expect(singleCardWidth).toBeLessThanOrEqual(360);
  await singleTab.close();
});

test('new-tab desktop supports stock edits, group moves, ordering, and deletion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '讓時間，留給 真正重要的事。' })).toBeVisible();
  await expect(page.getByRole('region', { name: '台股分區' })).toBeVisible();
  await expect(page.getByRole('region', { name: '美股分區' })).toBeVisible();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'default-empty-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: '加入第一檔股票' }).click();
  const addDialog = page.getByRole('dialog', { name: '新增股票' });
  await expect(addDialog.getByLabel(/名稱/)).toHaveCount(0);
  await expect(addDialog.getByLabel(/自訂標籤/)).toBeVisible();
  await expect(addDialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: resolve(artifacts, 'add-stock-no-name.png') });
  await addDialog.getByLabel('股票代號').fill('2330');
  await addDialog.getByRole('button', { name: '加入追蹤' }).click();
  const symbolCard = page.getByRole('article', { name: /2330.*2330/ });
  await expect(symbolCard).toBeVisible();
  const addedStock = await page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? '{}').stocks[0]);
  expect(addedStock).toMatchObject({ symbol: '2330', name: '2330' });

  await symbolCard.getByRole('button', { name: '2330的操作選單' }).click();
  await symbolCard.getByRole('button', { name: '編輯' }).click();
  const editDialog = page.getByRole('dialog', { name: '編輯股票' });
  await editDialog.getByLabel(/名稱/).fill('測試半導體');
  await editDialog.getByLabel(/每股買入均價/).fill('1000');
  await editDialog.getByLabel(/持股數量/).fill('1000');
  await editDialog.getByLabel(/^高於/).fill('1100');
  await editDialog.getByLabel(/^低於/).fill('900');
  await editDialog.getByRole('button', { name: '儲存變更' }).click();

  const firstCard = page.getByRole('article', { name: /測試半導體.*2330/ });
  await firstCard.getByRole('button', { name: '測試半導體的操作選單' }).click();
  await firstCard.getByRole('combobox', { name: '移動 測試半導體 至' }).selectOption('group-us');
  const usGroup = page.getByRole('region', { name: '美股分區' });
  await expect(usGroup.getByRole('article', { name: /測試半導體.*2330/ })).toBeVisible();
  await expect(usGroup.getByText(/高於 NT\$1,100/)).toBeVisible();

  await page.getByRole('button', { name: '新增分區' }).click();
  const groupDialog = page.getByRole('dialog', { name: '新增分區' });
  await groupDialog.getByLabel('分區名稱').fill('清單觀察');
  await groupDialog.getByRole('button', { name: '儲存' }).click();
  await page.getByRole('button', { name: '重新命名清單觀察分區' }).click();
  const renameDialog = page.getByRole('dialog', { name: '重新命名分區' });
  await renameDialog.getByLabel('分區名稱').fill('我的清單');
  await renameDialog.getByRole('button', { name: '儲存' }).click();
  const customGroup = page.getByRole('region', { name: '我的清單分區' });
  await page.getByRole('button', { name: '將我的清單分區上移' }).click();
  async function addStock(group: Locator, market: 'TW' | 'US', symbol: string) {
    await group.getByRole('button', { name: '加入股票' }).click();
    const dialog = page.getByRole('dialog', { name: '新增股票' });
    await dialog.getByLabel('市場').selectOption(market);
    await dialog.getByLabel('股票代號').fill(symbol);
    await expect(dialog.getByLabel(/名稱/)).toHaveCount(0);
    await dialog.getByRole('button', { name: '加入追蹤' }).click();
    await expect(group.getByRole('article', { name: new RegExp(symbol + '.*' + symbol) })).toBeVisible();
  }
  await addStock(customGroup, 'US', 'AAPL');
  await addStock(customGroup, 'US', 'MSFT');
  await addStock(customGroup, 'US', 'GOOG');
  await addStock(usGroup, 'US', 'TSLA');

  const msftCard = customGroup.getByRole('article', { name: /MSFT.*MSFT/ });
  const tslaCard = usGroup.getByRole('article', { name: /TSLA.*TSLA/ });
  await msftCard.locator('.drag-grip').dragTo(tslaCard);
  await expect.poll(() => usGroup.locator('.stock-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')))).toEqual([
    '測試半導體，台股 2330', 'MSFT，美股 MSFT', 'TSLA，美股 TSLA',
  ]);

  const searchCard = customGroup.getByRole('article', { name: /GOOG.*GOOG/ });
  await searchCard.getByRole('button', { name: 'GOOG的操作選單' }).click();
  await searchCard.getByRole('button', { name: '上移' }).click();
  await expect.poll(() => customGroup.locator('.stock-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')))).toEqual([
    'GOOG，美股 GOOG', 'AAPL，美股 AAPL',
  ]);

  await page.getByRole('button', { name: '刪除我的清單分區' }).click();
  const deleteDialog = page.getByRole('dialog', { name: '刪除分區' });
  await deleteDialog.getByRole('combobox').selectOption('group-tw');
  await deleteDialog.getByRole('button', { name: '確認刪除分區' }).click();
  await expect(page.getByRole('region', { name: '我的清單分區' })).toHaveCount(0);
  const twGroup = page.getByRole('region', { name: '台股分區' });
  await expect(twGroup.getByRole('article', { name: /GOOG.*GOOG/ })).toBeVisible();

  const movedCard = twGroup.getByRole('article', { name: /GOOG.*GOOG/ });
  await movedCard.getByRole('button', { name: 'GOOG的操作選單' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await movedCard.getByRole('button', { name: '移除股票' }).click();
  await expect(twGroup.getByRole('article', { name: /搜尋測試.*GOOG/ })).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 820 });
  await expect(page.getByRole('button', { name: '將台股分區下移' })).toBeVisible();
});

test('gain toggles persist, settings save locally, backgrounds upload and survive reload at phone widths', async ({ page }) => {
  const now = Date.now();
  const fixture: AppState = {
    version: 1,
    groups: [{ id: 'group-tw', name: '台股', order: 0 }, { id: 'group-us', name: '美股', order: 1 }],
    stocks: [{
      id: 'fixture-2330', market: 'TW', symbol: '2330', name: '測試資料 2330', order: 0, groupId: 'group-tw', averageCost: 100, shares: 5,
      gainDisplay: 'percent', alert: { above: 120, below: 90 }, alertLatches: { above: false, below: false },
      quote: { price: 110, previousClose: 108, dayChange: 2, dayChangePercent: 100 / 54, timestamp: now - 30_000, status: 'live', source: 'Fugle' }, quoteStatus: 'live',
    }],
    settings: { fugleKey: '', finnhubKey: '', notificationsEnabled: false, notificationPermission: 'default' },
    background: { selectedId: 'scene-01', brightness: 0.58 },
  };
  await page.addInitScript((state) => { if (!localStorage.getItem('stockDesktopState.v1')) localStorage.setItem('stockDesktopState.v1', JSON.stringify(state)); }, fixture);
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto('/');
  const card = page.getByRole('article', { name: /測試資料 2330.*2330/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('+10.00%', { exact: true })).toBeVisible();

  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.textContent = '測試資料（非即時行情）';
    badge.setAttribute('data-test-fixture-label', 'true');
    badge.style.cssText = 'position:fixed;z-index:1000;left:18px;bottom:18px;padding:8px 12px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#182b24;color:white;font:12px sans-serif;';
    document.body.append(badge);
  });
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'test-only-fixture-portfolio.png'), fullPage: true });
  await page.locator('[data-test-fixture-label]').evaluate((element) => element.remove());

  await card.getByRole('button', { name: /損益顯示切換/ }).click();
  await expect(card.getByText('+NT$50.00', { exact: true })).toBeVisible();
  await page.reload();
  const reloadedCard = page.getByRole('article', { name: /測試資料 2330.*2330/ });
  await expect(reloadedCard.getByText('+NT$50.00', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '設定' }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  await expect(settings.getByRole('radio', { name: /曙光山谷/ })).toHaveAttribute('aria-checked', 'true');
  const settingsPresentation = await settings.evaluate((dialog) => {
    const backdrop = dialog.parentElement!;
    const dialogStyle = getComputedStyle(dialog);
    const backdropStyle = getComputedStyle(backdrop);
    return {
      backdropFilter: backdropStyle.backdropFilter,
      backdropAnimationName: backdropStyle.animationName,
      dialogAnimationName: dialogStyle.animationName,
      dialogOpacity: dialogStyle.opacity,
      dialogTransform: dialogStyle.transform,
    };
  });
  expect(settingsPresentation).toEqual({ backdropFilter: 'none', backdropAnimationName: 'none', dialogAnimationName: 'none', dialogOpacity: '1', dialogTransform: 'none' });
  const settingsCloseButton = settings.getByRole('button', { name: '關閉設定' });
  await expect(settingsCloseButton).toBeFocused();
  await settingsCloseButton.press('Shift+Tab');
  await expect(settings.getByLabel('行情更新間隔')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(settingsCloseButton).toBeFocused();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'settings-fast-open.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 940 });
  await settings.getByRole('radio', { name: /冰島彩色山坡/ }).click();
  await expect(settings.getByRole('radio', { name: /冰島彩色山坡/ })).toHaveAttribute('aria-checked', 'true');
  await settings.getByLabel('Fugle 台股 API Key').fill('test-only-key');
  await settings.getByRole('button', { name: '儲存 API 金鑰' }).click();
  await expect(settings.getByText('行情金鑰已儲存在本機。')).toBeVisible();
  await expect(settings.getByLabel('Fugle 台股 API Key')).toHaveAttribute('type', 'password');

  const uploadImage = await readFile(resolve(here, '../../public/icons/icon128.png'));
  await settings.locator('.file-button input[type="file"]').setInputFiles({ name: 'local-test.png', mimeType: 'image/png', buffer: uploadImage });
  await expect(settings.getByText('目前使用')).toBeVisible();
  await settings.getByRole('button', { name: '關閉設定' }).click();
  await expect(page.locator('.credit')).toContainText('自訂背景');
  await page.reload();
  await expect(page.locator('.credit')).toContainText('自訂背景');
  await expect(page.locator('.background-image')).toHaveAttribute('style', /blob:/);

  await reloadedCard.getByRole('button', { name: '測試資料 2330的操作選單' }).click();
  await reloadedCard.getByRole('button', { name: '編輯' }).click();
  const identityDialog = page.getByRole('dialog', { name: '編輯股票' });
  const otherDialogPresentation = await identityDialog.evaluate((dialog) => ({
    backdropFilter: getComputedStyle(dialog.parentElement!).backdropFilter,
    backdropAnimationName: getComputedStyle(dialog.parentElement!).animationName,
    dialogAnimationName: getComputedStyle(dialog).animationName,
  }));
  expect(otherDialogPresentation).toEqual({ backdropFilter: 'blur(7px)', backdropAnimationName: 'fade-in', dialogAnimationName: 'dialog-in' });
  await identityDialog.getByLabel('市場').selectOption('US');
  await identityDialog.getByLabel('股票代號').fill('AAPL');
  await identityDialog.getByRole('button', { name: '儲存變更' }).click();
  const changedCard = page.getByRole('article', { name: /AAPL.*AAPL/ });
  await expect(changedCard.getByText('—', { exact: true })).toBeVisible();
  await expect(changedCard.getByText('NT$110.00', { exact: true })).toHaveCount(0);

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stockDesktopState.v1') ?? '{}') as AppState);
  expect(saved.settings.fugleKey).toBe('test-only-key');
  expect(saved.background.selectedId).toBe('custom');
  expect(saved.stocks[0]).toMatchObject({ market: 'US', symbol: 'AAPL', gainDisplay: 'money', alertLatches: { above: false, below: false }, quoteStatus: 'not-connected' });
  expect(saved.stocks[0]?.quote).toBeUndefined();
});

test('replacing a custom background refreshes the open page without a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  const input = settings.locator('.file-button input[type="file"]');
  const firstImage = await readFile(resolve(here, '../../public/icons/icon128.png'));
  const secondImage = await readFile(resolve(here, '../../public/backgrounds/01-thumb.jpg'));

  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: firstImage });
  const background = page.locator('.background-image');
  await expect(background).toHaveAttribute('style', /blob:/);
  const firstUrl = await background.getAttribute('style');

  await input.setInputFiles({ name: 'second.jpg', mimeType: 'image/jpeg', buffer: secondImage });
  await expect.poll(() => background.getAttribute('style')).not.toBe(firstUrl);

  const secondTab = await page.context().newPage();
  await secondTab.goto('/');
  const siblingBackground = secondTab.locator('.background-image');
  await expect(siblingBackground).toHaveAttribute('style', /blob:/);
  const originalPageUrl = await background.getAttribute('style');
  await secondTab.getByRole('button', { name: '設定' }).click();
  await secondTab.getByRole('dialog', { name: '設定' }).locator('.file-button input[type="file"]').setInputFiles({ name: 'again.png', mimeType: 'image/png', buffer: firstImage });
  await expect.poll(() => background.getAttribute('style')).toMatch(/blob:/);
  await expect.poll(() => background.getAttribute('style')).not.toBe(originalPageUrl);
});
