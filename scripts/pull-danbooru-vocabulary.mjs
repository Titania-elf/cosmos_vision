// 从 Danbooru 拉取 tag 词表与别名表，导出为本地校验用的紧凑 JSON。
// Danbooru 在国内被墙，运行前需开启本地代理（默认 http://127.0.0.1:7890）。
// 用法：node scripts/pull-danbooru-vocabulary.mjs [--proxy http://127.0.0.1:7890]
//
// 产物：scripts/out/danbooru-vocabulary.json
//   { version, generatedAt, thresholds, tags:[general...], characters:[cat4...], rare:[低频general...], aliases:{旧:新} }
// 名称均为 Danbooru 原始下划线格式；运行时把用户 tag 归一化成下划线再查。

// 通过 curl -x 走本地代理拉取（Node 内置 fetch 不走系统代理，且国内直连被墙）。
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const argProxy = process.argv.find((_, i) => process.argv[i - 1] === '--proxy');
const PROXY = argProxy ?? 'http://127.0.0.1:7890';
const BASE = 'https://danbooru.donmai.us';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

// 裁剪阈值：首要目标是别误杀真 tag，故放宽下限；低于 general 下限但 ≥RARE 的进 rare 名单（标记不删）。
// 关键：Danbooru 分页默认按 tag id 降序（最新创建在前），必须用 search[order]=count 改成按常用度降序，
// 否则拉到的全是冷门新 tag，核心老 tag（long_hair 等 id 极小）会被匿名深翻页限制截断漏掉。
const GENERAL_MIN = 20; // category=0 收录下限
const CHARACTER_MIN = 200; // category=4 收录下限（角色名收紧：只留知名角色，避免冷门名让编造蒙混过关）
const RARE_MIN = 3; // general 低频标记区间 [RARE_MIN, GENERAL_MIN)
const PAGE_LIMIT = 1000;
const MAX_PAGES = 1000; // Danbooru 匿名深翻页上限；按 count 降序后远用不到，达到阈值 post_count 会自然收尾
const REQ_GAP_MS = 120; // 礼貌间隔，避免触发限流

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        'curl',
        ['-sS', '-m', '40', '-x', PROXY, '-A', 'cosmos-vision-vocabulary-builder/1.0', `${BASE}${path}`],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
  return [];
}

// 按 count 降序分页拉 tag，post_count 跌破下限即停（降序保证后面只会更小）。
async function pullTags(category, minCount) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = `search%5Bcategory%5D=${category}&search%5Border%5D=count&only=name,post_count&limit=${PAGE_LIMIT}&page=${page}`;
    const rows = await getJson(`/tags.json?${q}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    let stop = false;
    for (const r of rows) {
      if (typeof r?.name !== 'string' || typeof r?.post_count !== 'number') continue;
      if (r.post_count < minCount) { stop = true; break; }
      out.push([r.name, r.post_count]);
    }
    process.stdout.write(`\r  category=${category} min=${minCount}: page ${page}, 累计 ${out.length}   `);
    if (stop) break;
    await sleep(REQ_GAP_MS);
  }
  process.stdout.write('\n');
  return out;
}

async function pullAliases() {
  const out = [];
  for (let page = 1; page <= 1000; page++) {
    const q = `search%5Bstatus%5D=active&only=antecedent_name,consequent_name&limit=${PAGE_LIMIT}&page=${page}`;
    const rows = await getJson(`/tag_aliases.json?${q}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      if (typeof r?.antecedent_name === 'string' && typeof r?.consequent_name === 'string') {
        out.push([r.antecedent_name, r.consequent_name]);
      }
    }
    process.stdout.write(`\r  aliases: page ${page}, 累计 ${out.length}   `);
    await sleep(REQ_GAP_MS);
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  console.log(`代理 ${PROXY}，开始拉取…`);
  const generalRaw = await pullTags(0, RARE_MIN); // 一次拉到 RARE 下限，再本地切分 general / rare
  const charactersRaw = await pullTags(4, CHARACTER_MIN);
  const aliasesRaw = await pullAliases();

  const general = generalRaw.filter(([, c]) => c >= GENERAL_MIN).map(([n]) => n);
  const rare = generalRaw.filter(([, c]) => c >= RARE_MIN && c < GENERAL_MIN).map(([n]) => n);
  const characters = charactersRaw.map(([n]) => n);

  // 只保留纠错目标存在于词表中的别名，砍掉指向已裁剪冷门词的映射。
  const known = new Set([...general, ...rare, ...characters]);
  const aliases = {};
  for (const [from, to] of aliasesRaw) {
    if (known.has(to) && !known.has(from)) aliases[from] = to;
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    thresholds: { general: GENERAL_MIN, character: CHARACTER_MIN, rare: RARE_MIN },
    tags: general.sort(),
    characters: characters.sort(),
    rare: rare.sort(),
    aliases,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(payload);
  const jsonPath = join(OUT_DIR, 'danbooru-vocabulary.json');
  const gzPath = join(OUT_DIR, 'danbooru-vocabulary.json.gz');
  await writeFile(jsonPath, json);
  await writeFile(gzPath, gzipSync(json, { level: 9 }));

  console.log('\n=== 完成 ===');
  console.log(`general    : ${general.length}`);
  console.log(`characters : ${characters.length}`);
  console.log(`rare       : ${rare.length}`);
  console.log(`aliases    : ${Object.keys(aliases).length}`);
  console.log(`JSON       : ${(json.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`gzip       : ${(gzipSync(json, { level: 9 }).length / 1024).toFixed(0)} KB`);
  console.log(`输出       : ${jsonPath}`);
}

main().catch(err => {
  console.error('\n拉取失败:', err);
  process.exit(1);
});
