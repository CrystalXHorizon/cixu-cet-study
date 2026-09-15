import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechPlayer, DEFAULT_AUDIO } from '../lib/speech-player.ts';
import { normalizeAudioText } from '../lib/audio-text.ts';
import { cloudAudioUrl, prepareAudioCatalog } from '../lib/cloud-audio.ts';

test('catalog retries failed requests and resolves normalized text to same-origin MP3 paths', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/data/audio-index.json');
    if (++calls === 1) return { ok: false };
    return {
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        files: { "It's ready.": '0123456789abcdef01234567' },
      }),
    };
  });
  await assert.rejects(prepareAudioCatalog());
  await Promise.all([prepareAudioCatalog(), prepareAudioCatalog()]);
  assert.equal(calls, 2);
  assert.equal(
    cloudAudioUrl(' It’s   ready. '),
    '/audio/full/01/0123456789abcdef01234567.mp3',
  );
  assert.equal(cloudAudioUrl('toString'), undefined);
});

function setup(overrides = {}) {
  const audio = {
    calls: 0,
    pause() {},
    load() {},
    removeAttribute() {},
    play() {
      this.calls++;
      return Promise.resolve();
    },
  };
  const player = new SpeechPlayer({
    resolveUrl: (text) => `/audio/${encodeURIComponent(text)}.mp3`,
    createAudio: () => audio,
    prepare: async () => {},
    ...overrides,
  });
  return { player, audio };
}
test('native MP3 playback starts synchronously and ignores stale callbacks', async () => {
  const { player, audio } = setup();
  const firstPlay = player.play('First.', {
    voiceURI: 'old-browser-voice',
    rate: 0.85,
  });
  assert.equal(audio.calls, 1);
  await firstPlay;
  assert.equal(audio.playbackRate, 0.85);
  assert.equal(audio.preservesPitch, true);
  const stale = [audio.onended, audio.onerror, audio.onplaying];
  await player.play('Second.');
  stale.forEach((callback) => callback());
  assert.equal(player.getSnapshot().status, 'playing');
  assert.equal(player.getSnapshot().text, 'Second.');
  player.stop();
  stale.forEach((callback) => callback());
  assert.equal(player.getSnapshot().status, 'idle');
});
test('blocked audio offers a synchronous retry on the same media element', async () => {
  const { player, audio } = setup();
  audio.play = function () {
    return ++this.calls === 1
      ? Promise.reject(new DOMException('Blocked', 'NotAllowedError'))
      : Promise.resolve();
  };
  await player.playWord('Hello');
  assert.equal(player.getSnapshot().retryable, true);
  player.retry();
  assert.equal(audio.calls, 2);
  await Promise.resolve();
  assert.equal(player.getSnapshot().status, 'playing');
  player.stop();
});
test('pause between repetitions waits for resume; stop cancels repetition', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { player, audio } = setup();
  await player.play('Repeat.', DEFAULT_AUDIO, 3);
  audio.onended();
  player.pause();
  context.mock.timers.tick(1000);
  assert.equal(audio.calls, 1);
  player.resume();
  assert.equal(audio.calls, 2);
  await Promise.resolve();
  audio.onended();
  player.stop();
  context.mock.timers.tick(1000);
  assert.equal(audio.calls, 2);
});
test('catalog completion respects pause and cancellation', async () => {
  for (const action of ['pause', 'stop']) {
    let ready = false,
      release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const { player, audio } = setup({
      resolveUrl: () => (ready ? '/audio.mp3' : undefined),
      prepare: () => waiting,
    });
    const loading = player.play('Wait.');
    player[action]();
    ready = true;
    release();
    await loading;
    assert.equal(audio.calls, 0);
    if (action === 'pause') {
      player.resume();
      assert.equal(audio.calls, 1);
    }
    player.stop();
  }
});
test('stalled downloads become retryable and late completion cannot revive them', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { player, audio } = setup();
  let finish;
  audio.play = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const loading = player.play('Slow.');
  context.mock.timers.tick(12001);
  assert.equal(player.getSnapshot().status, 'error');
  assert.equal(player.getSnapshot().retryable, true);
  finish();
  await loading;
  assert.equal(player.getSnapshot().status, 'error');
  player.stop();
});
test('unavailable recordings report an error without device speech synthesis', async () => {
  const { player, audio } = setup({ resolveUrl: () => undefined });
  await player.play('Unknown.');
  assert.equal(audio.calls, 0);
  assert.equal(player.getSnapshot().status, 'error');
  player.stop();
});
test('normalization preserves sentence case while normalizing quotes and spaces', () => {
  assert.equal(normalizeAudioText('  It’s   ready.\n'), "It's ready.");
});
