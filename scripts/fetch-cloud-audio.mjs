import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  loadCorpus,
  digest,
  audioVersion,
  modelId,
  voice,
} from './cloud-audio/corpus.mjs';

// Download pre-generated recordings. No speech engine runs during a site build.
const root = path.resolve(import.meta.dirname, '..');
const corpus = await loadCorpus();
const lock = JSON.parse(
  await readFile(
    path.join(root, 'scripts/cloud-audio/release-lock.json'),
    'utf8',
  ),
);
assert.equal(
  lock.corpusHash,
  corpus.corpusHash,
  'Vocabulary changed: regenerate the cloud library before publishing',
);
assert.equal(lock.version, audioVersion);
assert.equal(lock.assets.length, 40);
assert.deepEqual(
  lock.assets.map((asset) => asset.shard).sort((a, b) => a - b),
  Array.from({ length: 40 }, (_, i) => i),
);
const archiveDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'work/audio-downloads');
const publicDirectory = path.join(root, 'public');
await mkdir(archiveDirectory, { recursive: true });
const records = new Map();
let next = 0;
async function collect() {
  while (next < lock.assets.length) {
    const asset = lock.assets[next++];
    assert.equal(
      asset.name,
      `shard-${String(asset.shard).padStart(3, '0')}.tar.gz`,
    );
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      asset.url,
      `https://github.com/CrystalXHorizon/cixu-cet-study/releases/download/${lock.tag}/${asset.name}`,
    );
    const archivePath = path.join(archiveDirectory, asset.name);
    let buffer;
    try {
      buffer = await readFile(archivePath);
    } catch {
      /* Download below. */
    }
    if (!buffer || digest(buffer) !== asset.sha256) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(asset.url, {
            signal: AbortSignal.timeout(120000),
          });
          if (!response.ok)
            throw new Error(`Audio batch download failed: ${response.status}`);
          buffer = Buffer.from(await response.arrayBuffer());
          assert.equal(digest(buffer), asset.sha256);
          await writeFile(archivePath, buffer);
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
    }
    assert.equal(buffer.length, asset.size);
    assert.equal(digest(buffer), asset.sha256);
    const entries = execFileSync('tar', ['-tf', archivePath], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
      .trim()
      .split(/\r?\n/);
    const metadataPath = `audio/shards/shard-${String(asset.shard).padStart(3, '0')}.json`;
    for (const entry of entries)
      assert.ok(
        /^audio\/(?:full\/(?:[a-f0-9]{2}\/(?:[a-f0-9]{24}\.mp3)?)?|shards\/(?:shard-\d{3}\.json)?)?$/.test(
          entry,
        ),
        `Unexpected archive path: ${entry}`,
      );
    const metadata = JSON.parse(
      execFileSync('tar', ['-xOf', archivePath, metadataPath], {
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
      }),
    );
    assert.equal(metadata.corpusHash, corpus.corpusHash);
    assert.equal(metadata.version, audioVersion);
    assert.equal(metadata.model, modelId);
    assert.equal(metadata.voice, voice);
    assert.equal(metadata.index, asset.shard);
    assert.equal(metadata.count, 40);
    assert.deepEqual(
      metadata.records
        .map((item) => item.id)
        .sort((a, b) => a.localeCompare(b)),
      corpus.items
        .filter((_, i) => i % 40 === asset.shard)
        .map((item) => item.id)
        .sort((a, b) => a.localeCompare(b)),
    );
    const expectedFiles = [
      metadataPath,
      ...metadata.records.map(
        (item) => `audio/full/${item.id.slice(0, 2)}/${item.id}.mp3`,
      ),
    ];
    assert.deepEqual(
      entries
        .filter((entry) => !entry.endsWith('/'))
        .sort((a, b) => a.localeCompare(b)),
      expectedFiles.sort((a, b) => a.localeCompare(b)),
    );
    execFileSync('tar', ['-xf', archivePath, '-C', publicDirectory]);
    for (const item of metadata.records) {
      assert.ok(!records.has(item.id));
      const file = path.join(
        publicDirectory,
        'audio/full',
        item.id.slice(0, 2),
        `${item.id}.mp3`,
      );
      assert.ok((await stat(file)).isFile());
      const audio = await readFile(file);
      assert.equal(audio.length, item.bytes);
      assert.equal(
        digest(audio),
        item.sha256,
        `Audio checksum mismatch: ${item.id}`,
      );
      assert.ok(item.duration >= 0.15 && item.duration <= 90);
      records.set(item.id, item);
    }
    console.log(
      `Verified batch ${asset.shard + 1}/40 (${metadata.records.length} recordings)`,
    );
  }
}
await Promise.all(Array.from({ length: 4 }, collect));
assert.equal(records.size, corpus.items.length);
for (const item of corpus.items) {
  const record = records.get(item.id);
  assert.equal(record.text, item.text);
  assert.deepEqual(record.kinds, item.kinds);
}
const actualFiles = (
  await Promise.all(
    (
      await readdir(path.join(publicDirectory, 'audio/full'))
    ).map(async (prefix) =>
      (await readdir(path.join(publicDirectory, 'audio/full', prefix))).map(
        (name) => `${prefix}/${name}`,
      ),
    ),
  )
)
  .flat()
  .sort();
assert.deepEqual(
  actualFiles,
  corpus.items.map((item) => `${item.id.slice(0, 2)}/${item.id}.mp3`).sort(),
);
const totalBytes = [...records.values()].reduce(
  (sum, item) => sum + item.bytes,
  0,
);
assert.ok(totalBytes < 850_000_000, 'Audio library exceeds site size budget');
await writeFile(
  path.join(publicDirectory, 'data/audio-index.json'),
  JSON.stringify({
    schemaVersion: 1,
    version: audioVersion,
    corpusHash: corpus.corpusHash,
    counts: corpus.counts,
    files: Object.fromEntries(corpus.items.map((item) => [item.text, item.id])),
  }),
);
await writeFile(
  path.join(publicDirectory, 'data/audio-integrity.json'),
  JSON.stringify({
    schemaVersion: 1,
    version: audioVersion,
    corpusHash: corpus.corpusHash,
    counts: corpus.counts,
    totalBytes,
    release: `https://github.com/CrystalXHorizon/cixu-cet-study/releases/tag/${lock.tag}`,
    records: corpus.items.map((item) => {
      const { id, bytes, duration, sha256 } = records.get(item.id);
      return { id, bytes, duration, sha256 };
    }),
  }),
);
console.log(
  JSON.stringify({
    verified: records.size,
    totalBytes,
    corpusHash: corpus.corpusHash,
  }),
);
