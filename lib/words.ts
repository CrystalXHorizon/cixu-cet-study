export type WordLevel = 'cet4' | 'cet6';

export type SentenceExample = {
  english: string;
  chinese: string;
};

export type Word = {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  examples: SentenceExample[];
  level: WordLevel;
  rank: number;
};

export const WORD_COUNTS = {
  cet4: 4533,
  cet6Extra: 1176,
  cet6Total: 5709,
} as const;

const wordCache = new Map<WordLevel, Promise<Word[]>>();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

async function fetchWordFile(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`词库加载失败：${response.status}`);
  return response.json() as Promise<Word[]>;
}

export function loadWords(level: WordLevel) {
  const cached = wordCache.get(level);
  if (cached) return cached;

  const request = Promise.all([
    fetchWordFile(`${basePath}/data/cet4.json`),
    ...(level === 'cet6' ? [fetchWordFile(`${basePath}/data/cet6.json`)] : []),
  ]).then((groups) => {
    const unique = new Map<string, Word>();
    for (const word of groups.flat()) {
      if (!unique.has(word.id)) unique.set(word.id, word);
    }
    return Array.from(unique.values()).sort(
      (left, right) => left.rank - right.rank || left.word.localeCompare(right.word),
    );
  }).catch((error) => {
    wordCache.delete(level);
    throw error;
  });
  wordCache.set(level, request);
  return request;
}
