/**
 * 贴图健康巡检。
 *
 * 为什么需要：题库数据版本 26.1、最新正式版 26.3，跨版本最容易静默腐烂的就是
 * **贴图失效** —— 改名、路径调整、生成脚本漏跑，都只会变成一个空白框，
 * 不报错、不崩溃，玩家只会觉得「这题没图」，根本不知道是素材丢了。
 *
 * 本脚本做三层核对：
 *   ① 目录条目是否都有贴图映射（缺映射会走 VoxelGlyph 兜底，但要确认是「合理缺失」）
 *   ② 映射到的文件在磁盘上是否真的存在
 *   ③ 清单里有没有指向目录之外的孤儿贴图（素材残留，会让包体白白变大）
 *
 * 用法：
 *   node scripts/check-sprites.mjs            只查本地磁盘
 *   PREVIEW_URL=http://127.0.0.1:4205/ node scripts/check-sprites.mjs   顺便发 HTTP 请求验证
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')

const manifest = JSON.parse(readFileSync(join(ROOT, 'src/data/sprites.json'), 'utf8'))
const catalogRaw = JSON.parse(readFileSync(join(ROOT, 'src/data/catalog.json'), 'utf8'))
const catalog = catalogRaw.catalog ?? catalogRaw

const map = manifest.map ?? {}
const entries = catalog
const mapKeys = new Set(Object.keys(map))
const catalogIds = new Set(entries.map((e) => e.id))

let failed = 0
const fail = (msg) => { failed += 1; console.log(`  ✗ ${msg}`) }
const pass = (msg) => console.log(`  ✓ ${msg}`)

console.log('贴图健康巡检')
console.log(`清单版本 ${manifest.version} · 生成于 ${manifest.generatedAt}`)
console.log(`目录 ${entries.length} 条 · 贴图清单 ${mapKeys.size} 条\n`)

/* ---------- ① 磁盘文件是否存在 ---------- */
console.log('磁盘文件')
const missingOnDisk = []
let bytes = 0
for (const [id, url] of Object.entries(map)) {
  const p = join(PUBLIC_DIR, String(url).replace(/^\/+/, ''))
  if (!existsSync(p)) missingOnDisk.push({ id, url })
  else bytes += statSync(p).size
}
if (missingOnDisk.length === 0) {
  pass(`${mapKeys.size} 个贴图文件全部存在（共 ${(bytes / 1024 / 1024).toFixed(1)} MB）`)
} else {
  fail(`${missingOnDisk.length} 个贴图在清单里但磁盘上没有：`)
  for (const m of missingOnDisk.slice(0, 15)) console.log(`      ${m.id} -> ${m.url}`)
  if (missingOnDisk.length > 15) console.log(`      ...另有 ${missingOnDisk.length - 15} 个`)
}

/* ---------- ② 目录条目是否都有贴图 ---------- */
console.log('\n目录覆盖')
/**
 * 合理缺失白名单。
 *
 * 这些条目**本来就没有官方材质**，不是素材丢失：
 *  - 空气（void_air / cave_air）：没有方块贴图
 *  - 纯技术实体（giant / marker / interaction / lightning_bolt 等）：Java 版不生成实体模型
 *  - 投射物与展示实体（fireball / text_display / item_display 等）：贴图在方块/物品贴图集里
 * 这些会走 VoxelGlyph 兜底渲染，功能正常。
 *
 * 注意：白名单里的每一条都要**先查证**再放行，不能因为「报错了就先加白名单」。
 * 本清单每项的判据都一致 —— catalog 里 family 为 Immobile / UNKNOWN、
 * 或 kind 为纯技术实体，且 public/sprites/mob/ 下确实没有对应 png。
 * 例：mannequin（玩家模型）曾被误报，实测它和 giant / marker 同类，确实无贴图。
 */
const NO_SPRITE_OK = new Set([
  'block:void_air', 'block:cave_air',
  'mob:giant', 'mob:marker', 'mob:mannequin', 'mob:interaction', 'mob:lightning_bolt',
  'mob:leash_knot', 'mob:text_display', 'mob:item_display', 'mob:block_display',
  'mob:falling_block', 'mob:item', 'mob:ominous_item_spawner', 'mob:fireball',
  'mob:small_fireball', 'mob:shulker_bullet', 'mob:wither_skull', 'mob:eye_of_ender',
  'mob:area_effect_cloud', 'mob:spawner_minecart', 'mob:breeze_wind_charge',
])

const noSprite = [...catalogIds].filter((id) => !mapKeys.has(id))
const unexpected = noSprite.filter((id) => !NO_SPRITE_OK.has(id))

if (unexpected.length === 0) {
  pass(`${entries.length} 条目录全部有贴图或已知兜底（${noSprite.length} 条走 VoxelGlyph）`)
} else {
  fail(`${unexpected.length} 条既无贴图也不在兜底白名单里（会显示空白框）：`)
  for (const id of unexpected.slice(0, 20)) console.log(`      ${id}`)
  if (unexpected.length > 20) console.log(`      ...另有 ${unexpected.length - 20} 条`)
}

/*
白名单自检：光「列进白名单」不算数，得证明这些条目确实不该有贴图。
判据：清单里没有它们的映射，且 mob 类在磁盘上真的没有对应 png。
如果哪天 MC 给 mannequin 出了官方模型，这条会自己失败，提示把它移出白名单。
*/
console.log('\n兜底白名单自检（证明这些确实无官方材质）')
const staleAllow = []
for (const id of NO_SPRITE_OK) {
  if (mapKeys.has(id)) { staleAllow.push(`${id}：清单里已有贴图映射，应移出白名单`); continue }
  if (!id.startsWith('mob:')) continue
  const name = id.slice(4)
  const candidates = [
    join(PUBLIC_DIR, 'sprites/mob', `${name}.png`),
    join(PUBLIC_DIR, 'sprites/entity', `${name}.png`),
  ]
  if (candidates.some((p) => existsSync(p))) {
    staleAllow.push(`${id}：磁盘上存在同名贴图，应移出白名单`)
  }
}
if (staleAllow.length === 0) {
  pass(`${NO_SPRITE_OK.size} 条兜底条目均已核实：清单无映射且磁盘无文件`)
} else {
  fail(`兜底白名单有 ${staleAllow.length} 条过期：`)
  for (const s of staleAllow) console.log(`      ${s}`)
}

/* ---------- ③ 孤儿贴图（清单有、目录没有） ---------- */
console.log('\n孤儿贴图')
const orphans = [...mapKeys].filter((id) => !catalogIds.has(id))
if (orphans.length === 0) {
  pass('没有孤儿贴图（清单与目录一一对应）')
} else {
  // 不算失败，但要报出来 —— 每一张都是白下载的体积
  console.log(`  ⚠ ${orphans.length} 张贴图在清单里但目录里没有对应条目（不影响功能，只是冗余）：`)
  for (const id of orphans.slice(0, 10)) console.log(`      ${id}`)
  if (orphans.length > 10) console.log(`      ...另有 ${orphans.length - 10} 张`)
}

/* ---------- ④ 可选：HTTP 实测 ---------- */
const PREVIEW = process.env.PREVIEW_URL
if (PREVIEW) {
  console.log('\nHTTP 实测（真实请求预览服务）')
  const base = PREVIEW.replace(/\/+$/, '')
  const sample = [...mapKeys].slice(0, 40)
  let bad = []
  for (const id of sample) {
    const url = `${base}${map[id]}`
    try {
      const r = await fetch(url, { method: 'HEAD' })
      if (!r.ok) bad.push({ id, url, status: r.status })
    } catch (e) {
      bad.push({ id, url, status: String(e.message ?? e) })
    }
  }
  if (bad.length === 0) {
    pass(`抽样 ${sample.length} 张全部可正常下载（完整 ${mapKeys.size} 张见磁盘核对）`)
  } else {
    fail(`抽样 ${sample.length} 张里有 ${bad.length} 张取不到：`)
    for (const b of bad.slice(0, 10)) console.log(`      ${b.id} ${b.status}`)
  }
} else {
  console.log('\n（设 PREVIEW_URL 可额外做 HTTP 实测）')
}

console.log(failed === 0 ? '\n贴图全部健康。' : `\n发现 ${failed} 处问题。`)
process.exit(failed === 0 ? 0 : 1)
