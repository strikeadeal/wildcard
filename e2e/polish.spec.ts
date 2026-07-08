import { test, expect } from '@playwright/test';

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
