import rawQuiz from './data/quiz.json'
import { makeRandom } from './rng'
import { entryForName } from './transforms'
import type { CatalogEntry, Difficulty, GameMode, QuizData, QuizQuestion, QuizTier } from './types'

const quizData = rawQuiz as unknown as QuizData

export const QUIZ_META = quizData.meta
export const QUIZ_QUESTIONS: QuizQuestion[] = quizData.questions

/**
 * 难度 → 允许的题目层级。
 *
 * 这是用户定的硬规则：简单和中等难度只出 MC 基础知识，不要 bug 类型、
 * 也不要特别难的特性类内容；冷门机制与官方未修复 bug 只进极限难度。
 *   探险家 explorer —— 只出 level 1
 *   生存   survival —— 出 level 1 + level 2
 *   极限   hardcore —— 只出 obscure（冷门机制与官方 bug）
 *
 * ⚠️ 关于「level 1 到底该有多难」：用户反馈过「题目太简单」。复盘分两轮：
 *
 * 第一轮根因在数值题：
 *   ① 干扰项从全池随机取，四个选项天差地别 —— 硬度题抽出过「水 / 淡蓝色床 / 石英砖 /
 *     激活铁轨」，玩家闭眼就能剔掉「水」；
 *   ② 问的都是「以下哪个最 X」这类极值题，只要会排序就一定答对，
 *     根本不需要精确记忆任何数值。
 *   对策：干扰项改取数值紧邻项，极值题全部改成「精确数值题」与「答案居中的目标值题」。
 *
 * 第二轮根因在正向语义题 —— 数值题修好之后，level 1 里还剩 156 道
 * 「哪一个是 X」的正向题（哪个能当燃料 / 哪个是透明的 / 哪个是敌对生物 / 用什么工具采掘）。
 * 这些题靠物品语义就能答，根本用不上数据表：看到玻璃就知道透明，看到煤炭就知道是燃料。
 * 对策是把它们全部改造成需要交叉核对或反向确认的题：
 *   · 双条件交叉 —— 「同时满足『要用镐采掘』和『遮光等级是 0』」，
 *     三个干扰项各只满足其中一个条件，只查一行数据必被绊倒；
 *   · 反向排除 —— 「哪一个【不】需要用镐」「哪一个不能涂蜡」，
 *     必须确认另外三个都满足条件，只知道答案那一个不够；
 *   · 精确目标值批量出题 —— 硬度 / 爆炸抗性 / 发光等级 / 遮光等级 / 堆叠上限 / 碰撞宽度
 *     六个字段各自出题，答案既不是最大值也不是最小值。
 *
 * 换句话说：入门难度也必须真记得住数据，且不再有靠语义就能答的正向题。
 *
 * 实测分布（scripts/smoke-difficulty.mjs 量化）：
 *   level 1 平均可猜度 -0.78，level 2 平均 -0.73，题库里「可排序的极值送分题」为 0 道，
 *   「四个选项都是整句」的送分题为 0 道。
 *   精确目标值题 118 道，其中 level 1 的精确回忆题 149 道。
 *
 * 兜底顺序：先在 strictLevels 里抽，只有该池被历史去重抽空时才放宽到 fallbackLevels。
 * 这样极限难度不会因为「多带了些基础题兜底」而稀释掉冷门题比例。
 */
export const QUIZ_TIERS: Record<Difficulty, {
  tiers: QuizTier[]
  strictLevels: number[]
  fallbackLevels: number[]
  label: string
  note: string
}> = {
  explorer: {
    tiers: ['basic'],
    strictLevels: [1],
    fallbackLevels: [1, 2],
    label: 'MC 数据速查',
    note: '考的是「你记不记得这个数」：硬度、爆炸抗性、发光与遮光等级、堆叠上限、生物碰撞宽度。选项要么全是挨着的数字，要么是四个长得极像的方块而答案既不是最大也不是最小 —— 没有排除法空间，必须真的背过数据表。',
  },
  survival: {
    tiers: ['basic'],
    strictLevels: [1, 2],
    fallbackLevels: [1, 2],
    label: '数据 + 加工推理',
    note: '在数据速查之上加入需要交叉核对与反向确认的题：双条件交叉（工具 × 遮光、燃料 × 原料）、反向排除（哪一个【不】能去皮 / 不能涂蜡 / 不是透明）、同族辨析、烧制 / 去皮 / 涂蜡 / 刮蜡 / 冶炼的产物。仍然不涉及冷门机制与 bug。',
  },
  hardcore: {
    tiers: ['obscure', 'basic'],
    strictLevels: [3],
    fallbackLevels: [3, 2],
    label: '冷门机制与官方 Bug',
    note: '以官方未修复 bug、反直觉机制、社区实测冷知识为主，题源标注到具体 Jira 编号或视频。每条都对着 bugs.mojang.com 与 Wiki 核实过状态与修复版本。',
  },
}

const matchesRule = (question: QuizQuestion, rule: typeof QUIZ_TIERS[Difficulty], levels: number[]) =>
  rule.tiers.includes(question.tier) && levels.includes(question.level)

export const quizPool = (difficulty: Difficulty): QuizQuestion[] => {
  const rule = QUIZ_TIERS[difficulty]
  return QUIZ_QUESTIONS.filter((question) => matchesRule(question, rule, rule.strictLevels))
}

/**
 * 抽题池：与 quizPool 相同，但在「严格层已全部出过一次」时才放宽到兜底层级。
 *
 * 传入的 excludeIds 必须是【本局出过的全部题目】，不能只传最近 N 条：
 * 历史窗口（比如只留最近 40 条）会把早期题目「忘掉」，导致严格层明明还有没出过的题
 * 却被误判成抽空，从而过早放宽到兜底层 —— 极限难度会因此混进基础题。
 */
export const quizPickPool = (
  difficulty: Difficulty,
  excludeIds: string[],
): QuizQuestion[] => {
  const rule = QUIZ_TIERS[difficulty]
  const strict = QUIZ_QUESTIONS.filter((question) => matchesRule(question, rule, rule.strictLevels))
  const seen = new Set(excludeIds)
  const hasUnseenStrict = strict.some((question) => !seen.has(question.id))
  if (hasUnseenStrict) return strict
  // 严格层真的全出过了才放宽
  const fallback = QUIZ_QUESTIONS.filter((question) => matchesRule(question, rule, rule.fallbackLevels))
  return fallback.some((question) => !seen.has(question.id)) ? fallback : strict
}

export const quizTopics = (difficulty: Difficulty): string[] => {
  const seen = new Set<string>()
  for (const question of quizPool(difficulty)) seen.add(question.topic)
  return [...seen]
}

export const pickQuestion = (
  pool: QuizQuestion[],
  previousIds: string[],
  seed?: string,
  allowRepeat = false,
): QuizQuestion => {
  if (!pool.length) throw new Error('当前难度下没有可用题目。')
  // allowRepeat：勾选「允许重复」时不排除已出过的题
  const fresh = allowRepeat ? pool : pool.filter((question) => !previousIds.includes(question.id))
  const source = fresh.length ? fresh : pool
  const random = makeRandom(seed)
  return source[Math.floor(random() * source.length)]
}

/**
 * 把一道题的选项重新打乱。
 *
 * 用户要求「同一道题每次选项打乱」—— 记答案位置是很容易的习惯，
 * 固定顺序等于送分，所以每出一题都要重排。
 *
 * ⚠️ 关键：必须把 options / optionNames / answerIndex 三个数组【一起】重排。
 * 只排 options 的话，图标会跟文本错位（选「黑曜石」却显示熔岩的图标），
 * 而错位的图标在零泄漏原则下更糟：玩家会看到一个「本该出现却没出现」的图标，
 * 反过来推出答案。这里用 index 数组做统一置换，从结构上杜绝错位。
 */
export const shuffleQuestionOptions = (question: QuizQuestion, seed?: string): QuizQuestion => {
  if (question.options.length < 2) return question
  const random = makeRandom(seed ?? `${question.id}-shuffle-${Math.random()}`)
  const order = question.options.map((_, index) => index)
  // Fisher–Yates：比 sort(() => Math.random() - 0.5) 均匀，且不会因比较器不严格而漏点
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const temp = order[index]
    order[index] = order[swap]
    order[swap] = temp
  }
  // 顺序完全没变就直接返回原题，省一次对象分配
  if (order.every((value, index) => value === index)) return question
  return {
    ...question,
    options: order.map((index) => question.options[index]),
    optionNames: order.map((index) => question.optionNames[index]),
    answerIndex: order.indexOf(question.answerIndex),
  }
}

/**
 * 按难度抽一道题。
 * 内部会用 quizPickPool 处理「严格层被历史抽空后放宽」的兜底，
 * 所以调用方不需要自己关心层级规则。
 *
 * shuffleSeed 单独传，是因为「抽哪道题」和「选项怎么排」是两件独立的事：
 * 前者要按难度去重，后者只要随机。混在一起会导致同 seed 下重排出同一道题。
 */
export const pickQuizQuestion = (
  difficulty: Difficulty,
  previousIds: string[],
  seed?: string,
  allowRepeat = false,
): QuizQuestion => {
  const pool = quizPickPool(difficulty, previousIds)
  if (!pool.length) throw new Error('当前难度下没有可用题目。')
  return pickQuestion(pool, previousIds, seed, allowRepeat)
}

export const quizRoundSeed = (mode: GameMode, difficulty: Difficulty, round: number) => {
  const today = new Date().toISOString().slice(0, 10)
  return mode === 'daily'
    ? `${today}-quiz-${difficulty}`
    : `quiz-${difficulty}-${round}-${Math.floor(Math.random() * 100000)}`
}

/** 正确答案文本 */
export const answerOf = (question: QuizQuestion) => question.options[question.answerIndex]

/**
 * 每个选项各自的图鉴条目，用于给【每个选项】渲染它自己的官方材质图标。
 *
 * 零泄漏要点：这里刻意不提供「题目主角」式的单一入口。
 * 四选一里单独显示一个方块图标 = 直接把答案摆在脸上（实测旧版 232/347 道题的主角
 * 就是正确答案），所以四个选项一律平权：有自己的图标就出，没有就纯文字。
 */
export const optionEntries = (question: QuizQuestion): (CatalogEntry | null)[] =>
  question.optionNames.map((name) => (name ? entryForName(name) : null))

/** 出图标的题里，四个选项是否都带图标（部分出会让玩家靠「哪个没图」反推答案） */
export const optionsHaveUniformIcons = (question: QuizQuestion): boolean => {
  const filled = question.optionNames.filter((name) => name !== null).length
  return filled === 0 || filled === question.options.length
}

/**
 * 版本徽章文案。
 * 用户要求「每一道题都必须包含当前的版本信息」，所以这里给每题拼一段可读的版本说明：
 *   现行版本 26.3（项目数据 26.1）
 *   + 机制引入 / 修复信息（有就补上）
 */
export const versionBadge = (question: QuizQuestion): string[] => {
  const badge = [`现行 ${QUIZ_META.latestRelease} · 数据 ${QUIZ_META.dataVersion}`]
  if (question.version.introduced) badge.push(`机制自 ${question.version.introduced}`)
  if (question.version.fixed) badge.push(`已修复：${question.version.fixed}`)
  else if (question.version.verifiedIn) badge.push(`该现象在 ${question.version.verifiedIn} 成立`)
  return badge
}

export const SOURCE_LABELS: Record<QuizQuestion['source']['type'], string> = {
  data: '官方数据',
  recipe: '官方配方',
  'mojang-bug': '官方 Bug 单',
  up: '社区实测',
}

export const CONFIDENCE_LABELS: Record<QuizQuestion['source']['confidence'], string> = {
  data: '硬数据 · 逐条可复现',
  confirmed: '官方已确认复现',
  reported: '社区实测 · 未逐帧核实',
}

/** 单题满秒答对的基础分：基础题便宜、冷门题贵。练习与考试共用这一套标准 */
const basePoints = (difficulty: Difficulty, question: QuizQuestion) =>
  question.tier === 'obscure'
    ? (difficulty === 'hardcore' ? 240 : 180)
    : (difficulty === 'hardcore' ? 200 : difficulty === 'survival' ? 140 : 100)

/** 答对得分：按难度与提示 / 试错次数递减 */
export const quizScore = (
  difficulty: Difficulty,
  question: QuizQuestion,
  hintsUsed: number,
  wrongAttempts: number,
) => Math.max(20, basePoints(difficulty, question) - hintsUsed * 20 - wrongAttempts * 14)

/** 提示只做「排除」：返回一个还没被排除、且不是答案的错误选项下标。没有可排除的返回 null */
export const hintCandidate = (
  question: QuizQuestion,
  eliminated: number[],
  picked: number | null,
): number | null => {
  const candidates = question.options
    .map((_, index) => index)
    .filter((index) => index !== question.answerIndex && !eliminated.includes(index))
  if (!candidates.length) return null
  // 优先排除玩家还没点过的错误选项，避免把已经证明是错的再排一次
  return candidates.find((index) => index !== picked) ?? candidates[0]
}

/* ============================================================
 * 连错渐进提示
 *
 * 起因：玩家连着答错时，只有一句「不对，再看看剩下几个选项」是完全不够的 ——
 * 四个选项往往都很像，没人知道该往哪个方向想。于是有三种处境越走越窄：
 *
 *   第 1 次错 → 给方向：本题属于哪个知识点、考的是哪一版的行为
 *   第 2 次错 → 排除一个：自动排掉一个**他还没点过**的错误选项
 *   第 3 次错 → 直接揭晓：此时继续让他撞墙没有意义，直接给答案 + 解析
 *
 * ── 零泄漏仍然成立 ──────────────────────────────────────
 * 三档提示都不透露「哪个选项是对的」：
 *  - 方向提示只说知识点和版本，而这些信息**未揭晓时就摆在题面和侧栏上**
 *    （quiz-topic 标签、版本基准卡），不是靠答错才解锁的新信息；
 *  - 排除动作与玩家手动点「排除一个」走同一个 hintCandidate，
 *    它在设计上就保证永不返回正确选项；
 *  - 揭晓只在玩家已经错了 3 次之后发生，此时这题早已进错题本，
 *    藏着答案对玩家没有任何收益。
 * ============================================================ */

/** 连错到什么程度触发哪一档救济 */
export type AssistLevel = 0 | 1 | 2 | 3

/** 连续答错次数 → 救济档位（0 次不触发，≥3 次封顶在「揭晓」） */
export const assistLevelFor = (wrongCount: number): AssistLevel => {
  if (wrongCount <= 0) return 0
  if (wrongCount === 1) return 1
  if (wrongCount === 2) return 2
  return 3
}

export const ASSIST_COPY: Record<AssistLevel, string> = {
  0: '',
  1: '给个方向',
  2: '帮你排掉一个',
  3: '直接揭晓',
}

/**
 * 第 1 次错时的方向提示。
 *
 * 刻意只引用**题面本来就有**的信息（知识点维度 + 机制引入/修复版本），
 * 不用 explanation —— 解析里通常直接写着答案，那等于借「提示」泄题。
 */
export const assistDirection = (question: QuizQuestion, facetKey: string): string => {
  const bits: string[] = [`这道题属于「${facetKey}」`]
  if (question.version.introduced) bits.push(`机制从 ${question.version.introduced} 开始才有`)
  if (question.version.fixed) bits.push(`${question.version.fixed} 修过它的行为`)
  if (question.tier === 'obscure') bits.push('这是冷门机制，答案往往和官方 bug 记录的行为有关')
  else if (question.level === 1) bits.push('这是基础题，回想教材级的常识即可')
  else bits.push('这是需要对比着查表的那种题，逐项核一遍')
  return `${bits.join('，')}。`
}

// ---------- 考试模式 ----------

/** 考试模式可选的题量档位 */
export const EXAM_LENGTHS = [10, 20, 30] as const

/**
 * 考试模式每题秒数：**按难度分档**。
 *
 * 之前是固定 30 秒，对极限难度不合理：冷门机制题、多跳加工链题的读题时间
 * 天然比「石头的硬度是多少」长。30 秒不够读完四个选项就被扣分，
 * 分数实际上在测阅读速度而不是掌握程度 —— 惩罚的是「会但慢」的人。
 * 现在入门 30 / 进阶 45 / 极限 60，三档都是整数秒且与题量档位正交
 * （10 题 × 60 秒 = 10 分钟，落在原来 20 题的档位区间内，不冲突）。
 */
export const EXAM_SECONDS: Record<Difficulty, number> = {
  explorer: 30,
  survival: 45,
  hardcore: 60,
}

/**
 * @deprecated 保留旧名作为兜底值（= 入门档）。
 * 新代码一律调 examSecondsFor(level)，别再用这个常量 ——
 * 固定值会让「按难度计时」这个特性在某个调用点悄悄失效。
 */
export const EXAM_SECONDS_PER_QUESTION = 30

/** 取某个难度下每题的秒数 */
export const examSecondsFor = (difficulty: Difficulty) => EXAM_SECONDS[difficulty] ?? 30

export type ExamLength = (typeof EXAM_LENGTHS)[number]

/**
 * 题量档位只决定「几道题」，总时长由难度 × 题量决定。
 *
 * `seconds` 字段保留是为了成绩单显示「限时」——它不再是配置项，
 * 而是按当前难度现算的。写成配置反而会出现「切了难度但总时长没变」的错觉。
 */
export const EXAM_PRESETS: Record<ExamLength, { length: ExamLength; label: string }> = {
  10: { length: 10, label: '10 题' },
  20: { length: 20, label: '20 题' },
  30: { length: 30, label: '30 题' },
}

export interface ExamAnswer {
  questionId: string
  topic: string
  prompt: string
  /** 该题四个选项（已打乱后的顺序），用于成绩单逐题回顾 */
  options: string[]
  picked: number | null
  answerIndex: number
  correct: boolean
  /** 用时（秒），用于成绩单里看「哪道题卡住了」 */
  seconds: number
  points: number
}

export interface ExamResult {
  answers: ExamAnswer[]
  correct: number
  wrong: number
  /** 超时未作答按错处理，单独计数方便区分「答错」和「没答」 */
  timeout: number
  score: number
  /** 正确率 0-100，四舍五入到整数 */
  accuracy: number
  totalSeconds: number
  bestStreak: number
  /** 评价等级：S / A / B / C / D */
  grade: string
}

/** 评级用的基准条目：只关心 tier，level 不参与计分 */
const BASE_MARK_REFERENCE = { tier: 'basic', level: 1 } as QuizQuestion

/**
 * 考试模式单题得分。
 *
 * 与练习模式的 quizScore 不同，考试不看提示和试错（考试里这两项都关闭），
 * 只按「答对时的基础分 × 剩余时间比例」给分 —— 越快答对拿越多，
 * 这样倒计时才真的有意义，而不是一个摆设。
 */
export const examPoints = (difficulty: Difficulty, question: QuizQuestion, secondsLeft: number) => {
  const base = basePoints(difficulty, question)
  // 剩余时间占比 0~1，最少给 40% 保底：答对但只剩 1 秒也不该和满血答对同分。
  // 分母用该难度的实际时限 —— 用固定 30 秒的话，极限难度（60 秒）里
  // 刚开局剩 59 秒就会被算成「时间几乎用光」，直接扣掉一大截分数。
  const timeFactor = 0.4 + 0.6 * Math.max(0, Math.min(1, secondsLeft / examSecondsFor(difficulty)))
  return Math.round(base * timeFactor)
}

export const buildExamResult = (
  answers: ExamAnswer[],
  totalSeconds: number,
  difficulty: Difficulty,
): ExamResult => {
  const correct = answers.filter((answer) => answer.correct).length
  const timeout = answers.filter((answer) => answer.picked === null).length
  const score = answers.reduce((sum, answer) => sum + answer.points, 0)
  const accuracy = answers.length ? Math.round((correct / answers.length) * 100) : 0
  // 连对：遇到错的就清零
  let streak = 0
  let bestStreak = 0
  for (const answer of answers) {
    if (answer.correct) {
      streak += 1
      bestStreak = Math.max(bestStreak, streak)
    } else {
      streak = 0
    }
  }
  // 满分基准：全对且全部秒答。难度越高满分越高，评级按相对满分算
  const fullMark = answers.length * basePoints(difficulty, BASE_MARK_REFERENCE)
  const ratio = fullMark ? score / fullMark : 0
  const grade = accuracy >= 95 && ratio >= 0.9 ? 'S'
    : accuracy >= 85 ? 'A'
      : accuracy >= 70 ? 'B'
        : accuracy >= 55 ? 'C' : 'D'
  return {
    answers,
    correct,
    wrong: answers.length - correct,
    timeout,
    score,
    accuracy,
    totalSeconds,
    bestStreak,
    grade,
  }
}

/** 秒 → mm:ss */
export const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds))
  const minute = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minute).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
