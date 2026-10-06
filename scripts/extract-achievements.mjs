/**
 * 从 Minecraft 服务端 jar 提取成就（Advancements）—— 26.1 release。
 *
 * 用法：node scripts/extract-achievements.mjs <服务端jar 路径>
 *
 * ── 为什么必须从服务端 jar 取，而不是抄 Wiki ──────────────────
 * 抄 Wiki 那一版翻过车（详见 memory 里的记录）：
 *   · 3 个 id 是**凭空捏造**的：adventure/caves_and_cliffs、
 *     adventure/isnt_it_scute、adventure/sneak_100 —— 26.1 正式版里前两个
 *     真实存在但 id 不是这样，第三个在 26.1 根本不存在
 *   · 2 个 id 写错：over_overkill → overoverkill、trials → minecraft_trials_edition
 *   · 3 处边框类型抄错、10 处父级抄错
 *   · 农牧业 tab 抄的是**旧版本**（26.1 已重构，id 完全不同）
 * Wiki 正文太长（中英站都在「冒险 → 探索的时光」处被取回通道截断），
 * 靠抓取永远补不全；jar 里的 json 是**游戏本体用的定义**，不可能过期。
 *
 * ── jar 的两层结构（踩过的坑）───────────────────────────────
 * `server.jar` 是 Bundler 启动器，只有 165 个条目；
 * 真正的数据在**内层** `META-INF/versions/<ver>/server-<ver>.jar`（16461 个条目）。
 * 直接在 server.jar 里找 `data/advancement/*.json` 会得到 0 条。
 *
 * ── 另一个坑：路径过滤不能只判前缀 ──────────────────────────
 * `data/minecraft/advancement/recipes/` 下有 1492 个**配方**，它们不是成就。
 * 必须按第一段 ∈ {story,nether,end,adventure,husbandry} 过滤，
 * 否则会把 recipes/root 当成根成就、把 1492 个配方混进数据里。
 *
 * ── 一个信息：服务端 jar 里没有汉化 ──────────────────────────
 * `display.title` 存的是翻译键（`advancements.adventure.ol_betsy.title`），
 * 不是字面文本。所以这一份产出**只有英文**；
 * 中文名要另外从 zh.minecraft.wiki 补，见 merge-achievements-zh.mjs。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'

/** 真正的 5 个进度 tab。注意「我的世界」在 jar 里叫 story，目录名与界面名不一致 */
const TABS = ['story', 'nether', 'end', 'adventure', 'husbandry']

/** 界面 tab 名 → jar 目录名 */
const TAB_DIR = {
  minecraft: 'story',
  nether: 'nether',
  end: 'end',
  adventure: 'adventure',
  husbandry: 'husbandry',
}

const jarPath = process.argv[2]
if (!jarPath) {
  console.error('用法：node scripts/extract-achievements.mjs <服务端jar路径>')
  process.exit(1)
}

/**
 * 解析 zip。
 * 没引入第三方库：只用到 inflateRawSync，自己读中央目录就够了。
 */
const readZip = (buf) => {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是合法 zip（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    entries.push({
      name: buf.toString('utf8', off + 46, off + 46 + buf.readUInt16LE(off + 28)),
      method: buf.readUInt16LE(off + 10),
      compSize: buf.readUInt32LE(off + 20),
      localOff: buf.readUInt32LE(off + 42),
    })
    off += 46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
  }
  const read = (entry) => {
    const lo = entry.localOff
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(`坏条目: ${entry.name}`)
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28)
    const raw = buf.subarray(start, start + entry.compSize)
    return entry.method === 0 ? raw : zlib.inflateRawSync(raw)
  }
  return { entries, read }
}

const outerBytes = readFileSync(jarPath)
const outer = readZip(outerBytes)
console.log(`外层 server.jar：${outer.entries.length} 个条目`)

const innerEntry = outer.entries.find(
  (e) => e.name.startsWith('META-INF/versions/') && e.name.endsWith('.jar'),
)
if (!innerEntry) {
  console.error('没找到内层 jar（不是 Bundler 结构？）')
  process.exit(1)
}
console.log(`内层 jar：${innerEntry.name}`)
const inner = readZip(outer.read(innerEntry))
console.log(`内层：${inner.entries.length} 个条目`)

/* ── 提取 5 个 tab 的成就 ─────────────────────────────────── */
const DATA_PREFIX = 'data/minecraft/advancement/'
const adv = {}
for (const entry of inner.entries) {
  if (!entry.name.startsWith(DATA_PREFIX) || !entry.name.endsWith('.json')) continue
  const rid = entry.name.slice(DATA_PREFIX.length, -'.json'.length)
  if (!TABS.includes(rid.split('/')[0])) continue
  adv[rid] = JSON.parse(inner.read(entry).toString('utf8'))
}

const byTab = {}
for (const id of Object.keys(adv)) {
  const t = id.split('/')[0]
  byTab[t] = (byTab[t] ?? 0) + 1
}
console.log('\n提取结果：')
for (const t of TABS) console.log(`  ${t.padEnd(11)}${String(byTab[t] ?? 0).padStart(3)} 条`)
console.log(`  合计 ${Object.keys(adv).length} 条`)

/* ── 字段抽取 ────────────────────────────────────────────── */
const stripNs = (v) => (typeof v === 'string' ? v.replace(/^minecraft:/, '') : v)

const rows = []
for (const [id, raw] of Object.entries(adv)) {
  const dir = id.split('/')[0]
  const tab = Object.keys(TAB_DIR).find((k) => TAB_DIR[k] === dir)
  const display = raw.display ?? {}
  const titleKey = display.title?.translate ?? ''
  // 从翻译键反推英文名：advancements.<dir>.<name>.title
  const name = titleKey.split('.').slice(2, -1).join('.') || id.split('/')[1]
  rows.push({
    id,
    name,
    dir,
    tab,
    parent: stripNs(raw.parent) ?? null,
    frame: display.frame ?? 'advancement',
    titleKey,
    descKey: display.description?.translate ?? '',
    icon: display.icon?.id ? stripNs(display.icon.id) : null,
    isRoot: !raw.parent,
  })
}

const dirOrder = (d) => TABS.indexOf(d)
rows.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : dirOrder(a.dir) - dirOrder(b.dir)))

const versionEntry = inner.entries.find((e) => e.name === 'version.json')
const gameVersion = versionEntry
  ? JSON.parse(inner.read(versionEntry).toString('utf8')).id
  : 'unknown'

const out = {
  version: '26.1',
  gameVersion,
  source: innerEntry.name,
  sourceSha1: createHash('sha1').update(outerBytes).digest('hex'),
  tabDirs: TAB_DIR,
  counts: byTab,
  advancements: rows,
}

const target = new URL('../src/data/achievements-raw.json', import.meta.url)
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
console.log(`\n已写出 achievements-raw.json（${rows.length} 条）`)
console.log('这一份只有英文（服务端 jar 不含汉化），zh 由 merge 脚本补。')
