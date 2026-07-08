import { chromium } from '@playwright/test';

const urls = process.env.TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean);
const username = process.env.TURN_USERNAME;
const credential = process.env.TURN_CREDENTIAL;
if (!urls?.length || !username || !credential) {
  throw new Error('TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL are required');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const candidate = await page.evaluate(async ({ urls, username, credential }) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls, username, credential }],
      iceTransportPolicy: 'relay'
    });
    try {
      pc.createDataChannel('verify');
      await pc.setLocalDescription(await pc.createOffer());
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No relay candidate within 15 seconds')), 15_000);
        pc.addEventListener('icecandidate', (event) => {
          if (event.candidate?.type !== 'relay') return;
          clearTimeout(timeout);
          resolve(event.candidate.candidate);
        });
        pc.addEventListener('icecandidateerror', (event) => {
          if (event.errorCode >= 400) {
            clearTimeout(timeout);
            reject(new Error(`ICE ${event.errorCode}: ${event.errorText}`));
          }
        });
      });
    } finally {
      pc.close();
    }
  }, { urls, username, credential });
  console.log(`TURN relay candidate gathered: ${candidate}`);
} finally {
  await browser.close();
}
