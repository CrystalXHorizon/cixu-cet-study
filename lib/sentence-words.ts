import type { SentenceExample, Word } from './words';

export type SentenceMark = {
  token: string;
  example: SentenceExample;
  wordId?: string;
};

export type ReviewRecord = {
  interval: number;
  due: string;
  correct: number;
  wrong: number;
  correctStreak: number;
  lastReviewed: string;
};

export function normalizeToken(token: string) {
  return token.toLowerCase().replaceAll('’', "'");
}

export function sentenceTokens(sentence: string) {
  return sentence.split(/([a-zA-Z]+(?:['’-][a-zA-Z]+)*)/g).filter(Boolean);
}

export function isWordToken(token: string) {
  return /^[a-zA-Z]+(?:['’-][a-zA-Z]+)*$/.test(token);
}

const irregularForms: Record<string, string> = {
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  felt: 'feel',
  went: 'go',
  gone: 'go',
  saw: 'see',
  seen: 'see',
  had: 'have',
  has: 'have',
  did: 'do',
  done: 'do',
  made: 'make',
  took: 'take',
  taken: 'take',
  gave: 'give',
  given: 'give',
  thought: 'think',
  bought: 'buy',
  brought: 'bring',
  caught: 'catch',
  found: 'find',
  knew: 'know',
  known: 'know',
  said: 'say',
  told: 'tell',
  wrote: 'write',
  written: 'write',
  left: 'leave',
  kept: 'keep',
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
};

export function findSentenceWord(token: string, dictionary: Map<string, Word>) {
  const value = normalizeToken(token);
  const exact = dictionary.get(value);
  if (exact) return exact;
  const candidates: string[] = [];
  if (irregularForms[value]) candidates.push(irregularForms[value]);
  if (value.endsWith("'s")) candidates.push(value.slice(0, -2));
  if (value.endsWith('ies') || value.endsWith('ied'))
    candidates.push(`${value.slice(0, -3)}y`);
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (!value.endsWith(suffix) || value.length <= suffix.length + 2) continue;
    const stem = value.slice(0, -suffix.length);
    candidates.push(stem);
    if (suffix === 'ed' || suffix === 'ing') {
      candidates.push(`${stem}e`);
      if (/([b-df-hj-np-tv-z])\1$/.test(stem))
        candidates.push(stem.slice(0, -1));
    }
    if (suffix === 'es') candidates.push(`${stem}e`);
  }
  return candidates.map((candidate) => dictionary.get(candidate)).find(Boolean);
}

export function sentenceMarkKey(mark: SentenceMark) {
  return JSON.stringify([mark.example.english, normalizeToken(mark.token)]);
}

export function restoreSentenceMarks(value: unknown): SentenceMark[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter((mark): mark is SentenceMark =>
    Boolean(
      mark &&
      typeof mark.token === 'string' &&
      isWordToken(mark.token) &&
      typeof mark.example?.english === 'string' &&
      typeof mark.example?.chinese === 'string' &&
      (mark.wordId === undefined || typeof mark.wordId === 'string'),
    ),
  );
  return [
    ...new Map(valid.map((mark) => [sentenceMarkKey(mark), mark])).values(),
  ];
}

export function saveSentenceMarks<
  T extends {
    sentenceMarks: SentenceMark[];
    reviews: Record<string, ReviewRecord>;
    mistakes: string[];
  },
>(
  state: T,
  example: SentenceExample,
  selected: SentenceMark[],
  today: string,
): T {
  const oldKeys = new Set(state.sentenceMarks.map(sentenceMarkKey));
  const tokens = new Set(
    sentenceTokens(example.english).filter(isWordToken).map(normalizeToken),
  );
  const valid = restoreSentenceMarks(selected).filter(
    (mark) =>
      mark.example.english === example.english &&
      tokens.has(normalizeToken(mark.token)),
  );
  const sentenceMarks = [
    ...state.sentenceMarks.filter(
      (mark) => mark.example.english !== example.english,
    ),
    ...valid,
  ];
  const reviews = { ...state.reviews };
  const mistakes = new Set(state.mistakes);
  for (const mark of valid) {
    if (!mark.wordId || oldKeys.has(sentenceMarkKey(mark))) continue;
    const previous = reviews[mark.wordId];
    reviews[mark.wordId] = {
      interval: 0,
      due: today,
      correct: previous?.correct ?? 0,
      wrong: previous?.wrong ?? 0,
      correctStreak: 0,
      lastReviewed: previous?.lastReviewed ?? '',
    };
    mistakes.add(mark.wordId);
  }
  for (const old of state.sentenceMarks) {
    if (old.example.english !== example.english || !old.wordId) continue;
    if (
      !sentenceMarks.some((mark) => mark.wordId === old.wordId) &&
      !reviews[old.wordId]?.wrong
    ) {
      mistakes.delete(old.wordId);
    }
  }
  return { ...state, sentenceMarks, reviews, mistakes: [...mistakes] };
}
