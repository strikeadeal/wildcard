import { chromium } from '@playwright/test';

async function runScenario(browser, scenario) {
  const options = scenario.mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } };
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  async function throttle(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: scenario.cpu });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: scenario.latency,
      downloadThroughput: scenario.down * 1024 * 1024 / 8,
      uploadThroughput: scenario.up * 1024 * 1024 / 8,
      connectionType: 'cellular4g',
    });
  }

  async function createRoom(page, name) {
    await page.goto('http://127.0.0.1:5173/');
    await page.getByLabel('Your name').fill(name);
    await page.getByRole('button', { name: 'Create a room' }).click();
    return (await page.locator('.code').textContent({ timeout: 20_000 })).trim();
  }

  async function joinRoom(page, code, name) {
    await page.goto('http://127.0.0.1:5173/');
    await page.getByLabel('Your name').fill(name);
    await page.getByLabel('Room code').fill(code);
    await page.getByRole('button', { name: 'Join', exact: true }).click();
  }

  async function measure(page, phase) {
    const playable = page.locator('.hand .playable').first();
    const target = await playable.count() ? playable : page.getByRole('button', { name: 'Face-down card' });
    const action = await playable.count() ? 'play-card' : 'draw-card';
    await page.evaluate(() => {
      window.__task5 = { pointer: 0, local: 0, authority: 0, events: [] };
      const table = document.querySelector('.table');
      addEventListener('pointerdown', () => { window.__task5.pointer = performance.now(); }, { once: true, capture: true });
      new PerformanceObserver((list) => {
        window.__task5.events.push(...list.getEntries().map((entry) => ({
          name: entry.name, duration: entry.duration, interactionId: entry.interactionId,
          startTime: entry.startTime, processingStart: entry.processingStart,
        })));
      }).observe({ type: 'event', buffered: true, durationThreshold: 0 });
      const observer = new MutationObserver(() => {
        const busy = table?.getAttribute('aria-busy') === 'true';
        if (busy && !window.__task5.local) window.__task5.local = performance.now();
        if (!busy && window.__task5.local && !window.__task5.authority) {
          window.__task5.authority = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(table, { attributes: true, subtree: true, attributeFilter: ['aria-busy', 'class'] });
    });
    await target.click();
    await page.locator('.table').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__task5.authority > 0, null, { timeout: 20_000 });
    await page.waitForTimeout(150);
    const raw = await page.evaluate(() => window.__task5);
    const interactions = raw.events.filter((event) => event.interactionId > 0 && event.startTime >= raw.pointer - 5);
    const inp = interactions.reduce((max, event) => Math.max(max, event.duration), 0);
    return {
      phase, action,
      localAcknowledgementMs: +(raw.local - raw.pointer).toFixed(1),
      inpMs: +inp.toFixed(1),
      authoritativeAcknowledgementMs: +(raw.authority - raw.pointer).toFixed(1),
    };
  }

  try {
    await Promise.all([throttle(host), throttle(guest)]);
    const code = await createRoom(host, 'Hana');
    await joinRoom(guest, code, 'Gil');
    await host.locator('.seats li', { hasText: 'Gil' }).waitFor({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Start game' }).click();
    await Promise.all([
      host.locator('.hand .card').first().waitFor({ timeout: 20_000 }),
      guest.locator('.hand .card').first().waitFor({ timeout: 20_000 }),
    ]);
    const firstActor = await host.getByRole('button', { name: 'Face-down card' }).isEnabled() ? host : guest;
    const first = await measure(firstActor, 'first');
    const nextActor = await host.getByRole('button', { name: 'Face-down card' }).isEnabled() ? host : guest;
    const warm = await measure(nextActor, 'warm');
    return { scenario: scenario.name, code, measurements: [first, warm] };
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const scenarios = [
    { name: 'mobile-fast-4g', mobile: true, cpu: 4, latency: 60, down: 4, up: 3 },
    { name: 'mobile-slow-4g', mobile: true, cpu: 4, latency: 150, down: 1.6, up: 0.75 },
    { name: 'laptop', mobile: false, cpu: 1, latency: 0, down: 100, up: 100 },
  ];
  for (const scenario of scenarios) console.log(JSON.stringify(await runScenario(browser, scenario)));
} finally {
  await browser.close();
}
