import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeAudioText, sentenceChunks } from '../../lib/audio-text.ts';
import { sentenceTokens, isWordToken, normalizeToken } from '../../lib/sentence-words.ts';

export const audioVersion = 'kokoro-heart-q8-48k-v1';
export const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const voice = 'af_heart';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function loadCorpus() {
  const groups = await Promise.all(['cet4', 'cet6'].map(async (level) => JSON.parse(await readFile(new URL(`../../public/data/${level}.json`, import.meta.url), 'utf8'))));
  const uniqueWords = new Map();
  for (const word of groups.flat()) if (!uniqueWords.has(word.id)) uniqueWords.set(word.id, word);
  const entries = new Map();
  const sentences = new Set();
  const chunks = new Set();
  const tokens = new Set();
  const add = (input, kind) => {
    const text = normalizeAudioText(input);
    if (!text) return;
    const item = entries.get(text) ?? { text, id: digest(text).slice(0, 24), kinds: [] };
    if (!item.kinds.includes(kind)) item.kinds.push(kind);
    entries.set(text, item);
  };
  for (const word of uniqueWords.values()) {
    add(normalizeToken(word.word), 'word');
    for (const example of word.examples) {
      sentences.add(normalizeAudioText(example.english));
      add(example.english, 'sentence');
      for (const chunk of sentenceChunks(example.english)) { chunks.add(normalizeAudioText(chunk)); add(chunk, 'chunk'); }
      for (const token of sentenceTokens(example.english).filter(isWordToken)) { tokens.add(normalizeToken(token)); add(normalizeToken(token), 'token'); }
    }
  }
  const items = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Audio identifier collision');
  const corpusHash = digest(JSON.stringify({ audioVersion, items }));
  return { items, corpusHash, counts: { words: uniqueWords.size, sentences: sentences.size, chunks: chunks.size, tokens: tokens.size, recordings: items.length } };
}
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const corpus = await loadCorpus();
  const units = corpus.items.reduce((sum, item) => sum + Math.max(2, item.text.split(/\s+/).length), 0);
  console.log(JSON.stringify({ ...corpus.counts, corpusHash: corpus.corpusHash, estimateMBat48k: Math.round((units / 150 * 60 + corpus.items.length * 0.3) * 6000 / 1e6) }));
}
