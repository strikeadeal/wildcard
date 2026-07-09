import { test, expect } from '@playwright/test';
import { createRoom, joinRoom } from './helpers';

test('host actions remain visible in a two-player mobile lobby', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expect(host.getByText('Gil')).toBeVisible();
  const start = host.getByRole('button', { name: 'Start game' });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(host.getByRole('button', { name: 'Leave room' })).toBeInViewport({ ratio: 1 });
});

test('home fits a 390x844 viewport and exposes safe-area tokens', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
  const tokens = await page.evaluate(() => {
    // Read the *declared* (specified) CSSOM value for the safe-area tokens,
    // not `getComputedStyle`. Chromium eagerly substitutes `env()`
    // references into a concrete value (e.g. "0px" on a device with no
    // notch) even inside custom properties — unlike `var()`, which stays
    // lazy/unresolved until consumed by a real property — so
    // `getComputedStyle(...).getPropertyValue('--safe-top')` never returns
    // the literal `env(...)` text here. Reading the declared rule confirms
    // the token is actually wired to the real environment variable without
    // depending on that browser-specific resolution timing.
    function readRootDeclaredValue(name: string): string {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
            const value = rule.style.getPropertyValue(name).trim();
            if (value) return value;
          }
        }
      }
      return '';
    }
    const css = getComputedStyle(document.documentElement);
    return {
      top: readRootDeclaredValue('--safe-top'),
      bottom: readRootDeclaredValue('--safe-bottom'),
      medium: css.getPropertyValue('--motion-medium').trim()
    };
  });
  expect(tokens).toEqual({
    top: 'env(safe-area-inset-top)',
    bottom: 'env(safe-area-inset-bottom)',
    medium: '240ms'
  });
});

test('table shows actionable prompts, scores, and away-player controls safely', async ({ browser }) => {
  const host = await browser.newPage();
  const guestA = await browser.newPage();
  const guestB = await browser.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guestA, code, 'Gil');
  await joinRoom(guestB, code, 'Ira');
  await expect(host.getByText('Gil')).toBeVisible();
  await expect(host.getByText('Ira')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  await expect(host.locator('.status')).toContainText(/Your turn|Waiting for|Jump in now|Choose|Stack|Draw/);
  await expect(host.locator('.seat').filter({ hasText: 'Gil' }).getByText(/pts$/)).toBeVisible();
  await expect(host.locator('.seat').filter({ hasText: 'Ira' }).getByText(/pts$/)).toBeVisible();

  await guestA.close({ runBeforeUnload: true });

  const awaySeat = host.locator('.seat').filter({ hasText: 'Gil' });
  await expect(awaySeat.getByText('Away')).toBeVisible({ timeout: 12_000 });
  await expect(awaySeat.getByRole('button', { name: 'Remove' })).toBeVisible({ timeout: 12_000 });

  const skip = awaySeat.getByRole('button', { name: 'Skip once' });
  if (await awaySeat.evaluate((node) => node.classList.contains('turn'))) {
    await expect(skip).toBeVisible();
  } else {
    await expect(skip).toHaveCount(0);
  }

  const dialog = host.waitForEvent('dialog').then((d) => d.accept());
  await awaySeat.getByRole('button', { name: 'Remove' }).click();
  await dialog;
  await expect(host.locator('.seat').filter({ hasText: 'Gil' })).toHaveCount(0);
});
