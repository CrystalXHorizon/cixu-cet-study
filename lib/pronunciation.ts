export type Pronunciation = {
  url: string;
  fallbackUrl?: string;
  sourceUrl?: string;
  license?: { name?: string; url?: string };
};
export async function resolveOriginalRecording(
  recording: Pronunciation,
): Promise<Pronunciation> {
  if (!recording.sourceUrl) return recording;
  try {
    const source = new URL(recording.sourceUrl);
    if (source.hostname !== 'commons.wikimedia.org') return recording;
    const query = new URLSearchParams({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      format: 'json',
      origin: '*',
    });
    const pageId = source.searchParams.get('curid');
    if (pageId && /^\d+$/.test(pageId)) query.set('pageids', pageId);
    else if (source.pathname.startsWith('/wiki/File:'))
      query.set('titles', decodeURIComponent(source.pathname.slice(6)));
    else return recording;
    const response = await fetch(
      `https://commons.wikimedia.org/w/api.php?${query}`,
      { signal: AbortSignal.timeout(4000), credentials: 'omit' },
    );
    if (!response.ok) return recording;
    const data = await response.json();
    const pages = Object.values(data.query?.pages ?? {}) as Array<{
      imageinfo?: Array<{ url?: string }>;
    }>;
    const original = pages[0]?.imageinfo?.[0]?.url;
    if (
      !original ||
      new URL(original).hostname !== 'upload.wikimedia.org' ||
      !original.startsWith('https://')
    )
      return recording;
    return { ...recording, url: original, fallbackUrl: recording.url };
  } catch {
    return recording;
  }
}
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
      const result = await resolveOriginalRecording(selected);
      cache.set(key, result);
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
