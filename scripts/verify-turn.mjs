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
  const proof = await page.evaluate(async ({ urls, username, credential }) => {
    const config = {
      iceServers: [{ urls, username, credential }],
      iceTransportPolicy: 'relay'
    };
    const offerer = new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay' });
    const answerer = new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay' });
    const pendingForOfferer = [];
    const pendingForAnswerer = [];
    let signalingError;

    const forwardCandidate = async (candidate, target, pending) => {
      if (!candidate) return;
      if (!target.remoteDescription) {
        pending.push(candidate);
        return;
      }
      await target.addIceCandidate(candidate);
    };
    offerer.addEventListener('icecandidate', (event) => {
      forwardCandidate(event.candidate, answerer, pendingForAnswerer).catch((error) => {
        signalingError = error;
      });
    });
    answerer.addEventListener('icecandidate', (event) => {
      forwardCandidate(event.candidate, offerer, pendingForOfferer).catch((error) => {
        signalingError = error;
      });
    });

    const message = 'wildcard-turn-relay-proof';
    const received = new Promise((resolve) => {
      answerer.addEventListener('datachannel', (event) => {
        event.channel.addEventListener('message', (messageEvent) => resolve(messageEvent.data), { once: true });
      }, { once: true });
    });
    const channel = offerer.createDataChannel('verify');

    const waitFor = (description, predicate, timeoutMs = 20_000) => new Promise((resolve, reject) => {
      if (predicate()) {
        resolve();
        return;
      }
      const interval = setInterval(() => {
        if (!predicate()) return;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }, 25);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${description}`));
      }, timeoutMs);
    });

    try {
      await offerer.setLocalDescription(await offerer.createOffer());
      await answerer.setRemoteDescription(offerer.localDescription);
      await Promise.all(pendingForAnswerer.splice(0).map((candidate) => answerer.addIceCandidate(candidate)));
      await answerer.setLocalDescription(await answerer.createAnswer());
      await offerer.setRemoteDescription(answerer.localDescription);
      await Promise.all(pendingForOfferer.splice(0).map((candidate) => offerer.addIceCandidate(candidate)));

      await waitFor('data channel to open', () => channel.readyState === 'open');
      if (signalingError) throw signalingError;
      channel.send(message);
      const receivedMessage = await Promise.race([
        received,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for data message')), 5_000))
      ]);
      if (receivedMessage !== message) throw new Error(`Unexpected data message: ${receivedMessage}`);
      await waitFor('both ICE transports to connect', () =>
        ['connected', 'completed'].includes(offerer.iceConnectionState)
        && ['connected', 'completed'].includes(answerer.iceConnectionState));

      const stats = await offerer.getStats();
      const transport = [...stats.values()].find((report) => report.type === 'transport' && report.selectedCandidatePairId);
      const pair = transport
        ? stats.get(transport.selectedCandidatePairId)
        : [...stats.values()].find((report) =>
            report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated || report.selected));
      if (!pair) throw new Error('No selected ICE candidate pair in WebRTC stats');
      const localCandidate = stats.get(pair.localCandidateId);
      const remoteCandidate = stats.get(pair.remoteCandidateId);
      if (localCandidate?.candidateType !== 'relay') {
        throw new Error(`Selected local candidate is ${localCandidate?.candidateType ?? 'missing'}, not relay`);
      }

      return {
        dataMessage: receivedMessage,
        offererIceState: offerer.iceConnectionState,
        answererIceState: answerer.iceConnectionState,
        pairState: pair.state,
        localCandidateType: localCandidate.candidateType,
        localProtocol: localCandidate.protocol,
        localRelayProtocol: localCandidate.relayProtocol,
        localAddress: localCandidate.address ?? localCandidate.ip,
        localPort: localCandidate.port,
        remoteCandidateType: remoteCandidate?.candidateType,
        bytesSent: pair.bytesSent,
        bytesReceived: pair.bytesReceived
      };
    } finally {
      channel.close();
      offerer.close();
      answerer.close();
    }
  }, { urls, username, credential });

  console.log(`TURN relay data connection verified: ${JSON.stringify(proof)}`);
} finally {
  await browser.close();
}
