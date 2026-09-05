import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectPronunciation,
  preparePronunciation,
} from '../lib/pronunciation.ts';
import { SpeechPlayer } from '../lib/speech-player.ts';
import {
  calendarDay,
  learningDays,
  scheduleForDay,
} from '../lib/study-schedule.ts';

test('isolated word pronunciation prefers stressed recordings', () => {
  const result = selectPronunciation([
    {
      phonetics: [
        { audio: 'https://example.com/you-us-unstressed.mp3' },
        { audio: 'https://example.com/you-uk-stressed.mp3' },
        {
          audio: 'https://example.com/you-us-stressed.mp3',
          sourceUrl: 'https://example.com/source',
        },
      ],
    },
  ]);
  assert.equal(result.url, 'https://example.com/you-us-stressed.mp3');
  assert.equal(result.sourceUrl, 'https://example.com/source');
  assert.equal(
    selectPronunciation([{ phonetics: [{ audio: 'javascript:alert(1)' }] }]),
    undefined,
  );
});

test('blocked recording provides a direct, synchronous retry and no silent TTS fallback', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => [
      { phonetics: [{ audio: 'https://example.com/retry-us.mp3' }] },
    ],
  }));
  await preparePronunciation('retry-test');
  let calls = 0;
  const audio = {
    pause() {},
    play() {
      calls++;
      return calls === 1
        ? Promise.reject(new DOMException('Blocked', 'NotAllowedError'))
        : Promise.resolve();
    },
  };
  const player = new SpeechPlayer(
    () => undefined,
    () => {
      throw new Error('Must not use TTS for blocked recording');
    },
    () => audio,
  );
  await player.playWord('retry-test');
  assert.equal(player.getSnapshot().retryable, true);
  assert.match(player.getSnapshot().message, /声音已经准备好了/);
  player.retry();
  assert.equal(
    calls,
    2,
    'cached audio starts inside the retry gesture before any await',
  );
  await Promise.resolve();
  assert.equal(player.getSnapshot().status, 'playing');
  assert.equal(audio.volume, 1);
  assert.equal(audio.muted, false);
  audio.onended();
  assert.equal(player.getSnapshot().status, 'idle');
  player.stop();
});

test('local English speech works without requesting online audio', async (context) => {
  let requests = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    requests++;
    throw new Error('Offline');
  });
  let spoken;
  const engine = {
    getVoices: () => [
      { voiceURI: 'en', name: 'English', lang: 'en-US', localService: true },
    ],
    cancel() {},
    resume() {},
    speak(utterance) {
      spoken = utterance;
      utterance.onstart();
    },
  };
  const player = new SpeechPlayer(
    () => engine,
    (text) => ({ text }),
  );
  await player.playWord('offline-test');
  assert.equal(spoken.text, 'offline-test');
  assert.equal(requests, 0);
  assert.equal(player.getSnapshot().notice, '');
  assert.equal(player.getSnapshot().status, 'playing');
  player.stop();
  spoken.onend();
  assert.equal(player.getSnapshot().status, 'idle');
});

test('silent speech engines time out into a visible retry state', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = {
    getVoices: () => [{ name: 'English', lang: 'en-US' }],
    cancel() {},
    resume() {},
    speak() {},
  };
  const player = new SpeechPlayer(
    () => engine,
    (text) => ({ text }),
  );
  await player.play('Hello');
  assert.equal(player.getSnapshot().status, 'loading');
  context.mock.timers.tick(5001);
  assert.equal(player.getSnapshot().status, 'error');
  assert.equal(player.getSnapshot().retryable, true);
  player.stop();
});

test('calendar counts real learning days once, including listening-only days', () => {
  assert.equal(calendarDay(new Date(2026, 8, 5)), '2026-09-05');
  assert.deepEqual(
    learningDays(
      { '2026-09-04': { reviewed: 2 }, '2026-09-05': { reviewed: 0 } },
      { '2026-09-04': { completed: 2 }, '2026-09-06': { completed: 1 } },
    ),
    ['2026-09-04', '2026-09-06'],
  );
});

test('schedule groups overdue words today, separates future dates and protects history', () => {
  const words = ['old', 'today', 'tomorrow', 'new'].map((id) => ({
    id,
    word: id,
  }));
  const reviews = {
    old: { due: '2026-09-01' },
    today: { due: '2026-09-05' },
    tomorrow: { due: '2026-09-06' },
  };
  const day = (date) =>
    scheduleForDay(date, '2026-09-05', words, reviews, 10, '2026-12-12', 21);
  assert.deepEqual(
    day('2026-09-05').due.map((word) => word.id),
    ['old', 'today'],
  );
  assert.deepEqual(
    day('2026-09-06').due.map((word) => word.id),
    ['tomorrow'],
  );
  assert.equal(day('2026-09-05').newWords, 1);
  assert.equal(day('2026-09-06').newWords, 0);
  assert.equal(day('2026-09-01').due.length, 0);
  assert.equal(day('2026-09-01').past, true);
  assert.equal(day('2026-12-13').examPassed, true);
  assert.equal(day('2026-12-01').newWords, 0);
  assert.equal(reviews.old.due, '2026-09-01');
});
