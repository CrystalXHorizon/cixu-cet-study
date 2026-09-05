import type { SentenceExample, Word } from './words';
import type { ReviewRecord, SentenceMark } from './sentence-words';

export type ListeningItem = { word: Word; example: SentenceExample };

export function buildListeningQueue(
  words: Word[],
  reviews: Record<string, ReviewRecord>,
  mistakes: string[],
  marks: SentenceMark[],
  today: string,
): ListeningItem[] {
  const weak = new Set(mistakes);
  const priority = (word: Word) =>
    weak.has(word.id)
      ? 0
      : reviews[word.id]?.due <= today
        ? 1
        : reviews[word.id]
          ? 2
          : 3;
  const ordered = [...words].sort(
    (a, b) => priority(a) - priority(b) || a.rank - b.rank,
  );
  const seen = new Set<string>();
  const result: ListeningItem[] = [];
  for (const word of ordered) {
    const example =
      marks.find((mark) => mark.wordId === word.id)?.example ??
      word.examples[0];
    if (!example?.english.trim() || seen.has(example.english)) continue;
    seen.add(example.english);
    result.push({ word, example });
    if (result.length === 5) break;
  }
  return result;
}
