import rawCatalog from './data/catalog.json'
import rawSounds from './data/sounds.json'
import { makeRandom, sampleWith, shuffleWith } from './rng'
import { entryForName, METHOD_LABELS, TRANSFORMS } from './transforms'
import type { CatalogData, CatalogEntry, Difficulty } from './types'
import type { Transform } from './types'

/**
 * 四个新玩法的出题逻辑。
 *
 * ── 为什么都写成纯函数 ──────────────────────────────────────
 * 这些玩法「出不出得对」很难靠肉眼判断（比如找异类有没有第二种分法），
 * 纯函数 + 种子随机可以在 smoke 里跑几百次批量验证，而不是靠点几下界面。
 *
 * ── 零泄漏与这些玩法的关系 ──────────────────────────────────
 * 这些玩法**不是猜谜**，题目本身就是公开信息（两个方块摆出来、音效放出来），
 * 不存在「未揭晓」，所以不受那条铁律约束。
 * 要守的是另一条：**答案唯一**。所有干扰项都经过「不能也是正确答案」的过滤，
 * 否则玩家选对了却被判错，体验直接崩掉。
 */

const CATALOG: CatalogEntry[] = (rawCatalog as unknown as CatalogData).catalog

interface SoundEntry {
  id: string
  file: string
  category: 'mob' | 'block' | 'iconic'
  entry: string
  zh: string
  action: string
  source: string
}

interface SoundData {
  version: string
  generatedAt: string
  count: number
  byCategory: Record<string, number>
  sounds: SoundEntry[]
}

const SOUND_DATA = rawSounds as SoundData
export const SOUNDS: SoundEntry[] = SOUND_DATA.sounds ?? []
export const SOUND_META = { version: SOUND_DATA.version, count: SOUND_DATA.count }

/** 只有这些指标是可比的数值；字符串类的（工具/材质、可透光）不能比大小 */
const NUMERIC_METRICS = ['硬度', '爆炸抗性', '发光等级', '遮光等级', '堆叠上限'] as const
type Metric = typeof NUMERIC_METRICS[number]

const metricValue = (entry: CatalogEntry, metric: Metric): number | null => {
  const value = entry.facts?.[metric]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/* ============================================================
 * 玩法一：属性对决
 *
 * 两个条目摆出来，猜谁的某个数值更高。
 *
 * 这是现有玩法里唯一考「量级直觉」而不是「识别」的 ——
 * 其他玩法都能靠背答案过关，但 1167 条两两组合背不完，
 * 而且很多人的直觉本来就是错的（比如「遮光等级」绝大多数方块都是 15）。
 * ============================================================ */

export type DuelAnswer = 'left' | 'right' | 'tie'

export interface DuelRound {
  metric: Metric
  left: CatalogEntry
  right: CatalogEntry
  leftValue: number
  rightValue: number
  answer: DuelAnswer
  /** 答后揭示用：把两个数值和差距说清楚 */
  explanation: string
}

/**
 * 各难度可用的指标。
 *
 * 硬度和堆叠上限是玩家天天碰的（挖矿、整理背包），放入门；
 * 爆炸抗性和发光等级要玩得久才知道，放进阶；
 * 遮光等级是最反直觉的一个 —— 绝大多数方块都是 15，
 * 只有少数例外，凭直觉猜几乎必错，正好是极限难度该有的样子。
 */
const DUEL_METRICS: Record<Difficulty, Metric[]> = {
  explorer: ['硬度', '堆叠上限'],
  survival: ['硬度', '堆叠上限', '爆炸抗性', '发光等级'],
  hardcore: ['爆炸抗性', '发光等级', '遮光等级', '硬度'],
}

/**
 * 难度越高考的差距越小。
 * 入门要求差 3 倍以上（一眼能看出来），极限只要差 5%（真的得知道数值）。
 */
const MIN_RATIO: Record<Difficulty, number> = {
  explorer: 3,
  survival: 1.6,
  hardcore: 1.05,
}

export const duelRound = (difficulty: Difficulty, seed?: string): DuelRound | null => {
  const random = makeRandom(seed ?? `duel-${Math.random()}`)
  const metrics = shuffleWith(DUEL_METRICS[difficulty], random)
  const minRatio = MIN_RATIO[difficulty]

  for (const metric of metrics) {
    // 只在同一 kind 内比：拿方块和生物的硬度比是不公平的
    const pool = CATALOG.filter((entry) => metricValue(entry, metric) !== null)
    if (pool.length < 20) continue

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const [a, b] = sampleWith(pool, 2, random)
      if (!a || !b || a.id === b.id || a.kind !== b.kind) continue
      const leftValue = metricValue(a, metric)
      const rightValue = metricValue(b, metric)
      if (leftValue === null || rightValue === null) continue

      const high = Math.max(leftValue, rightValue)
      const low = Math.min(leftValue, rightValue)
      /*
      相等也是一种合法答案（tie），但要**限流**。

      第一版只在极限难度放开 tie，结果实测 120 题里出了 47 次平局（39%）——
      因为遮光等级绝大多数方块都是 15、发光等级绝大多数都是 0，
      随机撞上相等的概率远高于「正好差 5%」。
      每 5 题就有 2 题是「一样高」，玩家会觉得在玩文字游戏而不是考知识。

      所以 tie 是**刻意的稀有题型**（约 18%），撞上相等时多数情况直接换一对，
      只有少数时候才把它当成一道「你敢不敢赌它们一样」的题。
      */
      if (high === low) {
        if (difficulty !== 'hardcore' || random() > 0.18) continue
        return {
          metric, left: a, right: b, leftValue, rightValue, answer: 'tie',
          explanation: `两者${metric}都是 ${leftValue}，一样${metric === '硬度' ? '硬' : '高'}。`,
        }
      }
      if (high / low < minRatio) continue

      const leftIsHigher = leftValue > rightValue
      return {
        metric, left: a, right: b, leftValue, rightValue,
        answer: leftIsHigher ? 'left' : 'right',
        explanation: `${leftValue > rightValue ? a.zhName : b.zhName}的${metric}是 ${high}，另一个是 ${low}，差 ${(high - low).toFixed(metric === '硬度' ? 1 : 0)}。`,
      }
    }
  }
  return null
}

/* ============================================================
 * 玩法二：逆向合成
 *
 * 现有「合成配方」是给原料摆出产物，这里反过来：给产物，倒推原料或方法。
 * 用的是同一份 transformations 数据，只是查反向索引。
 *
 * 深度来自 206 个「一物多法」的产物（金锭 9 种做法、深板岩砖台阶 6 种），
 * 正好考等价替换 —— 与用户要的「煤炭木炭互换」是同一套机制。
 * ============================================================ */

export interface ReverseRound {
  /** 产物条目（用于显示名字与图标） */
  result: CatalogEntry
  /** 产物内部名 */
  resultName: string
  /** 题型：缺哪个原料 / 用什么方法 */
  kind: 'ingredient' | 'method'
  /** ingredient 题型里已经给出的其余原料（中文名） */
  given: string[]
  options: string[]
  answerIndex: number
  explanation: string
}

/** 产物名 → 所有能做出它的配方 */
const BY_RESULT = new Map<string, Transform[]>()
for (const transform of TRANSFORMS) {
  const list = BY_RESULT.get(transform.result)
  if (list) list.push(transform)
  else BY_RESULT.set(transform.result, [transform])
}

/** 某产物所有配方用到过的原料名集合（用来排除干扰项） */
const ingredientSetOf = (resultName: string): Set<string> => {
  const out = new Set<string>()
  for (const transform of BY_RESULT.get(resultName) ?? []) {
    for (const input of transform.inputs) {
      for (const name of input.names) out.add(name)
    }
  }
  return out
}

const methodSetOf = (resultName: string): Set<string> =>
  new Set((BY_RESULT.get(resultName) ?? []).map((transform) => transform.method))

export const reverseRound = (difficulty: Difficulty, seed?: string): ReverseRound | null => {
  const random = makeRandom(seed ?? `reverse-${Math.random()}`)

  /*
  入门只出「缺哪个原料」且给出全部其余原料（几乎是送分）；
  进阶开始混入「用什么方法」；极限则两者都有、且原料题不再给全线索。
  */
  const kinds: ReverseRound['kind'][] = difficulty === 'explorer'
    ? ['ingredient']
    : difficulty === 'survival'
      ? (random() < 0.7 ? ['ingredient'] : ['method'])
      : (random() < 0.5 ? ['ingredient'] : ['method'])

  // 候选产物：必须有配方、能在图鉴里查到中文名
  const candidates = [...BY_RESULT.entries()]
    .filter(([name, list]) => list.length > 0 && entryForName(name))
    .map(([name]) => name)

  for (const kind of shuffleWith(kinds, random)) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const resultName = candidates[Math.floor(random() * candidates.length)]
      const result = entryForName(resultName)
      if (!result) continue
      const recipes = BY_RESULT.get(resultName) ?? []
      if (!recipes.length) continue

      if (kind === 'method') {
        const used = methodSetOf(resultName)
        const answer = recipes[Math.floor(random() * recipes.length)].method
        // 干扰项必须是这个产物**真的用不了**的方法，否则会判错正确答案
        const distractors = shuffleWith(
          Object.keys(METHOD_LABELS).filter((m) => !used.has(m)),
          random,
        ).slice(0, 3)
        if (distractors.length < 3) continue
        const options = shuffleWith(
          [METHOD_LABELS[answer] ?? answer, ...distractors.map((m) => METHOD_LABELS[m] ?? m)],
          random,
        )
        return {
          result, resultName, kind: 'method', given: [],
          options,
          answerIndex: options.indexOf(METHOD_LABELS[answer] ?? answer),
          explanation: `${result.zhName}可以用「${METHOD_LABELS[answer] ?? answer}」做出来${
            recipes.length > 1 ? `（它一共有 ${recipes.length} 种做法）` : ''
          }。`,
        }
      }

      // ingredient：挑一个有 ≥2 种原料的配方，才谈得上「缺哪个」
      const recipe = recipes.find((t) => (t.inputs?.length ?? 0) >= 2)
        ?? recipes[Math.floor(random() * recipes.length)]
      const ingredients = (recipe.inputs ?? []).flatMap((input) => input.names)
      if (ingredients.length < 2) continue

      const answerName = ingredients[Math.floor(random() * ingredients.length)]
      const answer = entryForName(answerName)
      if (!answer) continue

      const used = ingredientSetOf(resultName)
      // 干扰项必须不在该产物的**任何**配方里 ——
      // 否则玩家选了另一个配方的合法原料也会被判错
      const distractorPool = CATALOG.filter(
        (entry) => entry.kind === 'item' && !used.has(entry.name) && entry.name !== answerName,
      )
      const distractors = sampleWith(distractorPool, 3, random)
      if (distractors.length < 3) continue

      const givenNames = ingredients
        .filter((name) => name !== answerName)
        .map((name) => entryForName(name)?.zhName ?? name)

      const options = shuffleWith(
        [answer.zhName, ...distractors.map((entry) => entry.zhName)],
        random,
      )
      return {
        result, resultName, kind: 'ingredient', given: givenNames,
        options,
        answerIndex: options.indexOf(answer.zhName),
        explanation: `${result.zhName}需要「${answer.zhName}」${
          givenNames.length ? `，配上 ${givenNames.join('、')}` : ''
        }，通过「${METHOD_LABELS[recipe.method] ?? recipe.method}」得到。`,
      }
    }
  }
  return null
}

/* ============================================================
 * 玩法三：找异类
 *
 * 四个条目，三个同族、一个不是，挑出那个异类。
 *
 * ── 这里最大的坑：分组必须唯一 ──────────────────────────────
 * 如果四个条目还能按**另一个维度**分成 3+1，且异的不是同一个，
 * 玩家据理力争却判错，会直接觉得题目出错了。
 * 所以下面 hasAmbiguity() 会检查所有数值维度，
 * 只要存在「另一个 3 同 1 异且异的不是答案」就丢弃这题。
 * ============================================================ */

export interface OddRound {
  items: CatalogEntry[]
  answerIndex: number
  /** 答后揭示：说明分组依据 */
  reason: string
}

/** 是否存在第二个能把这 4 个分成 3+1、且异类不是答案的维度 */
const hasAmbiguity = (items: CatalogEntry[], answerIndex: number): boolean => {
  for (const metric of NUMERIC_METRICS) {
    const counts = new Map<string, number[]>()
    items.forEach((entry, index) => {
      const value = metricValue(entry, metric)
      const key = value === null ? 'none' : String(value)
      const bucket = counts.get(key)
      if (bucket) bucket.push(index)
      else counts.set(key, [index])
    })
    for (const [, indexes] of counts) {
      // 出现「3 个一样」且剩下的那个不是答案 → 玩家完全有理由选另一个
      if (indexes.length !== items.length - 1) continue
      const odd = items.findIndex((_, i) => !indexes.includes(i))
      if (odd !== answerIndex) return true
    }
  }
  return false
}

export const oddRound = (difficulty: Difficulty, seed?: string): OddRound | null => {
  const random = makeRandom(seed ?? `odd-${Math.random()}`)

  // 按 family 分族，取成员够多的族（至少 4 个才能凑出 3 个同族）
  const byFamily = new Map<string, CatalogEntry[]>()
  for (const entry of CATALOG) {
    const list = byFamily.get(entry.family)
    if (list) list.push(entry)
    else byFamily.set(entry.family, [entry])
  }
  const families = [...byFamily.entries()].filter(([, list]) => list.length >= 4)
  if (families.length < 2) return null

  /*
  难度体现为族的「粒度」：
    入门用大族（台阶 / 楼梯 / 玻璃），看一眼就知道；
    极限用细分族，且要求同族三项在数值上也接近，逼玩家真的去分辨。
  */
  const sorted = families.sort((a, b) => b[1].length - a[1].length)
  const targetFamilies = difficulty === 'explorer'
    ? sorted.slice(0, Math.max(6, Math.floor(sorted.length * 0.3)))
    : sorted

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const [familyName, members] = targetFamilies[Math.floor(random() * targetFamilies.length)]
    const others = targetFamilies.filter(([name]) => name !== familyName)
    if (!others.length) continue

    /*
    抽 3 个同族时**必须按中文名去重**。
    这是实测出来的 bug：catalog 里方块和物品是两条独立记录，
    中文名却完全一样（block:orange_stained_glass 与 item:orange_stained_glass
    都叫「橙色染色玻璃」），同一 family 里两者都在，
    不去重就会出「绿色旗帜 / 青色染色玻璃 / 橙色染色玻璃 / 橙色染色玻璃」这种题 ——
    选项里两个一模一样的名字，玩家选哪个都算同一个，题直接废掉。
    所以多抽一些候选再按名字过滤，凑不满 3 个就换一族。
    */
    const seenNames = new Set<string>()
    const same: CatalogEntry[] = []
    for (const entry of sampleWith(members, 12, random)) {
      if (seenNames.has(entry.zhName)) continue
      seenNames.add(entry.zhName)
      same.push(entry)
      if (same.length === 3) break
    }
    if (same.length < 3) continue

    const [otherFamily, otherMembers] = others[Math.floor(random() * others.length)]
    const odd = otherMembers[Math.floor(random() * otherMembers.length)]
    if (!odd) continue
    // 异类也不能跟同族三项重名，否则同样会出现两个一样的选项
    if (seenNames.has(odd.zhName)) continue

    const items = shuffleWith([...same, odd], random)
    const answerIndex = items.findIndex((entry) => entry.id === odd.id)
    if (hasAmbiguity(items, answerIndex)) continue

    return {
      items,
      answerIndex,
      reason: `其余三个都属于「${familyName}」，只有${odd.zhName}属于「${otherFamily}」。`,
    }
  }
  return null
}

/* ============================================================
 * 玩法四：盲猜音效
 *
 * 放一段原版音效，四个里猜是谁（或什么）发的声。
 *
 * ⚠️ 选项必须同 category：拿生物叫声和方块破坏声混着出，
 * 玩家靠音色就能排除一半，题目就废了。
 * ⚠️ block 类的选项还要**来自不同 family** ——
 * 同族方块（各种木头）共用一个音源，听起来一模一样，
 * 放一起会出现「选哪个都对」的死题。
 * ============================================================ */

export interface SoundRound {
  sound: SoundEntry
  options: string[]
  answerIndex: number
}

export const soundRound = (difficulty: Difficulty, seed?: string): SoundRound | null => {
  const random = makeRandom(seed ?? `sound-${Math.random()}`)

  // 入门只出生物叫声（辨识度最高），进阶加方块，极限全开
  const categories: SoundEntry['category'][] = difficulty === 'explorer'
    ? ['mob']
    : difficulty === 'survival'
      ? ['mob', 'block']
      : ['mob', 'block', 'iconic']

  for (const category of shuffleWith(categories, random)) {
    const pool = SOUNDS.filter((sound) => sound.category === category)
    if (pool.length < 4) continue

    const answer = pool[Math.floor(random() * pool.length)]
    let distractorPool = pool.filter((sound) => sound.zh !== answer.zh)

    /*
    block 类：干扰项必须与答案、且彼此之间都不同 family。
    这是防止「两种木头听起来一样」的唯一可靠手段 ——
    音效文件本身判断不了相似度，但 family 大致对应音源分组。
    */
    if (category === 'block') {
      const familyOf = (zh: string) =>
        CATALOG.find((entry) => entry.zhName === zh)?.family ?? zh
      const taken = new Set([familyOf(answer.zh)])
      distractorPool = []
      for (const sound of shuffleWith(pool, random)) {
        if (sound.zh === answer.zh) continue
        const family = familyOf(sound.zh)
        if (taken.has(family)) continue
        taken.add(family)
        distractorPool.push(sound)
        if (distractorPool.length === 3) break
      }
    }

    const distractors = distractorPool.length >= 3
      ? sampleWith(distractorPool, 3, random)
      : []
    if (distractors.length < 3) continue

    const options = shuffleWith([answer.zh, ...distractors.map((s) => s.zh)], random)
    return { sound: answer, options, answerIndex: options.indexOf(answer.zh) }
  }
  return null
}

/* ============================================================
 * 每日挑战
 * ============================================================ */

/** 当天日期键（本地时区），同一天任何时刻都得到同一套题 */
export const dailyKey = (date: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 每日挑战的种子：只跟日期有关，所以同一天所有人拿到同一套题 */
export const dailySeed = (kind: string, date: Date = new Date()): string =>
  `daily-${dailyKey(date)}-${kind}`

export interface DailyRound {
  kind: 'duel' | 'reverse' | 'odd' | 'sound'
  label: string
  /** 各玩法自己的题目对象，渲染时按 kind 判断 */
  duel?: DuelRound
  reverse?: ReverseRound
  odd?: OddRound
  sound?: SoundRound
}

export const DAILY_LABELS: Record<DailyRound['kind'], string> = {
  duel: '属性对决',
  reverse: '逆向合成',
  odd: '找异类',
  sound: '盲猜音效',
}

/** 生成当天的挑战题（四种玩法各一道，固定难度为进阶） */
export const dailyRounds = (date: Date = new Date()): DailyRound[] => {
  const out: DailyRound[] = []
  const duel = duelRound('survival', dailySeed('duel', date))
  if (duel) out.push({ kind: 'duel', label: DAILY_LABELS.duel, duel })
  const reverse = reverseRound('survival', dailySeed('reverse', date))
  if (reverse) out.push({ kind: 'reverse', label: DAILY_LABELS.reverse, reverse })
  const odd = oddRound('survival', dailySeed('odd', date))
  if (odd) out.push({ kind: 'odd', label: DAILY_LABELS.odd, odd })
  const sound = soundRound('survival', dailySeed('sound', date))
  if (sound) out.push({ kind: 'sound', label: DAILY_LABELS.sound, sound })
  return out
}
