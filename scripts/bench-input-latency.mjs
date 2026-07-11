import { chromium } from '@playwright/test';

async function installInboundHold(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    let holding = false;
    const queued = [];
    class HeldWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        let handler = null;
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => handler,
          set: (next) => {
            handler = next;
            super.onmessage = next ? (event) => {
              if (holding) queued.push(() => next.call(this, event));
              else next.call(this, event);
            } : null;
          },
        });
      }
    }
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'])
      Object.defineProperty(HeldWebSocket, key, { value: NativeWebSocket[key] });
    window.WebSocket = HeldWebSocket;
    window.__latencyHold = {
      start() { holding = true; },
      release() { holding = false; queued.splice(0).forEach((deliver) => deliver()); },
    };
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

async function measureTouchTap(page, phase, holdMs) {
  // The draw pile is guaranteed to be enabled for the current actor and has a
  // stable unobscured touchscreen target. Fanned hand cards can overlap fully.
  const target = page.getByRole('button', { name: 'Face-down card' });
  const action = 'draw-card';
  const point = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (const yRatio of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      for (const xRatio of [0.5, 0.25, 0.75]) {
        const x = rect.left + rect.width * xRatio;
        const y = rect.top + rect.height * yRatio;
        if (element.contains(document.elementFromPoint(x, y))) return { x, y };
      }
    }
    throw new Error('action target has no visible touchscreen point');
  });
  await page.evaluate(() => {
    window.__latencyResult = { pointer: 0, mutation: 0, paintBoundary: 0, authority: 0, events: [] };
    const result = window.__latencyResult;
    const table = document.querySelector('.table');
    addEventListener('pointerdown', () => { result.pointer = performance.now(); }, { once: true, capture: true });
    new PerformanceObserver((list) => result.events.push(...list.getEntries().map((entry) => ({
      duration: entry.duration, interactionId: entry.interactionId, startTime: entry.startTime,
    })))).observe({ type: 'event', buffered: true, durationThreshold: 0 });
    const observer = new MutationObserver(() => {
      const busy = table?.getAttribute('aria-busy') === 'true';
      if (busy && !result.mutation) {
        result.mutation = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { result.paintBoundary = performance.now(); }));
      }
      if (!busy && result.mutation && !result.authority) {
        result.authority = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(table, { attributes: true, subtree: true, attributeFilter: ['aria-busy', 'class'] });
  });
  if (holdMs) await page.evaluate(() => window.__latencyHold.start());
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => window.__latencyResult.paintBoundary > 0);
  let release = 0;
  if (holdMs) {
    await page.waitForTimeout(holdMs);
    release = await page.evaluate(() => { const now = performance.now(); window.__latencyHold.release(); return now; });
  }
  await page.waitForFunction(() => window.__latencyResult.authority > 0, null, { timeout: 20_000 });
  await page.waitForTimeout(150);
  const raw = await page.evaluate(() => window.__latencyResult);
  const inp = raw.events
    .filter((entry) => entry.interactionId > 0 && entry.startTime >= raw.pointer - 5)
    .reduce((max, entry) => Math.max(max, entry.duration), 0);
  return {
    phase, action, holdMs,
    domMutationMs: +(raw.mutation - raw.pointer).toFixed(1),
    secondRafPaintBoundaryMs: +(raw.paintBoundary - raw.pointer).toFixed(1),
    inpMs: +inp.toFixed(1),
    authorityFromTapMs: +(raw.authority - raw.pointer).toFixed(1),
    authorityAfterReleaseMs: holdMs ? +(raw.authority - release).toFixed(1) : null,
  };
}

async function runScenario(browser, { name, mobile, cpu, holdMs }) {
  const options = mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, hasTouch: true };
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await Promise.all([installInboundHold(host), installInboundHold(guest)]);
    for (const page of [host, guest]) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
    const code = await createRoom(host, 'Hana');
    await joinRoom(guest, code, 'Gil');
    await host.locator('.seats li', { hasText: 'Gil' }).waitFor({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Start game' }).click();
    await Promise.all([host.locator('.hand .card').first().waitFor(), guest.locator('.hand .card').first().waitFor()]);
    const actor = async () => {
      for (const page of [host, guest]) {
        if (await page.getByRole('button', { name: 'Face-down card' }).isEnabled()) return page;
      }
      for (const page of [host, guest]) {
        const keep = page.getByRole('button', { name: 'Keep it' });
        if (await keep.isVisible().catch(() => false) && await keep.isEnabled()) {
          await keep.click();
          await page.waitForTimeout(50);
          return actor();
        }
      }
      throw new Error('no legal draw actor or pass-turn setup action');
    };
    const first = await measureTouchTap(await actor(), 'first', holdMs);
    const warm = await measureTouchTap(await actor(), 'warm', holdMs);
    return { scenario: name, code, measurements: [first, warm] };
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const scenario of [
    { name: 'mobile-390x844-4x-cpu', mobile: true, cpu: 4, holdMs: 0 },
    { name: 'mobile-390x844-4x-cpu-inbound-held-400ms', mobile: true, cpu: 4, holdMs: 400 },
    { name: 'laptop-1440x900', mobile: false, cpu: 1, holdMs: 0 },
  ]) console.log(JSON.stringify(await runScenario(browser, scenario)));
} finally {
  await browser.close();
}
