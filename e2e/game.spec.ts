import { test, expect, type Page } from '@playwright/test';
import { actIfPossible, createRoom, joinRoom } from './helpers';

test('two players create, join, and play a full round to a win', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expect(host.getByText('Gil')).toBeVisible({ timeout: 20_000 });

  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });
  await expect(guest.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });

  const pages: Page[] = [host, guest];
  let finished = false;
  for (let i = 0; i < 400 && !finished; i++) {
    let acted = false;
    for (const page of pages) {
      if (await page.getByText(/wins the round|You win the round/).isVisible().catch(() => false)) {
        finished = true;
        break;
      }
      if (!acted) acted = await actIfPossible(page);
    }
    if (!finished && !acted) await host.waitForTimeout(250);
  }
  expect(finished).toBe(true);

  await hostCtx.close();
  await guestCtx.close();
});

test('a disconnected guest can rejoin and keep their seat', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  let guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expect(host.getByText('Gil')).toBeVisible({ timeout: 20_000 });
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });

  await guest.close(); // drop the connection, keep the context (localStorage token)
  await expect(host.getByText('away')).toBeVisible({ timeout: 20_000 });

  guest = await guestCtx.newPage();
  await joinRoom(guest, code, 'Gil');
  await expect(guest.locator('.hand .card')).toHaveCount(7, { timeout: 30_000 });
  await expect(host.getByText('away')).toBeHidden({ timeout: 20_000 });

  await hostCtx.close();
  await guestCtx.close();
});

test('house-rule toggles propagate to guests and the game runs with them on', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expect(host.getByText('Gil')).toBeVisible({ timeout: 20_000 });

  for (const rule of ['Stacking', 'Jump-in', 'Draw to match', '7-0']) {
    await host.getByRole('checkbox', { name: new RegExp(rule) }).check();
    await expect(guest.getByRole('checkbox', { name: new RegExp(rule) }))
      .toBeChecked({ timeout: 10_000 });
  }

  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });

  // Smoke: 30 legal moves under the full house ruleset without a stall or error.
  const pages = [host, guest];
  for (let i = 0; i < 30; i++) {
    // 7-0 swap picker may be open on either page
    for (const page of pages) {
      const swapChoice = page.locator('.list button').first();
      if (await swapChoice.isVisible().catch(() => false)) await swapChoice.click();
    }
    let acted = false;
    for (const page of pages) {
      if (await page.getByText(/wins the round|You win the round/).isVisible().catch(() => false)) {
        i = 30;
        acted = true;
        break;
      }
      if (!acted) acted = await actIfPossible(page);
    }
    if (!acted) await host.waitForTimeout(250);
  }

  await hostCtx.close();
  await guestCtx.close();
});
