import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPronunciation } from '../lib/pronunciation.ts';
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
