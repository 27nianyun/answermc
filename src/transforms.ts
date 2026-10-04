import rawCatalog from './data/catalog.json'
import rawTransforms from './data/transformations.json'
import { spriteUrlFor } from './sprites'
import type {
  CatalogData,
  CatalogEntry,
  Difficulty,
  GameMode,
  Kind,
  Transform,
  TransformData,
} from './types'

const catalog = rawCatalog as unknown as CatalogData
const transformData = rawTransforms as unknown as TransformData

export const TRANSFORMS: Transform[] = transformData.transforms
export const TRANSFORM_META = transformData.meta
export const METHOD_LABELS = transformData.meta.methodLabels as Record<string, string>

/**
 * 全局燃料表（取自原版 FuelValues.vanillaBurnTimes，共 300+ 项）。
 * 煤、木炭、全部原木/木板/木制品、木制工具、竹与草木、羊毛、干海带块、熔岩桶、烈焰棒
 * ……凡是能点着的东西都在里面，所以燃料槽里放哪一样都能烧。
 */
export const FUEL_NAMES: string[] = transformData.meta.fuels ?? []
const FUEL_SET = new Set(FUEL_NAMES)

/** 某个物品能否当燃料 */
export const isFuelName = (name: string | null | undefined): boolean =>
  Boolean(name) && FUEL_SET.has(name as string)

/** 提示 / 揭晓时默认放进燃料槽的东西（燃料表里挑一个最直观的） */
const DEFAULT_FUEL = FUEL_SET.has('charcoal') ? 'charcoal' : FUEL_NAMES[0] ?? 'coal'

/** 找出某个转化里的燃料槽（烧制类的第 2 格） */
export const fuelSlotIndex = (transform: Transform): number =>
  transform.inputs.findIndex((input) => input.fuelSlot)

/**
 * 这个 input 是否已有明确候选名。
 * 燃料槽刻意留空（走全局燃料表判定），不能因为 names 为空就把整条转化踢出池子。
 */
const hasCandidates = (input: Transform['inputs'][number]) => input.fuelSlot || input.names.length > 0

const entryByName = new Map<string, CatalogEntry>()
const familyOf = new Map<string, string>()
const kindOf = new Map<string, Kind>()
for (const entry of catalog.catalog) {
  if (!entryByName.has(entry.name)) entryByName.set(entry.name, entry)
  else if (entry.kind === 'item') entryByName.set(entry.name, entry)
  familyOf.set(entry.name, entry.family)
  kindOf.set(entry.name, entry.kind)
}

// 同家族材料索引（用于生成「相似干扰项」）
const familyPeers = new Map<string, Set<string>>()
for (const entry of catalog.catalog) {
  if (entry.kind === 'mob') continue
  const fam = entry.family
  if (!fam) continue
  if (!familyPeers.has(fam)) familyPeers.set(fam, new Set())
  familyPeers.get(fam)!.add(entry.name)
}

export const entryForName = (name: string): CatalogEntry | null => entryByName.get(name) ?? null
export const entryForTransform = (transform: Transform): CatalogEntry | null => entryForName(transform.result)

const hashString = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const makeRandom = (seed?: string) => {
  let state = seed ? hashString(seed) : (Math.random() * 0xffffffff) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const shuffle = <T,>(list: T[], random: () => number): T[] => {
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

export const DISTRACTOR_COUNT: Record<Difficulty, number> = {
  explorer: 2,
  survival: 4,
  hardcore: 6,
}

export const transformPool = (kinds: Kind[]) => TRANSFORMS.filter((transform) => {
  const entry = entryForTransform(transform)
  if (!entry || !kinds.includes(entry.kind)) return false
  return transform.inputs.every(hasCandidates)
})

export const transformsForName = (name: string, limit = 3) =>
  TRANSFORMS.filter((transform) => transform.result === name).slice(0, limit)

export const pickTransform = (pool: Transform[], previousSignatures: string[], seed?: string): Transform => {
  if (!pool.length) throw new Error('当前筛选条件下没有可用转化。')
  const freshPool = pool.filter((transform) => !previousSignatures.includes(transform.signature))
  const source = freshPool.length ? freshPool : pool
  const random = makeRandom(seed)
  return source[Math.floor(random() * source.length)]
}

// ---- 槽位与校验 ----

export const slotCount = (transform: Transform): number => {
  if (transform.layout === 'grid-shaped' || transform.layout === 'grid-shapeless') return 9
  if (transform.layout === 'single') return 1
  if (transform.layout === 'furnace') return 2
  return 2
}

/** 叶子名 → 它在 inputs 中的下标（用于「任意同标签材料均可」的宽容判定） */
const nameMapCache = new Map<string, Map<string, number>>()
const nameMapOf = (transform: Transform) => {
  if (nameMapCache.has(transform.id)) return nameMapCache.get(transform.id)!
  const map = new Map<string, number>()
  transform.inputs.forEach((input, index) => {
    for (const name of input.names) {
      if (!map.has(name)) map.set(name, index)
    }
  })
  nameMapCache.set(transform.id, map)
  return map
}

/** 用于「提示一格 / 揭晓」的标准槽位排列 */
export const expectedSlots = (transform: Transform): (string | null)[] => {
  const count = slotCount(transform)
  if (transform.layout === 'grid-shaped') {
    const grid: (string | null)[] = Array.from({ length: 9 }, () => null)
    transform.shape?.forEach((row, rowIndex) => {
      row.forEach((name, colIndex) => {
        grid[rowIndex * 3 + colIndex] = name
      })
    })
    return grid
  }
  if (transform.layout === 'grid-shapeless') {
    const grid: (string | null)[] = Array.from({ length: 9 }, () => null)
    transform.inputs.forEach((input, index) => {
      if (index < 9) grid[index] = input.names[0]
    })
    return grid
  }
  if (transform.layout === 'furnace') {
    return [transform.inputs[0]?.names[0] ?? null, DEFAULT_FUEL]
  }
  return transform.inputs.map((input) => input.names[0]).slice(0, count)
}

export interface PlacementResult {
  correct: boolean
  wrongCells: number[]
  placed: number
}

/** 把网格旋转 180°（行序倒序 + 每行也倒序） */
const rotateHalf = (rows: number[][]): number[][] =>
  [...rows].reverse().map((row) => [...row].reverse())

/** 裁掉网格四周全空的行与列，让任意平移的摆法对齐到同一形状（每行补齐同宽） */
const trimGrid = (rows: number[][]): number[][] => {
  const filled = rows.filter((row) => row.some((c) => c >= 0))
  if (!filled.length) return []
  const cols: number[] = []
  rows.forEach((row) => row.forEach((c, cc) => { if (c >= 0) cols.push(cc) }))
  if (!cols.length) return []
  const first = Math.min(...cols)
  const last = Math.max(...cols)
  const width = last - first + 1
  return filled.map((row) => {
    const sliced = row.slice(first, last + 1)
    while (sliced.length < width) sliced.push(-1)
    return sliced
  })
}

export const checkPlacement = (transform: Transform, slots: (string | null)[]): PlacementResult => {
  const placed = slots.filter(Boolean).length

  if (transform.layout === 'grid-shaped') {
    const expected = expectedSlots(transform)
    const nameMap = nameMapOf(transform)
    const toIndex = (name: string | null) => (name === null ? -1 : (nameMap.has(name) ? nameMap.get(name)! : -2))
    const expIdx = expected.map(toIndex)
    const givIdx = slots.map(toIndex)
    const trimIdx = (arr: number[]) => {
      const rows = [0, 1, 2].map((r) => arr.slice(r * 3, r * 3 + 3))
      const filled = rows.filter((row) => row.some((c) => c >= 0))
      if (!filled.length) return [] as number[][]
      const cols: number[] = []
      rows.forEach((row) => row.forEach((c, cc) => { if (c >= 0) cols.push(cc) }))
      const first = Math.min(...cols)
      const last = Math.max(...cols)
      const width = last - first + 1
      return filled.map((row) => {
        const sliced = row.slice(first, last + 1)
        while (sliced.length < width) sliced.push(-1)
        return sliced
      })
    }
    const sameIdx = (left: number[][], right: number[][]) => {
      if (left.length !== right.length) return false
      for (let r = 0; r < left.length; r += 1) {
        if (left[r].length !== right[r].length) return false
        for (let c = 0; c < left[r].length; c += 1) {
          // -1 表示空格需一致；有效材料位（>=0）必须同序号；-2（非法材料）永远不匹配
          if (left[r][c] === -1 || right[r][c] === -1) {
            if (left[r][c] !== right[r][c]) return false
          } else if (left[r][c] !== right[r][c] || left[r][c] === -2 || right[r][c] === -2) {
            return false
          }
        }
      }
      return true
    }
    const et = trimIdx(expIdx)
    const gt = trimIdx(givIdx)
    const mirrorRows = (rows: number[][]) => rows.map((row) => [...row].reverse())
    // 等价摆放：平移由 trimIdx 处理（裁掉空行空列），左右镜像对所有配方都安全。
    // 另外放宽 180° 旋转：网格转半圈后材料的相对结构不变，同样能合成。
    // 两处刻意的限制：
    //  1) 不做 90°/270°——3×2 的门转 90° 会变成 2×3，那恰好是「活板门」的合法摆法，
    //     会让两个不同配方互相误判。
    //  2) 只含 1~2 格时不放宽 180°——像 bundle（string/leather 竖排）这种配方，
    //     「旋转 180°」和「上下颠倒材料」在几何上是同一件事，放宽就等于允许放错材料。
    const cellCount = transform.inputs.length
    const allowHalfTurn = cellCount >= 3
    const ok =
      sameIdx(et, gt) ||
      sameIdx(et, mirrorRows(gt)) ||
      (allowHalfTurn && sameIdx(et, trimGrid(rotateHalf(gt))))
    if (ok) return { correct: true, wrongCells: [], placed }
    const wrongCells = slots.map((cell, index) => (cell ? index : -1)).filter((index) => index >= 0)
    return { correct: false, wrongCells, placed }
  }

  if (transform.layout === 'grid-shapeless') {
    const nameMap = nameMapOf(transform)
    const given = slots.filter((cell): cell is string => Boolean(cell))
    if (given.length !== transform.inputs.length) {
      return { correct: false, wrongCells: given.map((_, i) => i), placed }
    }
    const used = new Set<string>()
    let valid = true
    for (const leaf of given) {
      const idx = nameMap.get(leaf)
      if (idx === undefined || used.has(`${idx}`)) { valid = false; break }
      used.add(`${idx}`)
    }
    if (valid && used.size === transform.inputs.length) {
      return { correct: true, wrongCells: [], placed }
    }
    return { correct: false, wrongCells: given.map((_, i) => i), placed }
  }

  if (transform.layout === 'single') {
    const correct = Boolean(slots[0]) && transform.inputs[0].names.includes(slots[0] as string)
    return { correct, wrongCells: correct ? [] : slots[0] ? [0] : [], placed }
  }

  if (transform.layout === 'furnace') {
    const ingredientOk = Boolean(slots[0]) && transform.inputs[0].names.includes(slots[0] as string)
    // 燃料槽：只要是全局燃料表里的任意一项都算对（煤、木炭、原木、木板、木制工具……）
    const fuelOk = isFuelName(slots[1])
    const correct = ingredientOk && fuelOk
    const wrongCells: number[] = []
    if (!ingredientOk) wrongCells.push(0)
    if (!fuelOk) wrongCells.push(1)
    return { correct, wrongCells, placed }
  }

  // dual
  const filled = slots.filter((cell): cell is string => Boolean(cell))
  if (filled.length !== 2) return { correct: false, wrongCells: filled.map((_, i) => i), placed }
  const nameMap = nameMapOf(transform)
  const idx0 = nameMap.get(filled[0])
  const idx1 = nameMap.get(filled[1])
  const correct = idx0 !== undefined && idx1 !== undefined && idx0 !== idx1
  return { correct, wrongCells: correct ? [] : [0, 1], placed }
}

/** 找一个还没被提示占用的正确槽位，用于「提示一格」 */
export const nextHintCell = (transform: Transform, slots: (string | null)[], locked: boolean[]) => {
  const expected = expectedSlots(transform)
  const open: number[] = []
  for (let index = 0; index < slotCount(transform); index += 1) {
    const cell = expected[index]
    if (!cell) continue
    if (locked[index]) continue
    if (slots[index] !== cell) open.push(index)
  }
  if (!open.length) return null
  const random = makeRandom()
  return open[Math.floor(random() * open.length)]
}

// ---- 相似干扰项 ----

/**
 * 燃料槽在盘面上放几个代表燃料。
 * 燃料表有 300+ 项，全放出来会把材料盘撑成一堵墙；全不放又等于没提示。
 * 所以按难度给 2/3/4 个「长得不一样」的燃料（煤 vs 木炭 vs 原木 vs 木板 vs 木镐…），
 * 让玩家意识到「这些都能烧」，放中任何一个都判对。
 */
const FUEL_SAMPLE_COUNT: Record<Difficulty, number> = {
  explorer: 2,
  survival: 3,
  hardcore: 4,
}

/** 燃料展示分组：每组挑一个，保证盘面上的燃料类型有区分度 */
const FUEL_SHOWCASE: string[][] = [
  ['coal', 'charcoal', 'coal_block'],
  ['oak_planks', 'spruce_planks', 'birch_planks', 'acacia_planks', 'dark_oak_planks'],
  ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log'],
  ['oak_slab', 'oak_stairs', 'birch_slab', 'spruce_stairs'],
  ['wooden_pickaxe', 'wooden_axe', 'wooden_sword', 'wooden_shovel', 'wooden_hoe'],
  ['crafting_table', 'bookshelf', 'chest', 'barrel', 'loom', 'composter'],
  ['stick', 'bamboo', 'bamboo_planks', 'sapling'],
  ['lava_bucket', 'blaze_rod', 'dried_kelp_block'],
]

/** 给定难度，挑一组有代表性的燃料放进盘面 */
export const sampleFuels = (difficulty: Difficulty, random: () => number): string[] => {
  const want = FUEL_SAMPLE_COUNT[difficulty]
  const groups = shuffle(FUEL_SHOWCASE, random)
  const picked: string[] = []
  for (const group of groups) {
    if (picked.length >= want) break
    const options = group.filter((name) => isFuelName(name) && entryForName(name))
    if (!options.length) continue
    picked.push(options[Math.floor(random() * options.length)])
  }
  // 兜底：分组全失效时从燃料表里随便补
  if (picked.length < want) {
    const rest = shuffle(FUEL_NAMES.filter((n) => !picked.includes(n) && entryForName(n)), random)
    picked.push(...rest.slice(0, want - picked.length))
  }
  return picked
}

export const buildPalette = (transform: Transform, difficulty: Difficulty, seed?: string) => {
  const random = makeRandom(seed ? `${seed}-palette` : undefined)
  const correctLeaves = [...new Set(transform.inputs.flatMap((input) => input.names))]
  const fuelSlot = fuelSlotIndex(transform)
  // 燃料槽没有候选名，改由 sampleFuels 挑几个代表燃料上盘
  const fuelSamples = fuelSlot >= 0 ? sampleFuels(difficulty, random) : []
  const blocked = new Set<string>([...correctLeaves, transform.result, ...fuelSamples])
  const candidates = new Set<string>()

  for (const leaf of correctLeaves) {
    const fam = familyOf.get(leaf)
    if (fam) {
      for (const peer of familyPeers.get(fam) ?? []) {
        if (!blocked.has(peer) && entryForName(peer)) candidates.add(peer)
      }
    }
  }

  const need = DISTRACTOR_COUNT[difficulty]
  if (candidates.size < need) {
    const kinds = new Set(correctLeaves.map((leaf) => kindOf.get(leaf)).filter(Boolean) as Kind[])
    for (const entry of catalog.catalog) {
      if (entry.kind === 'mob' || blocked.has(entry.name)) continue
      if (kinds.size && !kinds.has(entry.kind)) continue
      candidates.add(entry.name)
      if (candidates.size >= need + correctLeaves.length * 4) break
    }
  }

  // 干扰项必须真的「用不上」：把所有合法燃料（除材料本身与已展示的）剔掉。
  // 否则像「原木→木炭」这种材料全是原木的转化，会从同家族里捞到木板、木台阶——
  // 它们看着像干扰项，其实塞进燃料槽照样判对，玩家会以为自己摆错了。
  for (const name of [...candidates]) {
    if (isFuelName(name) && !blocked.has(name)) candidates.delete(name)
  }

  const distractors = shuffle([...candidates], random).slice(0, need)
  const names = shuffle([...correctLeaves, ...fuelSamples, ...distractors], random)
  return names.map((name) => {
    const entry = entryForName(name)!
    return { name, zhName: entry.zhName, sprite: null, entry }
  })
}

/** 这个转化在盘面上「能直接摆对」的东西有哪些（提示 / 文案统计用） */
export const acceptedNames = (transform: Transform, difficulty: Difficulty, seed?: string) => {
  const random = makeRandom(seed ? `${seed}-palette` : undefined)
  const leaves = [...new Set(transform.inputs.flatMap((input) => input.names))]
  return fuelSlotIndex(transform) >= 0 ? [...leaves, ...sampleFuels(difficulty, random)] : leaves
}

// ---- 工具类处理（去皮 / 刮蜡 / 涂蜡）----

const TOOL_METHOD_MAP: Record<string, string> = {
  strip: 'axe',
  scrape: 'axe',
  wax: 'honeycomb',
}

const ALL_TOOLS = ['axe', 'pickaxe', 'shovel', 'hoe', 'honeycomb', 'shears'] as const
const TOOL_LABELS: Record<string, string> = {
  axe: '斧',
  pickaxe: '镐',
  shovel: '锹',
  hoe: '锄',
  honeycomb: '蜜脾',
  shears: '剪刀',
}
const TOOL_SPRITE_ITEM: Record<string, string> = {
  axe: 'iron_axe',
  pickaxe: 'iron_pickaxe',
  shovel: 'iron_shovel',
  hoe: 'iron_hoe',
  honeycomb: 'honeycomb',
  shears: 'shears',
}

export interface ToolItem {
  name: string
  zhName: string
  sprite: string | null
  correct: boolean
}

export const isToolMethod = (method: string): method is 'strip' | 'scrape' | 'wax' =>
  method === 'strip' || method === 'scrape' || method === 'wax'

export const correctToolFor = (transform: Transform): string | null => TOOL_METHOD_MAP[transform.method] ?? null

// 预建「目标方块 + 工具 → 产物」索引，用于错误工具反馈
const sourceToolIndex = (() => {
  const map = new Map<string, Map<string, string>>()
  for (const t of TRANSFORMS) {
    if (!isToolMethod(t.method)) continue
    const tool = correctToolFor(t)
    if (!tool || !t.inputs[0]?.names.length) continue
    for (const source of t.inputs[0].names) {
      if (!map.has(source)) map.set(source, new Map())
      map.get(source)!.set(tool, t.result)
    }
  }
  return map
})()

export const toolResultFor = (target: string, tool: string): string | null =>
  sourceToolIndex.get(target)?.get(tool) ?? null

export const buildToolPalette = (transform: Transform, difficulty: Difficulty, seed?: string): ToolItem[] => {
  const random = makeRandom(seed ? `${seed}-tools` : undefined)
  const correct = correctToolFor(transform)
  if (!correct) return []
  const wrongPool = ALL_TOOLS.filter((name) => name !== correct)
  const wrongCount = Math.min(DISTRACTOR_COUNT[difficulty], wrongPool.length)
  const chosenWrong = shuffle(wrongPool, random).slice(0, wrongCount)
  const names = shuffle([correct, ...chosenWrong], random)
  return names.map((name) => {
    const entry = entryForName(TOOL_SPRITE_ITEM[name])
    return {
      name,
      zhName: TOOL_LABELS[name],
      sprite: entry ? spriteUrlFor(entry) : null,
      correct: name === correct,
    }
  })
}

// ---- 组合工序（先 X 后 Y）----

const resultToTransforms = (() => {
  const map = new Map<string, Transform[]>()
  for (const transform of TRANSFORMS) {
    if (!transform.inputs.every(hasCandidates)) continue
    if (!map.has(transform.result)) map.set(transform.result, [])
    map.get(transform.result)!.push(transform)
  }
  return map
})()

export interface ChainStep {
  transform: Transform
  produces: string
}

export interface TransformChain {
  target: string
  steps: ChainStep[]
}

/** 链条里允许出现的方法：材料类与工具类混排 */
const CHAIN_METHODS = new Set([
  'craft_shaped',
  'craft_shapeless',
  'smelt',
  'blast',
  'smoke',
  'campfire',
  'stonecut',
  'smith',
  'wax',
  'scrape',
  'strip',
])

const chainable = (transform: Transform) => CHAIN_METHODS.has(transform.method)

/**
 * 链条里每一步的产物必须能被下一步真正用上：命中某个 input 的某个候选名。
 * 燃料槽要排除：它是「随便一个可燃物都行」，不是这一步真正的材料，
 * 否则会出现「先烧出煤 → 再用煤当燃料烧 X」这种把燃料当产物的假链条。
 */
const feedsInto = (produced: string, next: Transform) =>
  next.inputs.some((input) => !input.fuelSlot && input.names.includes(produced))

/** 某个材料是否存在可用的上游配方（能作为链条的第一步） */
const upstreamCache = new Map<string, boolean>()
const hasUpstream = (name: string, target: string): boolean => {
  const key = `${name}|${target}`
  const cached = upstreamCache.get(key)
  if (cached !== undefined) return cached
  const value = (resultToTransforms.get(name) ?? []).some(
    (t) =>
      chainable(t) &&
      t.result === name &&
      t.result !== target &&
      // 不能以最终目标为原料，否则等于把 target 变回 target
      !t.inputs.some((i) => i.names.includes(target)),
  )
  upstreamCache.set(key, value)
  return value
}

/**
 * 为某个产物寻找一条两步组合工序：第一步产出第二步需要的材料。
 * 保留回环 / 绕圈过滤，并要求第一步确实存在（基础材料如 stick 无上游，直接跳过）。
 */
export const chainForResult = (target: string, seed?: string): TransformChain | null => {
  const steps2 = (resultToTransforms.get(target) ?? []).filter(chainable)
  const random = makeRandom(seed ? `${seed}-chain` : undefined)
  const tried2 = shuffle(steps2, random)
  for (const step2 of tried2) {
    // 燃料槽不算「第一步产物要喂进来的材料」，跳过
    for (const input of step2.inputs.filter((i) => !i.fuelSlot)) {
      for (const leaf of input.names) {
        // 第一步必须真的存在，且不是绕回 target
        if (!hasUpstream(leaf, target)) continue
        const step1List = (resultToTransforms.get(leaf) ?? []).filter(
          (c) =>
            chainable(c) &&
            c.id !== step2.id &&
            // 第一步的产物必须正好是 leaf（这是链条成立的前提）
            c.result === leaf &&
            // 排除回环：第一步的产物不能就是最终目标
            // （否则做两步原地踏步，如 copper_bars --涂蜡--> waxed_* --刮蜡--> copper_bars）
            c.result !== target &&
            // 排除绕一圈：第一步的原料若就是最终目标，第二步再把它变回来毫无意义
            !c.inputs.some((i) => i.names.includes(target)),
        )
        if (!step1List.length) continue
        // 第一步的产物必须真的能被第二步用上
        if (!feedsInto(leaf, step2)) continue
        const step1 = step1List[Math.floor(random() * step1List.length)]
        return {
          target,
          steps: [
            { transform: step1, produces: leaf },
            { transform: step2, produces: target },
          ],
        }
      }
    }
  }
  return null
}

export const chainPool = (kinds: Kind[]) => {
  const valid = new Set(
    TRANSFORMS.filter((transform) => {
      const entry = entryForTransform(transform)
      return entry && kinds.includes(entry.kind)
    }).map((transform) => transform.result),
  )
  return [...valid]
}

export const pickChain = (kinds: Kind[], previousTargets: string[], seed?: string): TransformChain | null => {
  const targets = chainPool(kinds).filter((target) => !previousTargets.includes(target))
  const source = targets.length ? targets : chainPool(kinds)
  const random = makeRandom(seed)
  const ordered = shuffle(source, random)
  for (const target of ordered) {
    const chain = chainForResult(target, seed ? `${seed}-${target}` : undefined)
    if (chain) return chain
  }
  return null
}

export const roundSeed = (mode: GameMode, kinds: Kind[], round: number, scope: string) => {
  const today = new Date().toISOString().slice(0, 10)
  return mode === 'daily' ? `${today}-${scope}-${kinds.join('-')}` : `${scope}-${round}-${Math.floor(Math.random() * 100000)}`
}
