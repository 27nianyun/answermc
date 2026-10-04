#!/usr/bin/env node
/**
 * 音效资源库生成。
 *
 * ── 为什么单独写这个脚本 ──────────────────────────────────
 * client jar 里**只有 sounds 相关的 .class 文件，没有任何音频**。
 * 真正的 .ogg 在 assets 索引（.cache/asset-index.json）里，
 * 要从 https://resources.download.minecraft.net/<hash前2位>/<hash> 单独下。
 * 之前 extract-jar.mjs 只取了 textures / models / recipes，从没取过声音，
 * 所以「项目没有音效资源」这个结论其实是错的 —— 是没取，不是没有。
 *
 * ── 精选策略（不做全量 4564 个）────────────────────────────
 * 全量约 137 MB，没必要。只取**辨识度高、且能映射到图鉴中文名**的：
 *   - mob/<生物>/say1：76 种生物叫声，盲猜玩法的主力（差异最大）
 *   - block/<方块>/break1：139 种方块破坏声，次之
 *   - 标志性音效：弓箭、爆炸、升级、门、火等（白名单）
 * 合计约 230 个文件 / 5 MB 左右。
 *
 * 用法：
 *   node scripts/generate-sounds.mjs            增量下载（已存在则跳过）
 *   node scripts/generate-sounds.mjs --dry-run  只算清单不下载
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const OUT_DIR = join(ROOT, 'public/sounds')
const OUT_JSON = join(ROOT, 'src/data/sounds.json')
const DRY = process.argv.includes('--dry-run')
const CONCURRENCY = 8

const index = JSON.parse(readFileSync(join(CACHE, 'asset-index.json'), 'utf8'))
const catalogRaw = JSON.parse(readFileSync(join(ROOT, 'src/data/catalog.json'), 'utf8'))
const catalog = catalogRaw.catalog ?? catalogRaw

/* ---------- 1. 建立「英文条目名 → 中文名」映射 ---------- */
/*
按 kind 分开建索引：音效目录名（如 cow）可能同时对应方块和实体，
不分开会把「牛」和某个同名方块搞混。
*/
const zhOf = { block: new Map(), item: new Map(), mob: new Map() }
for (const entry of catalog) {
  if (!entry.name || !entry.zhName) continue
  const bucket = zhOf[entry.kind]
  if (!bucket) continue
  // 同名条目取第一个（后续变体不影响发音辨识）
  if (!bucket.has(entry.name)) bucket.set(entry.name, entry.zhName)
}

/* ---------- 2. 挑出要下的音效 ---------- */
const all = Object.keys(index.objects).filter((k) => k.endsWith('.ogg'))

/** 音效路径 → 归属分类 + 条目名 */
const parse = (key) => {
  const parts = key.replace('minecraft/sounds/', '').split('/')
  if (parts[0] === 'mob' && parts.length >= 3) return { cat: 'mob', name: parts[1], file: parts[2] }
  if (parts[0] === 'block' && parts.length >= 3) return { cat: 'block', name: parts[1], file: parts[2] }
  if (parts.length === 2) return { cat: parts[0], name: parts[1].replace('.ogg', ''), file: parts[1] }
  return null
}

/*
每个条目只取一个最有辨识度的音。

⚠️ 命名在不同生物间**完全不统一**，这是实测出来的：
   牛=cow/ambient1（哞）、苦力怕=creeper/say1（嘶嘶）、末影人=endermen/idle1、
   狼=wolf/bark1、恶魂=ghast/moan1、村民=villager/haggle1。
   只写 ['say1','ambient1'] 的话，狼和恶魂会退化到 hurt1（受击声），
   而受击声在生物之间差异很小，出了题玩家根本分不出来。
   所以优先级要覆盖所有这些「叫声」的别名，hurt/death 只作最后兜底。
*/
const PICK = {
  mob: [
    'say1.ogg', 'ambient1.ogg', 'idle1.ogg', 'bark1.ogg', 'moan1.ogg',
    'haggle1.ogg', 'affectionate_scream.ogg', 'hurt1.ogg',
  ],
  block: ['break1.ogg', 'place1.ogg', 'step1.ogg', 'hit1.ogg'],
}

// 标志性音效白名单：这些不是某个条目发的声，但辨识度极高，适合单独成题
const ICONIC = [
  ['random', 'bow'], ['random', 'explode1'], ['random', 'levelup'],
  ['random', 'door_open'], ['random', 'door_close'], ['random', 'click'],
  ['random', 'orb'], ['random', 'pop'], ['random', 'fizz'], ['random', 'burp'],
  ['random', 'anvil_land'], ['random', 'splash'], ['random', 'eat1'],
  ['fire', 'fire'], ['fire', 'ignite'],
  ['liquid', 'lava'], ['liquid', 'splash'],
  ['portal', 'portal'], ['portal', 'trigger'],
  ['enchant', 'thorns'],
  ['ui', 'stonecutter'], ['ui', 'loom'], ['ui', 'cartography_table'],
]
const ICONIC_ZH = {
  'random/bow': '拉弓', 'random/explode1': '爆炸', 'random/levelup': '升级',
  'random/door_open': '开门', 'random/door_close': '关门', 'random/click': '按钮咔哒',
  'random/orb': '拾取经验球', 'random/pop': '气泡破裂', 'random/fizz': '引信嘶嘶',
  'random/burp': '打嗝', 'random/anvil_land': '铁砧落地', 'random/splash': '入水',
  'random/eat1': '进食', 'fire/fire': '火焰燃烧', 'fire/ignite': '点火',
  'liquid/lava': '岩浆', 'liquid/splash': '水花', 'portal/portal': '传送门',
  'portal/trigger': '传送门触发', 'enchant/thorns': '荆棘',
  'ui/stonecutter': '切石机', 'ui/loom': '织布机', 'ui/cartography_table': '制图台',
}

const planned = []
const seen = new Set()

// mob / block：每个条目取一个音
for (const key of all) {
  const p = parse(key)
  if (!p || !PICK[p.cat]) continue
  const pickIndex = PICK[p.cat].indexOf(p.file)
  if (pickIndex < 0) continue
  const dedupe = `${p.cat}/${p.name}`
  if (seen.has(dedupe)) continue
  const zh = zhOf[p.cat === 'mob' ? 'mob' : 'block'].get(p.name)
  if (!zh) continue
  seen.add(dedupe)
  planned.push({ key, cat: p.cat, entry: p.name, zh, action: p.file.replace('.ogg', '') })
}

// 标志性音效
for (const [cat, name] of ICONIC) {
  const key = `minecraft/sounds/${cat}/${name}.ogg`
  if (!index.objects[key]) continue
  const zh = ICONIC_ZH[`${cat}/${name}`]
  if (!zh) continue
  planned.push({ key, cat: 'iconic', entry: `${cat}/${name}`, zh, action: name })
}

console.log(`计划下载 ${planned.length} 个音效（mob ${planned.filter((p) => p.cat === 'mob').length} / block ${planned.filter((p) => p.cat === 'block').length} / iconic ${planned.filter((p) => p.cat === 'iconic').length}）`)
const totalBytes = planned.reduce((sum, p) => sum + (index.objects[p.key]?.size ?? 0), 0)
console.log(`预计体积 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)

if (DRY) {
  console.log('\n（--dry-run，未下载）')
  console.log(planned.slice(0, 15).map((p) => `  ${p.zh} <- ${p.key}`).join('\n'))
  process.exit(0)
}

/* ---------- 3. 并发下载 ---------- */
mkdirSync(OUT_DIR, { recursive: true })

/** 扁平化文件名：sounds/ 下不建子目录，避免路径过深 */
const flatName = (item) => {
  const safe = item.entry.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()
  return `${item.cat}_${safe}_${item.action}.ogg`
}

const download = async (item) => {
  const target = join(OUT_DIR, flatName(item))
  if (existsSync(target)) return { item, ok: true, skipped: true }
  const meta = index.objects[item.key]
  const url = `https://resources.download.minecraft.net/${meta.hash.slice(0, 2)}/${meta.hash}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length !== meta.size) throw new Error(`字节数不符 ${buffer.length} != ${meta.size}`)
      writeFileSync(target, buffer)
      return { item, ok: true, skipped: false }
    } catch (error) {
      if (attempt === 2) return { item, ok: false, error: String(error.message ?? error) }
    }
  }
  return { item, ok: false, error: '未知错误' }
}

const results = []
let cursor = 0
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < planned.length) {
    const item = planned[cursor]
    cursor += 1
    results.push(await download(item))
  }
})
await Promise.all(workers)

const failed = results.filter((r) => !r.ok)
const skipped = results.filter((r) => r.skipped)
console.log(`\n下载完成：成功 ${results.length - failed.length}（跳过已存在 ${skipped.length}），失败 ${failed.length}`)
if (failed.length) {
  for (const f of failed.slice(0, 10)) console.log(`  ✗ ${f.item.zh} ${f.error}`)
}

/* ---------- 4. 写清单 ---------- */
const sounds = results
  .filter((r) => r.ok)
  .map((r) => ({
    id: `${r.item.cat}:${r.item.entry}`,
    file: `sounds/${flatName(r.item)}`,
    category: r.item.cat,
    entry: r.item.entry,
    zh: r.item.zh,
    action: r.item.action,
    source: r.item.key,
  }))
  .sort((a, b) => a.category.localeCompare(b.category) || a.zh.localeCompare(b.zh, 'zh'))

const payload = {
  version: catalogRaw.meta?.version ?? '26.1',
  generatedAt: new Date().toISOString(),
  count: sounds.length,
  byCategory: sounds.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1
    return acc
  }, {}),
  sounds,
}

mkdirSync(dirname(OUT_JSON), { recursive: true })
writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`\n已写入 ${OUT_JSON}（${sounds.length} 条）`)
console.log('分类分布：', JSON.stringify(payload.byCategory))
process.exit(0)
