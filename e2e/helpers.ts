import { expect, type Page } from '@playwright/test';

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

/** Make whatever legal move the UI offers on this page. Returns true if it acted. */
export async function actIfPossible(page: Page): Promise<boolean> {
  // a wild waiting for its color?
  const swatch = page.locator('.swatches button').first();
  if (await swatch.isVisible().catch(() => false)) {
    await swatch.click();
    return true;
  }
  const playable = page.locator('.playable').first();
  if (await playable.isVisible().catch(() => false)) {
    await playable.click();
    return true;
  }
  const draw = page.getByRole('button', { name: 'Face-down card' });
  if (await draw.isEnabled().catch(() => false)) {
    await draw.click();
    return true;
  }
  const pass = page.getByRole('button', { name: 'Keep it' });
  if (await pass.isVisible().catch(() => false)) {
    await pass.click();
    return true;
  }
  return false;
}
