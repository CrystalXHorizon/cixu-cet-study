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
  restoreAudioPreferences,
  sentenceChunks,
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

test('sentence chunks retain punctuation and match the cloud corpus', () => {
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
