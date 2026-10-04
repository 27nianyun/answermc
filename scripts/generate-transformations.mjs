import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const minecraftData = require('minecraft-data')
const mc = minecraftData('26.1')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const catalogPath = join(root, 'src/data/catalog.json')
const recipeDir = join(root, '.cache/jar/data/minecraft/recipe')
// 26.1 起物品标签在 data/minecraft/tags/item/，方块标签在 tags/block/，两者有同名文件。
// 配方原料与 FuelValues 燃料表引用的都是 ItemTags，所以 item 命名空间优先；
// 但像 non_flammable_wood 只存在于 item 侧，缺了它剔除不下界菌木。
const tagDirs = [
  join(root, '.cache/jar/data/minecraft/tags/item'),
  join(root, '.cache/jar/data/minecraft/tags/block'),
  join(root, '.cache/jar/data/minecraft/tags/items'),
  join(root, '.cache/jar/data/minecraft/tags/blocks'),
]
const outPath = join(root, 'src/data/transformations.json')

if (!existsSync(catalogPath)) throw new Error('缺少 src/data/catalog.json，请先运行 npm run generate:data')
if (!existsSync(recipeDir)) throw new Error('缺少配方原始数据，请先运行 npm run fetch:assets')

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const knownNames = new Set(catalog.catalog.map((entry) => entry.name))
const nameKind = new Map(catalog.catalog.map((entry) => [entry.name, entry.kind]))

const stripName = (value) => (value || '').replace(/^minecraft:/, '')

// ---- 标签索引：把 #tag 解析为具体物品/方块名（处理嵌套标签）----
// tagDirs 的顺序即优先级：靠前的命名空间先写入，同名标签不再被后面覆盖。
const tagRaw = new Map()
for (const dir of tagDirs) {
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const tag = `minecraft:${file.slice(0, -5)}`
    if (tagRaw.has(tag)) continue
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    tagRaw.set(tag, data.values || [])
  }
}
const tagLeavesCache = new Map()
const resolveTag = (tag, visiting = new Set()) => {
  if (tagLeavesCache.has(tag)) return tagLeavesCache.get(tag)
  if (visiting.has(tag)) return []
  visiting.add(tag)
  const out = []
  for (const value of tagRaw.get(tag) || []) {
    if (value.startsWith('#')) out.push(...resolveTag(value.slice(1), visiting))
    else {
      const name = stripName(value)
      if (knownNames.has(name)) out.push(name)
    }
  }
  tagLeavesCache.set(tag, out)
  return out
}

const normalizeRef = (ref) => {
  if (!ref) return null
  if (typeof ref === 'string') return ref.startsWith('#') ? { tag: ref.slice(1) } : { item: ref }
  return ref
}

/** 解析配方引用（字符串物品 / #标签 / {item} / {tag} / {items:[...]}），返回所有叶子名 + 是否标签 */
const resolveRef = (ref) => {
  const r = normalizeRef(ref)
  if (!r) return { names: [], tag: null }
  if (Array.isArray(r.items)) {
    const names = r.items.map(stripName).filter((n) => knownNames.has(n))
    return { names, tag: null }
  }
  if (r.tag) {
    const leaves = resolveTag(r.tag.replace(/^#/, '')).filter((n) => knownNames.has(n))
    return { names: leaves.length ? leaves : [], tag: r.tag.replace(/^#/, '') }
  }
  if (r.item) {
    const name = stripName(r.item)
    return { names: knownNames.has(name) ? [name] : [], tag: null }
  }
  return { names: [], tag: null }
}

const METHOD_LABELS = {
  craft_shaped: '有序合成',
  craft_shapeless: '无序合成',
  smelt: '烧制',
  blast: '冶炼',
  smoke: '烟熏',
  campfire: '篝火烤',
  stonecut: '切石',
  wax: '涂蜡',
  scrape: '刮蜡',
  strip: '去皮',
  smith: '锻造',
  dye: '染色',
}

// ---- 燃料表 ----
// 官方没有 `fuel` 标签，燃烧时间写死在 net/minecraft/world/level/block/entity/FuelValues 里。
// 下面这张表是从 26.1 客户端 FuelValues.vanillaBurnTimes() 的注册序列逐条扒出来的，
// 顺序与燃烧时长系数都忠于原版；`#tag` 会展开成具体物品，`REMOVE` 是原版明确排除的不可燃木。
// 展开后共 300+ 项：煤与木炭、全部原木/木板/木制品、木制工具、竹与草木、羊毛、
// 干海带块、熔岩桶、烈焰棒，甚至工作台、书架、箱子、唱片机都能烧 —— 凡是能点着的都算。
const FUEL_REGISTRY = [
  'lava_bucket', 'coal_block', 'blaze_rod', 'coal', 'charcoal',
  '#logs', '#bamboo_blocks', '#planks', 'bamboo_mosaic',
  '#wooden_stairs', 'bamboo_mosaic_stairs',
  '#wooden_slabs', 'bamboo_mosaic_slab',
  '#wooden_trapdoors', '#wooden_pressure_plates', '#wooden_shelves',
  '#wooden_fences', '#fence_gates',
  'note_block', 'bookshelf', 'chiseled_bookshelf', 'lectern', 'jukebox',
  'chest', 'trapped_chest', 'crafting_table', 'daylight_detector',
  '#banners', 'bow', 'fishing_rod', 'ladder', '#signs', '#hanging_signs',
  'wooden_shovel', 'wooden_sword', 'wooden_spear', 'wooden_hoe', 'wooden_axe', 'wooden_pickaxe',
  '#wooden_doors', '#boats', '#wool', '#wooden_buttons', 'stick', '#saplings', 'bowl', '#wool_carpets',
  'dried_kelp_block', 'crossbow', 'bamboo', 'dead_bush', 'short_dry_grass', 'tall_dry_grass',
  'scaffolding', 'loom', 'barrel', 'cartography_table', 'fletching_table', 'smithing_table',
  'composter', 'azalea', 'flowering_azalea', 'mangrove_roots', 'leaf_litter',
]
// 原版 FuelValues 最后一步：把「不可燃木」（下界菌木）从燃料表里剔除
const FUEL_EXCLUDE_TAG = 'non_flammable_wood'

const FUEL_NAMES = (() => {
  const set = new Set()
  for (const entry of FUEL_REGISTRY) {
    if (entry.startsWith('#')) {
      for (const name of resolveTag(`minecraft:${entry.slice(1)}`)) set.add(name)
    } else if (knownNames.has(entry)) {
      set.add(entry)
    }
  }
  for (const name of resolveTag(`minecraft:${FUEL_EXCLUDE_TAG}`)) set.delete(name)
  return [...set].sort()
})()

// 燃料槽：故意不放具体候选名（300+ 项会把材料盘撑爆，也会让组合工序误把
// 「烧出煤」当成有效链条）。这里只留一个标记，判定时查全局燃料表。
const FUEL_INPUT = { names: [], tag: null, fuelSlot: true }


const transforms = []
const seen = new Set()

const resultOf = (value) => {
  if (!value) return null
  if (typeof value === 'string') return stripName(value)
  return stripName(value.item || value.id)
}
const countOf = (value) => (value && typeof value === 'object' && value.count ? value.count : 1)

const pushTransform = (transform) => {
  if (seen.has(transform.signature)) return
  seen.add(transform.signature)
  transforms.push(transform)
}

// ---- 解析 jar 内全部配方 ----
const files = readdirSync(recipeDir).filter((f) => f.endsWith('.json'))
let skipped = 0
for (const file of files) {
  const recipe = JSON.parse(readFileSync(join(recipeDir, file), 'utf8'))
  const type = recipe.type || ''
  const result = resultOf(recipe.result)
  if (!result || !knownNames.has(result) || nameKind.get(result) === 'mob') {
    skipped += 1
    continue
  }
  const count = countOf(recipe.result)

  if (type === 'minecraft:crafting_shaped') {
    const keyMap = recipe.key || {}
    const resolveKey = (ch) => {
      const ref = resolveRef(keyMap[ch])
      return ref.names[0] || null
    }
    const rows = (recipe.pattern || []).map((line) => [...line].map(resolveKey))
    if (rows.some((row) => row.some((c) => c === null))) {
      skipped += 1
      continue
    }
    const flat = rows.flat().filter(Boolean)
    if (!flat.length || flat.length > 9) {
      skipped += 1
      continue
    }
    const height = rows.length
    const width = Math.max(...rows.map((r) => r.length))
    pushTransform({
      id: `${result}-shaped-${transforms.length}`,
      method: 'craft_shaped',
      result,
      count,
      layout: 'grid-shaped',
      width,
      height,
      shape: rows,
      inputs: [...new Set(flat)].map((name) => ({ names: [name], tag: null })),
      signature: `craft_shaped|${rows.map((r) => r.join(',')).join('/')}|${result}`,
    })
    continue
  }

  if (type === 'minecraft:crafting_shapeless') {
    const names = []
    let ok = true
    for (const ref of recipe.ingredients || []) {
      const resolved = resolveRef(ref)
      if (!resolved.names.length) { ok = false; break }
      names.push(resolved.names[0])
    }
    if (!ok || names.length < 2 || names.length > 9) { skipped += 1; continue }
    pushTransform({
      id: `${result}-shapeless-${transforms.length}`,
      method: 'craft_shapeless',
      result,
      count,
      layout: 'grid-shapeless',
      width: 0,
      height: 0,
      shape: null,
      inputs: [...new Set(names)].map((name) => ({ names: [name], tag: null })),
      signature: `craft_shapeless|${[...new Set(names)].sort().join(',')}|${result}`,
    })
    continue
  }

  // 单输入加工：烧制 / 冶炼 / 烟熏 / 篝火 / 切石
  const singleType = {
    'minecraft:smelting': 'smelt',
    'minecraft:blasting': 'blast',
    'minecraft:smoking': 'smoke',
    'minecraft:campfire_cooking': 'campfire',
    'minecraft:stonecutting': 'stonecut',
  }[type]
  if (singleType) {
    const ref = resolveRef(recipe.ingredient)
    if (!ref.names.length) { skipped += 1; continue }
    const isFurnace = ['smelt', 'blast', 'smoke', 'campfire'].includes(singleType)
    const inputs = [{ names: ref.names, tag: ref.tag }]
    if (isFurnace && FUEL_NAMES.length) inputs.push(FUEL_INPUT)
    pushTransform({
      id: `${result}-${singleType}-${transforms.length}`,
      method: singleType,
      result,
      count,
      layout: isFurnace ? 'furnace' : 'single',
      width: 0,
      height: 0,
      shape: null,
      inputs,
      // 燃料槽是「任意可燃物」，不参与签名，否则所有烧制会撞成同一个 signature 被去重掉
      signature: `${singleType}|${inputs
        .map((i) => (i.fuelSlot ? '*' : [...new Set(i.names)].sort().join(',')))
        .join('|')}|${result}`,
    })
    continue
  }

  // 涂蜡/染色类：crafting_transmute 在 26.1 里主要用于染色潜影盒与收纳包，并非涂蜡；
  // 涂蜡实际走 crafting_shapeless（见下方后处理），这里只保留「蜜脾 → waxed_*」的特例。
  if (type === 'minecraft:crafting_transmute' || type === 'minecraft:crafting_dye') {
    const a = resolveRef(recipe.input)
    const b = resolveRef(recipe.material || recipe.dye)
    if (!a.names.length || !b.names.length) { skipped += 1; continue }
    const isWax = [...a.names, ...b.names].includes('honeycomb') && result.startsWith('waxed_')
    if (!isWax) { skipped += 1; continue }
    pushTransform({
      id: `${result}-wax-${transforms.length}`,
      method: 'wax',
      result,
      count,
      layout: 'dual',
      width: 0,
      height: 0,
      shape: null,
      inputs: [{ names: a.names, tag: a.tag }, { names: b.names, tag: b.tag }],
      signature: `wax|${[...new Set([...a.names, ...b.names])].sort().join(',')}|${result}`,
    })
    continue
  }

  // 锻造：下界合金升级（base + addition）
  if (type === 'minecraft:smithing_transform') {
    const base = resolveRef(recipe.base)
    let addition = resolveRef(recipe.addition)
    // 下界合金升级的 addition 是 item 标签，jar 内无对应文件，按惯例回退为下界合金锭
    if (!addition.names.length && typeof recipe.addition === 'string' && recipe.addition.includes('netherite')) {
      addition = { names: ['netherite_ingot'], tag: null }
    }
    if (!base.names.length || !addition.names.length) { skipped += 1; continue }
    pushTransform({
      id: `${result}-smith-${transforms.length}`,
      method: 'smith',
      result,
      count,
      layout: 'dual',
      width: 0,
      height: 0,
      shape: null,
      inputs: [{ names: base.names, tag: base.tag }, { names: addition.names, tag: addition.tag }],
      signature: `smith|${[...new Set([...base.names, ...addition.names])].sort().join(',')}|${result}`,
    })
    continue
  }

  // 其余特殊配方（special / decorated_pot / imbue 等）暂不纳入
  skipped += 1
}

// ---- 手动补充：去皮 / 刮蜡（斧头操作，不在配方数据里）----
for (const entry of catalog.catalog) {
  if (entry.kind === 'mob') continue
  if (entry.name.startsWith('stripped_')) {
    const source = entry.name.slice('stripped_'.length)
    if (knownNames.has(source) && nameKind.get(source) !== 'mob') {
      pushTransform({
        id: `${entry.name}-strip-${transforms.length}`,
        method: 'strip',
        result: entry.name,
        count: 1,
        layout: 'single',
        width: 0,
        height: 0,
        shape: null,
        inputs: [{ names: [source], tag: null }],
        signature: `strip|${source}|${entry.name}`,
      })
    }
  }
  if (entry.name.startsWith('waxed_')) {
    // 刮蜡：用斧刮掉蜡 → 得到未涂蜡的同族方块（输入是 waxed_*，输出是去掉前缀的本体）
    const source = entry.name.slice('waxed_'.length)
    if (knownNames.has(source) && nameKind.get(source) !== 'mob') {
      pushTransform({
        id: `${source}-scrape-${transforms.length}`,
        method: 'scrape',
        result: source,
        count: 1,
        layout: 'single',
        width: 0,
        height: 0,
        shape: null,
        inputs: [{ names: [entry.name], tag: null }],
        signature: `scrape|${entry.name}|${source}`,
      })
    }
  }
}

// 后处理：把「蜂蜜罐 + 铜质方块 → 涂蜡产物」的无序合成标记为涂蜡
for (const t of transforms) {
  if (t.method === 'craft_shapeless') {
    const names = t.inputs.flatMap((i) => i.names)
    if (names.includes('honeycomb') && t.result.startsWith('waxed_')) {
      t.method = 'wax'
      t.layout = 'dual'
      t.signature = `wax|${[...new Set(names)].sort().join(',')}|${t.result}`
    }
  }
}

const methodCounts = {}
for (const t of transforms) methodCounts[t.method] = (methodCounts[t.method] || 0) + 1

const output = {
  meta: {
    edition: 'Java Edition',
    version: mc.version?.minecraftVersion || '26.1',
    generatedFrom: 'minecraft client.jar data/minecraft/recipe + FuelValues 燃料表 + 去皮/刮蜡 派生',
    methodLabels: METHOD_LABELS,
    /** 全局燃料表：烧制/冶炼/烟熏/篝火的燃料槽放这里任意一项都算对 */
    fuels: FUEL_NAMES,
    counts: {
      transforms: transforms.length,
      results: new Set(transforms.map((t) => t.result)).size,
      byMethod: methodCounts,
      fuels: FUEL_NAMES.length,
      skipped,
    },
  },
  transforms,
}
writeFileSync(outPath, JSON.stringify(output))
console.log(`生成 ${transforms.length} 条方块/物品转化（跳过 ${skipped} 条特殊/无译名）`)
console.log(`燃料表 ${FUEL_NAMES.length} 项（取自 FuelValues.vanillaBurnTimes）`)
console.log('按方法统计：', methodCounts)
