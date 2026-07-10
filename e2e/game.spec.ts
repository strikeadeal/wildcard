import { test, expect, type Page } from '@playwright/test';
import { actIfPossible, clickIfActionable, createRoom, expectLobbyPlayer, joinRoom } from './helpers';

async function dropGuestConnection(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__wildcardTest.dropGuestConnection());
}

async function openPendingWildPicker(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__wildcardTest.openPendingWildPicker());
}

async function dropHostSignaling(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__wildcardTest.dropHostSignaling());
}

test('action helper does not wait on a control that became disabled', async ({ page }) => {
  await page.setContent('<button aria-label="Face-down card" disabled>W</button>');
  const started = Date.now();
  expect(await clickIfActionable(page.getByRole('button', { name: 'Face-down card' })))
    .toBe(false);
  expect(Date.now() - started).toBeLessThan(1_000);
});

test('two players create, join, and play a full round to a win', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expectLobbyPlayer(host, 'Gil', 20_000);

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
  const guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expectLobbyPlayer(host, 'Gil', 20_000);
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });

  // Change the guest's state before dropping, so a rejoin that re-deals a
  // fresh 7-card hand (instead of restoring the seat) is caught. A draw adds
  // one card — or the full penalty amount if a draw2/wild4 is pending — which
  // is why the wait checks for growth rather than an exact count.
  const drawPile = guest.getByRole('button', { name: 'Face-down card' });
  let handSize = 0;
  for (let i = 0; i < 40 && handSize === 0; i++) {
    if (await drawPile.isEnabled().catch(() => false)) {
      const before = await guest.locator('.hand .card').count();
      await drawPile.click();
      await expect.poll(() => guest.locator('.hand .card').count()).toBeGreaterThan(before);
      handSize = await guest.locator('.hand .card').count();
    } else {
      await actIfPossible(host); // advance the game until the guest may draw
      await guest.waitForTimeout(250);
    }
  }
  expect(handSize).toBeGreaterThan(7);

  await openPendingWildPicker(guest);
  await expect(guest.locator('.swatches')).toBeVisible({ timeout: 5_000 });

  await dropGuestConnection(guest);
  await expect(guest.getByRole('status')).toContainText('Connection unstable…', { timeout: 10_000 });
  await expect(guest.locator('.swatches')).toHaveCount(0, { timeout: 10_000 });
  // The Away badge is transient here — a fast rejoin can clear it before this
  // assertion polls (the badge itself is covered in polish.spec.ts, where the
  // guest never returns). Assert the durable history entry instead.
  await expect(host.getByText('Gil lost connection')).toBeVisible({ timeout: 20_000 });
  // 'Rejoining your seat…' flashes for a single localhost roundtrip — too
  // transient to assert reliably. The durable outcome of recovery is the
  // same seat with the same hand, and the overlay gone.
  await expect(guest.locator('.hand .card')).toHaveCount(handSize, { timeout: 30_000 });
  await expect(guest.getByRole('status')).toHaveCount(0, { timeout: 20_000 });
  await expect(guest.locator('.swatches')).toHaveCount(0);
  await expect(host.getByText('away')).toBeHidden({ timeout: 20_000 });

  await hostCtx.close();
  await guestCtx.close();
});

test('a guest joining after a host broker reconnect gets exactly one seat', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const code = await createRoom(host, 'Pat');
  // Drop the host's signaling socket the way the public broker does; the
  // session auto-reconnects and PeerJS re-emits 'open'. A joiner arriving
  // after that used to be attached once per 'open' → duplicate lobby seats.
  await dropHostSignaling(host);
  await host.waitForTimeout(1_000); // let the reconnect settle

  await joinRoom(guest, code, 'Libby');
  await expectLobbyPlayer(host, 'Libby', 20_000); // asserts exactly one row
  await expectLobbyPlayer(guest, 'Libby', 20_000);

  // The single seat must be fully functional: start and let the guest act.
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });
  const pages = [host, guest];
  let guestActed = false;
  for (let i = 0; i < 60 && !guestActed; i++) {
    guestActed = await actIfPossible(guest);
    if (!guestActed && !(await actIfPossible(host))) await host.waitForTimeout(250);
  }
  expect(guestActed).toBe(true); // the guest's intents still reach the host

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
  await expectLobbyPlayer(host, 'Gil', 20_000);

  for (const rule of ['Stacking', 'Jump-in', 'Draw to match', '7-0']) {
    await host.getByRole('checkbox', { name: new RegExp(rule) }).check();
    await expect(guest.getByRole('checkbox', { name: new RegExp(rule) }))
      .toBeChecked({ timeout: 10_000 });
  }

  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.locator('.hand .card')).toHaveCount(7, { timeout: 20_000 });

  // Smoke: 30 legal moves under the full house ruleset without a stall or error.
  const pages = [host, guest];
  let totalActed = 0;
  for (let i = 0; i < 30; i++) {
    // 7-0 swap picker may be open on either page
    for (const page of pages) {
      const swapChoice = page.locator('.list button').first();
      if (await clickIfActionable(swapChoice)) totalActed++;
    }
    let finished = false;
    let acted = false;
    for (const page of pages) {
      if (await page.getByText(/wins the round|You win the round/).isVisible().catch(() => false)) {
        finished = true;
        break;
      }
      if (!acted) acted = await actIfPossible(page);
    }
    if (finished) break;
    if (acted) totalActed++;
    else await host.waitForTimeout(250);
  }
  // The combined ruleset must not stall the game outright.
  expect(totalActed).toBeGreaterThan(0);

  await hostCtx.close();
  await guestCtx.close();
});
