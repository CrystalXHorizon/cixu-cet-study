import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  examPlanningDate,
  examSessionOptions,
  nextExamSession,
  normalizeExamSession,
} from '../lib/exam-session.ts';
import {
  findSentenceWord,
  isWordToken,
  normalizeToken,
  restoreSentenceMarks,
  saveSentenceMarks,
  sentenceTokens,
} from '../lib/sentence-words.ts';

const wordData = JSON.parse(
  readFileSync(new URL('../public/data/cet4.json', import.meta.url), 'utf8'),
);
const dictionary = new Map(
  wordData.map((word) => [normalizeToken(word.word), word]),
);
const example = {
  english: 'She felt a slight breeze on her face.',
  chinese: '她感到脸上有一丝微风。',
};
const feel = findSentenceWord('felt', dictionary);
const initial = {
  sentenceMarks: [],
  mistakes: [],
  reviews: {},
  history: { '2026-09-05': { reviewed: 5, correct: 4, learned: 2 } },
};

test('legacy dates become June/December sessions and invalid backups fall back safely', () => {
  assert.equal(normalizeExamSession('2026-12-13'), '2026-12');
  assert.equal(normalizeExamSession('2027-04-20'), '2027-06');
  assert.equal(normalizeExamSession(null, new Date(2026, 8, 5)), '2026-12');
  assert.equal(examPlanningDate('2026-12-13'), '2026-12-12');
  assert.equal(nextExamSession(new Date(2026, 11, 31)), '2026-12');
  assert.equal(nextExamSession(new Date(2027, 0, 1)), '2027-06');
});

test('session choices cross years, have no arbitrary dates, and retain a past selection', () => {
  const choices = examSessionOptions('2026-06', new Date(2026, 8, 5));
  assert.ok(choices.every((option) => /^\d{4}-(06|12)$/.test(option.value)));
  assert.equal(choices[0].disabled, true);
  assert.deepEqual(
    choices
      .filter((option) => !option.disabled)
      .slice(0, 2)
      .map((option) => option.value),
    ['2026-12', '2027-06'],
  );
});

test('sentence words preserve punctuation, contractions, and complete inflections', () => {
  const sentence =
    'He slighted her; she didn’t answer the well-known question.';
  assert.equal(sentenceTokens(sentence).join(''), sentence);
  assert.ok(sentenceTokens(sentence).filter(isWordToken).includes('didn’t'));
  assert.equal(findSentenceWord('slighted', dictionary)?.word, 'slight');
  assert.equal(feel?.word, 'feel');
  assert.equal(findSentenceWord('ignoring', dictionary)?.word, 'ignore');
  assert.equal(
    findSentenceWord(
      'slightly',
      new Map([['slight', dictionary.get('slight')]]),
    ),
    undefined,
  );
});

test('marking schedules a dictionary word without recording an incorrect answer or study activity', () => {
  assert.ok(feel);
  const mark = { token: 'felt', example, wordId: feel.id };
  const saved = saveSentenceMarks(initial, example, [mark, mark], '2026-09-05');
  assert.equal(saved.sentenceMarks.length, 1);
  assert.deepEqual(saved.mistakes, [feel.id]);
  assert.equal(saved.reviews[feel.id].due, '2026-09-05');
  assert.equal(saved.reviews[feel.id].wrong, 0);
  assert.equal(saved.reviews[feel.id].lastReviewed, '');
  assert.deepEqual(saved.history, initial.history);
  assert.deepEqual(initial.reviews, {});
  const reviewed = {
    ...saved,
    reviews: {
      [feel.id]: { ...saved.reviews[feel.id], due: '2026-09-08', correct: 1 },
    },
  };
  assert.deepEqual(
    saveSentenceMarks(reviewed, example, [mark], '2026-09-06').reviews,
    reviewed.reviews,
  );
});

test('unknown dictionary entries survive backup/restore and can be unmarked', () => {
  const unknownExample = {
    english: 'Xylophoria is a name.',
    chinese: 'Xylophoria 是一个名字。',
  };
  const mark = { token: 'Xylophoria', example: unknownExample };
  const saved = saveSentenceMarks(
    initial,
    unknownExample,
    [mark],
    '2026-09-05',
  );
  assert.equal(saved.sentenceMarks.length, 1);
  assert.deepEqual(saved.reviews, {});
  assert.deepEqual(saved.mistakes, []);
  const restored = restoreSentenceMarks(
    JSON.parse(JSON.stringify(saved)).sentenceMarks,
  );
  assert.equal(restored[0].example.english, unknownExample.english);
  assert.deepEqual(restoreSentenceMarks(undefined), []);
  assert.deepEqual(restoreSentenceMarks([null, {}, { token: 'one' }]), []);
  assert.equal(
    saveSentenceMarks(saved, unknownExample, [], '2026-09-05').sentenceMarks
      .length,
    0,
  );
});

test('unmarking retains real mistakes and marks in other sentences', () => {
  const mark = { token: 'felt', example, wordId: feel.id };
  const saved = saveSentenceMarks(initial, example, [mark], '2026-09-05');
  const second = { english: 'She felt happy.', chinese: '她感到开心。' };
  const two = saveSentenceMarks(
    saved,
    second,
    [{ ...mark, example: second }],
    '2026-09-05',
  );
  const one = saveSentenceMarks(two, example, [], '2026-09-05');
  assert.equal(one.sentenceMarks.length, 1);
  assert.ok(one.mistakes.includes(feel.id));
  const mistaken = {
    ...one,
    reviews: { [feel.id]: { ...one.reviews[feel.id], wrong: 2 } },
  };
  assert.ok(
    saveSentenceMarks(mistaken, second, [], '2026-09-05').mistakes.includes(
      feel.id,
    ),
  );
  assert.deepEqual(
    saveSentenceMarks(saved, example, [], '2026-09-05').mistakes,
    [],
  );
});
