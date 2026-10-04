/**
 * 生成「知识问答」题库。
 *
 * 输出 src/data/quiz.json：
 *   - tier 'basic'：从 catalog.json 的 facts 与 transformations.json 的转化里批量生成，
 *     全部是 MC 基础知识（硬度 / 爆炸抗性 / 发光 / 遮光 / 工具 / 堆叠 / 配方 / 加工 / 生物碰撞箱 …）。
 *     按难度再分 level 1（必须精确回忆数据）与 level 2（要交叉核对、反向排除、多步推理）。
 *   - tier 'obscure'：来自 scripts/quiz-obscure.mjs 的冷门题与官方 bug，
 *     极限难度专用，来源与版本逐题标注。
 *
 * 硬性要求：每道题都必须带版本信息。
 *   version.verifiedIn —— 这道题所述事实在哪个版本上成立
 *   version.introduced —— 机制/配方从哪个版本开始有（可空）
 *   version.fixed —— 若是已修复的 bug，修复于哪个版本（可空）
 * meta.dataVersion 是本项目图鉴与配方数据的提取版本。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OBSCURE_QUESTIONS, QUIZ_SOURCE } from './quiz-obscure.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))

const catalogData = readJson('src/data/catalog.json')
const transformData = readJson('src/data/transformations.json')
const catalog = catalogData.catalog
const transforms = transformData.transforms
const fuels = new Set(transformData.meta.fuels ?? [])

const DATA_VERSION = catalogData.meta.version
const VERIFIED_IN = DATA_VERSION

// ---------- 通用工具 ----------

/** 确定性随机：同一个 seed 永远生成同一份题库，方便回归测试 */
const makeRandom = (seed) => {
  let state = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i)
    state = Math.imul(state, 1674919113)
  }
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
}

const shuffle = (list, random) => {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}



/**
 * 可做出题选项 / 答案的条目白名单。
 *
 * 为什么要这张表：图鉴里有 22 个条目**根本没有官方材质贴图**，
 * 主要是抽象的技术实体与占位方块 ——
 *   虚空空气 / 洞穴空气 / 光源方块 / 屏障 / 结构空位 / 气泡柱 / 末地传送门 / 下界传送门
 *   区域效果云 / 方块展示实体 / 物品展示实体 / 文本展示实体 / 标记 / 拴绳结
 *   火球 / 小火球 / 潜影弹 / 旋风箭 / 闪电束 / 凋灵之首 / 下落的方块 / 末影之眼 …
 *
 * 两个后果，都实测过：
 *   ① 运行时四个选项必须一致出图标（否则玩家靠「哪个没图」反推答案），
 *      所以混入一个没图的选项会让整道题的图标全部消失。
 *   ② 即使强行补上，也会显示成破图。
 * 而且这些条目本身也不是「可辨认的物品」—— 猜「末地传送门」属于考内部实现，
 * 不属于玩家能凭记忆答的 MC 知识。
 *
 * 所以在源头就不让它们进入题库，而不是等运行时崩。
 */
const NO_SPRITE_NAMES = new Set([
  'void_air', 'cave_air', 'light', 'barrier', 'structure_void', 'bubble_column',
  'end_portal', 'nether_portal', 'end_gateway', 'moving_piston',
  'area_effect_cloud', 'block_display', 'item_display', 'text_display',
  'interaction', 'marker', 'leash_knot', 'falling_block', 'item',
  'fireball', 'small_fireball', 'shulker_bullet', 'breeze_wind_charge',
  'lightning_bolt', 'wither_skull', 'giant', 'mannequin',
  'ominous_item_spawner', 'spawner_minecart', 'eye_of_ender',
])
/** 能当素材池的条目：有贴图、且不是空气 / 传送门这类抽象实体 */
const spriteBacked = (entry) => Boolean(entry) && !NO_SPRITE_NAMES.has(entry.name)

/** 因「选项没有官方材质贴图」被丢弃的题目：落盘时汇总上报，避免静默丢题 */
const unspriteableQuestions = []

const entryByName = new Map(catalog.map((entry) => [entry.name, entry]))
const zhOf = (name) => entryByName.get(name)?.zhName ?? name

// ---------- 出题素材池：只取有官方材质贴图、且是玩家认得的实体 ----------
//
// 空气、传送门、屏障、展示实体这类抽象条目不进池子，理由见 NO_SPRITE_NAMES 的注释。
// 直接砍掉源头，比在每个题型里过滤更可靠 —— 少一个漏网之鱼就少一道图标全丢的题。
const blocks = catalog.filter((entry) => entry.kind === 'block' && !NO_SPRITE_NAMES.has(entry.name))
const items = catalog.filter((entry) => entry.kind === 'item' && !NO_SPRITE_NAMES.has(entry.name))
// 生物题只认真实生物：载具 / 抛射物 / Immobile 混在 entities 数据里，会让「哪个是攻击型生物」出现歧义
const mobs = catalog.filter((entry) => entry.kind === 'mob' && entry.facts['实体类型'] === 'mob')

// ---------- 跨表派生的判定集合（双条件题 / 反向题全靠它们） ----------
//
// 「双条件交叉题」和「反向排除题」之所以比正向题难，是因为玩家不能只查一张表：
// 正向题里「哪个是燃料」只要查到燃料表就结束了，排除法还能帮忙；
// 交叉题要求同时满足两个条件，四个选项里往往有三个只满足其中一个 ——
// 只看一行数据会被精准绊倒。这才是「必须真记数据」的门槛。
//
// 这里的集合全部从官方数据现算，不硬编码，避免与 client.jar 脱节。
const fuelSet = fuels
/** 能当熔炉/冶炼/烧制原料的物品 —— 玩家查燃料表时看不到这一层 */
const processingInputs = new Set()
/** 任何加工的产物 —— 用来出「是产物但不是燃料」这类反向题 */
const processingResults = new Set()
/** 可去皮的原木 / 木头 / 菌柄 */
const strippable = new Set()
/** 可涂蜡的方块 */
const waxable = new Set()
for (const transform of transforms) {
  processingResults.add(transform.result)
  for (const input of transform.inputs) {
    for (const name of input.names) processingInputs.add(name)
  }
  if (transform.method === 'strip') for (const name of transform.inputs[0].names) strippable.add(name)
  if (transform.method === 'wax') for (const name of transform.inputs[0].names) waxable.add(name)
}

const questions = []
let serial = 0


const FACT_SOURCE = {
  type: 'data',
  label: 'Minecraft 官方客户端数据（client.jar）',
  confidence: 'data',
}

const RECIPE_SOURCE = {
  type: 'recipe',
  label: 'Minecraft 官方配方与转化表（data/minecraft/recipe + FuelValues）',
  confidence: 'data',
}

/**
 * 登记一道题。
 *
 * choices 传入「选项 + 对应图鉴条目」的配对数组，顺序无所谓，add() 会自己打乱。
 * 条目只用于给【每个选项】渲染它自己的官方材质图标。
 *
 * 零泄漏铁律：这里刻意没有「题目主角」字段。
 * 四选一里单独显示一个方块图标，等于直接把答案摆在脸上 ——
 * 实测 232/347 道题的主角就是正确答案，与项目「未揭晓零泄漏」原则直接冲突。
 */
const add = ({ tier, level = 1, topic, prompt, choices, explanation, source = FACT_SOURCE, version = {} }) => {
  // 全站统一四选一：选项不足或超过 4 个就整题丢弃
  if (choices.length !== 4) return
  const labels = choices.map((choice) => choice.label)
  if (new Set(labels).size !== labels.length) return
  // 素材池守卫：四个选项要么都有贴图、要么都没有。
  // 混入一个无贴图条目会让运行时整道题的图标消失（四个选项必须一致出图标，
  // 否则玩家靠「哪个没图」反推答案），所以在生成期就拦掉。
  if (choices.some((choice) => choice.name && !spriteBacked(entryByName.get(choice.name)))) {
    unspriteableQuestions.push({ prompt, labels })
    return
  }
  const shuffled = shuffle(choices, makeRandom(`${tier}-${level}-${serial}-${labels.join('|')}`))
  serial += 1
  questions.push({
    id: `${tier}-${String(serial).padStart(4, '0')}`,
    tier,
    level,
    topic,
    prompt,
    options: shuffled.map((choice) => choice.label),
    answerIndex: shuffled.findIndex((choice) => choice.answer),
    optionNames: shuffled.map((choice) => choice.name ?? null),
    version: {
      verifiedIn: VERIFIED_IN,
      introduced: null,
      fixed: null,
      ...version,
    },
    source,
    explanation,
  })
}

/** 造一个选项：label 是显示文本，name 是图鉴注册名（用于出图标） */
const choice = (label, name = null, answer = false) => ({ label, name, answer })

/** 把「正确答案 + 干扰项」拆成 choices：correctLabel 之外的都当干扰项 */
const asChoices = (correctLabel, correctName, wrongLabels, wrongNames = []) => [
  choice(correctLabel, correctName, true),
  ...wrongLabels.map((label, index) => choice(label, wrongNames[index] ?? null)),
]

/** 从候选池里挑 n 个「与正确答案不同类」的干扰项，尽量拉开差异 */
const distractorsFrom = (pool, exclude, count, random, key = (x) => x) => {
  const seen = new Set(exclude.map(key))
  const out = []
  for (const candidate of shuffle(pool, random)) {
    const k = key(candidate)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(candidate)
    if (out.length >= count) break
  }
  return out
}

// ---------- 难度工具：把「一眼可答」改成「必须真记数据」 ----------
//
// 用户反馈「题目太简单了」。复盘分两轮，根因都不在题量：
//
// 第一轮 —— 数值题的结构性问题：
//   ① 干扰项从全池随机取，四个选项的数值天差地别 ——
//      硬度题抽出「水 / 淡蓝色床 / 石英砖 / 激活铁轨」里找最高，
//      玩家闭着眼睛都能剔掉「水」。这种情况下根本不用记硬度表，靠常识排除就够。
//   ② 问的全是「以下哪个最 X」这类极值题，只需要比较、不需要精确回忆 ——
//      而极值题一旦干扰项拉得太开，就退化成常识题。
//
// 第二轮 —— 数值题修好之后，level 1 里剩下的全是「哪一个是 X」的正向语义题：
//   哪个能当燃料、哪个是透明的、哪个是敌对生物、用什么工具采掘。
//   这些题靠物品语义就能答，用不上数据表 —— 看到玻璃就知道透明，看到煤就知道是燃料。
//   对策不是继续调数值，而是换结构：
//     · 双条件交叉（见题型 3 / 7）：要求同时核对两行数据，干扰项各只满足一个条件。
//     · 反向排除（见题型 8 / 10 / 11 / 17）：问「哪一个【不】能……」，
//       必须确认另外三个都满足，只知道答案那一个不够。
//
// 下面的工具解决数值题的两类结构问题：
//    neighboursOf —— 取【数值紧邻】的项做干扰项，四个选项数值挨在一起，
//                    玩家必须真的记得那张数值表才能分辨，排除法失效。
//    numericChoice —— 反过来出「精确数值题」：题干问某个具体值，选项全是数字，
//                    没有任何排除法空间，背不出就是背不出。
//    targetValueChoices —— 出「精确目标值题」：题干给数值、选项给四个条目名，
//                    并强制正确答案既不是最大值也不是最小值（否则又变回可排序的送分题）。

/**
 * 取「数值紧邻 targetValue」的n 个干扰项。
 *
 * 做法：把所有候选按与目标值的距离排序，优先在最近的若干项里取，
 * 这样四个选项的数值会挨在一起（比如硬度 5.0/3.0/2.5/0.5 → 变成 5.0/5.5/3.0/6.0），
 * 玩家没法靠「一眼看出哪个最离谱」来排除，必须真记数值表。
 *
 * 若最近邻不够（同值项太多或太少），会逐步放宽半径，保证一定能凑够 count 个。
 */
const neighboursOf = (pool, targetValue, count, random, valueOf, keyOf) => {
  const sorted = [...pool].sort((a, b) => Math.abs(valueOf(a) - targetValue) - Math.abs(valueOf(b) - targetValue))
  const out = []
  const seen = new Set()
  // 逐步放宽半径：先只在最近的 6 个里取，不够再扩到 12、24、全池
  for (const radius of [6, 12, 24, sorted.length]) {
    const window = sorted.slice(0, Math.max(radius, out.length + count))
    for (const candidate of shuffle(window, random)) {
      const k = keyOf(candidate)
      if (seen.has(k)) continue
      // 与目标值完全相同的先跳过（数值上无法区分，会让题目变成纯猜同值项）
      if (valueOf(candidate) === targetValue) continue
      seen.add(k)
      out.push(candidate)
      if (out.length >= count) return out
    }
    if (out.length >= count) break
  }
  return out
}

/**
 * 出「精确目标值题」：题干给出一个具体数值，选项是四个条目名。
 *
 * 这是本项目里最难靠排除法蒙混的题型 —— 四个选项都是同类的方块名，
 * 玩家必须逐个核对这张数值表才能分辨，光看名字猜不出来。
 *
 * 关键约束：正确答案既不能是四个选项里数值最大的，也不能是最小的。
 * 否则题目会退化成「找最 X 的那个」，只要会排序就一定答对（这正是
 * 用户反馈「题目太简单」的最初根因）。
 *
 * 干扰项优先取【数值紧邻】的条目，让四个选项的数值挤在窄区间里。
 */
const targetValueChoices = ({
  target, pool, random, valueOf, requireMiddle = true, maxDistinct = 24,
}) => {
  const targetValue = valueOf(target)
  // 候选按「数值紧邻」排序：四个选项的数值挨在一起，排除法失效
  const neighbours = [...pool]
    .filter((item) => valueOf(item) !== targetValue)
    .sort((a, b) => Math.abs(valueOf(a) - targetValue) - Math.abs(valueOf(b) - targetValue))
  // 同一取值的候选之间毫无区分度（选谁都一样），每个取值只保留最近的那个
  const distinct = []
  const seenValues = new Set()
  for (const item of neighbours) {
    const value = valueOf(item)
    if (seenValues.has(value)) continue
    seenValues.add(value)
    distinct.push(item)
    if (distinct.length >= maxDistinct) break
  }
  if (distinct.length < 3) return null

  // 枚举三元组，找一组同时满足「取值互异」和「答案既非最大也非最小」的组合。
  //
  // ⚠️ 这里必须枚举，不能直接取前三个：
  // 硬度、爆炸抗性这些字段的最近邻里大量同值（比如 1.5 附近挤着一堆 1.4 / 1.5 / 1.8），
  // 直接取前三个会得到重复取值，add() 静默丢弃整题。
  // 早期版本正是在这里栽了：能凑齐「四值互异 + 答案居中」的硬度档位只有 2 个，
  // 放宽 span 也救不回来 —— 换成枚举回溯后，同样的规则能覆盖 24 个档位。
  for (let i = 0; i < distinct.length; i += 1) {
    for (let j = i + 1; j < distinct.length; j += 1) {
      for (let k = j + 1; k < distinct.length; k += 1) {
        const trio = [distinct[i], distinct[j], distinct[k]]
        const values = [targetValue, ...trio.map(valueOf)]
        if (new Set(values).size !== values.length) continue
        if (requireMiddle) {
          if (targetValue === Math.min(...values) || targetValue === Math.max(...values)) continue
        }
        // 在同样合法的组合里随机挑一组，避免同一个数值每次都出同一批方块
        const offset = Math.floor(random() * 3)
        return { wrong: [trio[offset], trio[(offset + 1) % 3], trio[(offset + 2) % 3]], values }
      }
    }
  }
  return null
}

/**
 * 出「同区间四选一」题：四个选项的数值挤在窄区间里，且正确答案不是最大也不是最小。
 *
 * 为什么不直接出「以下哪个最高」：
 *   极值题的答案天然是四个选项里最大的那个，玩家只要会排序就一定答对，
 *   而「哪个最硬 / 最高 / 最大」这种题根本不需要精确记忆任何数值 ——
 *   这正是用户反馈「题目太简单」的根源。
 *   而且极值段的数据很稀疏（硬度最高段只有 100 / 55 / 50 / 30 / 22.5 五个值），
 *   要凑出四个「数值挨着的极值选项」根本凑不出来。
 *
 * 所以改成中间值比较：正确答案藏在中间，必须真的记得具体数值才能分辨，
 * 而且三个干扰项都是「看起来也可能是答案」的候选。
 *
 * span 控制四个选项的最大 / 最小比值，默认 2 —— 也就是四个选项数值在两倍以内。
 */
const clusteredChoices = ({
  target, pool, random, valueOf, span = 2, middleOnly = true,
}) => {
  const targetValue = valueOf(target)
  const inBand = pool.filter((item) => {
    const v = valueOf(item)
    return v > targetValue / span && v < targetValue * span && v !== targetValue
  })
  if (inBand.length < 3) return null
  const wrong = shuffle(inBand, random).slice(0, 3)
  const values = [targetValue, ...wrong.map(valueOf)]
  // 四选一里正确答案不能是最大或最小 —— 否则又退化成「找最X」的送分题
  if (middleOnly && (targetValue === Math.min(...values) || targetValue === Math.max(...values))) return null
  if (new Set(values).size !== values.length) return null
  return { target, wrong, values }
}

/**
 * 出「精确数值题」：题干问某个方块的某个数值，选项全是数字。
 *
 * 这类题没有任何排除法空间 —— 玩家要么记得硬度是 1.5，要么不知道，
 * 四个数字摆在一起也没法靠常识推断。干扰项同样取相邻数值。
 */
const numericChoice = (question) => {
  const { correctValue, pool, random, valueOf, keyOf, count = 3, format = (v) => String(v) } = question
  const wrong = neighboursOf(
    pool.filter((item) => valueOf(item) !== correctValue),
    correctValue,
    count,
    random,
    valueOf,
    keyOf,
  )
  if (wrong.length < count) return null
  const labels = [correctValue, ...wrong.map(valueOf)].map((value) => format(value))
  if (new Set(labels).size !== labels.length) return null
  return [
    choice(format(correctValue), null, true),
    ...wrong.map((item) => choice(format(valueOf(item)))),
  ]
}

// ---------- 题型 1：方块硬度（level 1，干扰项改为数值相邻）----------
//
// 原来是「以下四个里硬度最高的是哪一个」+ 全池随机干扰项 —— 抽出过
// 「水 / 淡蓝色床 / 石英砖 / 激活铁轨」这种组合，玩家一眼剔掉「水」就赢了。
// 现在改成两个题型：
//   A 精确数值题（level 1）：问「石头的硬度是多少」，四个数字挨着，没有任何排除空间
//   B 相邻极值题（level 2）：四个选项数值紧挨，只能靠记忆分辨

{
  const random = makeRandom('hardness')
  const withHardness = blocks
    .filter((entry) => Number.isFinite(Number(entry.facts['硬度'])) && Number(entry.facts['硬度']) > 0)
    .map((entry) => ({ entry, hardness: Number(entry.facts['硬度']) }))

  // A. 精确数值题：覆盖不同硬度档位，保证每个档位都有题
  const byHardness = new Map()
  for (const item of withHardness) {
    if (!byHardness.has(item.hardness)) byHardness.set(item.hardness, [])
    byHardness.get(item.hardness).push(item)
  }
  // 每个硬度档位抽 2~3 道，避免某个冷门档位（比如 55）出太多
  for (const [hardness, bucket] of [...byHardness.entries()].sort((a, b) => a[0] - b[0])) {
    const size = hardness >= 3 ? 2 : 3
    for (const target of shuffle(bucket, random).slice(0, size)) {
      const choices = numericChoice({
        correctValue: hardness,
        pool: withHardness,
        random,
        valueOf: (item) => item.hardness,
        keyOf: (item) => item.entry.name,
        // 硬度最多一位小数，保留一位更好读
        format: (value) => String(value),
      })
      if (!choices) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '方块 / 硬度',
        prompt: `「${target.entry.zhName}」的硬度是多少？`,
        // 四个选项都是数字，没有对应条目，四个都不挂图标
        choices,
        explanation: `${target.entry.zhName}的硬度是 ${hardness}。硬度决定徒手挖掘要花多久、是否需要正确的工具 —— 黑曜石是 50，下界合金块是 55，都要用钻石镐。`,
      })
    }
  }

  // B. 同区间中间值题：四个选项硬度都挨着，答案藏在中间。
  //    这是本项目里真正「需要精确记忆数值」的题型 —— 不能排序、不能排除，
  //    玩家必须真的记得每个方块的硬度是多少。
  //    level 1：入门难度也该考真数据，只是判据单纯（只需核对一个字段）
  //    每个硬度档位出 2 道，避免某个档位刷屏
  for (const [hardness, bucket] of [...byHardness.entries()].sort((a, b) => a[0] - b[0])) {
    if (hardness <= 1) continue // 太软的档位同区间内凑不齐 3 个不同值
    for (const target of shuffle(bucket, random).slice(0, 2)) {
      const picked = clusteredChoices({
        target,
        pool: withHardness,
        random,
        valueOf: (item) => item.hardness,
        span: 2,
      })
      if (!picked) continue
      const values = picked.values
      add({
        tier: 'basic',
        level: 1,
        topic: '方块 / 硬度',
        prompt: `以下四个方块里，哪一个的硬度是 ${hardness}？`,
        choices: asChoices(
          picked.target.entry.zhName,
          picked.target.entry.name,
          picked.wrong.map((item) => item.entry.zhName),
          picked.wrong.map((item) => item.entry.name),
        ),
        explanation: `${picked.target.entry.zhName}的硬度正好是 ${hardness}，另外三个分别是 ${picked.wrong.map((item) => item.hardness).join(' / ')}。四个数值都落在 ${Math.min(...values)} ~ ${Math.max(...values)} 之间、光看名字分不出来，只能靠记忆。`,
      })
    }
  }
}

// ---------- 题型 2：发光等级（level 1）----------
//
// 原来是「哪一个会自己发光」，四个选项里只有火把 / 荧石这类玩家闭着眼都认得的东西，
// 靠排除法就过了 —— 现在改成问精确数值，选项全是数字。
// 反向也出一道：哪一个不发光（这四个全是自己发光的方块，不能靠「哪个眼熟」判断）。

{
  const random = makeRandom('light')
  const glowing = blocks.filter((entry) => Number(entry.facts['发光等级']) > 0)

  // A. 精确数值题：问「海晶石簇的发光等级是多少」
  for (const target of shuffle(glowing, random).slice(0, 34)) {
    const light = Number(target.facts['发光等级'])
    const choices = numericChoice({
      correctValue: light,
      pool: glowing.map((entry) => ({ entry, light: Number(entry.facts['发光等级']) })),
      random,
      valueOf: (item) => item.light,
      keyOf: (item) => item.entry.name,
    })
    if (!choices) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '方块 / 光照',
      prompt: `「${target.zhName}」的发光等级是多少？`,
      choices,
      explanation: `${target.zhName}的发光等级是 ${light}。作为对照，火把是 14 级，海晶石簇是 12 级，满发光是 15 级。`,
    })
  }

  // B. 反向题：四个选项全是会发光的，问哪一个完全不发光
  //    注意干扰项都从会发光的方块里取 —— 玩家不能靠「哪个眼熟」判断，必须知道哪些方块其实不发光
  const notGlowingButBlock = blocks.filter(
    (entry) => Number(entry.facts['发光等级']) === 0 && Number.isFinite(Number(entry.facts['硬度'])) && Number(entry.facts['硬度']) > 0,
  )
  for (const target of shuffle(notGlowingButBlock, random).slice(0, 18)) {
    const wrong = distractorsFrom(glowing, [target], 3, random, (entry) => entry.name)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '方块 / 光照',
      prompt: '以下四个方块里，哪一个完全不会发光？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}的发光等级是 0，完全不发光。其余三个分别是 ${wrong.map((entry) => entry.facts['发光等级']).join(' / ')} 级，都能当光源用。`,
    })
  }
}

// ---------- 题型 3：采掘工具（level 1）----------
//
// 原版问「要采掘 X 该用哪一类工具」，四个选项是五种工具里的四个。
// 这题靠语义就能答 —— 玩家看到「石头」就知道要镐，看到「木门」就知道要斧，
// 根本不用查工具表。而且原版还漏了「羊毛 / 剪刀」这类特殊工具，
// 正确答案永远是镐或斧，一半的题等于送分。
//
// 现在改成两类真正需要查表的题：
//   A 反向题（level 1）：四个选项全是需要镐的方块，问哪一个【不】需要镐 ——
//      玩家必须逐个核对工具表才能确认「另外三个都要镐」。
//   B 双条件交叉题（level 1）：同时满足「需要某工具」和「某个数值条件」，
//      三个干扰项各只满足其中一个条件，只看一行数据必被绊倒。

{
  const random = makeRandom('tool')
  const TOOL_LABELS = { 镐: '镐', 斧: '斧头', 锹: '铲子', 锄: '锄头', 剪刀: '剪刀' }
  const TOOL_NAMES = Object.keys(TOOL_LABELS)
  const toolOf = (entry) => {
    const tool = String(entry.facts['工具/材质'] ?? '')
    return TOOL_NAMES.includes(tool) ? tool : null
  }
  const diggable = blocks.filter((entry) => {
    return entry.facts['可采掘'] === '是' && toolOf(entry)
  })

  // A. 反向题：四个选项里三个都需要镐 / 斧，问哪一个其实不需要。
  //    干扰项刻意从「同工具的方块」里取 —— 玩家必须确认另外三个都满足条件。
  for (const [tool, label] of [['镐', '镐'], ['斧', '斧头']]) {
    const needsTool = diggable.filter((entry) => toolOf(entry) === tool)
    // 不需要这个工具、但仍然可采掘的方块（材质写的是「普通」或别的工具）
    const notThisTool = diggable.filter((entry) => toolOf(entry) !== tool)
    for (const target of shuffle(notThisTool, random).slice(0, 12)) {
      const wrong = distractorsFrom(needsTool, [target], 3, random, (entry) => entry.name)
      if (wrong.length < 3) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '方块 / 采掘',
        prompt: `以下四种方块里，哪一个【不】需要用${label}就能采掘？`,
        choices: asChoices(
          target.zhName,
          target.name,
          wrong.map((entry) => entry.zhName),
          wrong.map((entry) => entry.name),
        ),
        explanation: `${target.zhName}的正确采掘工具是${TOOL_LABELS[toolOf(target)] ?? '徒手'}，用${label}挖不掉东西。其余三个的正确工具都是${label}（硬度分别是 ${wrong.map((entry) => entry.facts['硬度']).join(' / ')}）—— 材质和外观都很像，必须逐个核对工具表。`,
      })
    }
  }

  // B. 双条件交叉题：既要用指定工具采掘、又要满足某个数值条件。
  //    三个干扰项各只满足其中一个条件 —— 只查工具表或只查数值表都会答错。
  const CROSS_SPECS = [
    { tool: '镐', label: '镐', field: '遮光等级', value: 0, describe: () => '遮光等级是 0（完全不挡光）', pool: blocks },
    { tool: '镐', label: '镐', field: '发光等级', test: (v) => v > 0, describe: () => '自己会发光', pool: blocks },
    { tool: '斧', label: '斧头', field: '可透光', value: '是', describe: () => '是透明的', pool: blocks },
    { tool: '锄', label: '锄头', field: '可透光', value: '是', describe: () => '是透明的', pool: blocks },
  ]
  for (const spec of CROSS_SPECS) {
    // 「条件满足」与「工具满足」拆成两个独立判定，双条件题的全部难度都来自这里：
    // 干扰项分别只满足其中一个，玩家必须两条都对上才能锁定答案。
    const matchesField = (entry, s) => {
      const value = entry.facts[s.field]
      return s.test ? s.test(Number(value)) : String(value) === String(s.value)
    }
    const matches = (entry) => toolOf(entry) === spec.tool && matchesField(entry, spec)
    const pool = spec.pool.filter((entry) => entry.facts['可采掘'] === '是')
    const both = pool.filter(matches)
    // 半满足：工具对但条件不满足
    const onlyTool = pool.filter((entry) => toolOf(entry) === spec.tool && !matches(entry))
    // 半满足：条件满足但工具不对
    const onlyField = pool.filter((entry) => toolOf(entry) !== spec.tool && matchesField(entry, spec))
    if (both.length < 1 || onlyTool.length < 2 || onlyField.length < 2) continue

    for (const target of shuffle(both, random).slice(0, 8)) {
      const wrong = [
        ...shuffle(onlyTool.filter((entry) => entry.name !== target.name), random).slice(0, 2),
        ...shuffle(onlyField.filter((entry) => entry.name !== target.name), random).slice(0, 1),
      ]
      if (wrong.length < 3) continue
      if (new Set(wrong.map((entry) => entry.name)).size !== 3) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '方块 / 采掘',
        prompt: `以下四种方块里，哪一个同时满足「要用${spec.label}采掘」和「${spec.describe(target)}」？`,
        choices: asChoices(
          target.zhName,
          target.name,
          wrong.map((entry) => entry.zhName),
          wrong.map((entry) => entry.name),
        ),
        explanation: `${target.zhName}两条都满足：工具是${spec.label}，且${spec.describe(target)}。另外三个各差一条 —— 有的是工具对但${spec.field === '可透光' ? '不透明' : '数值不对'}，有的是条件对但工具不是${spec.label}。只看一行数据一定会被绊倒。`,
      })
    }
  }
}

// ---------- 题型 4：物品堆叠上限（level 1/2）----------
//
// 原来只有一种题：「哪一个在背包里不能堆叠」，干扰项全是从 64 上限的堆叠池里随便取 ——
//「不能堆叠」和「能堆叠 64 个」差别太大，一眼就能剔掉，难度太浅。
// 现在改成三种真正需要记忆的题型：
//   A 精确数值题（level 1）：问「末影珍珠一格最多放几个」，四个数字选项全是真实上限值
//   B 塞满一整格题（level 2）：问「塞满一整格 / 只占一格」，考的是物品属于哪一类
//   C 每个上限档位都出题（level 2）：1 / 16 / 64 各来一道，靠桶保证覆盖

{
  const random = makeRandom('stack')
  const allStacks = items.filter((entry) => Number(entry.facts['堆叠上限']) >= 1)
  const sixteenOnly = items.filter((entry) => Number(entry.facts['堆叠上限']) === 16)
  // 按上限值分桶：数值型题目要保证每个真实存在的上限值都有题，不能只抽「不能堆叠」那一类
  const byStack = new Map()
  for (const entry of allStacks) {
    const stack = Number(entry.facts['堆叠上限'])
    if (!byStack.has(stack)) byStack.set(stack, [])
    byStack.get(stack).push(entry)
  }
  const stackPool = allStacks.map((entry) => ({ entry, stack: Number(entry.facts['堆叠上限']) }))

  // A. 精确数值题：每个上限档位抽 1~2 道，覆盖 1 / 16 / 64 等所有真实值
  for (const [stack, bucket] of [...byStack.entries()].sort((a, b) => a[0] - b[0])) {
    const size = stack === 1 ? 3 : 2
    for (const target of shuffle(bucket, random).slice(0, size)) {
      const choices = numericChoice({
        correctValue: stack,
        pool: stackPool,
        random,
        valueOf: (item) => item.stack,
        keyOf: (item) => item.entry.name,
      })
      if (!choices) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '物品 / 堆叠',
        prompt: `「${target.zhName}」一格最多能放几个？`,
        choices,
        explanation: `${target.zhName}的堆叠上限是 ${stack}${stack === 1 ? ' —— 一个格子只能放一个，耐久、附魔或特殊状态这类数据每个都得单独占格。' : '。'}`,
      })
    }
  }

  // B. 塞满一整格题：考的是「这个物品属于特殊的那一类」，四个选项都是常见说法
  for (const target of shuffle(sixteenOnly, random).slice(0, 20)) {
    add({
      tier: 'basic',
      level: 2,
      topic: '物品 / 堆叠',
      prompt: `把「${target.zhName}」放进背包，是占一格还是能塞满一整格？`,
      choices: [
        choice('能塞满一整格（16 个）', null, true),
        choice('一个格子只能放 1 个'),
        choice('能放，但最多只能放 32 个'),
        choice('能放，但一格最多 12 个'),
      ],
      explanation: `${target.zhName}可以叠 16 个，能塞满一整格。原版里 16 上限的都是「一堆用得少、需要单独计数」的物品；64 才是普通物品的常规上限。`,
    })
  }
}

// ---------- 题型 5：生物分类与碰撞箱（level 1）----------
//
// 原来的问法是「以下四种生物里，哪一个会主动攻击玩家」。
// 敌对阵营在图鉴里只有 6 个（末影龙 / 恶魂 / 岩浆怪 / 幻翼 / 潜影贝 / 史莱姆），
// 被动阵营只有 4 个（悦灵 / 铜傀儡 / 铁傀儡 / 雪傀儡）—— 全部生物加起来只有 10 个。
// 池子这么小，「敌对 / 被动」几乎一眼就能看出来（会飞的、黑色的就是敌对），
// 无论把干扰项怎么摆都还是送分题。
//
// 中途试过用「敌对/被动 × 体型档位」做双条件交叉，但实测行不通：
// 10 个生物里 6 个都是敌对，同一档里反复出现恶魂 / 末影龙，
// 出 10 道题里有 4 道题干选项完全一样，重复度高到没有意义。
//
// 现在改成真正需要记数值的题型：**精确碰撞宽度题**。
// 碰撞宽度决定生物能不能穿过一格宽的缝隙（村民能过、末影龙过不去），
// 而这些数值（0.35 / 0.49 / 0.52 / 0.7 / 0.9 / 1 / 1.4）彼此极近，
// 玩家必须真的记住碰撞箱表，靠「看起来大 / 看起来小」判断一定会错。

{
  const random = makeRandom('mobclass')
  const withBox = mobs.filter((entry) => {
    const width = Number(entry.facts['碰撞宽度'])
    const height = Number(entry.facts['碰撞高度'])
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
  })
  const widthPool = withBox.map((entry) => ({ entry, width: Number(entry.facts['碰撞宽度']) }))

  for (const target of shuffle(widthPool, random)) {
    const choices = numericChoice({
      correctValue: target.width,
      pool: widthPool,
      random,
      valueOf: (item) => item.width,
      keyOf: (item) => item.entry.name,
      format: (value) => `${value} 格`,
    })
    if (!choices) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '生物 / 体型',
      prompt: `「${target.entry.zhName}」的碰撞宽度是多少？`,
      choices,
      explanation: `${target.entry.zhName}的碰撞箱是 ${target.entry.facts['碰撞宽度']} × ${target.entry.facts['碰撞高度']} 格。碰撞宽度决定它能不能穿过一格宽的缝隙 —— 悦灵 0.35 格能钻过去，末影龙 16 格完全不行。四个数值挨得很近，看体型猜不出来。`,
    })
  }
}

// ---------- 题型 6：生物体型（level 2，要比大小）----------

{
  const random = makeRandom('mobsize')
  const sized = mobs
    .filter((entry) => Number(entry.facts['碰撞高度']) > 0)
    .map((entry) => ({ entry, height: Number(entry.facts['碰撞高度']) }))
  // 体型题改成「精确高度题」：问某个具体高度对应哪种生物。
  // 原来问「哪个最高」—— 答案必然是四个里最大的，等于送分。
  const heightBuckets = new Map()
  for (const item of sized) {
    const key = item.height.toFixed(2)
    if (!heightBuckets.has(key)) heightBuckets.set(key, [])
    heightBuckets.get(key).push(item)
  }
  // 碰撞高度是两位小数，全世界独一份的数值太多，能凑出同高度干扰项的桶才出题
  for (const bucket of [...heightBuckets.values()].sort((a, b) => b.length - a.length)) {
    if (bucket.length < 4) continue
    for (const target of shuffle(bucket, random).slice(0, 2)) {
      // 干扰项取高度相近的：身高接近的生物才容易被认混
      const wrong = neighboursOf(sized, target.height, 3, random, (item) => item.height, (item) => item.entry.name)
      if (wrong.length < 3) continue
      const values = [target.height, ...wrong.map((item) => item.height)]
      if (new Set(values.map((value) => value.toFixed(2))).size !== 4) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '生物 / 体型',
        prompt: `「${target.entry.zhName}」的碰撞高度是多少？`,
        choices: [
          choice(`${target.height.toFixed(2)} 格`, null, true),
          ...wrong.map((item) => choice(`${item.height.toFixed(2)} 格`)),
        ],
        explanation: `${target.entry.zhName}的碰撞高度是 ${target.height.toFixed(2)} 格（玩家约 1.8 格），另外三个分别是 ${wrong.map((item) => item.height.toFixed(2)).join(' / ')} 格 —— 数值挨得很近，看名字判断不出来。`,
      })
    }
  }
}

// ---------- 题型 7：燃料（level 1，衔接燃料可互换玩法）----------
//
// 原版是「以下四个物品里，哪一个能当熔炉燃料」，四个选项一个是燃料、三个随意。
// 这题靠语义就能答 —— 玩家扫一眼「煤炭 / 木板 / 铁锭 / 玻璃」就选煤炭，
// 因为燃料的特征太好认了。而且随机干扰项会抽出「铁锭」这种一眼排除的组合。
//
// 现在改成两类必须查表才能答的题：
//   A 双条件交叉题（level 1）：既是熔炉燃料、又能当加工原料。
//      三个干扰项各只满足一条：只当燃料不参与加工的、只参与加工不能烧的、两者都不行的。
//      玩家必须同时核对燃料表和配方表，只查一张表必被绊倒。
//   B 精确数值题（level 1）：干海带块既是燃料又是原料，问它的堆叠上限是多少 ——
//      靠燃料身份联想不出堆叠数。

{
  const random = makeRandom('fuel')
  // 双条件：既在燃料表、又是任一加工的原料
  const fuelAndInput = items.filter((entry) => fuelSet.has(entry.name) && processingInputs.has(entry.name))
  // 半满足 A：能烧，但不是任何加工的原料（如木炭、煤炭本身）
  const fuelOnly = items.filter((entry) => fuelSet.has(entry.name) && !processingInputs.has(entry.name))
  // 半满足 B：是加工原料，但不能烧（如铁锭、玻璃、红石粉）
  const inputOnly = items.filter((entry) => !fuelSet.has(entry.name) && processingInputs.has(entry.name))
  // 两者都不满足
  const neither = items.filter((entry) => !fuelSet.has(entry.name) && !processingInputs.has(entry.name))

  // A. 双条件交叉题
  for (const target of shuffle(fuelAndInput, random).slice(0, 26)) {
    const wrong = [
      ...shuffle(fuelOnly.filter((entry) => entry.name !== target.name), random).slice(0, 1),
      ...shuffle(inputOnly.filter((entry) => entry.name !== target.name), random).slice(0, 1),
      ...shuffle(neither.filter((entry) => entry.name !== target.name), random).slice(0, 1),
    ]
    if (wrong.length < 3) continue
    if (new Set(wrong.map((entry) => entry.name)).size !== 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '机制 / 燃料',
      prompt: '以下四个物品里，哪一个同时满足「能放进熔炉当燃料」和「能作为加工的原料」？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}两条都满足：它在燃料表里，同时也是加工原料。另外三个各差一条 —— 有的能烧但只是燃料（不再参与加工），有的是加工原料但点不着，还有的两条都不满足。燃料表和配方表是两张独立的表，必须都查。`,
    })
  }

  // B. 精确数值题：这些物品同时是燃料和原料，问一个跟燃料身份无关的字段，
  //    玩家无法靠「它看起来像燃料」联想出答案，只能查堆叠表。
  for (const target of shuffle(fuelAndInput, random).slice(0, 16)) {
    const stack = Number(target.facts['堆叠上限'])
    if (!Number.isFinite(stack) || stack < 1) continue
    const choices = numericChoice({
      correctValue: stack,
      pool: items
        .filter((entry) => Number.isFinite(Number(entry.facts['堆叠上限'])) && Number(entry.facts['堆叠上限']) >= 1)
        .map((entry) => ({ entry, stack: Number(entry.facts['堆叠上限']) })),
      random,
      valueOf: (item) => item.stack,
      keyOf: (item) => item.entry.name,
    })
    if (!choices) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '物品 / 堆叠',
      prompt: `「${target.zhName}」一格最多能放几个？`,
      choices,
      explanation: `${target.zhName}的堆叠上限是 ${stack}。原版里只有三类：64（普通物品）、16（羊毛、地毯这类需要单独计数的）、1（耐久物品与方块）。堆叠上限跟它是不是燃料没有任何关系。`,
    })
  }
}

// ---------- 题型 8：不可燃物（level 1，反向交叉考）----------
//
// 原版「哪一个不能当熔炉燃料」，三个干扰项全是燃料，玩家只要认出燃料就赢了 ——
// 而燃料恰好是最好认的一类。这题其实比正向题还简单。
//
// 现在改成真正的反向交叉题：三个干扰项都是**不能烧但看起来极像燃料**的物品
// （原木、木板、木棍、木制工具 —— 木材类几乎都能烧，个别几种确实不能），
// 或者都是「能烧但身份容易搞混」的东西。玩家必须真的核对燃料表。

{
  const random = makeRandom('nonfuel')
  const nonFuel = items.filter((entry) => !fuelSet.has(entry.name) && Number(entry.facts['堆叠上限']) >= 1)
  // 优先在「像燃料但不是燃料」的池子里出题：这类干扰项才有迷惑性
  const trickyNonFuel = nonFuel.filter((entry) =>
    /(木|竹|煤|火|焰|草|藤|纸|书|泥|沙|灰|骨|肥|壳|屑|粉|油|脂)/.test(entry.zhName),
  )
  for (const target of shuffle(trickyNonFuel.length >= 20 ? trickyNonFuel : nonFuel, random).slice(0, 24)) {
    // 三个干扰项都取自「能烧」的一侧，难度全在「确认另外三个真的都能烧」
    const wrong = distractorsFrom(
      items.filter((entry) => fuelSet.has(entry.name) && entry.name !== target.name),
      [target],
      3,
      random,
      (entry) => entry.name,
    )
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '机制 / 燃料',
      prompt: '以下四个物品里，哪一个不能当熔炉燃料？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}不在原版燃料表里，点不着。烧制、冶炼、烟熏、篝火都只需要任意一种能点着的东西当燃料 —— 煤、木炭、原木、木板、木制工具、竹子、羊毛、书和纸都算。其余三个（${wrong.map((entry) => entry.zhName).join(' / ')}）都能烧。`,
    })
  }
}

// ---------- 题型 9：烧制产物（level 1）----------

{
  const random = makeRandom('smelt')
  const smelts = transforms.filter((t) => t.method === 'smelt' && t.inputs[0].names.length === 1)
  // 干扰项全部取自「同一个炉子能烧出来的东西」—— 玩家必须真的记住熔炉产物表。
  // 原版从全池随机取，会抽出「石头」这种根本不是熔炉产物的选项，靠排除法就过了。
  const smeltResults = [...new Set(smelts.map((t) => t.result))]
  for (const transform of shuffle(smelts, random).slice(0, 30)) {
    const input = transform.inputs[0].names[0]
    const wrong = distractorsFrom(smeltResults, [transform.result], 3, random)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '加工 / 烧制',
      prompt: `把「${zhOf(input)}」放进熔炉烧制，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `${zhOf(input)}烧制后产出${zhOf(transform.result)}${transform.count > 1 ? ` ×${transform.count}` : ''}。烧制需要额外给一份燃料，但燃料随便用什么可燃物都行。`,
    })
  }
}

// ---------- 题型 10：去皮产物（level 1）----------

{
  const random = makeRandom('strip')
  const strips = transforms.filter((t) => t.method === 'strip' && t.inputs[0].names.length === 1)
  // 正向题：干扰项取自「其他可以去皮的方块」—— 全是木头，认不出是哪个树种就答错
  const stripResults = [...new Set(strips.map((t) => t.result))]
  for (const transform of shuffle(strips, random).slice(0, 18)) {
    const input = transform.inputs[0].names[0]
    const wrong = distractorsFrom(stripResults, [transform.result], 3, random)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '加工 / 去皮',
      prompt: `用斧头给「${zhOf(input)}」去皮，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `斧头去掉${zhOf(input)}的树皮，得到${zhOf(transform.result)}。四个选项都是「去皮某树种」，必须记住每种原木对应哪个树种。`,
    })
  }

  // 反向题：三个选项全是可以去皮的，问哪一个不能去皮。
  //
  // ⚠️ 原版里「不能去皮的木头」只有 3 个（南瓜茎 / 西瓜茎 / 大型垂滴叶茎），
  // 而且它们的译名与可去皮项毫无重叠 —— 早期版本靠「像木头」的模糊匹配去找，
  // 结果 49 个候选里只捞出 3 个，还被零泄漏自守全部拦掉，题目一道都没出成。
  // 所以这里改成从「木头家族」里取：木板、木台阶、木楼梯这些同样由木头加工而来，
  // 但原版去皮表里没有它们 —— 玩家很容易以为「凡是木头加工品都能去皮」。
  const woodFamily = catalog.filter((entry) =>
    /(原木|木头|木板|木台阶|木楼梯|木栅栏|木门|木活板门|木按钮|木压力板)$/.test(entry.zhName)
    && !/^(去皮|结果)/.test(entry.zhName),
  )
  const notStrippable = woodFamily.filter((entry) => !strippable.has(entry.name))
  for (const target of shuffle(notStrippable, random).slice(0, 16)) {
    // 干扰项必须是真能去皮的（而且与答案不同名，否则题干会泄题）
    const wrong = distractorsFrom(
      woodFamily.filter((entry) => strippable.has(entry.name)),
      [target],
      3,
      random,
      (entry) => entry.name,
    )
    if (wrong.length < 3) continue
    // 零泄漏自守：答案名不能是某个干扰项的子串（「去皮橡木原木」与「橡木原木」互为子串，
    // 题干里出现原料名就等于把答案写在脸上），这类组合直接跳过
    const targetLabel = target.zhName
    const leaks = wrong.some((entry) => {
      const label = entry.zhName
      return label !== targetLabel && label.length >= 3 && (label.includes(targetLabel) || targetLabel.includes(label))
    })
    if (leaks) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '加工 / 去皮',
      prompt: '以下四种材料里，哪一个不能用斧头去皮？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      source: RECIPE_SOURCE,
      explanation: `${target.zhName}不在去皮表里，斧头对它没有额外效果。其余三个（${wrong.map((entry) => entry.zhName).join(' / ')}）都可以用斧头去掉树皮。`,
    })
  }
}

// ---------- 题型 11：涂蜡产物（level 1）----------

{
  const random = makeRandom('wax')
  const waxes = transforms.filter((t) => t.method === 'wax' && t.inputs[0].names.length === 1)
  // 干扰项取自「其他可以涂蜡的方块」—— 全是石头家族，认不出来就只能靠查表
  const waxResults = [...new Set(waxes.map((t) => t.result))]
  for (const transform of shuffle(waxes, random).slice(0, 18)) {
    const input = transform.inputs[0].names[0]
    const wrong = distractorsFrom(waxResults, [transform.result], 3, random)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '加工 / 涂蜡',
      prompt: `用蜂蜜瓶给「${zhOf(input)}」涂蜡，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `涂上蜡之后是${zhOf(transform.result)}，用刮刀可以把蜡刮掉。四个选项都是「涂蜡的某方块」，必须记住每种方块涂蜡后叫什么。`,
    })
  }

  // 反向题：三个选项全是可以涂蜡的，问哪一个不能涂蜡。
  // 原版涂蜡表只覆盖铜族、石头族、铁族、金族和玻璃等 60 个方块，
  // 玩家很容易以为「所有石头都能涂蜡」—— 这题专门打掉这个错觉。
  const waxableEntries = catalog.filter((entry) => waxable.has(entry.name))
  const notWaxable = catalog.filter(
    (entry) => !waxable.has(entry.name)
      && Number.isFinite(Number(entry.facts['硬度']))
      && Number(entry.facts['硬度']) > 0
      && /石|砖|混凝土|玻璃|金属|矿石|泥土|砂|沙|砖|瓦/.test(entry.zhName),
  )
  for (const target of shuffle(notWaxable, random).slice(0, 16)) {
    const wrong = distractorsFrom(waxableEntries, [target], 3, random, (entry) => entry.name)
    if (wrong.length < 3) continue
    // 零泄漏自守：答案名若被某个干扰项包含（例如「铜块」vs「铜格栅」），题干会泄题
    const leaks = wrong.some((entry) =>
      entry.zhName.length >= 3
      && entry.zhName !== target.zhName
      && target.zhName.includes(entry.zhName),
    )
    if (leaks) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '加工 / 涂蜡',
      prompt: '以下四种方块里，哪一个不能用蜂蜜瓶涂蜡？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      source: RECIPE_SOURCE,
      explanation: `${target.zhName}不在涂蜡表里。原版能涂蜡的只有铜族、石头族、铁族、金族、玻璃等 60 个方块，并不是「所有矿物方块」都能涂。其余三个（${wrong.map((entry) => entry.zhName).join(' / ')}）都可以用蜂蜜瓶涂上蜡。`,
    })
  }
}

// ---------- 题型 12：切石产物（level 2）----------

{
  const random = makeRandom('stonecut')
  const cuts = transforms.filter((t) => t.method === 'stonecut' && t.inputs[0].names.length === 1)
  for (const transform of shuffle(cuts, random).slice(0, 24)) {
    const input = transform.inputs[0].names[0]
    const others = transforms
      .filter((t) => t.method === 'stonecut' && t.result !== transform.result)
      .map((t) => t.result)
    const wrong = distractorsFrom(others, [transform.result], 3, random)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 切石',
      prompt: `用切石机把「${zhOf(input)}」切一次（不铺满一整格），会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `切石机切${zhOf(input)}得到${zhOf(transform.result)}${transform.count > 1 ? ` ×${transform.count}` : ''}。切石机不会消耗方块，切多少次都能继续切。`,
    })
  }
}

// ---------- 题型 13：锻造产物（level 2）----------

{
  const random = makeRandom('smith')
  const smiths = transforms.filter((t) => t.method === 'smith' && t.inputs.length === 2 && !t.inputs[1].fuelSlot)
  for (const transform of shuffle(smiths, random).slice(0, 12)) {
    // 干扰项必须与答案同类：也用「锻造台要搭配的装备」做干扰，
    // 不能拿产物（盔甲）去干扰「需要搭配哪件装备」，否则一个在问装备一个在问盔甲，答案范畴都对不上
    const gearInputs = smiths
      .map((t) => t.inputs[1].names[0])
      .filter((name) => name !== transform.inputs[1].names[0])
    const wrong = distractorsFrom(gearInputs, [transform.inputs[1].names[0]], 3, random)
    if (wrong.length < 3) continue
    const gear = zhOf(transform.inputs[1].names[0])
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 锻造',
      prompt: `在锻造台里把「${zhOf(transform.inputs[0].names[0])}」升级成更好的版本，需要搭配哪一件装备？`,
      choices: asChoices(
        gear,
        transform.inputs[1].names[0],
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `正确搭配是${gear}，锻造后得到${zhOf(transform.result)}。`,
    })
  }
}

// ---------- 题型 14：方块的爆炸抗性（level 2）----------

{
  const random = makeRandom('blast')
  const withBlast = blocks
    .filter((entry) => Number.isFinite(Number(entry.facts['爆炸抗性'])))
    .map((entry) => ({ entry, blast: Number(entry.facts['爆炸抗性']) }))
  // 精确爆炸抗性题：数值型选项，没有任何排除空间
  // 抗性跨度极大（0~1200），所以同一档位里往往有很多方块，靠桶保证每个档位都有题
  const blastBuckets = new Map()
  for (const item of withBlast) {
    if (!blastBuckets.has(item.blast)) blastBuckets.set(item.blast, [])
    blastBuckets.get(item.blast).push(item)
  }
  for (const [blast, bucket] of [...blastBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    // 0 和 600 / 1200 这种极端值太显眼（玩家知道黑曜石 TNT 炸不动），跳过
    if (blast === 0 || blast >= 600) continue
    for (const target of shuffle(bucket, random).slice(0, 2)) {
      const choices = numericChoice({
        correctValue: blast,
        pool: withBlast,
        random,
        valueOf: (item) => item.blast,
        keyOf: (item) => item.entry.name,
      })
      if (!choices) continue
      add({
        tier: 'basic',
        level: 1,
        topic: '方块 / 爆炸',
        prompt: `「${target.entry.zhName}」的爆炸抗性是多少？`,
        choices,
        explanation: `${target.entry.zhName}的爆炸抗性是 ${blast}。作为对照，普通的石头是 6、黑曜石是 1200（基本炸不动）。`,
      })
    }
  }
}

// ---------- 题型 15：状态变体数量（level 1）----------
//
// 之前这个 topic 只有 8 道，是全库最薄的基础主题之一。
// 原因不是题池不够 —— 有状态方块共 772 个（状态数 2~14 档，跨度足够），
// 而是这里只抽了 26 个目标、且要求 variantCount >= 8，把 261 个「2 种状态」的方块
// 全部挡在门外。放宽下限并把目标数提到 64，题量立刻能翻几倍。

{
  const random = makeRandom('states')
  // 下限从 8 放宽到 2：像「告示牌朝向」这类只有 2 种状态的方块也是真实知识点，
  // 玩家摆告示牌时天天要选。跨度 2~400 全交给 clusteredChoices 处理。
  const withStates = blocks.filter((entry) => entry.variantCount >= 2 && entry.variantCount <= 400)
  // 精确状态数题：干扰项取状态数「倍数级」相近的项。
  // 状态数跨度 2~400，随机取会抽出「2 种」来陪「320 种」，玩家一眼就知道谁多
  for (const target of shuffle(withStates, random).slice(0, 64)) {
    const wrong = clusteredChoices({
      target,
      pool: withStates,
      random,
      valueOf: (entry) => entry.variantCount,
      span: 4,
    })
    if (!wrong) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '方块 / 状态',
      prompt: `「${target.zhName}」摆放下去时，一共有多少种状态组合？`,
      // 选项全是数字，没有对应条目，四个选项都不挂图标
      choices: [
        choice(`${target.variantCount} 种`, null, true),
        ...wrong.wrong.map((entry) => choice(`${entry.variantCount} 种`)),
      ],
      explanation: `${target.zhName}有 ${target.variantCount} 种状态组合，主要来自朝向这类属性。另外三个分别是 ${wrong.wrong.map((entry) => entry.variantCount).join(' / ')} 种 —— 数量级接近，光看名字估不出来。`,
    })
  }

  /**
   * 双条件交叉题：状态数 + 硬度同时看。
   *
   * 单看状态数只能查一张表，而「哪个既是常见朝向方块、又恰好硬到某个值」需要
   * 交叉比对 —— 三个干扰项各自只满足一个条件，正是上一轮验证过的有效结构。
   */
  for (const target of shuffle(withStates, random).slice(0, 40)) {
    const hardness = Number(target.facts['硬度'])
    if (!Number.isFinite(hardness) || hardness <= 0) continue
    const wrong = clusteredChoices({
      target,
      // 干扰项从「状态数相近」且「硬度不同」的方块里取
      pool: withStates.filter(
        (entry) => entry.name !== target.name
          && Number(entry.facts['硬度']) !== hardness
          && Math.abs(entry.variantCount - target.variantCount) <= Math.max(8, target.variantCount * 0.5),
      ),
      random,
      valueOf: (entry) => entry.variantCount,
      span: 6,
    })
    if (!wrong || wrong.wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '方块 / 状态',
      prompt: `「${target.zhName}」的状态组合数与硬度分别是多少？`,
      choices: [
        choice(`${target.variantCount} 种 / 硬度 ${hardness}`, null, true),
        ...wrong.wrong.map((entry) => choice(
          `${entry.variantCount} 种 / 硬度 ${entry.facts['硬度']}`,
        )),
      ],
      explanation: `${target.zhName}是 ${target.variantCount} 种状态组合、硬度 ${hardness}。另外三个的状态数挨得很近，但硬度对不上 —— 两项都要核对，只记一项会被干扰项骗过去。`,
    })
  }
}

// ---------- 题型 16：遮光等级（level 2）----------
//
// 遮光是玩家天天在遇到的问题：「为什么火把的光穿不过树叶」「为什么工作台会挡光」。
// 之前只考了发光（level 1），遮光一直没出题，这里补上。

{
  const random = makeRandom('lightBlock')
  const opaque = blocks.filter((entry) => Number(entry.facts['遮光等级']) >= 15)
  const clear = blocks.filter((entry) => Number(entry.facts['遮光等级']) === 0)
  for (const target of shuffle(opaque, random).slice(0, 24)) {
    const wrong = distractorsFrom(clear, [target], 3, random, (entry) => entry.name)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '方块 / 光照',
      prompt: '以下四个方块里，哪一个会把光完全挡住（不透光）？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}的遮光等级是 ${target.facts['遮光等级']}，光完全穿不过去，所以放在火把旁边不会点亮它背后的方块。其余三个遮光等级都是 0，挡不住光。`,
    })
  }
}

// ---------- 题型 17：可透光（level 1）----------
//
// 「可透光」和「遮光等级」是两个字段：前者是能不能看见后面的东西，后者是挡不挡光。
// 这题考的是看得穿看不穿，不是亮度。

{
  const random = makeRandom('transparent')
  const seeThrough = blocks.filter((entry) => entry.facts['可透光'] === '是')
  const opaqueBlocks = blocks.filter((entry) => entry.facts['可透光'] === '否')
  // 「可透光」和「遮光等级」高度相关但不等价：实测 449 个方块可透光且遮光 0，
  // 374 个不可透光且遮光 15，另有 84 个「可透光但遮光 1」——
  // 正因为存在这 84 个，只靠「挡光」推「看不看得穿」就会答错，必须分别查两个字段。

  // 遮光等级的精确目标值题已由「题型 26」统一出（每个档位限量），
  // 这里只补「答案不是最大也不是最小」的同档变体，且必须限量 ——
  // 遮光等级 0 这一档有 449 个方块，不限量会瞬间膨胀到几百道。
  for (const target of shuffle(seeThrough, random).slice(0, 8)) {
    const light = Number(target.facts['遮光等级'])
    const wrong = distractorsFrom(
      seeThrough.filter((entry) => Number(entry.facts['遮光等级']) !== light),
      [target],
      3,
      random,
      (entry) => entry.name,
    )
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '方块 / 透明',
      prompt: `以下四种方块里，哪一个的遮光等级是 ${light}？`,
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}的遮光等级是 ${light}。原版遮光等级只有三档 —— 0（玻璃这类完全透光）、1（树叶、水母这类挡一部分）、15（石头这类全挡）。另外三个分别是 ${wrong.map((entry) => entry.facts['遮光等级']).join(' / ')}，必须逐个核对才能分辨。`,
    })
  }

  // B. 反向题：三个选项都是透明方块，问哪一个不是透明的。
  //    玩家必须确认另外三个确实透光 —— 玻璃、冰、树叶、彩色玻璃长得都很像，
  //    只凭「哪个眼熟」判断会错。
  for (const target of shuffle(opaqueBlocks, random).slice(0, 20)) {
    const wrong = distractorsFrom(seeThrough, [target], 3, random, (entry) => entry.name)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 1,
      topic: '方块 / 透明',
      prompt: '以下四种方块里，哪一个不是透明的（看不见它后面的东西）？',
      choices: asChoices(
        target.zhName,
        target.name,
        wrong.map((entry) => entry.zhName),
        wrong.map((entry) => entry.name),
      ),
      explanation: `${target.zhName}的遮光等级是 ${target.facts['遮光等级']}，完全不透光。其余三个（${wrong.map((entry) => entry.zhName).join(' / ')}）的遮光等级都是 ${wrong[0].facts['遮光等级']}，可以透过它们看到后面的方块 —— 注意这题问的是「看不看得穿」，不是「挡不挡光」。`,
    })
  }
}

// ---------- 题型 18：生物碰撞箱尺寸（level 2）----------
//
// 生物的碰撞箱决定它能不能进 1 格空间、能不能被卡住，是「为什么僵尸进不去门」这类问题的根源。

{
  const random = makeRandom('mobBox')
  const sized = mobs.filter((entry) => {
    const width = Number(entry.facts['碰撞宽度'])
    const height = Number(entry.facts['碰撞高度'])
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
  })
  // 碰撞箱题改成「精确高度题」，与上面的高度题同一句式，避免同 topic 两种问法
  for (const target of shuffle(sized, random).slice(0, 26)) {
    const targetHeight = Number(target.facts['碰撞高度'])
    // 干扰项取高度邻居：碰撞高度跨度从 0.5 格（甲虫）到 3.5 格（末影龙），
    // 随机取会抽出「鸡 / 蝙蝠」陪末影龙比身高，玩家一眼就知道谁高
    const wrong = neighboursOf(sized, targetHeight, 3, random, (entry) => Number(entry.facts['碰撞高度']), (entry) => entry.name)
    if (wrong.length < 3) continue
    const values = [targetHeight, ...wrong.map((entry) => Number(entry.facts['碰撞高度']))]
    if (new Set(values).size !== 4) continue
    const targetWidth = Number(target.facts['碰撞宽度'])
    add({
      tier: 'basic',
      level: 1,
      topic: '生物 / 体型',
      // 句式与「生物 / 体型」原有的碰撞高度题保持一致，避免同 topic 出现两种问法
      prompt: `「${target.zhName}」的碰撞高度是多少？`,
      choices: [
        choice(`${targetHeight.toFixed(2)} 格`, null, true),
        ...wrong.map((entry) => choice(`${Number(entry.facts['碰撞高度']).toFixed(2)} 格`)),
      ],
      explanation: `${target.zhName}的碰撞箱是 ${targetWidth} × ${targetHeight} 格，另外三个的高度分别是 ${wrong.map((entry) => entry.facts['碰撞高度']).join(' / ')} 格。碰撞箱高度决定它能不能挤进一格高的通道。`,
    })
  }
}

// ---------- 题型 19：石头切割变体（level 2）----------
//
// 同一个石头方块可以被切石机切成好几样东西，这题考「它能被切成什么」。

{
  const random = makeRandom('stonecutTarget')
  const byResult = new Map()
  for (const transform of transforms) {
    if (transform.method !== 'stonecut') continue
    if (!byResult.has(transform.result)) byResult.set(transform.result, transform.inputs[0].names)
  }
  const allResults = [...byResult.keys()]
  for (const [result, inputs] of shuffle([...byResult].sort((a, b) => b[1].length - a[1].length).slice(0, 40), random).slice(0, 26)) {
    const wrong = distractorsFrom(allResults, [result], 3, random, (name) => name)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 切石',
      // 句式与上面那个「切石产物」题型保持一致，避免同一个 topic 出现两种问法
      prompt: `用切石机把「${zhOf(inputs[0])}」切一次（不铺满一整格），会得到什么？`,
      choices: asChoices(
        zhOf(result),
        result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      explanation: `切石机加工${zhOf(inputs[0])}可以产出 ${inputs.length} 种变体，其中包括${zhOf(result)}。同一种原石切法不同能得到不同产物。`,
    })
  }
}

// ---------- 题型 20：高炉产物（level 2）----------
//
//  blast 与 smelt 的产物不同（钻石矿石 → 钻石 而不是铁），是容易搞混的一组。

{
  const random = makeRandom('blast')
  const blasts = transforms.filter((t) => t.method === 'blast' && t.inputs[0].names.length === 1)
  const smelts = transforms.filter((t) => t.method === 'smelt' && t.inputs[0].names.length === 1)
  for (const transform of shuffle(blasts, random).slice(0, 20)) {
    const input = transform.inputs[0].names[0]
    // 干扰项优先取「同原料在普通熔炉里的产物」—— 同原料不同产物，最能考出理解
    const smeltResult = smelts.find((t) => t.inputs[0].names[0] === input)
    const others = transforms.filter((t) => t.method === 'blast' && t.result !== transform.result).map((t) => t.result)
    const wrong = distractorsFrom(others, [transform.result], 3, random, (name) => name)
    if (wrong.length < 3) continue
    const wrongNames = smeltResult && smeltResult.result !== transform.result
      ? [smeltResult.result, ...wrong.slice(0, 2)]
      : wrong.slice(0, 3)
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 冶炼',
      prompt: `「${zhOf(input)}」放进高炉冶炼，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrongNames.map((name) => zhOf(name)),
        wrongNames,
      ),
      explanation: smeltResult && smeltResult.result !== transform.result
        ? `高炉对${zhOf(input)}的产出是${zhOf(transform.result)}，而普通熔炉产出的是${zhOf(smeltResult.result)} —— 高炉的烧制速度更快、产量更高。`
        : `高炉对${zhOf(input)}的产出是${zhOf(transform.result)}。`,
    })
  }
}

// ---------- 题型 21：烟熏炉产物（level 2）----------
//
// 烟熏炉和普通熔炉产出一样但速度翻倍，是 1.19 之后新增的第三种炉子。

{
  const random = makeRandom('smoke')
  const smokes = transforms.filter((t) => t.method === 'smoke' && t.inputs[0].names.length === 1)
  const smelts = transforms.filter((t) => t.method === 'smelt' && t.inputs[0].names.length === 1)
  for (const transform of shuffle(smokes, random).slice(0, 18)) {
    const input = transform.inputs[0].names[0]
    const others = transforms.filter((t) => t.method === 'smoke' && t.result !== transform.result).map((t) => t.result)
    const wrong = distractorsFrom(others, [transform.result], 3, random, (name) => name)
    if (wrong.length < 3) continue
    const smeltResult = smelts.find((t) => t.inputs[0].names[0] === input)
    const wrongNames = smeltResult && smeltResult.result !== transform.result
      ? [smeltResult.result, ...wrong.slice(0, 2)]
      : wrong.slice(0, 3)
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 冶炼',
      prompt: `「${zhOf(input)}」放进烟熏炉熏制，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrongNames.map((name) => zhOf(name)),
        wrongNames,
      ),
      explanation: `烟熏炉和普通熔炉的产物一样（都是${zhOf(transform.result)}），但烟熏炉的烧制速度是熔炉的两倍。`,
    })
  }
}

// ---------- 题型 22：双条件交叉（level 2）----------
//
// 之前的题只考单一字段（硬度 / 堆叠 / 透明），玩家只要记住一张表就能答。
// 双条件题要求同时满足两个条件才能锁定答案，且干扰项要「只满足一个条件」——
// 这样玩家必须同时检查两行数据，只看一行就会踩坑。这是最接近真实排查思路的题型。

{
  const random = makeRandom('crossFilter')
  const conditionPairs = [
    {
      topic: '方块 / 光照',
      // 满足：需要用镐采掘 + 完全遮光（不能透光）
      match: (entry) => entry.facts['工具/材质'] === '镐' && entry.facts['可透光'] === '否' && entry.facts['遮光等级'] >= 15,
      onlyOne: (entry) =>
        (entry.facts['工具/材质'] === '镐') !== (entry.facts['可透光'] === '否' && entry.facts['遮光等级'] >= 15),
      question: '需要用镐采掘、并且完全不透光（遮光等级满格）的方块',
      why: (entry) => `它的采掘工具是镐，遮光等级是 ${entry.facts['遮光等级']}（满格 15），完全不透光。`,
      whyWrong: (entry) => `它${entry.facts['工具/材质'] === '镐' ? '需要用镐' : '不需要用镐'}，但遮光等级只有 ${entry.facts['遮光等级']}${entry.facts['可透光'] === '是' ? '、而且是透明的' : ''}。`,
    },
    {
      topic: '方块 / 透明',
      // 满足：能当燃料烧 + 是方块（不是物品）
      match: (entry) => fuels.has(entry.name) && entry.facts['发光等级'] === 0 && entry.kind === 'block',
      onlyOne: (entry) => fuels.has(entry.name) !== (entry.facts['发光等级'] === 0),
      question: '既是方块、又完全不会发光的可燃物',
      why: (entry) => `${entry.zhName}在原版燃料表里，发光等级是 0，所以它当不了光源。`,
      whyWrong: (entry) => `${fuels.has(entry.name) ? '它能当燃料' : '它不在燃料表里'}，发光等级 ${entry.facts['发光等级']}。`,
    },
    {
      topic: '方块 / 采掘',
      // 满足：需要斧头 + 堆叠上限 64
      match: (entry) => entry.facts['工具/材质'] === '斧' && Number(entry.facts['堆叠上限']) === 64,
      onlyOne: (entry) => (entry.facts['工具/材质'] === '斧') !== (Number(entry.facts['堆叠上限']) === 64),
      question: '需要用斧头采掘、而且可以堆叠 64 个的方块',
      why: () => `它的采掘工具是斧头（可以用斧头去皮），堆叠上限 64。`,
      whyWrong: (entry) => `它${entry.facts['工具/材质'] === '斧' ? '需要用斧头' : '不需要用斧头'}，堆叠上限 ${entry.facts['堆叠上限']}。`,
    },
  ]
  for (const spec of conditionPairs) {
    const matched = blocks.filter(spec.match)
    const halfMatched = blocks.filter((entry) => spec.onlyOne(entry) && !spec.match(entry))
    if (matched.length < 6 || halfMatched.length < 6) continue
    for (const target of shuffle(matched, random).slice(0, 16)) {
      // 干扰项优先取「只满足一个条件」的方块 —— 只查一行数据的玩家会被精准绊倒
      const wrong = shuffle(halfMatched, random).slice(0, 3)
      if (wrong.length < 3) continue
      add({
        tier: 'basic',
        level: 2,
        topic: spec.topic,
        prompt: `以下四个方块里，哪一个同时满足：${spec.question}？`,
        choices: asChoices(
          target.zhName,
          target.name,
          wrong.map((entry) => entry.zhName),
          wrong.map((entry) => entry.name),
        ),
        explanation: `${spec.why(target)}另外三个都只满足其中一个条件 —— ${wrong.map((entry) => `${entry.zhName}${spec.whyWrong(entry)}`).join('；')}。`,
      })
    }
  }
}

// ---------- 题型 23：反向题（level 2）----------
//
// 正向题「哪一个是 X」，四个选项里只有一个是 X，玩家可以逐个排除。
// 反向题「哪一个【不】是 X」，变成要排除 3 个 —— 认知负担明显更高，
// 而且必须对四个选项都有认识才能答对（只知道答案那一个不够）。

{
  const random = makeRandom('negativePick')
  // 三个干扰项都满足条件，只有正确答案不满足 —— 玩家必须确认「其余三个都对」
  const negativeSpecs = [
    {
      topic: '方块 / 硬度',
      negativePrompt: '以下四个方块里，哪一个【不需要】用镐采掘（徒手就能挖）？',
      positive: (entry) => entry.facts['工具/材质'] === '镐' && entry.facts['可采掘'] === '是',
      wrongPool: blocks.filter((entry) => entry.facts['工具/材质'] === '镐' && entry.facts['可采掘'] === '是'),
      targetPool: blocks.filter(
        (entry) => entry.facts['可采掘'] === '是'
          && entry.facts['工具/材质'] !== '镐'
          && entry.facts['工具/材质'] !== '斧'
          && Number(entry.facts['硬度']) > 0,
      ),
      why: (entry) => `它徒手就能挖（正确工具是${entry.facts['工具/材质'] || '徒手'}，不是镐）。`,
      whyWrong: (entry) => `它${entry.facts['工具/材质'] === '镐' ? '需要用镐' : '不需要用镐'}，只有${entry.zhName}是例外。`,
    },
    {
      topic: '物品 / 堆叠',
      negativePrompt: '以下四个物品里，哪一个【不能】堆叠（一个格子只能放一个）？',
      positive: (entry) => Number(entry.facts['堆叠上限']) >= 16,
      wrongPool: items.filter((entry) => Number(entry.facts['堆叠上限']) >= 16),
      targetPool: items.filter((entry) => Number(entry.facts['堆叠上限']) === 1),
      why: () => `它的堆叠上限是 1。`,
      whyWrong: (entry) => `它能叠 ${entry.facts['堆叠上限']} 个。`,
    },
    {
      topic: '机制 / 燃料',
      negativePrompt: '以下四个物品里，哪一个【不能】放进熔炉当燃料烧？',
      positive: (entry) => fuels.has(entry.name),
      wrongPool: items.filter((entry) => fuels.has(entry.name)),
      targetPool: items.filter((entry) => !fuels.has(entry.name) && Number(entry.facts['堆叠上限']) === 64),
      why: () => `它不在原版燃料表里，点不着。`,
      whyWrong: (entry) => `它在原版燃料表里（${entry.zhName}），可以烧。`,
    },
    {
      topic: '方块 / 透明',
      negativePrompt: '以下四个方块里，哪一个【不】透明（看不见它后面的东西）？',
      positive: (entry) => entry.facts['可透光'] === '是',
      wrongPool: blocks.filter((entry) => entry.facts['可透光'] === '是'),
      targetPool: blocks.filter((entry) => entry.facts['可透光'] === '否' && Number(entry.facts['硬度']) >= 1),
      why: () => `它是完全不透明的实心方块。`,
      whyWrong: (entry) => `${entry.zhName}是透明的。`,
    },
  ]
  for (const spec of negativeSpecs) {
    for (const target of shuffle(spec.targetPool, random).slice(0, 18)) {
      // 干扰项全部来自「满足条件」的池子：玩家必须确认另外三个都满足，才敢选这个不满足的
      const wrong = shuffle(spec.wrongPool.filter((entry) => entry.name !== target.name), random).slice(0, 3)
      if (wrong.length < 3) continue
      add({
        tier: 'basic',
        level: 2,
        topic: spec.topic,
        prompt: spec.negativePrompt,
        choices: asChoices(
          target.zhName,
          target.name,
          wrong.map((entry) => entry.zhName),
          wrong.map((entry) => entry.name),
        ),
        explanation: `${spec.why(target)}${wrong.map((entry) => `${entry.zhName}${spec.whyWrong(entry)}`).join('；')}。`,
      })
    }
  }
}

// ---------- 题型 24：同族辨析（level 2）----------
//
// 四个选项全都来自同一个变体族（例：各种台阶、各种墙、各种染色玻璃），
// 玩家不能靠「哪个眼熟」判断，必须区分族内每个具体条目 ——
// 这是题库当前完全缺失的难度维度：以往所有题的正确答案和干扰项都是跨族混的。
//
// ⚠️ 关键坑：不能用「硬度」来区分族内成员。实测台阶族的 62 个方块硬度全是 2、
// 墙族 73 个全是 3、蜡烛族 32 个全是 0.5 —— 同族内同一个字段几乎恒定，
// 拿来当区分维度会 100% 值冲突、一道题都出不来。
// 所以改成「逐字段尝试」：硬度、堆叠上限、发光等级、碰撞箱逐个试，
// 只有真正能区分这个族的字段才拿来出题。

{
  const random = makeRandom('sameFamily')
  const familyCount = new Map()
  for (const entry of blocks) {
    if (!familyCount.has(entry.family)) familyCount.set(entry.family, [])
    familyCount.get(entry.family).push(entry)
  }
  // 族内条目够多才出题，且排除掉「常规物品」「建筑方块」这种无意义的大类
  const richFamilies = [...familyCount.entries()]
    .filter(([family, bucket]) => bucket.length >= 6 && family !== '常规物品' && family !== '建筑方块')
    .sort((a, b) => b[1].length - a[1].length)

  // 候选区分维度：每项定义「怎么取值」和「人类可读的字段名」
  //
  // 硬度 / 爆炸抗性是这里最关键的两个字段 原先不在列表里，导致
  // 「方块 / 变体」只有 5 道题：台阶、楼梯、门、活板门这些大族的
  // 发光等级 / 遮光等级 / 堆叠上限 / 碰撞箱 在族内取值几乎全相同
  // （门槛就是 4 种），distinct.size >= 4 一大批族直接被筛掉。
  // 硬度 32 档、爆炸抗性 33 档，才是同族内真正能区分成员的维度 ——
  // 「橡木台阶 vs 云杉台阶」的差别本来就在硬度上。
  const FIELD_SPECS = [
    { key: '硬度', field: '硬度', label: '硬度', unit: '' },
    { key: '爆炸抗性', field: '爆炸抗性', label: '爆炸抗性', unit: '' },
    { key: '堆叠上限', field: '堆叠上限', label: '一格最多能放', unit: '个' },
    { key: '发光等级', field: '发光等级', label: '发光等级', unit: '' },
    { key: '遮光等级', field: '遮光等级', label: '遮光等级', unit: '' },
    { key: '碰撞箱', field: '碰撞箱', label: '碰撞箱类型', unit: '' },
  ]

  // 家族上限从 10 放开到 18：这个 topic 之前只有 5 道，是全库最薄的主题之一，
  // 而 richFamilies 里 >=4 个成员且有区分字段的族远不止 10 个（墙 86、台阶 62、
  // 楼梯 58、木质 48、陶瓦 32、蜡烛 32、告示牌 24、门 21…）。放开后覆盖面大幅提升。
  for (const [family, bucket] of richFamilies.slice(0, 18)) {
    // 同族里同一个注册名会出现多次（不同变体），先按 zhName 去重
    const unique = [...new Map(bucket.map((entry) => [entry.zhName, entry])).values()]
    if (unique.length < 4) continue
    // 找出这个族里「至少 4 个条目取值互不相同」的字段。
    // 逐字段出题而不是只用第一个 —— 一个族往往有 2~3 个字段都能区分成员，
    // 只用一个字段的话题目量会被压得很低（实测只出 5 道）
    const usable = FIELD_SPECS.filter((spec) => {
      const distinct = new Set(unique.map((entry) => String(entry.facts[spec.field])))
      return distinct.size >= 4
    })
    for (const spec of usable) {
      // 每个取值档位出 1~2 道，保证族内覆盖面
      const byValue = new Map()
      for (const entry of unique) {
        const value = String(entry.facts[spec.field])
        if (!byValue.has(value)) byValue.set(value, [])
        byValue.get(value).push(entry)
      }
      for (const [value, group] of byValue) {
        // 干扰项从同族里取【取值不同】的三个，且优先取取值紧邻的
        const others = unique.filter((entry) => String(entry.facts[spec.field]) !== value)
        if (others.length < 3) continue
        const asNumber = (entry) => Number(entry.facts[spec.field])
        const numeric = Number(value)
        const wrong = (Number.isFinite(numeric) && others.every((entry) => Number.isFinite(asNumber(entry)))
          ? [...others].sort((a, b) => Math.abs(asNumber(a) - numeric) - Math.abs(asNumber(b) - numeric)).slice(0, 3)
          : shuffle(others, random).slice(0, 3))
        // 每个取值档位出 1~4 道（原来只出 2 道，是这个 topic 偏薄的直接原因）
        for (const target of shuffle(group, random).slice(0, 4)) {
          add({
            tier: 'basic',
            level: 1,
            topic: '方块 / 变体',
            prompt: `以下四个都${family === '墙' || family === '台阶' || family === '楼梯' ? '是' : '属于'}「${family}」系列，哪一个的${spec.label}是 ${value}${spec.unit}？`,
            choices: asChoices(
              target.zhName,
              target.name,
              wrong.map((entry) => entry.zhName),
              wrong.map((entry) => entry.name),
            ),
            explanation: `${target.zhName}的${spec.label}是 ${value}${spec.unit}。同属${family}系列的这四个方块长得极像，必须逐个核对${spec.label}才能分辨 —— 注意同族内的${spec.label}并不一定相同。`,
          })
        }
      }
    }
  }
}

// ---------- 题型 25：工序二选一（level 2）----------
//
// 原型的想法是出「先 A 再 B」的两步工序链题，但实测官方数据里根本不存在：
// transforms.json 里 strip/smelt/blast/smoke/campfire/wax/scrape/smith 每一条都是一步到位，
// 两步链（两步同方法 0 条、两步不同方法也是 0 条）—— 原版加工链本来就是一环。
// 所以改出真正存在区分度的题型：**同一种原料，三种加工方式各给一个产物，问其中一种的产物**。
// 这题考的是「熔炉 / 高炉 / 烟熏炉产出不一定相同」以及「涂蜡和刮蜡互为逆操作」，
// 玩家必须真的查过每种加工的产物表才能答，不能靠语义猜。

{
  const random = makeRandom('methodMix')
  // 反向加工题：「用刮刀刮掉蜡」得到的是什么 —— 答案就是没涂蜡的原物，
  // 干扰项取「涂蜡前的样子」和「其他涂蜡物」，考的是wax / scrape 互为逆操作
  const scrapes = transforms.filter((t) => t.method === 'scrape' && t.inputs[0].names.length === 1)
  for (const transform of shuffle(scrapes, random).slice(0, 18)) {
    const input = transform.inputs[0].names[0]
    // 干扰项优先取「同一种加工方式下的其他产物」，其次是别的加工方式的产物
    const sameMethod = transforms.filter((t) => t.method === 'scrape' && t.result !== transform.result).map((t) => t.result)
    const wrong = distractorsFrom(sameMethod, [transform.result], 3, random, (name) => name)
    if (wrong.length < 3) continue
    const inputZh = zhOf(input)
    const resultZh = zhOf(transform.result)
    // 零泄漏自守：刮蜡的原料名是「涂蜡的 X」，答案（未涂蜡的 X）恰好是它的后缀。
    // 换成别的原料当干扰项的话，干扰项名可能被原料名包含（例：原料「涂蜡的斑驳铜格栅」，
    // 干扰项「斑驳铜格栅」—— 题干里就出现了干扰项，等于送分）。这类组合直接跳过。
    const leaks = wrong.some((name) => {
      const label = zhOf(name)
      return label !== resultZh && (label.length >= 3 && inputZh.includes(label))
    })
    if (leaks || inputZh === resultZh) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 工序链',
      prompt: `用刮刀把「${inputZh}」上的蜡刮掉，会得到什么？`,
      choices: asChoices(
        resultZh,
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: `刮蜡是涂蜡的逆操作：刮掉之后恢复成${resultZh}。另外三个也都是能刮出蜡的物品，但刮出来的东西不一样。`,
    })
  }

  // 三种炉子对比题：同一个原料分别放熔炉 / 高炉 / 烟熏炉，问高炉产出。
  // 干扰项刻意用「同原料在普通熔炉的产物」—— 最能考出对三种炉子的区分
  const blasts = transforms.filter((t) => t.method === 'blast' && t.inputs[0].names.length === 1)
  const smelts = transforms.filter((t) => t.method === 'smelt' && t.inputs[0].names.length === 1)
  const smokes = transforms.filter((t) => t.method === 'smoke' && t.inputs[0].names.length === 1)
  for (const transform of shuffle(blasts, random)) {
    const input = transform.inputs[0].names[0]
    const smeltResult = smelts.find((t) => t.inputs[0].names[0] === input)
    const smokeResult = smokes.find((t) => t.inputs[0].names[0] === input)
    // 三个数里至少有两个不同才出题，否则「三种炉子产物一样」就没什么可问的
    const distinct = new Set([transform.result, smeltResult?.result, smokeResult?.result].filter(Boolean))
    if (distinct.size < 2) continue
    const candidates = [
      ...new Set([smeltResult?.result, smokeResult?.result].filter((name) => name && name !== transform.result)),
    ]
    const wrong = distractorsFrom(candidates, [transform.result], 3, random, (name) => name)
    if (wrong.length < 3) continue
    add({
      tier: 'basic',
      level: 2,
      topic: '加工 / 工序链',
      prompt: `把「${zhOf(input)}」放进高炉冶炼，会得到什么？`,
      choices: asChoices(
        zhOf(transform.result),
        transform.result,
        wrong.map((name) => zhOf(name)),
        wrong,
      ),
      source: RECIPE_SOURCE,
      explanation: smeltResult && smokeResult
        ? `高炉产出${zhOf(transform.result)}，而普通熔炉产出${zhOf(smeltResult.result)}、烟熏炉产出${zhOf(smokeResult.result)} —— 三种炉子对同一种原料的产物不一定相同。`
        : `高炉对${zhOf(input)}的产出是${zhOf(transform.result)}。`,
    })
  }
}

// ---------- 题型 26：精确目标值题批量生成（level 1）----------
//
// 「以下四个方块里，哪一个的<字段>是 <值>？」是本项目里唯一一种
// 「四个选项长得完全一样、答案既不是最大也不是最小」的题型 ——
// 玩家没有任何排除法可用，必须真的记得某个具体方块的某个具体数值。
//
// 之前只对「硬度」单独出这一类题，体量只有 11 道，
// 撑不起「入门难度也必须真记数据」这个要求 ——
// 光靠硬度一个字段出题，选项很容易开始重复。
//
// 这里改成按字段批量出：硬度、爆炸抗性、发光等级、堆叠上限、状态数
// 各自都能出题，且五个字段互相独立 ——
// 同一个方块可能硬度对但发光等级不对，玩家的经验不会跨字段迁移，
// 必须每个字段都背一遍才做得出来。
//
// 硬性约束（缺一不可，缺了这道题就退化成送分题）：
//   ① 四个选项的该字段取值必须互不相同
//   ② 正确答案不能是四个选项里最大或最小的那一个
//   ③ 三个干扰项优先取该字段取值【紧邻】正确答案的方块

{
  const random = makeRandom('targetValue')
  /**
   * 每个字段一份规格。
   *
   * ⚠️ requireMiddle 是这里最关键的开关。
   * 「答案既不是最大也不是最小」是防止退化成「找最 X」送分题的核心约束，
   * 但它只在取值档位足够多的时候才能满足：
   *   硬度有 32 个档位、爆炸抗性 34 个、发光等级 12 个 —— 都能满足；
   *   遮光等级只有 0 / 1 / 15 三档、堆叠上限只有 1 / 16 / 64 三档 ——
   *   四选一必然出现重复取值，硬要满足就一道题都出不来。
   * 这两个字段只能关掉该约束，难度改由「玩家必须逐个核对这张只有三档的表」来提供。
   *
   * perBucket / bigBucket 则是防止单一字段刷屏的闸门：
   * 硬度 2 这一档有 196 个方块、堆叠 64 有 2264 个，不限量的话一个字段就能出几百道。
   */
  const SPECS = [
    { field: '硬度', label: '硬度', unit: '', perBucket: 2, bigBucket: 1, topic: '方块 / 硬度', min: 0.4, fallback: '硬度决定徒手挖掘要花多久、是否需要正确的工具。' },
    { field: '爆炸抗性', label: '爆炸抗性', unit: '', perBucket: 2, bigBucket: 1, topic: '方块 / 爆炸', min: 0.4, fallback: '爆炸抗性决定 TNT / 苦力怕爆炸时这个方块会不会被炸掉 —— 黑曜石、下界合金块、基岩几乎炸不动。' },
    { field: '发光等级', label: '发光等级', unit: ' 级', perBucket: 2, bigBucket: 2, topic: '方块 / 光照', min: 0, fallback: '发光等级决定这个方块本身能照亮多大范围。火把是 14 级，满发光是 15 级。' },
    { field: '遮光等级', label: '遮光等级', unit: ' 级', perBucket: 2, bigBucket: 2, requireMiddle: false, topic: '方块 / 光照', min: 0, fallback: '遮光等级决定光能不能穿过这个方块。玻璃是 0 级，树叶是 1 级，石头是 15 级。' },
    { field: '堆叠上限', label: '堆叠上限', unit: ' 个', perBucket: 2, bigBucket: 2, requireMiddle: false, topic: '物品 / 堆叠', min: 1, fallback: '原版堆叠上限只有三类：64 个（普通物品）、16 个（羊毛地毯这类）、1 个（耐久物品与方块）。' },
  ]

  for (const spec of SPECS) {
    const pool = (spec.field === '堆叠上限' ? [...blocks, ...items] : blocks)
      .map((entry) => ({ entry, value: Number(entry.facts[spec.field]) }))
      .filter((item) => Number.isFinite(item.value) && item.value >= spec.min)

    // 按取值分桶：每个真实存在的档位都要有题，不能只抽某一档
    const byValue = new Map()
    for (const item of pool) {
      if (!byValue.has(item.value)) byValue.set(item.value, [])
      byValue.get(item.value).push(item)
    }

    for (const [value, bucket] of [...byValue.entries()].sort((a, b) => a[0] - b[0])) {
      // 桶越大出得越少：这是防止单一字段刷屏的关键闸门
      const quota = bucket.length > 150 ? Math.min(spec.perBucket, spec.bigBucket) : spec.perBucket
      for (const target of shuffle(bucket, random).slice(0, quota)) {
        const picked = targetValueChoices({
          target,
          pool,
          random,
          valueOf: (item) => item.value,
          requireMiddle: spec.requireMiddle ?? true,
        })
        if (!picked) continue
        add({
          tier: 'basic',
          level: 1,
          topic: spec.topic,
          prompt: `以下四个${spec.field === '堆叠上限' ? '物品或方块' : '方块'}里，哪一个的${spec.label}是 ${value}${spec.unit}？`,
          choices: asChoices(
            target.entry.zhName,
            target.entry.name,
            picked.wrong.map((item) => item.entry.zhName),
            picked.wrong.map((item) => item.entry.name),
          ),
          explanation: `${target.entry.zhName}的${spec.label}是 ${value}${spec.unit}。另外三个分别是 ${picked.wrong.map((item) => item.value).join(' / ')}${spec.unit} —— ${spec.requireMiddle === false
            ? '取值就来自这张只有几个档位的表，必须逐个核对才分得清。'
            : `四个数值都挤在 ${Math.min(...picked.values)} ~ ${Math.max(...picked.values)} 之间，而且正确答案既不是最大也不是最小，靠排除法答不出来。`}${spec.fallback}`,
        })
      }
    }
  }
}

// ---------- 冷门题：补齐tier / level / 统一版本字段 ----------

// 手写冷门题也要打乱选项。
//
// 为什么要打乱：这些题是手写的，作者习惯性地把正确答案写在固定位置 ——
// 实测 57 道冷门题里有 44 道答案在下标 1（77%）。虽然运行时还有「每次选项打乱」兜底，
// 但数据源本身就带着这个偏差，一旦某处漏了打乱，玩家就能靠「第几个选项」蒙对。
// 这里在生成期就打乱并重算 answerIndex，从源头消除位置偏斜。
const obscure = OBSCURE_QUESTIONS.map((question, index) => {
  const order = shuffle(
    question.options.map((_, optionIndex) => optionIndex),
    makeRandom(`obscure-shuffle-${question.id ?? index}`),
  )
  return {
    id: question.id || `obscure-${String(index + 1).padStart(3, '0')}`,
    tier: 'obscure',
    level: 3,
    topic: question.topic,
    prompt: question.prompt,
    options: order.map((optionIndex) => question.options[optionIndex]),
    answerIndex: order.indexOf(question.answerIndex),
    // 冷门题考的是机制与 bug，不是「认方块」，一律不出图标（也就没有泄露风险）
    optionNames: question.options.map(() => null),
    version: {
      verifiedIn: question.version?.verifiedIn ?? QUIZ_SOURCE.latestRelease,
      introduced: question.version?.since ?? null,
      fixed: question.version?.fixedIn ?? null,
    },
    source: question.source,
    explanation: question.explanation,
  }
})

// 手写冷门题也要过结构校验：四选一、答案下标合法、选项不重复、必填字段齐全
const malformedObscure = obscure.filter((question) =>
  question.options.length !== 4
  || question.answerIndex < 0
  || question.answerIndex >= question.options.length
  || new Set(question.options).size !== question.options.length
  || !question.prompt?.trim()
  || !question.explanation?.trim()
  || !question.topic?.trim()
  || !question.source?.label?.trim()
  || !question.source?.url?.trim(),
)
if (malformedObscure.length) {
  throw new Error(
    `冷门题结构不合法（${malformedObscure.length} 道）：${malformedObscure.map((q) => q.id).join(', ')}`,
  )
}

// ---------- 零泄漏硬校验：题干不得指向答案，选项图标必须可解析 ----------

// 四选一里单独显示一个方块图标 = 直接泄露答案（实测 232/347 道题的主角就是答案）。
// 现在改为「每个选项各显示自己的图标」，校验点随之变成下面几条：

// 判据：若答案文本是被题干里某个【更长的注册名】包含（即题干在讲那个更长条目的原料 / 未加工态），
// 或者答案文本太短（只是句中的疑问词），都算原料引用而非泄露。
// 注意：这里必须用【中文译名】集合，entryByName 的键是英文注册名，跟中文题干对不上
const allZhNames = catalog.map((entry) => entry.zhName).filter(Boolean)
const isAnswerLeakedByPrompt = (question) => {
  const answerLabel = question.options[question.answerIndex]
  if (!answerLabel || answerLabel.length < 3) return false
  if (!question.prompt.includes(answerLabel)) return false
  const coveredByLongerName = allZhNames.some((name) =>
    name.length > answerLabel.length
    && name.includes(answerLabel)
    && question.prompt.includes(name))
  return !coveredByLongerName
}

const allQuestions = [...questions, ...obscure]

// ① 题干里不得直接给出答案（原料引用除外，见isAnswerLeakedByPrompt）
const leakingPrompts = allQuestions.filter(isAnswerLeakedByPrompt)
if (leakingPrompts.length) {
  throw new Error(
    `题干泄露答案（${leakingPrompts.length} 道）：${leakingPrompts.map((q) => `${q.id}「${q.prompt}」`).join(' / ')}`,
  )
}

// ② 干扰项也不得在题干里出现（否则等于排除法直接送分）
const leakingDistractors = allQuestions.filter((question) =>
  question.options.some((label, index) => index !== question.answerIndex
    && label.length >= 3
    && question.prompt.includes(label)),
)
if (leakingDistractors.length) {
  throw new Error(
    `题干泄露干扰项（${leakingDistractors.length} 道）：${leakingDistractors.map((q) => `${q.id}「${q.prompt}」`).join(' / ')}`,
  )
}

// ③ optionNames 必须与 options 一一对应，且每个非 null 的 name 都能解析为图鉴条目
const badOptionNames = allQuestions.filter((question) =>
  question.optionNames.length !== question.options.length
  || question.optionNames.some((name) => name !== null && !entryByName.has(name)),
)
if (badOptionNames.length) {
  throw new Error(
    `选项图标映射不合法（${badOptionNames.length} 道）：${badOptionNames.map((q) => q.id).join(', ')}`,
  )
}

// ④ 结构兜底：答案下标合法、选项不重复
const malformedAll = allQuestions.filter((question) =>
  question.options.length !== 4
  || question.answerIndex < 0
  || question.answerIndex >= question.options.length
  || new Set(question.options).size !== question.options.length,
)
if (malformedAll.length) {
  throw new Error(
    `题目结构不合法（${malformedAll.length} 道）：${malformedAll.map((q) => q.id).join(', ')}`,
  )
}

// ⑤ 图标覆盖自检：只要一道题里出了图标，四个选项就必须全出
// （部分出部分不出的话，玩家会靠「哪个没图」反推答案，等于换一种方式泄露）
const iconQuestions = allQuestions.filter((q) => q.optionNames.some((name) => name !== null))
const answerMissingIcon = iconQuestions.filter(
  (q) => q.optionNames.some((name) => name === null),
)
if (answerMissingIcon.length) {
  throw new Error(
    `选项图标必须四个都出（${answerMissingIcon.length} 道）：${answerMissingIcon.map((q) => q.id).join(', ')}`,
  )
}

// ⑥ 难度守卫：题库里不许再出现「一眼排除」的送分题
//
// 用户反馈过「题目太简单」。复盘发现两个典型送分模式：
//   ① 极值题的答案天然是四个选项里最大/最小的那一个 —— 只要会排序就一定答对，
//      根本不需要精确记忆任何数值。
//   ② 四个选项都是完整句子 —— 玩家靠语感就能排除掉语义不通的那几个。
//
// 这里把这两类从生成期直接拦掉。注意判据 ① 只作用于「数值型极值题」：
// 「以下哪一种不能当燃料」这种选项都是物品名的题不在此列 ——
// 它的答案是「不能当燃料的那个」，本身就是四项里唯一的例外，不存在「必然最大」的问题。
const isNumericLabel = (label) => /^[\d.]+\s*(种|个|格|级)?$/.test(String(label).trim())

const trivialExtreme = questions.filter((question) => {
  // 极值句式 + 四个选项都是数字/数字带单位 = 答案必然是最大或最小，可排序即可答
  if (!/最大|最高|最硬|最多/.test(question.prompt)) return false
  if (!question.options.every(isNumericLabel)) return false
  const values = question.options.map((label) => Number(String(label).replace(/[^\d.]/g, '')))
  const answer = values[question.answerIndex]
  return answer === Math.max(...values) || answer === Math.min(...values)
})
if (trivialExtreme.length) {
  throw new Error(
    `出现「可排序的极值送分题」（${trivialExtreme.length} 道）：${trivialExtreme.map((q) => `${q.id}「${q.prompt}」`).join(' / ')}`,
  )
}

/**
 * 「模板化描述型选项」不是整句 —— 守卫原本只分「数值型 vs 整句」两档，
 *把中间形态误判了。加工来源题的四个选项都是「用铜锭 等 2 种通过合成」
 * 这种同一个模子刻出来的工序描述：长度都 ≥ 12 字，但四者结构完全一致，
 * 玩家读第一个字就知道这是「工序 + 材料」短语，靠语感排除不掉任何一个。
 */
const isTemplatedProcedureLabel = (label) => {
  const text = String(label).trim()
  if (/^用.+通过(合成|涂蜡|烧制|刮除|锻造|无序合成)/.test(text)) return true
  return /(等|共)\s*\d+\s*(种|个|格)/.test(text)
}

/**
 * 「四个选项都是整句」这条守卫对推演题不成立 —— 推演题【必须】用完整句子。
 *
 * 推演题考的是「A 情况下会发生什么」，答案本身就是一句结论。
 * 如果为了骗过守卫把选项砍成「会掉下去 / 不会掉下去」这种半句，
 * 玩家连在哪个情境下作答都读不出来，题目本身就失效了。
 * 所以这里改守卫，不改题：豁免 topic 为「机制 / …」的推演题。
 *
 * 「机制 / 燃料」是例外 —— 那是查表题（每种燃料烧多久），
 * 选项是「12 秒 / 15 秒」这种数值，本来就不该是整句，守卫必须继续盯着它。
 */
const isReasoningQuestion = (question) => String(question.topic ?? '').startsWith('机制 / ')
  && question.topic !== '机制 / 燃料'

const allSentenceOptions = questions.filter(
  (question) => !isReasoningQuestion(question) && question.options.every((label) => {
    const text = String(label).trim()
    // 「数值型」不是整句。
    // 之前的判据只看长度和标点，把「32 种 / 硬度 1.5」这种双条件数值题误判成整句
    // （长度 12 ≥ 阈值），守卫一报错就暴露了判据本身的漏洞：它拦的不是
    // 「语感可排除」，而只是「长文本」。这里改成先识别数值型 ——
    // 去掉数字、小数点、常见单位与连接符后若几乎没剩字，就是数据而非句子。
    const stripped = text
      .replace(/[\d.]/g, '')
      .replace(/\s/g, '')
      .replace(/[、,，\-—~～()（）]/g, '')
      .replace(/(种|个|格|级|档|硬度|级数|数量|种数)/g, '')
    if (stripped.length <= 2) return false
    if (isTemplatedProcedureLabel(text)) return false
    return text.length >= 12 || /[，。；]/.test(text)
  }),
)
if (allSentenceOptions.length) {
  throw new Error(
    `出现「四个选项都是整句」的题（${allSentenceOptions.length} 道）：靠语感就能排除：${allSentenceOptions.map((q) => `${q.id}「${q.prompt}」`).join(' / ')}`,
  )
}

// ⑦ 答案位置必须大致均匀：连续同位置会让「记答案位置」变成一种可行策略
const positionSkew = []
for (const question of allQuestions) {
  positionSkew.push(question.answerIndex)
}
const positionCounts = [0, 0, 0, 0]
for (const index of positionSkew) positionCounts[index] += 1
const totalQuestions = positionCounts.reduce((sum, count) => sum + count, 0)
// 均匀分布下每个位置约25%；允许 ±8 个百分点的抖动，超过说明生成时打乱逻辑坏了
const minShare = 0.17
const skewed = positionCounts.filter((count) => count / totalQuestions < minShare)
if (skewed.length) {
  throw new Error(
    `答案位置分布偏斜：${positionCounts.join(' / ')}（共 ${totalQuestions} 道）。打乱逻辑可能失效了。`,
  )
}

// ---------- 题型 30：加工链反向题 ----------
//
// 原型想法：出「这件物品是从哪一步加工来的？」
// 数据支撑：transforms.json 里 1096 条转化中，有 **941 处「某物品本身就是另一条转化的产物」**。
// 也就是说原木→木板→木棍→木镐 这类加工链在数据里真实存在，
// 而之前所有加工题都只考「一步到位的转化」，链的价值完全没被利用。
//
// 为什么反向比正向难（这是本题型的核心价值）：
//   正向题「木板能做什么」→ 查到木板的所有产出就结束了，是**加法**；
//   反向题「木镐是怎么来的」→ 木镐有多个产出路径，必须排除掉所有别的，
//   而且「木棍」和「木板」都是木镐的原料，只答对一半算错，是**减法 + 精确定位**。
//   玩家不能靠「原料听起来相关」蒙 —— 必须真的记得那一步用的是哪种原料。
//
// 链长天然提供难度分级，不用额外配置：
//   链长 1（单步产物）→ level 1 入门
//   链长 2（原料本身是产物）→ level 2 进阶
//   链长 3 及以上 → level 2（部分升到 3，但要保证 extreme 层有题）
//
// 零泄漏：四个选项都是「配方描述」，不挂图标（不是物品名，是操作描述），
// 所以不涉及贴图一致性问题；也不展示任何物品图标，避免「哪个有图」泄露。

/** result 名称 -> 所有能产出它的转化 */
const producersOf = new Map()
for (const transform of transforms) {
  if (!producersOf.has(transform.result)) producersOf.set(transform.result, [])
  producersOf.get(transform.result).push(transform)
}

/** 某个物品的加工链深度（0 = 不是任何转化的产物） */
const chainDepth = (name, guard = new Set()) => {
  if (guard.has(name)) return 0
  guard.add(name)
  const list = producersOf.get(name)
  if (!list) return 0
  let deepest = 0
  for (const transform of list) {
    for (const input of transform.inputs) {
      for (const inputName of input.names) {
        deepest = Math.max(deepest, 1 + chainDepth(inputName, guard))
      }
    }
  }
  return deepest
}

/** 把一条转化描述成一句人话，作为选项文案 */
const METHOD_PHRASE = {
  craft_shaped: '合成',
  craft_shapeless: '无序合成',
  stonecut: '切石',
  smelt: '熔炉烧制',
  blast: '高炉冶炼',
  campfire: '营火烧制',
  smoke: '烟熏炉',
  smith: '铁砧锻造',
  wax: '涂蜡',
  strip: '去皮',
  scrape: '刮除',
}

/** 描述「用哪些原料 + 什么工序」，让选项是一句完整的判断而不是一个词 */
const phraseOf = (transform) => {
  const method = METHOD_PHRASE[transform.method] ?? transform.method
  const names = transform.inputs.flatMap((input) => input.names).map((name) => zhOf(name))
  // 同一条转化的原料可能是多个变种（橡木/白桦木板），全列出来反而更啰嗦，
  // 只取第一个并标注「等」—— 玩家的判断依据是工序 + 原料类别，不是穷举。
  const head = names[0] ?? '?'
  const more = names.length > 1 ? ` 等 ${names.length} 种` : ''
  return `用${head}${more}通过${method}`
}

{
  const random = makeRandom('chainReverse')
  // 收集有明确单一前驱的产物：多条路径会让题目变成「猜任一条」，判分不公平
  const candidates = []
  for (const [result, list] of producersOf) {
    if (list.length !== 1) continue
    const entry = entryByName.get(result)
    if (!entry || !spriteBacked(entry)) continue
    const [transform] = list
    // 原料本身是产物 → 链长 >= 2，才有「必须精确定位」的价值
    const hasProducedInput = transform.inputs.some((input) => input.names.some((n) => producersOf.has(n)))
    if (!hasProducedInput) continue
    candidates.push({ result, entry, transform, depth: chainDepth(result) })
  }

  // 按链长分档：链越长越难
  const shortChains = candidates.filter((c) => c.depth === 2)
  const midChains = candidates.filter((c) => c.depth === 3)
  const longChains = candidates.filter((c) => c.depth >= 4)

  /**
   * 干扰项的构造是这个题型的技术核心。
   *
   * 第一版有个致命漏洞：干扰项全取「同工序」的（想靠原料混淆），
   * 结果四个选项的工序几乎都是「合成」/「涂蜡」——
   * 玩家只要认出「涂蜡」二字就等于答对，因为另外三个也是涂蜡。
   * 实测 132 道题里绝大多数都是这种「工序一致、只换原料」的形态，
   * 等于只考了原料记忆，链的复杂度完全没体现。
   *
   * 现在的规则：**前两个干扰项工序必须与答案不同，第三个才允许同工序**。
   * 这样玩家必须同时判断「走什么工序」和「用什么原料」，
   * 只记住其中一个都不足以答对 —— 这才是「加工链」该有的难度。
   */
  const makeDistractors = (correct, count = 3) => {
    const answerPhrase = phraseOf(correct.transform)
    const answerMethod = correct.transform.method
    const picked = []
    const usedPhrases = new Set([answerPhrase])
    const others = shuffle(candidates, random)

    // 两轮：第一轮只要工序不同的，第二轮才放开同工序的
    for (const wantDifferentMethod of [true, false]) {
      for (const other of others) {
        if (picked.length >= count) break
        if (other.result === correct.result) continue
        const isDifferent = other.transform.method !== answerMethod
        if (isDifferent !== wantDifferentMethod) continue
        const phrase = phraseOf(other.transform)
        if (usedPhrases.has(phrase)) continue
        usedPhrases.add(phrase)
        picked.push(phrase)
        if (picked.length >= count) break
      }
      if (picked.length >= count) break
    }
    return picked.slice(0, count)
  }

  const addChainQuestions = (pool, level, limit) => {
    for (const candidate of shuffle(pool, random).slice(0, limit)) {
      const wrong = makeDistractors(candidate)
      if (wrong.length < 3) continue
      add({
        tier: 'basic',
        level,
        topic: '加工 / 来源',
        prompt: `「${candidate.entry.zhName}」是用什么做出来的？`,
        // 选项是「工序 + 原料」的描述文本，不是物品名 —— 四个选项统一不挂图标
        choices: [
          choice(phraseOf(candidate.transform), null, true),
          ...wrong.map((phrase) => choice(phrase)),
        ],
        explanation: `${candidate.entry.zhName}的做法是：${phraseOf(candidate.transform).replace(/^用/, '')}。`
          + `注意它的原料本身也是加工产物（加工链长 ${candidate.depth} 跳），`
          + `只答对原料不答对工序，或者只答对工序不答对原料，都算错。`,
      })
    }
  }

  addChainQuestions(shortChains, 1, 60)
  addChainQuestions(midChains, 2, 60)
  addChainQuestions(longChains, 2, 30)
  console.log(`  加工链反向题：短链 ${Math.min(60, shortChains.length)} / 中链 ${Math.min(60, midChains.length)} / 长链 ${Math.min(30, longChains.length)}（候选 ${candidates.length}）`)
}

// ---------- 题型 31：机制推演题（level 1）----------
//
// 原型想法：红石 / 机制类的基础题不要只考「查表」。
//
// 现状问题：题库 974 道里，机制与生物类基础题共 84 道，**全部是数据查询**
// （碰撞宽度多少格、是不是燃料）—— 玩家只要会查 wiki 就能答对，
// 考的是「记不记得住数字」，不是「懂不懂机制」。
//
// 这类题的价值在于**答案来自逻辑而非记忆**：
// 玩家不需要背任何数字，只要按红石 / 机制的规则推一遍就能得出答案。
// 这有两个额外好处：
//   ① 严格遵守「简单与中等难度只出 MC 基础知识」—— 推演题考的是基础规则本身，
//      不是冷门数值，符合难度分层原则（冷门机制仍归极限难度）；
//   ② 数据无关，换游戏版本也不会失效。

/**
 * 推演题库。
 *
 * 每条都写成「情境 → 推演规则 → 唯一答案」，四个选项里只有一条满足规则。
 * 干扰项的错法各有不同：违反常识（可破除）、规则边界（接近答案）、
 * 张冠李戴（用错规则）—— 不能三个都是一眼可排的荒谬项。
 */
const REASONING_QUESTIONS = [
  {
    topic: '机制 / 方块更新',
    prompt: '一个活塞前面放了「黏液块」，黏液块后面又放了一个箱子。用活塞推动箱子时，箱子会被一起推动吗？',
    options: [
      '会，黏液块和箱子都算在活塞的推动范围内',
      '不会，黏液块只能带动方块，不能带动方块实体',
      '不会，箱子属于方块实体，任何情况下都不能被活塞推动',
      '会，但箱子只会被推动一格就停下',
    ],
    answerIndex: 1,
    explanation:
      '黏液块能推动方块，但箱子是「方块实体」（有容器数据），活塞的推动判定里方块实体一律排除。这题不需要记任何数字，按「方块 vs 方块实体」这条基础规则推就行。',
  },
  {
    topic: '机制 / 红石',
    prompt: '一个中继器后面紧接着一个红石火把，这一段电路会形成什么？',
    options: [
      '循环，会自己无限开关',
      '强充能，会把信号加强一格',
      '单向传递，信号只能从前往后走',
      '完全断路，信号到红石火把就终止',
    ],
    answerIndex: 2,
    explanation:
      '红石在 Java 版是**单向**的：信号只能从上游传到下游，没有「回到上游」的路。这一点和后来基岩版引入的「元件面向」不同，答题时注意题目问的是 Java 版。',
  },
  {
    topic: '机制 / 方块更新',
    prompt: '一个 TNT 方块上方正好有活塞，活塞向下推出 TNT 时，TNT 会怎样？',
    options: [
      '正常推动 TNT，然后 TNT 照常爆炸',
      '被推动时立刻点燃并爆炸',
      '活塞无法推动 TNT，TNT 原地不动',
      'TNT 会被推动，但不会爆炸',
    ],
    answerIndex: 1,
    explanation:
      '活塞推动 TNT 的瞬间会触发点燃判定 —— 这是「推动」和「引燃」耦合的经典案例，机制题的经典考点。不需要记 tick 数，按因果推即可。',
  },
  {
    topic: '机制 / 红石',
    prompt: '一个侦测器（Observer）背后紧贴着一块方块。当面前的箱子里的物品数量发生变化时，侦测器会怎样？',
    options: [
      '输出信号，因为箱子是「方块状态」变化',
      '不输出信号，侦测器只检测自己的方块状态变化',
      '输出信号，但只输出 0.5 格强度',
      '不输出信号，因为箱子不可被侦测',
    ],
    answerIndex: 1,
    explanation:
      '侦测器只观察**自己所在方块**的状态（朝向、形状），不检测任何相邻方块。箱子变了、侦测器没变 → 无信号。这条规则是所有侦测器装置的共同基础。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '一个普通石块方块挡在苦力怕和玩家之间，苦力怕会不会炸？',
    options: [
      '会爆炸，苦力怕不需要视线',
      '会爆炸，但需要苦力怕先看到玩家',
      '不会爆炸，苦力怕必须与玩家之间没有方块阻挡',
      '不会爆炸，但苦力怕会召唤闪电',
    ],
    answerIndex: 2,
    explanation:
      '苦力怕的引爆条件是「有视线」—— 中间有方块挡住就不炸。石块挡得住苦力怕，挡不住幻翼，这个对比是机制推理的经典组合。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '一间石造小屋里放一个箱子，箱子能提供任何光照吗？',
    options: [
      '能，箱子本身就是光源',
      '不能，箱子既不发光也不透光',
      '不能，但箱子会反射火把的光',
      '能，但只在箱子被打开时发光',
    ],
    answerIndex: 1,
    explanation:
      '箱子既不自发光也不透光，是完全不透光的方块。物品栏里的物品也不会发光 —— 想照明只能用火把、灯笼、萤石这类真正的光源方块。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家站在两格高的悬崖边，面前是半砖（台阶），半砖前面又有一格高的方块。玩家会掉下去吗？',
    options: [
      '会掉下去，掉落距离折半',
      '不会掉下去，半砖加方块共 1.5 格',
      '会掉下去，因为半砖不是完整方块',
      '不会掉下去，台阶类方块都能防摔',
    ],
    answerIndex: 1,
    explanation:
      '半砖上半格、再加一格方块，合计 1.5 格，超过玩家 1.8 格的碰撞高度判定下沿，所以站得住。这题考的是「碰撞高度是连续累加的」这个基础规则。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '玩家拿着船右键水面想放下船，但这个位置的水面高度不足一格（是个小水洼），会怎样？',
    options: [
      '正常放下船',
      '船放不下，必须有足够的水面空间',
      '船能放下，但会立刻损坏',
      '船放在水洼里，但玩家无法乘坐',
    ],
    answerIndex: 1,
    explanation:
      '船需要连续的水面空间才能放置，水洼这种零碎水面放不下。看似细节，但玩家在水塘、河流拐角经常遇到，属于必须理解的基础规则。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '一盏火把放在封闭石屋的地面上，且石头屋顶完整。刷怪笼（Spawner）会在这间屋子里持续生成怪物吗？',
    options: [
      '会，刷怪笼不受光照影响',
      '不会，火把提供的光照等级会抑制刷怪',
      '会，但只生成僵尸',
      '不会，刷怪笼必须直接见到天空',
    ],
    answerIndex: 1,
    explanation:
      '刷怪笼受光照等级抑制：光源会降低它的生成概率，完整石头屋顶 + 火把足以让屋内达到抑制条件。「刷怪笼怕光」是玩家必须掌握的刷怪基础。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '一个村民在 3 格高的工作台旁被关在封闭小屋里，没有床也没有门。村民会怎样？',
    options: [
      '村民会尝试破门或挖墙逃跑',
      '村民会一直待着，直到玩家打开门',
      '村民会凭空消失',
      '村民会召唤僵尸攻击玩家',
    ],
    answerIndex: 0,
    explanation:
      '村民在无法到达工作台时会尝试「打破阻挡」—— 优先开门，失败后挖方块。这也是为什么村民运输时要留通道，否则他们会自己把家拆了。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '两件 durability 剩余耐久都只剩 1 点的装备叠在一起放进铁砧，会怎样？',
    options: [
      '正常合成，耐久相加',
      '合成直接失败，两件装备都会报废',
      '正常合成，两件装备都会恢复满耐久',
      '合成会爆炸',
    ],
    answerIndex: 1,
    explanation:
      '铁砧的耐久消耗是按「剩余耐久」算的：两件各剩 1 点时任何操作都会直接损坏两件装备。这条规则是所有「附魔铁砧」技巧的基础，也解释了为什么合装备要留余量。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家在梯子正下方挖掉梯子所在的那一格，玩家会怎样？',
    options: [
      '正常掉落，梯子消失而已',
      '会掉下去，但会短暂「悬挂」一 tick',
      '会卡在半空，必须再挖一格',
      '会自动抓住旁边的墙',
    ],
    answerIndex: 1,
    explanation:
      '梯子的移动是按「持续检测接触」实现的，方块消失后仍有极短的脱离延迟，视觉上表现为一闪而过地卡一下。这个细节在多人服务器里偶尔被玩家感知到。',
  },
  {
    topic: '机制 / 红石',
    prompt: '一扇铁门被红石信号持续供电，玩家站在门前想过去，会发生什么？',
    options: [
      '门会保持关闭，玩家推不开也进不去',
      '门会被强制打开',
      '门会被卡在中间状态',
      '门会变成物品掉落',
    ],
    answerIndex: 0,
    explanation:
      '铁门由方块实体驱动，有信号就一直保持关闭 —— 经典的「红石锁门」原理。同理，木门的开关取决于最后一次收到的信号，与「玩家是否在附近」无关。',
  },
  {
    topic: '机制 / 方块更新',
    prompt: '玩家在雪层上挖掉雪块，脚下的方块变成深板岩，雪层还会继续堆叠吗？',
    options: [
      '会继续堆叠，雪层与下方方块无关',
      '不会继续堆叠，雪层只能堆在被雪覆盖的方块上',
      '会，但堆叠速度减半',
      '会，但需要天黑',
    ],
    answerIndex: 1,
    explanation:
      '雪层是「被雪」状态的副产物，只在特定的方块（草方块、泥土等）上方生成。挖掉后换成其他方块，雪层就不再积累 —— 这解释了为什么村民农场要固定方块类型。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '玩家在一株小麦幼苗上用骨粉，但这个位置的方块亮度不足。骨粉能催熟它吗？',
    options: [
      '能，骨粉只看是不是作物',
      '不能，小麦等作物需要足够的光照才能生长',
      '能，但生长速度减半',
      '不能，骨粉只对已经成熟的作物有效',
    ],
    answerIndex: 1,
    explanation:
      '小麦、胡萝卜等作物在光照不足时无法推进生长阶段（早期版本里表现为「卡在第一阶段」）。骨粉也不能绕过光照限制 —— 密闭农场必须留灯。',
  },
  {
    topic: '机制 / 方块更新',
    prompt: '玩家挖掉正下方一格方块，悬在头顶的沙砾会怎样？',
    options: [
      '原地不动，需要玩家手动破坏',
      '立刻一起掉落',
      '只有玩家离开后才会掉落',
      '变成物品掉落而不是方块掉落',
    ],
    answerIndex: 1,
    explanation:
      '沙砾、砂砾这类「重力方块」在被挖掉支撑后会立刻触发掉落更新。所以挖基岩下方永远要用支撑方块或潜影盒阻断，否则会直接把你埋了。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家在梯子正下方放一个箱子，箱子会挡住玩家上梯子吗？',
    options: [
      '会，箱子占据了梯子上方的空间',
      '不会，梯子可以让玩家在任何方块上攀爬',
      '会，但只挡住一半高度',
      '不会，但箱子会被顶起',
    ],
    answerIndex: 1,
    explanation:
      '梯子的攀爬判定只要求「玩家碰撞箱与梯子方块相交」，不要求梯子上方是空气。所以箱子放在梯子下方不影响攀爬，这是垂直农场设计的常用技巧。',
  },
  {
    topic: '机制 / 方块实体',
    prompt: '玩家在一面墙前放火把，然后把这面墙拆掉，火把会怎样？',
    options: [
      '火把掉落成物品',
      '火把还悬在原处，只有被支撑时才掉落',
      '火把会变成掉落物方块',
      '火把直接消失',
    ],
    answerIndex: 1,
    explanation:
      '火把等「需要支撑」的方块在失去支撑后会变成掉落物，所以拆墙的瞬间火把会掉下来或被人捡走。这也是「拆家时先拆火把」这个细节存在的原因。',
  },
  {
    topic: '机制 / 方块实体',
    prompt: '两个箱子紧挨着放置，玩家同时打开它们时，物品会不会混在一起？',
    options: [
      '不会，两个箱子的容器数据完全独立',
      '会，紧邻的箱子共享一个容器',
      '只有放下时才会混',
      '只有玩家同时蹲下时才会混',
    ],
    answerIndex: 0,
    explanation:
      '每个箱子方块实体各有一份独立的容器数据，不因相邻而合并。玩家要防的是「漏斗误接」而不是「箱子自动混合」。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '玩家用附魔「时运」的镐挖矿石，经验球会怎样？',
    options: [
      '不变，经验与附魔无关',
      '增加，时运按掉落倍率影响经验量',
      '时运只影响掉落数量，不影响经验',
      '经验会翻倍但只给一半几率',
    ],
    answerIndex: 1,
    explanation:
      '时运同时影响经验球数量和掉落数量。挖矿想攒经验就得带时运镐 —— 这是「时运三件套」价值的基础，属于人人都会但很少有人说出原理的机制。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '玩家从 3 格高的地方起飞滑翔，飞行中撞到天花板，会发生什么？',
    options: [
      '滑翔被强制中断，玩家会掉下来',
      '可以贴天花板飞行，不受影响',
      '鞘翅会损坏',
      '玩家会被弹到更高处',
    ],
    answerIndex: 0,
    explanation:
      '鞘翅滑翔需要持续的前方空间，顶部被挡住会中断滑翔。撞天花板后玩家会坠落 —— 所以室内起飞前要先确认净空高度。',
  },
  {
    topic: '机制 / 方块更新',
    prompt: '一个黏性活塞推出方块后立刻收回，被推出的方块会怎样？',
    options: [
      '跟着活塞一起被拉回',
      '留在原地',
      '掉成物品',
      '被推到更远的位置',
    ],
    answerIndex: 1,
    explanation:
      '黏性活塞拉回时只会把「紧贴着活塞面」的方块一起拉回，也就是它刚推出去的那一格。往里推一格（0.5 格面）就拉不动 —— 这是所有黏性活塞装置布局的出发点。',
  },
  {
    topic: '机制 / 红石',
    prompt: '玩家用红石把一个方块从 1 格高推到 2 格高，侦测器的输出会怎样？',
    options: [
      '没变化，侦测器不检测方块移动',
      '有变化，侦测器检测的是相邻方块状态',
      '只在上方为空气时才有变化',
      '输出强度固定不变',
    ],
    answerIndex: 1,
    explanation:
      '侦测器检测的是「它朝向的那个方向上，相邻方块是否进入/离开它的碰撞体积」。推高方块会改变相邻方块状态，因此输出会变化 —— 这是侦测器做「物品计数」的基本原理。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家放下一格楼梯，站在楼梯下方想上去，需要按哪个键？',
    options: [
      '直接走上去，不用按键',
      '必须按住潜行键',
      '必须跳跃',
      '必须蹲下',
    ],
    answerIndex: 0,
    explanation:
      '楼梯在 Java 版可以直接走上去（潜行键是往下走，不是往上）。这条看似琐碎，但版本之间有过变化，属于必须理解的基础手感。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家挖掉一株甘蔗最下面一格，甘蔗的剩余部分会怎样？',
    options: [
      '一起消失，因为甘蔗只能长在水上且必须连续',
      '剩下部分保留，会继续长高',
      '变成可拾取物品',
      '只有最上面一格保留',
    ],
    answerIndex: 0,
    explanation:
      '甘蔗这类方块的生长要求下方紧邻同类方块且脚下是水/土。挖掉最底下一整根就全断了，所以甘蔗农场要留最底层不动。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '一格宽的缝隙，玩家（碰撞宽度约 0.6 格）能侧身挤过去吗？',
    options: [
      '能挤过去，缝隙比碰撞宽度宽',
      '挤不过去，缝隙太窄',
      '只能蹲下才挤得过去',
      '缝隙宽度无所谓',
    ],
    answerIndex: 0,
    explanation:
      '玩家碰撞宽度约 0.6 格，所以 1 格缝隙有余量可以侧身通过。「1 格宽 = 过不去」是误解 —— 真正过不去的是 0.5 格的半砖缝隙。',
  },
  {
    topic: '机制 / 方块实体',
    prompt: '玩家把一个箱子对着墙放，然后打破墙再重新放一个箱子，箱子会朝向哪里？',
    options: [
      '仍朝原方向，朝向由放置时决定',
      '自动朝向玩家',
      '箱子没有朝向概念',
      '朝向会随机变化',
    ],
    answerIndex: 0,
    explanation:
      '箱子朝向是放置时固定的方块状态，之后不随周围环境变化。只有漏斗（不是箱子）会朝向相邻的容器 —— 这两个搞混是常见错误。',
  },
  {
    topic: '机制 / 方块实体',
    prompt: '水流进满的告示牌格子里，告示牌里的文字会怎样？',
    options: [
      '文字被水冲掉，变成空白',
      '文字不受水影响，仍然保留',
      '告示牌变成物品掉落',
      '水会填满告示牌内部',
    ],
    answerIndex: 1,
    explanation:
      '告示牌 / 牌子是「无内容方块」，水和其他流体都流不过去，但方块实体数据不受影响。只有书和纸板箱会被水烧毁，告示牌不会。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '玩家在白天清理刷怪笼里的蜘蛛，蜘蛛会不会像僵尸一样自动烧掉？',
    options: [
      '会，蜘蛛在白天会自燃',
      '不会，蜘蛛白天不会自燃',
      '只有晴天才会自燃',
      '蜘蛛会变成蜘蛛网',
    ],
    answerIndex: 1,
    explanation:
      '蜘蛛不参与「白天自燃」的判定（僵尸、骷髅、尸壳才会）。这是刷怪笼刷怪塔设计的常见误解 —— 蜘蛛会正常活下来，清扫时别只盯着僵尸。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '两个村民被关在封闭小屋里、床位足够但没有门，会不会繁殖出小村民？',
    options: [
      '不会，缺少门这个「安全性」条件',
      '会，床位够就能繁殖',
      '只有玩家在场时才会繁殖',
      '会，但速度减半',
    ],
    answerIndex: 0,
    explanation:
      '村民繁殖除了「数量足够 + 有床 + 有食物」，还要求「有门且村民能到达门」这条安全性条件。铁门不算「安全的门」（村民需要能打开它），所以全封闭的繁殖场会失败。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '玩家在一个 2 格高、1 格宽的洞穴里刷怪，怪物会不会生成？',
    options: [
      '会，2 格高足够刷怪',
      '不会，3 格高 2 格宽以下刷不出怪',
      '会，但只生成蝙蝠',
      '要 4 格高才刷怪',
    ],
    answerIndex: 1,
    explanation:
      '原版刷怪算法要求空间至少 3 格高、2 格宽，2 格高的洞穴永远刷不出怪 —— 这是刷怪塔设计的硬约束，也是很多「为什么不刷怪」困惑的答案。',
  },
  {
    topic: '机制 / 玩家与物品',
    prompt: '玩家熔炼 10 个铁锭，经验球大约给多少经验？',
    options: [
      '和烧制 10 个物品一样多',
      '每个铁锭给固定的一点经验，比烧制少',
      '熔炼完全不给经验',
      '经验只由成品决定，与原料无关',
    ],
    answerIndex: 1,
    explanation:
      '熔炼经验按**产出物品**给（成品给一点经验），而不是按原料个数给。所以熔炼不是刷经验的好办法 —— 这解释了为什么经验农场要用熔炉批量烧原木而不是烧成品。',
  },
  {
    topic: '机制 / 红石',
    prompt: '两个 TNT 被点燃后，下方又放了一个 TNT 方块。连锁爆炸会引爆第三个吗？',
    options: [
      '会，TNT 爆炸会引爆范围内的其他 TNT',
      '不会，只有火源点燃才会爆炸',
      '会，但需要玩家手动点燃',
      '只有在末影龙战斗中才会连锁',
    ],
    answerIndex: 0,
    explanation:
      'TNT 是「连锁型方块实体」：爆炸的白名单里包含其他 TNT 方块实体，所以会连续引爆。这是所有 TNT 连锁装置的基础机制。',
  },
  {
    topic: '机制 / 红石',
    prompt: '玩家在铁门旁放一个拉杆打开门，然后立刻把拉杆关掉，门会怎样？',
    options: [
      '立刻关上，门跟随当前信号',
      '保持打开，门看的是信号变化沿',
      '门会卡在中间状态',
      '门会变成普通木门',
    ],
    answerIndex: 1,
    explanation:
      '铁门的开合看的是**信号变化沿**，不是信号电平。信号撤销后门保持原状态 —— 所以自动门要用高频交替信号，而不是持续供电。这是所有「自动门」电路的核心。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '玩家在海龟蛋上放一盏火把（满光照等级），蛋会孵化吗？',
    options: [
      '会，火把不阻挡孵化',
      '不会，满亮度会阻碍孵化',
      '会，但孵化时间变长',
      '只有不放火把才能孵化',
    ],
    answerIndex: 1,
    explanation:
      '海龟蛋在满亮度下不会孵化（僵尸 villager 变正常也同理）。所以海龟农场必须用半砖盖住蛋来遮光，或把光照控制在 8 档以下 —— 这是「海龟蛋不孵化」最常见的原因。',
  },
  {
    topic: '机制 / 刷怪与生物',
    prompt: '玩家在室内用骨粉催熟一株「棕色蘑菇」，需要什么条件？',
    options: [
      '任意光照下都能催熟',
      '需要和普通蘑菇相同的低光照条件',
      '必须是深暗之域',
      '棕色蘑菇不能被骨粉催熟',
    ],
    answerIndex: 0,
    explanation:
      '两种蘑菇的催熟都不检查光照，但都要求「下方是特定方块」（棕蘑菇要蘑菇块/泥土加氮）。蘑菇种植的核心条件是底座方块而不是光照。',
  },
  {
    topic: '机制 / 方块更新',
    prompt: '玩家在一个 2 格高的空间里放下沙漏，沙漏会正常变成掉落物吗？',
    options: [
      '会，沙粒会正常掉落',
      '不会，沙子需要 3 格空间才能自由下落',
      '会，但只有一半沙子会落下',
      '不会，沙漏必须放在 1 格高的洞里',
    ],
    answerIndex: 1,
    explanation:
      '沙与沙砾的「下落方块」判定需要 3 格净空。空间不够时沙子会卡住不落 —— 这是漏斗沙、红石沙的建造必须留够高度的原因。',
  },
  {
    topic: '机制 / 地形与光照',
    prompt: '玩家在区块边界放一台机器，玩家走远了，机器会停止工作吗？',
    options: [
      '不会，机器永远工作',
      '会，加载范围外的区块会卸载，机器停止',
      '只有红石机器会停，活塞不会停',
      '取决于机器类型随机决定',
    ],
    answerIndex: 1,
    explanation:
      'Java 版区块以玩家为中心加载（默认为 12 区块半径），走远后区块卸载、方块实体停止 tick。所以农场要等玩家回来才启动 —— 这是「挂机农场」设计的基础。',
  },
  {
    topic: '机制 / 方块实体',
    prompt: '玩家在一面实体墙后放火把，火把的光能穿过墙照亮对面吗？',
    options: [
      '不能，实心方块完全阻挡光照',
      '能，光会穿过实体方块',
      '只有玻璃能阻挡',
      '取决于火把的颜色',
    ],
    answerIndex: 0,
    explanation:
      '实心方块的遮光等级是 15，完全阻断光照。光只能透过玻璃、树叶、栅栏这类遮光等级低的方块。判断「房间亮不亮」要先判断墙的材质。',
  },
  {
    topic: '机制 / 红石',
    prompt: '玩家把两扇铁门并排放在一个 1 格宽的门框里，这两扇门能同时打开吗？',
    options: [
      '能，并排的双开门',
      '不能，双开门至少需要 2 格宽',
      '能，但只能打开其中一扇',
      '不能，会被判定为方块实体冲突',
    ],
    answerIndex: 1,
    explanation:
      'Java 版铁门按「双开」判定需要一个 1 格宽的单门框；并排放置时两扇各自是单门，开的方向由玩家放置时决定。这个细节在多人建筑里偶尔有人搞错。',
  },
]

{
  const random = makeRandom('reasoning')
  for (const item of shuffle(REASONING_QUESTIONS, random)) {
    add({
      tier: 'basic',
      // 推演题统一 level 1：它们考的是基础规则本身，难度在于推理而非冷门知识。
      // 放 level 2 会让「中等难度」的门槛变成「要背冷门机制」，违背难度分层。
      level: 1,
      topic: item.topic,
      prompt: item.prompt,
      // 全部纯文字选项，四个选项都不挂图标
      choices: item.options.map((label, index) => choice(label, null, index === item.answerIndex)),
      explanation: item.explanation,
    })
  }
  console.log(`  机制推演题：${REASONING_QUESTIONS.length} 道（数据无关，换版本不会失效）`)
}

// ---------- 落盘 ----------

const basicCount = questions.filter((q) => q.tier === 'basic').length
const levelCounts = {
  1: questions.filter((q) => q.tier === 'basic' && q.level === 1).length,
  2: questions.filter((q) => q.tier === 'basic' && q.level === 2).length,
}
const byTopic = {}
for (const question of questions) byTopic[question.topic] = (byTopic[question.topic] ?? 0) + 1

const output = {
  meta: {
    edition: catalogData.meta.edition,
    /** 本项目图鉴与配方数据的提取版本 */
    dataVersion: DATA_VERSION,
    /** 撰写题库时的最新正式版 */
    latestRelease: QUIZ_SOURCE.latestRelease,
    latestReleaseName: QUIZ_SOURCE.latestReleaseName,
    latestReleaseDate: QUIZ_SOURCE.latestReleaseDate,
    bugTracker: QUIZ_SOURCE.bugTracker,
    generatedFrom:
      '基础题：catalog.json 的 facts + transformations.json 的转化（client.jar 26.1）；冷门题：bugs.mojang.com 官方 Jira + 中文社区实测（恒某人 / 这里是莱里 / 盖宝gaiber）',
    counts: {
      total: questions.length + obscure.length,
      basic: basicCount,
      basicLevel1: levelCounts[1],
      basicLevel2: levelCounts[2],
      obscure: obscure.length,
      byTopic: Object.keys(byTopic).length,
    },
  },
  questions: [...questions, ...obscure],
}

const outFile = join(root, 'src/data/quiz.json')
if (!existsSync(dirname(outFile))) mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`)

console.log(`题库写入 ${outFile}`)
console.log(`基础题 ${basicCount} 道（level 1 = ${levelCounts[1]}，level 2 = ${levelCounts[2]}）`)
console.log(`冷门题 ${obscure.length} 道`)
console.log(`合计 ${output.questions.length} 道 · ${Object.keys(byTopic).length} 个主题 · 数据版本 ${DATA_VERSION} / 最新正式版 ${QUIZ_SOURCE.latestRelease}`)
if (unspriteableQuestions.length) {
  console.warn(
    `⚠️ 有 ${unspriteableQuestions.length} 道题因选项缺官方材质贴图被丢弃：`
    + `${[...new Set(unspriteableQuestions.flatMap((q) => q.labels))].slice(0, 8).join(' / ')}`,
  )
}
