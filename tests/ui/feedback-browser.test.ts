import { afterEach, describe, expect, it, vi } from 'vitest';
import appSource from '../../src/ui/App.svelte?raw';
import tableSource from '../../src/ui/screens/Table.svelte?raw';

type Listener = () => void;

function fakeBrowser() {
  const listeners = new Map<string, Set<Listener>>();
  const addEventListener = vi.fn((type: string, listener: Listener) => {
    const registered = listeners.get(type) ?? new Set<Listener>();
    registered.add(listener);
    listeners.set(type, registered);
  });
  const removeEventListener = vi.fn((type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  });
  const dispatch = (type: string) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener();
  };
  return { addEventListener, removeEventListener, dispatch };
}

describe('browser feedback initialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('is owned by the app shell rather than the gameplay table', () => {
    expect(appSource).toMatch(/import \{ initFeedback \} from ['"]\.\/feedback['"]/);
    expect(appSource.match(/\binitFeedback\(\)/g)).toHaveLength(1);
    expect(tableSource).not.toMatch(/\binitFeedback\b/);
  });

  it('warms audio once on the first app gesture and leaves later gestures alone', async () => {
    const browser = fakeBrowser();
    const resume = vi.fn(() => Promise.resolve());
    const AudioContext = vi.fn(function () {
      return { state: 'suspended', resume };
    });
    vi.stubGlobal('window', { ...browser, AudioContext });

    const { initFeedback } = await import('../../src/ui/feedback');
    initFeedback();
    initFeedback();

    expect(browser.addEventListener.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
    browser.dispatch('pointerdown');
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);

    browser.dispatch('pointerdown');
    browser.dispatch('pointerdown');
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('swallows audio initialization failures synchronously', async () => {
    const browser = fakeBrowser();
    const AudioContext = vi.fn(function () {
      throw new Error('audio unavailable');
    });
    vi.stubGlobal('window', { ...browser, AudioContext });

    const { initFeedback } = await import('../../src/ui/feedback');
    initFeedback();

    expect(() => browser.dispatch('pointerdown')).not.toThrow();
    expect(AudioContext).toHaveBeenCalledTimes(1);
  });
});
