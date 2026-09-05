import assert from 'node:assert/strict';
import test from 'node:test';
import { examSchedule } from '../lib/exam-session.ts';
import {
  greeting,
  normalizeNickname,
  progressPercent,
  restoreListeningHistory,
} from '../lib/study-dashboard.ts';
import { buildListeningQueue } from '../lib/listening-queue.ts';
import {
  DEFAULT_AUDIO,
  englishVoices,
  restoreAudioPreferences,
  sentenceChunks,
  SpeechPlayer,
} from '../lib/speech-player.ts';

test('confirmed exams use official dates; unannounced sessions remain estimates', () => {
  assert.deepEqual(
    [examSchedule('2026-12').date, examSchedule('2026-12').confirmed],
    ['2026-12-12', true],
  );
  assert.deepEqual(
    [examSchedule('2027-06').date, examSchedule('2027-06').confirmed],
    ['2027-06-15', false],
  );
});

test('names are optional, bounded, and greeted according to local time', () => {
  assert.equal(normalizeNickname(null), '');
  assert.equal(normalizeNickname('  小   林  '), '小 林');
  assert.equal(normalizeNickname('x'.repeat(100)).length, 24);
  assert.equal(greeting('小林', new Date(2026, 8, 5, 9)), '早上好，小林');
  assert.equal(greeting('', new Date(2026, 8, 5, 20)), '晚上好，同学');
});

test('progress handles zero targets and remains bounded', () => {
  assert.ok(Math.abs(progressPercent(5, 35) - 100 / 7) < 1e-10);
  assert.equal(progressPercent(10, 0), 0);
  assert.equal(progressPercent(10, 5), 100);
  assert.equal(progressPercent(-2, 5), 0);
});

test('old or invalid backups restore audio and listening defaults safely', () => {
  assert.deepEqual(restoreAudioPreferences(null), DEFAULT_AUDIO);
  assert.equal(
    restoreAudioPreferences({ rate: Infinity }).rate,
    DEFAULT_AUDIO.rate,
  );
  assert.equal(restoreAudioPreferences({ rate: 9 }).rate, 1.2);
  assert.deepEqual(restoreListeningHistory(undefined), {});
  assert.deepEqual(
    restoreListeningHistory({
      '2026-09-05': { completed: 5, understood: 3 },
      '2026-09-06': { completed: 2, understood: 3 },
      bad: null,
    }),
    { '2026-09-05': { completed: 5, understood: 3 } },
  );
});

const voices = [
  { voiceURI: 'cn', name: 'Chinese Natural', lang: 'zh-CN' },
  { voiceURI: 'basic', name: 'Basic English', lang: 'en-US' },
  { voiceURI: 'natural', name: 'English Natural', lang: 'en-GB' },
];

test('voice selection prefers enhanced English, not a natural Chinese voice', () => {
  assert.deepEqual(
    englishVoices(voices).map((voice) => voice.voiceURI),
    ['natural', 'basic'],
  );
  assert.deepEqual(
    sentenceChunks('She felt a breeze, and closed the window.'),
    ['She felt a breeze,', 'and closed the window.'],
  );
});

test('listening queue prioritizes weak words, then due words, without duplicate sentences', () => {
  const words = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    rank: i,
    examples: [{ english: `Sentence ${i}.`, chinese: '' }],
  }));
  const reviews = { 6: { due: '2026-09-04' }, 5: { due: '2026-09-10' } };
  const marked = { english: 'A marked sentence.', chinese: '标记原句' };
  const result = buildListeningQueue(
    words,
    reviews,
    ['7'],
    [{ wordId: '7', example: marked }],
    '2026-09-05',
  );
  assert.deepEqual(
    result.map((item) => item.word.id),
    ['7', '6', '5', '0', '1'],
  );
  assert.equal(result[0].example, marked);
  assert.deepEqual(buildListeningQueue([], {}, [], [], '2026-09-05'), []);
  words[1].examples = words[0].examples;
  assert.equal(
    new Set(
      buildListeningQueue(words, {}, [], [], '2026-09-05').map(
        (item) => item.example.english,
      ),
    ).size,
    5,
  );
});

function fakePlayer(available = voices) {
  const utterances = [];
  const listeners = new Set();
  const engine = {
    getVoices: () => available,
    cancel() {},
    pause() {},
    resume() {},
    speak(utterance) {
      utterances.push(utterance);
      utterance.onstart?.();
    },
    addEventListener(_, fn) {
      listeners.add(fn);
    },
    removeEventListener(_, fn) {
      listeners.delete(fn);
    },
  };
  return {
    player: new SpeechPlayer(
      () => engine,
      (text) => ({ text }),
    ),
    utterances,
    listeners,
  };
}

test('player honors selected voice and prevents stale callbacks after switching audio', async () => {
  const { player, utterances } = fakePlayer();
  await player.play('First.', { voiceURI: 'basic', rate: 0.85 });
  const first = utterances[0];
  assert.equal(first.voice.voiceURI, 'basic');
  assert.equal(first.rate, 0.85);
  await player.play('Second.');
  first.onend();
  first.onerror({ error: 'network' });
  assert.equal(player.getSnapshot().status, 'playing');
  player.stop();
  utterances[1].onstart();
  assert.equal(player.getSnapshot().status, 'idle');
});

test('pause between repetitions defers next playback until resume', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { player, utterances } = fakePlayer();
  await player.play('Repeat.', DEFAULT_AUDIO, 3);
  utterances[0].onend();
  player.pause();
  context.mock.timers.tick(1000);
  assert.equal(utterances.length, 1);
  player.resume();
  assert.equal(utterances.length, 2);
  utterances[1].onend();
  player.stop();
  context.mock.timers.tick(1000);
  assert.equal(utterances.length, 2);
  assert.equal(player.getSnapshot().status, 'idle');
});

test('leaving while voices initialize cancels pending speech and subscriptions', async () => {
  const { player, utterances, listeners } = fakePlayer([]);
  const loading = player.play('Do not speak after exit.');
  assert.equal(player.getSnapshot().status, 'loading');
  player.stop();
  await loading;
  assert.equal(utterances.length, 0);
  assert.equal(listeners.size, 0);
});

test('unsupported speech reports a useful error', async () => {
  const player = new SpeechPlayer(() => undefined);
  await player.play('Hello.');
  assert.equal(player.getSnapshot().status, 'error');
  assert.match(player.getSnapshot().message, /不支持朗读/);
});
