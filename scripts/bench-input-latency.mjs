import { chromium } from '@playwright/test';

async function installInboundHold(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    let holding = false;
    let sentIntents = 0;
    const queued = [];
    class HeldWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const nativeSend = this.send.bind(this);
        this.send = (data) => {
          if (typeof data === 'string' && data.includes('"type":"intent"')) sentIntents++;
          nativeSend(data);
        };
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
      sentIntents() { return sentIntents; },
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

async function visiblePoint(target) {
  return target.evaluate((element) => {
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
}

async function playableTarget(page) {
  const cards = page.locator('.hand .playable');
  const result = await cards.evaluateAll((elements) => {
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      if (!(element instanceof HTMLButtonElement) || element.disabled) continue;
      if (/wild/i.test(element.getAttribute('aria-label') ?? '')) continue;
      const rect = element.getBoundingClientRect();
      for (const yRatio of [0.15, 0.3, 0.5, 0.7, 0.85]) {
        for (const xRatio of [0.5, 0.25, 0.75]) {
          const x = rect.left + rect.width * xRatio;
          const y = rect.top + rect.height * yRatio;
          if (element.contains(document.elementFromPoint(x, y))) return { index, point: { x, y } };
        }
      }
    }
    return null;
  });
  return result ? { target: cards.nth(result.index), point: result.point } : null;
}

async function measureTouchTap(page, phase, action, holdMs) {
  const selected = action === 'play-card'
    ? await playableTarget(page)
    : { target: page.getByRole('button', { name: 'Face-down card' }), point: null };
  if (!selected) throw new Error('no visible playable-card touchscreen target');
  const point = selected.point ?? await visiblePoint(selected.target);
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
  const intentsBefore = await page.evaluate(() => window.__latencyHold.sentIntents());
  if (holdMs) await page.evaluate(() => window.__latencyHold.start());
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => window.__latencyResult.paintBoundary > 0);
  let release = 0;
  if (holdMs) {
    // Exercise the duplicate guard with the same real touchscreen target.
    await page.touchscreen.tap(point.x, point.y);
    const remaining = await page.evaluate((delay) => Math.max(
      0, delay - (performance.now() - window.__latencyResult.pointer),
    ), holdMs);
    await page.waitForTimeout(remaining);
    release = await page.evaluate(() => { const now = performance.now(); window.__latencyHold.release(); return now; });
  }
  await page.waitForFunction(() => window.__latencyResult.authority > 0, null, { timeout: 20_000 });
  await page.waitForTimeout(150);
  const raw = await page.evaluate(() => window.__latencyResult);
  const intentsAfter = await page.evaluate(() => window.__latencyHold.sentIntents());
  const inp = raw.events
    .filter((entry) => entry.interactionId > 0 && entry.startTime >= raw.pointer - 5)
    .reduce((max, entry) => Math.max(max, entry.duration), 0);
  return {
    phase, action, holdMs,
    domMutationMs: +(raw.mutation - raw.pointer).toFixed(1),
    secondRafPaintBoundaryMs: +(raw.paintBoundary - raw.pointer).toFixed(1),
    inpMs: +inp.toFixed(1),
    authorityFromTapMs: +(raw.authority - raw.pointer).toFixed(1),
    releaseFromTapMs: holdMs ? +(release - raw.pointer).toFixed(1) : null,
    authorityAfterReleaseMs: holdMs ? +(raw.authority - release).toFixed(1) : null,
    outboundIntentDelta: intentsAfter - intentsBefore,
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
    const actor = async (action) => {
      for (const page of [host, guest]) {
        if (action === 'draw-card' && await page.getByRole('button', { name: 'Face-down card' }).isEnabled()) return page;
        if (action === 'play-card' && await playableTarget(page)) return page;
      }
      for (const page of [host, guest]) {
        const keep = page.getByRole('button', { name: 'Keep it' });
        if (await keep.isVisible().catch(() => false) && await keep.isEnabled()) {
          await keep.click();
          await page.waitForTimeout(50);
          return actor(action);
        }
      }
      // Deterministic setup fallback: advance one legal action until a visible
      // playable card exists, without including setup work in the benchmark.
      for (const page of [host, guest]) {
        const advanced = await page.evaluate(() => {
          const playable = [...document.querySelectorAll('.hand .playable')]
            .find((element) => element instanceof HTMLButtonElement && !element.disabled &&
              !/wild/i.test(element.getAttribute('aria-label') ?? ''));
          const draw = [...document.querySelectorAll('button')]
            .find((element) => element.getAttribute('aria-label') === 'Face-down card' && !element.disabled);
          const target = playable ?? draw;
          if (!(target instanceof HTMLButtonElement)) return false;
          target.click();
          return true;
        });
        if (advanced) {
          await page.waitForTimeout(80);
          return actor(action);
        }
      }
      throw new Error(`no legal ${action} actor or setup action`);
    };
    const card = await measureTouchTap(await actor('play-card'), 'card', 'play-card', holdMs);
    const draw = await measureTouchTap(await actor('draw-card'), 'draw', 'draw-card', holdMs);
    return { scenario: name, code, measurements: [card, draw] };
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
