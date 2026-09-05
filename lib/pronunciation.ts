export type Pronunciation = {
  url: string;
  sourceUrl?: string;
  license?: { name?: string; url?: string };
};
const cache = new Map<string, Pronunciation>();
const pending = new Map<string, Promise<Pronunciation>>();
export function cachedPronunciation(word: string) {
  return cache.get(word.trim().toLowerCase());
}
export function selectPronunciation(
  entries: unknown,
): Pronunciation | undefined {
  if (!Array.isArray(entries)) return;
  const choices = entries
    .flatMap((entry) =>
      Array.isArray(entry?.phonetics) ? entry.phonetics : [],
    )
    .filter(
      (item) =>
        typeof item?.audio === 'string' &&
        /^(https:\/\/|\/\/)/.test(item.audio),
    );
  const score = (url: string) =>
    (/unstressed/i.test(url) ? -10 : /stressed/i.test(url) ? 10 : 0) +
    (/-us[.-]/i.test(url) ? 2 : 0);
  choices.sort((a, b) => score(b.audio) - score(a.audio));
  const item = choices[0];
  if (!item) return;
  return {
    url: item.audio.startsWith('//') ? `https:${item.audio}` : item.audio,
    sourceUrl: item.sourceUrl,
    license: item.license,
  };
}
export function preparePronunciation(word: string): Promise<Pronunciation> {
  const key = word.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const current = pending.get(key);
  if (current) return current;
  const request = fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
    { signal: AbortSignal.timeout(6000) },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error('Pronunciation unavailable');
      const selected = selectPronunciation(await response.json());
      if (!selected) throw new Error('No recording');
      cache.set(key, selected);
      return selected;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
