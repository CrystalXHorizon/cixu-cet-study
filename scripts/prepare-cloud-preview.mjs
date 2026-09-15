// Verify the downloaded cloud recordings and add text captions. No TTS runs here.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = new URL('../public/audio/cloud-preview/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
const corpus = JSON.parse(await readFile(new URL('../public/data/cet4.json', import.meta.url), 'utf8'));
assert.equal(manifest.generation.platform, 'GitHub Actions');
assert.equal(manifest.generation.repository, 'CrystalXHorizon/cixu-cet-study');
assert.equal(manifest.samples.length, 15);
assert.equal(new Set(manifest.samples.map((sample) => sample.id)).size, 15);
assert.equal((await readdir(directory)).filter((file) => file.endsWith('.mp3')).length, 15);
let totalBytes = 0;
let totalDuration = 0;
for (const sample of manifest.samples) {
  assert.match(sample.id, /^sentence-\d{2}$/);
  assert.equal(sample.file, `${sample.id}.mp3`);
  const audio = await readFile(new URL(sample.file, directory));
  assert.equal(createHash('sha256').update(audio).digest('hex'), sample.sha256, `${sample.id}: checksum mismatch`);
  assert.equal(audio.length, sample.bytes);
  assert(sample.duration > 0.5 && sample.duration < 30);
  assert(corpus.some((word) => word.word === sample.word && word.examples.some((example) => example.english === sample.english && example.chinese === sample.chinese)), `${sample.id}: not a corpus example`);
  const timestamp = `00:00:${sample.duration.toFixed(3).padStart(6, '0')}`;
  await writeFile(new URL(`${sample.id}.vtt`, directory), `WEBVTT\n\n00:00:00.000 --> ${timestamp}\n${sample.english}\n`);
  totalBytes += sample.bytes;
  totalDuration += sample.duration;
}
console.log(JSON.stringify({ verifiedSamples: 15, totalBytes, totalSeconds: Number(totalDuration.toFixed(2)), workflow: manifest.generation.runUrl }));
