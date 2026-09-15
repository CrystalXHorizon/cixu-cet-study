import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadCorpus, digest, audioVersion, modelId, voice } from './corpus.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Speech synthesis runs only in GitHub Actions.');

if (!isMainThread) {
  const { KokoroTTS } = await import('kokoro-js');
  const { StyleTextToSpeech2Model, AutoTokenizer } = await import('@huggingface/transformers');
  const model = await StyleTextToSpeech2Model.from_pretrained(modelId, {
    dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const tts = new KokoroTTS(model, tokenizer);
  for (const item of workerData.items) {
    const started = Date.now();
    const directory = path.join(workerData.directory, 'audio/full', item.id.slice(0, 2));
    await mkdir(directory, { recursive: true });
    const wav = path.join(directory, `${item.id}.wav`);
    const mp3 = path.join(directory, `${item.id}.mp3`);
    const generated = await tts.generate(item.text, { voice, speed: 1 });
    await generated.save(wav);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-i', wav, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '48k', '-map_metadata', '-1', mp3]);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp3], { encoding: 'utf8' }).trim());
    if (!Number.isFinite(duration) || duration < 0.15 || duration > 90) throw new Error(`Invalid duration for ${item.id}: ${duration}`);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-threads', '1', '-i', mp3, '-f', 'null', '-']);
    const data = await readFile(mp3);
    await unlink(wav);
    parentPort.postMessage({ ...item, duration, bytes: data.length, sha256: digest(data), generationMs: Date.now() - started });
  }
  await model.dispose();
} else {
  const index = Number(process.argv[2]);
  const count = Number(process.argv[3]);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) throw new Error('Expected shard index and count.');
  const corpus = await loadCorpus();
  const items = corpus.items.filter((_, position) => position % count === index);
  const name = `shard-${String(index).padStart(3, '0')}`;
  const directory = path.resolve('work', name);
  await mkdir(path.join(directory, 'audio/shards'), { recursive: true });
  await mkdir('work/cloud-audio-output', { recursive: true });
  const records = [];
  const workers = Math.min(3, Math.max(1, availableParallelism() - 1));
  console.log(`${name}: ${items.length} recordings, ${workers} synthesis workers, corpus ${corpus.corpusHash}`);
  // Complete the shared model download before workers open the ONNX cache.
  // Concurrent first downloads can otherwise expose an incomplete model file.
  const { KokoroTTS } = await import('kokoro-js');
  const preload = await KokoroTTS.from_pretrained(modelId, { dtype: 'q8', device: 'cpu' });
  await preload.model.dispose();
  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, (_, worker) => new Promise((resolve, reject) => {
    const instance = new Worker(new URL(import.meta.url), { workerData: { directory, items: items.filter((_, i) => i % workers === worker) } });
    instance.on('message', (record) => {
      records.push(record);
      if (records.length % 25 === 0 || records.length === items.length) console.log(`${name}: ${records.length}/${items.length}, ${Math.round((Date.now() - started) / 1000)}s elapsed`);
    });
    instance.on('error', reject);
    instance.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Synthesis worker exited ${code}`)));
  })));
  if (records.length !== items.length) throw new Error('Incomplete shard');
  records.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path.join(directory, 'audio/shards', `${name}.json`), JSON.stringify({
    version: audioVersion, corpusHash: corpus.corpusHash, counts: corpus.counts, index, count,
    model: modelId, voice, bitrate: 48000, sampleRate: 24000, generatedAt: new Date().toISOString(),
    workflow: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    commit: process.env.GITHUB_SHA, records,
  }));
  const archive = path.resolve('work/cloud-audio-output', `${name}.tar.gz`);
  execFileSync('tar', ['-C', directory, '-czf', archive, 'audio']);
  console.log(`Completed ${items.length} recordings: ${archive}`);
}
