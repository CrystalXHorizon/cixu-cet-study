import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const separator = value.indexOf('=');
    return separator === -1
      ? [value.replace(/^--/, ''), true]
      : [value.slice(2, separator), value.slice(separator + 1)];
  }),
);

const tempDir = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'Temp')
  : process.cwd();
const cet4Path = resolve(String(args.cet4 ?? resolve(tempDir, 'OpenEtymology-CET4.epub')));
const cet6Path = resolve(String(args.cet6 ?? resolve(tempDir, 'OpenEtymology-CET6.epub')));
const frequencyPath = resolve(
  String(args.frequency ?? resolve(tempDir, 'FrequencyWords-en-50k.txt')),
);
const outputDir = resolve(String(args.out ?? resolve(process.cwd(), 'public', 'data')));

const manualEntries = {
  africa: ['Africa', '/ˈæfrɪkə/', 'n.', '非洲', ['Africa is home to many different cultures.', '非洲拥有许多不同的文化。']],
  america: ['America', '/əˈmerɪkə/', 'n.', '美洲；美国', ['She spent a semester studying in America.', '她在美国学习了一个学期。']],
  asia: ['Asia', '/ˈeɪʒə/', 'n.', '亚洲', ['Asia is the largest continent in the world.', '亚洲是世界上最大的洲。']],
  atlantic: ['Atlantic', '/ətˈlæntɪk/', 'n. / adj.', '大西洋；大西洋的', ['The plane crossed the Atlantic during the night.', '飞机在夜间飞越了大西洋。']],
  australia: ['Australia', '/ɒˈstreɪliə/', 'n.', '澳大利亚', ['Australia is known for its unique wildlife.', '澳大利亚以独特的野生动物闻名。']],
  britain: ['Britain', '/ˈbrɪtən/', 'n.', '英国；不列颠', ['He returned to Britain after finishing the course.', '课程结束后，他回到了英国。']],
  canada: ['Canada', '/ˈkænədə/', 'n.', '加拿大', ['Canada has two official languages.', '加拿大有两种官方语言。']],
  check: ['check', '/tʃek/', 'v. / n.', '检查；核对；支票', ['Please check your answers before handing in the paper.', '交卷前请检查你的答案。']],
  dissatisfy: ['dissatisfy', '/dɪsˈsætɪsfaɪ/', 'v.', '使不满意；使失望', ['Poor service can quickly dissatisfy customers.', '糟糕的服务会很快令顾客不满。']],
  england: ['England', '/ˈɪŋɡlənd/', 'n.', '英格兰', ['She studied history at a university in England.', '她在英格兰的一所大学学习历史。']],
  europe: ['Europe', '/ˈjʊərəp/', 'n.', '欧洲', ['The railway connects several major cities in Europe.', '这条铁路连接欧洲的几座主要城市。']],
  france: ['France', '/frɑːns/', 'n.', '法国', ['France attracts millions of visitors every year.', '法国每年吸引数百万游客。']],
  germany: ['Germany', '/ˈdʒɜːməni/', 'n.', '德国', ['Germany has a strong tradition of engineering.', '德国有深厚的工程技术传统。']],
  india: ['India', '/ˈɪndiə/', 'n.', '印度', ['India has a large and diverse population.', '印度人口众多且文化多元。']],
  japan: ['Japan', '/dʒəˈpæn/', 'n.', '日本', ['Japan is made up of thousands of islands.', '日本由数千座岛屿组成。']],
  oceania: ['Oceania', '/ˌəʊsiˈɑːniə/', 'n.', '大洋洲', ['Oceania includes Australia and many Pacific islands.', '大洋洲包括澳大利亚和许多太平洋岛屿。']],
  outskirt: ['outskirt', '/ˈaʊtskɜːt/', 'n.', '市郊；边缘地带', ['The new campus was built on the outskirts of the city.', '新校区建在城市郊区。']],
  reflexion: ['reflexion', '/rɪˈflekʃən/', 'n.', '反射；映像；深思（reflection 的变体）', ['The old spelling reflexion is now less common than reflection.', '旧拼法 reflexion 如今不如 reflection 常见。']],
  spot: ['spot', '/spɒt/', 'n. / v.', '地点；斑点；发现', ['She spotted a small mistake in the final paragraph.', '她发现了最后一段中的一个小错误。']],
  'world-wide': ['world-wide', '/ˌwɜːldˈwaɪd/', 'adj. / adv.', '全世界的；在全世界', ['The event received world-wide attention.', '这场活动受到全世界的关注。']],
  'air-condition': ['air-condition', '/ˈeə kəndɪʃən/', 'v.', '给……装空调；调节空气', ['The library is air-conditioned throughout the summer.', '图书馆整个夏天都开着空调。']],
  telecommunication: ['telecommunication', '/ˌtelikəˌmjuːnɪˈkeɪʃən/', 'n.', '电信；远程通信', ['Modern telecommunication makes remote work possible.', '现代电信技术使远程工作成为可能。']],
};

const manualIdsByLevel = {
  cet4: ['africa', 'america', 'asia', 'atlantic', 'australia', 'britain', 'canada', 'check', 'dissatisfy', 'england', 'europe', 'france', 'germany', 'india', 'japan', 'oceania', 'outskirt', 'reflexion', 'spot', 'world-wide'],
  cet6: ['air-condition', 'telecommunication'],
};

function decodeHtml(value) {
  const entities = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
  };
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(
        code.toLowerCase().startsWith('x')
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10),
      ),
    )
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html, expression) {
  const match = html.match(expression);
  return match ? decodeHtml(match[1]) : '';
}

function createManualEntry(key, level, frequencyRanks, fallbackRank) {
  const [word, phonetic, partOfSpeech, meaning, example] = manualEntries[key];
  return {
    id: key,
    word,
    phonetic,
    partOfSpeech,
    meaning,
    examples: [{ english: example[0], chinese: example[1] }],
    level,
    rank: frequencyRanks.get(key) ?? 50_000 + fallbackRank,
  };
}

function archiveChapters(epubPath) {
  const listing = execFileSync('tar', ['-tf', epubPath], { encoding: 'utf8' });
  return listing
    .split(/\r?\n/)
    .filter((path) => /OEBPS\/text\/chapter-\d+\.xhtml$/i.test(path));
}

function readChapter(epubPath, chapterPath) {
  return execFileSync('tar', ['-xOf', epubPath, chapterPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseEntry(id, html, level, frequencyRanks, fallbackRank) {
  const word = firstMatch(html, /<h2>([\s\S]*?)<\/h2>/i);
  const key = (word || id).toLocaleLowerCase('en-US');
  const manual = manualEntries[key];
  if (manual) {
    return createManualEntry(key, level, frequencyRanks, fallbackRank);
  }
  const rawPronunciation = firstMatch(
    html,
    /<p class="pronunciation">([\s\S]*?)<\/p>/i,
  );
  const phonetic = rawPronunciation
    .replace(/\s*·\s*US\s*/i, ' · ')
    .replace(/^UK\s*/i, '')
    .trim();
  const definitionsHtml = html.match(
    /<ol class="definitions">([\s\S]*?)<\/ol>/i,
  )?.[1] ?? '';
  const definitions = Array.from(definitionsHtml.matchAll(/<li>([\s\S]*?)<\/li>/gi)).map(
    (match) => ({
      partOfSpeech: firstMatch(match[1], /<strong>([\s\S]*?)<\/strong>/i),
      meaning: decodeHtml(match[1].replace(/<strong>[\s\S]*?<\/strong>/i, '')),
    }),
  );
  const examplesHtml = html.match(/<ol class="examples">([\s\S]*?)<\/ol>/i)?.[1] ?? '';
  const englishExamples = Array.from(
    examplesHtml.matchAll(/<p class="example-en">([\s\S]*?)<\/p>/gi),
  ).map((match) => decodeHtml(match[1]));
  const chineseExamples = Array.from(
    examplesHtml.matchAll(/<p class="example-zh">([\s\S]*?)<\/p>/gi),
  ).map((match) => decodeHtml(match[1]));
  const examples = englishExamples
    .map((english, index) => ({ english, chinese: chineseExamples[index] ?? '' }))
    .filter((example) => example.english && example.chinese)
    .slice(0, 3);

  if (!word || definitions.length === 0 || examples.length === 0) return null;

  const uniqueParts = [...new Set(definitions.map((item) => item.partOfSpeech).filter(Boolean))];
  const meaning = definitions
    .slice(0, 3)
    .map((item) => item.meaning)
    .filter(Boolean)
    .join('；');
  return {
    id: key || id.toLocaleLowerCase('en-US'),
    word,
    phonetic,
    partOfSpeech: uniqueParts.join(' / '),
    meaning,
    examples,
    level,
    rank: frequencyRanks.get(key) ?? 50_000 + fallbackRank,
  };
}

function parseBook(epubPath, level, frequencyRanks) {
  const words = [];
  for (const chapter of archiveChapters(epubPath)) {
    const html = readChapter(epubPath, chapter);
    const pieces = html.split(/<section class="word-entry" id="([^"]+)">/i);
    for (let index = 1; index < pieces.length; index += 2) {
      const entry = parseEntry(
        pieces[index],
        pieces[index + 1] ?? '',
        level,
        frequencyRanks,
        words.length,
      );
      if (entry) words.push(entry);
    }
  }
  const existingIds = new Set(words.map((word) => word.id));
  for (const key of manualIdsByLevel[level]) {
    if (!existingIds.has(key)) {
      words.push(createManualEntry(key, level, frequencyRanks, words.length));
    }
  }
  return words.sort((left, right) => left.rank - right.rank || left.word.localeCompare(right.word));
}

function frequencyRanksFromFile(path) {
  return new Map(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => [line.split(/\s+/)[0].toLocaleLowerCase('en-US'), index + 1]),
  );
}

function writeBook(filename, words) {
  writeFileSync(resolve(outputDir, filename), `${JSON.stringify(words)}\n`, 'utf8');
}

const frequencyRanks = frequencyRanksFromFile(frequencyPath);
const cet4 = parseBook(cet4Path, 'cet4', frequencyRanks);
const cet6 = parseBook(cet6Path, 'cet6', frequencyRanks);
mkdirSync(outputDir, { recursive: true });
writeBook('cet4.json', cet4);
writeBook('cet6.json', cet6);

const cet4Ids = new Set(cet4.map((word) => word.id));
const overlap = cet6.filter((word) => cet4Ids.has(word.id)).length;
process.stdout.write(
  [
    `Built ${cet4.length} CET4 words from ${basename(cet4Path)}`,
    `Built ${cet6.length} CET6 words from ${basename(cet6Path)}`,
    `Found ${overlap} overlapping entries`,
  ].join('\n') + '\n',
);
