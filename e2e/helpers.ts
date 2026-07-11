import { expect, type Locator, type Page } from '@playwright/test';

export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create a room' }).click();
  const code = await page.locator('.code').textContent({ timeout: 20_000 });
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return code!;
}

export async function joinRoom(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Room code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
}

export async function expectLobbyPlayer(page: Page, name: string, timeout?: number): Promise<void> {
  const rows = page.locator('.seats li').filter({ has: page.locator('.pname', { hasText: name }) });
  await expect(rows).toHaveCount(1, timeout ? { timeout } : undefined);
  await expect(rows.first().locator('.pname')).toHaveText(name, timeout ? { timeout } : undefined);
}

/**
 * Click a locator only if it is still visible and enabled at the moment of
 * the check, and bound the click itself — a control that flips from
 * enabled to disabled between observation and click must never hang an
 * e2e action on Playwright's default 240s timeout.
 */
export async function clickIfActionable(locator: Locator): Promise<boolean> {
  if (!await locator.isVisible().catch(() => false)) return false;
  if (!await locator.isEnabled().catch(() => false)) return false;
  return locator.click({ timeout: 750 }).then(() => true, () => false);
}

/** Make whatever legal move the UI offers on this page. Returns true if it acted. */
export async function actIfPossible(page: Page): Promise<boolean> {
  // a wild waiting for its color?
  const swatch = page.locator('.swatches button').first();
  if (await clickIfActionable(swatch)) return true;
  // This is a state-machine driver, not a pointer hit-test. Dispatch directly
  // so fanned-card occlusion cannot strand an otherwise legal simulation.
  const played = await page.evaluate(() => {
    const candidate = [...document.querySelectorAll<HTMLButtonElement>('.playable')]
      .find((button) => !button.disabled);
    if (!candidate) return false;
    candidate.click();
    return true;
  }).catch(() => false);
  if (played) {
    await page.waitForTimeout(20);
    return true;
  }
  const draw = page.getByRole('button', { name: 'Face-down card' });
  if (await clickIfActionable(draw)) return true;
  const pass = page.getByRole('button', { name: 'Keep it' });
  if (await clickIfActionable(pass)) return true;
  return false;
}
