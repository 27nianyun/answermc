import { QUIZ_QUESTIONS } from './quiz'
import type { PlayerStats, QuizQuestion } from './types'

/**
 * 知识地图：答对一题就点亮「图鉴里的某个知识点」。
 *
 * ── 为什么零泄漏仍然成立 ──────────────────────────────────────
 * 收集进度只记两件事：**玩家已经答对过哪些题**、**这些题属于哪个知识点维度**。
 * 它记录的是「已掌握」，不是「正确答案是什么」——
 * 一道题被点亮时玩家已经知道答案了，所以进度条既不会预告答案、
 * 也不会把某个方块和某个属性提前关联起来。
 * 唯一要小心的是「未点亮」不能反过来变成线索：
 * 所以未点亮的知识点**只显示维度名和题量，不显示任何条目名**，
 * 玩家无法从「哪个知识点还没亮」倒推出当前题的答案。
 *
 * ── 知识点维度怎么来 ─────────────────────────────────────────
 * 题库 topic 的第二段（如「方块 / 硬度」→「硬度」、「机制 / 红石」→「红石」）
 * 就是天然的知识点维度。冷门题的细分 topic（只有 1~2 道题）
 * 合并到上一层去，否则地图上会出现几十个「1/1」的格子，没法看。
 */

/** 知识点 key：topic 的第二段；没有第二段就用整段 */
export const knowledgeKeyOf = (topic: string): string => {
  const parts = topic.split(' / ')
  return parts.length > 1 ? parts[1] : parts[0]
}

/**
 * 冷门题（tier = obscure）只进极限难度，它们的细分 topic 动辄只有 1~2 道题
 * （实测近 30 个），全并进「冷门机制」—— 否则地图上会挤出一排「1/1」的格子，
 * 既不好看也不反映真实的掌握结构。冷门题本来就是另一条赛道，合并不丢信息。
 */
const RARE_BUCKET = '冷门机制'

/** 把细分维度映射到最终的知识点 key */
const resolveKey = (topic: string, rare: boolean): string => {
  const key = knowledgeKeyOf(topic)
  return rare ? RARE_BUCKET : key
}

/**
 * 对外暴露「题目 → 知识点 key」的解析。
 *
 * 方向提示（assistDirection）要说出「这道题属于哪个知识点」，
 * 如果它自己重新实现一遍冷门题合并逻辑，两处迟早会对不上 ——
 * 所以直接把这条规则开放出去，保证提示里说的和知识地图上画的是同一个维度。
 */
export const resolveFacetKey = (question: QuizQuestion): string =>
  resolveKey(question.topic, question.tier === 'obscure')

export interface KnowledgeFacet {
  key: string
  /** 该维度在题库里的总题量 —— 用来算进度分母 */
  total: number
  /** 属于哪个大类（topic 第一段），展示时分组 */
  group: string
}

/**
 * 全站知识点清单，在模块加载时算一次（题库是静态的，不必每次渲染重算）。
 *
 * 分组取该 key 第一次出现时的 topic 首段；「冷门机制」是人工合并出来的桶，
 * 归到「极限」组下，和它在游戏里的入口一致。
 */
let facetCache: KnowledgeFacet[] | null = null

export const knowledgeFacets = (): KnowledgeFacet[] => {
  if (facetCache) return facetCache
  // 第一遍：数每个 key 的题量（注意要先按合并后的 key 数，不能按原始 key 数）
  const totals = new Map<string, number>()
  for (const question of QUIZ_QUESTIONS) {
    const key = resolveKey(question.topic, question.tier === 'obscure')
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }
  // 第二遍：登记每个 key 的元信息（分组取该 key 第一次出现时的 topic 首段）
  const groups = new Map<string, string>()
  for (const question of QUIZ_QUESTIONS) {
    const key = resolveKey(question.topic, question.tier === 'obscure')
    if (groups.has(key)) continue
    const parts = question.topic.split(' / ')
    groups.set(key, key === RARE_BUCKET ? '极限' : parts[0])
  }
  facetCache = [...totals.entries()]
    .map(([key, total]) => ({ key, total, group: groups.get(key) ?? '其他' }))
    .sort((a, b) => b.total - a.total)
  return facetCache
}

export interface KnowledgeProgress {
  /** 已点亮的知识点 key → 答对过的题数 */
  lit: Record<string, number>
  /** 已答对过的题目 id —— 同一题不重复计数 */
  solvedIds: string[]
  /**
   * 错题本：题目 id → 累计答错次数。
   *
   * 与 `lit` 严格并存的两条记录：同一题可以既点亮过又答错过（先错后对），
   * 这正是最值得复习的那类题 —— 从错题本里彻底答对后会自动移出。
   */
  wrong: Record<string, number>
}

export const EMPTY_KNOWLEDGE: KnowledgeProgress = { lit: {}, solvedIds: [], wrong: {} }

/**
 * 答对一题时上报。
 *
 * 只在答对时调用；答错 / 跳过 / 超时都不点亮 —— 收集进度必须是「掌握」的证据，
 * 不是「看过」的证据，否则玩家乱点也能点亮，收集就失去意义。
 */
export const lightUp = (
  previous: KnowledgeProgress,
  question: QuizQuestion,
): KnowledgeProgress => {
  // 同一题只计一次：考试模式不会重复出同一题，但「不重复」关掉后可能重抽到，
  // 那时再点一次会让进度虚高。
  if (previous.solvedIds.includes(question.id)) return previous
  const key = resolveKey(question.topic, question.tier === 'obscure')
  /*
  答对了就移出错题本。
  「曾经答错」是历史，「现在答对」是现状 —— 错题本要反映的是**还需要复习的题**，
  玩家已经会的题继续挂在错题本里只会让列表越来越长、越来越没有参考价值。
  之后如果再答错，markWrong 会重新把它加回来。
  */
  const { [question.id]: _removed, ...restWrong } = previous.wrong
  void _removed
  return {
    lit: { ...previous.lit, [key]: (previous.lit[key] ?? 0) + 1 },
    solvedIds: [...previous.solvedIds, question.id],
    wrong: restWrong,
  }
}

/**
 * 答错时上报，进错题本。
 *
 * 和 lightUp 严格分开：答错不点亮任何知识点，也不记 solvedIds ——
 * 收集进度必须是「掌握」的证据。错题本则相反，它只收「还没掌握」的证据。
 *
 * 重复答错同一题时累加次数，用来在错题本里排序（错得越多越该先复习）。
 */
export const markWrong = (
  previous: KnowledgeProgress,
  question: QuizQuestion,
): KnowledgeProgress => ({
  ...previous,
  wrong: { ...previous.wrong, [question.id]: (previous.wrong[question.id] ?? 0) + 1 },
})

export const markSolved = lightUp

export interface FacetState extends KnowledgeFacet {
  /** 已点亮题数 */
  litCount: number
  /** 完成度 0~1 */
  ratio: number
  /** 玩家是否一道都还没答对过这一维度 */
  blank: boolean
}

export const facetStates = (progress: KnowledgeProgress): FacetState[] =>
  knowledgeFacets().map((facet) => {
    const litCount = Math.min(progress.lit[facet.key] ?? 0, facet.total)
    return {
      ...facet,
      litCount,
      ratio: facet.total > 0 ? litCount / facet.total : 0,
      blank: litCount === 0,
    }
  })

export interface KnowledgeSummary {
  /** 已点亮的知识点数 / 总知识点数 */
  litFacets: number
  totalFacets: number
  /** 已点亮题数 / 题库总题数 */
  litQuestions: number
  totalQuestions: number
  /** 完全空白的知识点（按题量降序，前端只显示这些的维度名） */
  blanks: FacetState[]
  /** 掌握度最高的三个维度 */
  strongest: FacetState[]
}

export const knowledgeSummary = (progress: KnowledgeProgress): KnowledgeSummary => {
  const states = facetStates(progress)
  const lit = states.filter((state) => state.litCount > 0)
  return {
    litFacets: lit.length,
    totalFacets: states.length,
    litQuestions: progress.solvedIds.length,
    totalQuestions: QUIZ_QUESTIONS.length,
    blanks: states.filter((state) => state.blank),
    strongest: [...lit].sort((a, b) => b.ratio - a.ratio).slice(0, 3),
  }
}

/** 从旧的 PlayerStats（可能没有 knowledge 字段）里安全取出收集进度 */
export const readKnowledge = (stats: PlayerStats | null | undefined): KnowledgeProgress => {
  const raw = stats?.knowledge
  if (!raw || typeof raw !== 'object') return EMPTY_KNOWLEDGE
  const lit = raw.lit && typeof raw.lit === 'object' ? raw.lit : {}
  const solvedIds = Array.isArray(raw.solvedIds)
    ? raw.solvedIds.filter((id): id is string => typeof id === 'string')
    : []
  // wrong 同样是可选字段：老存档没有就是空对象，不要让它把整份进度变成 undefined
  const wrongRaw = raw.wrong && typeof raw.wrong === 'object' ? raw.wrong : {}
  const wrong: Record<string, number> = {}
  for (const [id, count] of Object.entries(wrongRaw)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      wrong[id] = Math.floor(count)
    }
  }
  return { lit: lit as Record<string, number>, solvedIds, wrong }
}

/* ============================================================
 * 错题本
 *
 * 为什么单独一节而不是塞进知识地图：
 * 知识地图回答「我掌握得怎么样」，是**成就**；错题本回答「我该复习什么」，
 * 是**待办**。两者方向相反，混在一起会让侧栏既不像奖杯也不像任务列表。
 *
 * ── 零泄漏仍然成立 ──────────────────────────────────────
 * 错题本只存「题目 id + 错误次数」，不存答案、不存玩家当初选了什么。
 * 展示时也要注意：列表里出现一道题，不等于告诉玩家答案 ——
 * 玩家点「重练」是主动去答，答错时本来也看不到对错。
 * ============================================================ */

export interface MistakeEntry {
  question: QuizQuestion
  /** 累计答错次数 */
  times: number
  /** 所属知识点维度 key，和知识地图用同一套 key */
  facetKey: string
  /** 该题所属难度层，决定重练时该用哪个难度 */
  tier: 'basic' | 'obscure'
}

/** 按错误次数降序取错题；次数相同按题目 id 排，保证顺序稳定不跳动 */
export const mistakeList = (progress: KnowledgeProgress): MistakeEntry[] => {
  const byId = new Map(QUIZ_QUESTIONS.map((q) => [q.id, q]))
  const out: MistakeEntry[] = []
  for (const [id, times] of Object.entries(progress.wrong)) {
    const question = byId.get(id)
    // 题库里已经不存在的 id（数据版本更新后删题）直接忽略，
    // 否则错题本会卡着一个点不开的条目
    if (!question) continue
    out.push({
      question,
      times,
      facetKey: resolveKey(question.topic, question.tier === 'obscure'),
      tier: question.tier,
    })
  }
  return out.sort((a, b) => b.times - a.times || a.question.id.localeCompare(b.question.id))
}

export interface MistakeSummary {
  /** 错题总数（去重后的题目数） */
  total: number
  /** 累计答错次数 */
  attempts: number
  /** 错得最多的知识点（按错误次数降序，取前 5） */
  weakest: Array<{ key: string; group: string; wrongCount: number; total: number }>
  /** 只错过一次的题 —— 属于「粗心」，优先级最低 */
  onceOnly: number
}

export const mistakeSummary = (progress: KnowledgeProgress): MistakeSummary => {
  const list = mistakeList(progress)
  const groups = new Map<string, number>()
  for (const item of list) {
    groups.set(item.facetKey, (groups.get(item.facetKey) ?? 0) + item.times)
  }
  const groupOf = new Map(knowledgeFacets().map((f) => [f.key, f.group]))
  const totalOf = new Map(knowledgeFacets().map((f) => [f.key, f.total]))
  return {
    total: list.length,
    attempts: list.reduce((sum, item) => sum + item.times, 0),
    weakest: [...groups.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, wrongCount]) => ({
        key,
        group: groupOf.get(key) ?? '其他',
        wrongCount,
        total: totalOf.get(key) ?? 0,
      })),
    onceOnly: list.filter((item) => item.times === 1).length,
  }
}
