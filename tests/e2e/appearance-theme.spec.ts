import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const extension = resolve(process.cwd(), 'dist');
const STATE_KEY = 'stockDesktopState.v1';

async function launchExtension(profile: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const id = await worker.evaluate(() => chrome.runtime.id);
  await page.goto(`chrome-extension://${id}/index.html`);
  await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
  return { context, page };
}

async function closeExtension(context: BrowserContext) {
  await context.close();
}

test('all theme choices support keyboard switching and survive extension reload', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'chrome-stock-theme-'));
  let context: BrowserContext | undefined;
  try {
    const first = await launchExtension(profile);
    context = first.context;
    const page = first.page;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest');

    await page.getByRole('button', { name: '設定' }).click();
    const picker = page.locator('.theme-picker');
    await expect(picker.getByRole('radio')).toHaveCount(6);
    expect(await picker.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await picker.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('radio', { name: '山嵐' }).focus();
    const choices = [
      { id: 'midnight', label: '午夜' },
      { id: 'sand', label: '暖砂' },
      { id: 'graphite', label: '墨曜' },
      { id: 'dusk', label: '暮紫' },
      { id: 'sky', label: '晴空' },
    ];
    for (const choice of choices) {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('html')).toHaveAttribute('data-theme', choice.id);
      await expect(page.getByRole('radio', { name: choice.label })).toBeChecked();
      const saved = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STATE_KEY);
      expect(saved.settings.appearanceTheme).toBe(choice.id);
    }

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sky');
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.getByRole('radio', { name: '晴空' })).toBeChecked();

    await closeExtension(first.context);
    context = undefined;
    const second = await launchExtension(profile);
    context = second.context;
    const reopened = second.page;
    await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'sky');
  } finally {
    if (context) await closeExtension(context);
    await rm(profile, { recursive: true, force: true });
  }
});
