import { normalizeAudioText } from './audio-text.ts';
export type CloudAudioIndex = {
  schemaVersion: number;
  version: string;
  corpusHash: string;
  counts: {
    words: number;
    sentences: number;
    chunks: number;
    tokens: number;
    recordings: number;
  };
  files: Record<string, string>;
};
const base = import.meta.env?.BASE_URL ?? '/';
let index: CloudAudioIndex | undefined;
let loading: Promise<void> | undefined;
export function cloudAudioUrl(text: string) {
  const key = normalizeAudioText(text);
  const id =
    index && Object.hasOwn(index.files, key) ? index.files[key] : undefined;
  return id ? `${base}audio/full/${id.slice(0, 2)}/${id}.mp3` : undefined;
}
export function prepareAudioCatalog(): Promise<void> {
  if (index) return Promise.resolve();
  if (loading) return loading;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  loading = fetch(`${base}data/audio-index.json`, {
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('Audio catalog unavailable');
      const data = (await response.json()) as CloudAudioIndex;
      if (
        data.schemaVersion !== 1 ||
        !data.files ||
        Object.values(data.files).some((id) => !/^[a-f0-9]{24}$/.test(id))
      )
        throw new Error('Invalid audio catalog');
      index = data;
    })
    .finally(() => {
      clearTimeout(timeout);
      loading = undefined;
    });
  return loading;
}
