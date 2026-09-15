export function normalizeAudioText(text: string) {
  return text.normalize('NFC').replaceAll('’', "'").replace(/\s+/g, ' ').trim();
}

export function sentenceChunks(sentence: string) {
  const clauses = sentence.match(/[^,;:!?.]+[,;:!?.]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [sentence];
  return clauses.flatMap((clause) => {
    const words = clause.split(/\s+/);
    if (words.length <= 10) return [clause];
    const count = Math.ceil(words.length / 8);
    const size = Math.ceil(words.length / count);
    return Array.from({ length: count }, (_, index) => words.slice(index * size, (index + 1) * size).join(' '));
  });
}
