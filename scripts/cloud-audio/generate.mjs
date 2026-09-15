// Run only on GitHub's hosted runner; the website never imports this module.
import { KokoroTTS } from 'kokoro-js';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Audio generation is cloud-only. Run the Generate cloud audio preview GitHub workflow.');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'public/audio/cloud-preview');
await mkdir(directory, { recursive: true });
const words = JSON.parse(await readFile(path.join(root, 'public/data/cet4.json'), 'utf8'));
const selections = [
  ['time', 0, '日常短句'],
  ['practice', 0, '日常短句'],
  ['learn', 2, '日常短句'],
  ['remember', 0, '日常短句'],
  ['possible', 0, '日常短句'],
  ['people', 0, '自然连读'],
  ['understand', 0, '自然连读'],
  ['change', 0, '自然连读'],
  ['learn', 0, '自然连读'],
  ['support', 1, '自然连读'],
  ['environment', 2, '进阶表达'],
  ['education', 0, '进阶表达'],
  ['achieve', 0, '进阶表达'],
  ['knowledge', 2, '进阶表达'],
  ['responsibility', 1, '进阶表达'],
];
const examples = selections.map(([word, exampleIndex, group], index) => {
  const entry = words.find((entry) => entry.word === word);
  const example = entry?.examples[exampleIndex];
  if (!example?.english || !example?.chinese) throw new Error(`Missing example: ${word}/${exampleIndex}`);
  return { id: `sentence-${String(index + 1).padStart(2, '0')}`, word, group, ...example };
});
const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const voice = 'af_heart';
console.log('Loading Kokoro on the GitHub cloud CPU…');
const tts = await KokoroTTS.from_pretrained(modelId, { dtype: 'q8', device: 'cpu' });
const samples = [];
for (const example of examples) {
  const started = Date.now();
  const audio = await tts.generate(example.english, { voice, speed: 1 });
  const wav = path.join(directory, `${example.id}.wav`);
  const mp3 = path.join(directory, `${example.id}.mp3`);
  await audio.save(wav);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', mp3]);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', mp3], { encoding: 'utf8' }));
  const duration = Number(probe.format.duration);
  if (!(duration > 0.5 && duration < 30) || probe.streams[0]?.codec_name !== 'mp3') throw new Error(`Invalid audio: ${example.id}`);
  // Fully decode every result so truncated/corrupt media fails the cloud build.
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', mp3, '-f', 'null', '-']);
  const bytes = (await stat(mp3)).size;
  const sha256 = createHash('sha256').update(await readFile(mp3)).digest('hex');
  samples.push({ ...example, file: `${example.id}.mp3`, duration: Number(duration.toFixed(3)), bytes, sha256 });
  await unlink(wav);
  console.log(`${example.id}: ${duration.toFixed(2)} seconds, ${bytes} bytes, generated in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  engine: { library: 'kokoro-js', version: '1.2.1', model: modelId, voice, language: 'en-US', dtype: 'q8', speed: 1 },
  generation: { platform: 'GitHub Actions', repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` },
  samples,
};
await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await tts.model.dispose();
console.log(`Finished ${samples.length} cloud-generated MP3 files.`);
