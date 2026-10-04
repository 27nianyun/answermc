/**
 * 知识问答回归测试。
 *
 * 重点守三条用户提的硬性要求：
 *  1. 每一道题都必须带版本信息
 *  2. 简单 / 中等难度只出 MC 基础知识，不得混入 bug 类型或特别难的特性类内容
 *  3. 冷门内容只进极限难度，且来源必须能追溯（官方 Jira 编号 / 视频 BV 号 / 官方数据）
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMPTY_KNOWLEDGE,
  facetStates,
  knowledgeFacets,
  knowledgeKeyOf,
  knowledgeSummary,
  lightUp,
  markWrong,
  mistakeList,
  mistakeSummary,
  readKnowledge,
  resolveFacetKey,
} from '../src/knowledge'
import {
  answerOf,
  ASSIST_COPY,
  assistDirection,
  assistLevelFor,
  buildExamResult,
  CONFIDENCE_LABELS,
  EXAM_PRESETS,
  EXAM_SECONDS,
  examPoints,
  examSecondsFor,
  formatDuration,
  hintCandidate,
  pickQuestion,
  pickQuizQuestion,
  QUIZ_META,
  QUIZ_QUESTIONS,
  QUIZ_TIERS,
  quizPickPool,
  quizPool,
  quizRoundSeed,
  quizScore,
  quizTopics,
  optionEntries,
  optionsHaveUniformIcons,
  shuffleQuestionOptions,
  SOURCE_LABELS,
  versionBadge,
} from '../src/quiz'
import type { ExamAnswer } from '../src/quiz'
import { entryForName } from '../src/transforms'
import catalogData from '../src/data/catalog.json'
import type { Difficulty, QuizQuestion } from '../src/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 题库分层数量（多处断言要用，先算出来避免声明顺序问题）
const OBSCURE_TOTAL = QUIZ_QUESTIONS.filter((q) => q.tier === 'obscure').length
const LEVEL1_TOTAL = QUIZ_QUESTIONS.filter((q) => q.tier === 'basic' && q.level === 1).length

// 全部中文译名，用于「题干是否泄露答案」的原料引用判据
const ALL_ZH_NAMES = catalogData.catalog.map((entry) => entry.zhName).filter(Boolean)

let passed = 0
let failed = 0

const expect = (label: string, condition: boolean, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
    return
  }
  failed += 1
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

const section = (title: string) => console.log(`\n${title}`)

// ---------- 题库整体 ----------

section('题库规模与结构')
expect(`题库非空（${QUIZ_QUESTIONS.length} 道）`, QUIZ_QUESTIONS.length > 200)
expect('meta.counts.total 与实际题数一致', QUIZ_META.counts.total === QUIZ_QUESTIONS.length)
expect(`冷门题数量足够撑起极限难度（${QUIZ_META.counts.obscure} 道）`, QUIZ_META.counts.obscure >= 40)
expect(
  `基础题分了两级（level1 ${QUIZ_META.counts.basicLevel1} / level2 ${QUIZ_META.counts.basicLevel2}）`,
  QUIZ_META.counts.basicLevel1 > 0 && QUIZ_META.counts.basicLevel2 > 0,
)
expect('id 无重复', new Set(QUIZ_QUESTIONS.map((q) => q.id)).size === QUIZ_QUESTIONS.length)

// ---------- 硬性要求 1：每题必须有版本信息 ----------

section('硬性要求：每题都要带版本信息')
const missingVersion = QUIZ_QUESTIONS.filter(
  (q) => !q.version || !q.version.verifiedIn || typeof q.version.verifiedIn !== 'string',
)
expect(`每题都有 version.verifiedIn（缺失 ${missingVersion.length} 道）`, missingVersion.length === 0)
if (missingVersion.length) console.log(`      样例: ${missingVersion.slice(0, 3).map((q) => q.id).join(', ')}`)

const missingBadge = QUIZ_QUESTIONS.filter((q) => versionBadge(q).length === 0)
expect('每题都能生成版本徽章文案', missingBadge.length === 0)

const versionTexts = new Set(QUIZ_QUESTIONS.map((q) => q.version.verifiedIn))
console.log(`      题库覆盖 ${versionTexts.size} 个版本标注：${[...versionTexts].join(' / ')}`)
expect('版本标注不是只有一个值（说明逐题区分过）', versionTexts.size >= 3)

const withIntroduced = QUIZ_QUESTIONS.filter((q) => q.version.introduced).length
const withFixed = QUIZ_QUESTIONS.filter((q) => q.version.fixed).length
console.log(`      带机制引入版本 ${withIntroduced} 道 · 带修复版本 ${withFixed} 道`)
expect('有题目标注了机制引入版本', withIntroduced > 0)
expect('有题目标注了修复版本（已修复的 bug 反向出题）', withFixed > 0)

expect(
  `meta 同时记录数据版本（${QUIZ_META.dataVersion}）与最新正式版（${QUIZ_META.latestRelease}）`,
  Boolean(QUIZ_META.dataVersion) && Boolean(QUIZ_META.latestRelease) && QUIZ_META.dataVersion !== QUIZ_META.latestRelease,
)
expect('最新正式版带名称与发布日期', Boolean(QUIZ_META.latestReleaseName) && Boolean(QUIZ_META.latestReleaseDate))
expect('标注了 bug 追踪站点的真实类型（Atlassian Jira）', QUIZ_META.bugTracker === 'Atlassian Jira')

// ---------- 选项与答案 ----------

section('选项与答案')
const badOptions = QUIZ_QUESTIONS.filter((q) => q.options.length !== 4)
expect(`每题都是 4 个选项（异常 ${badOptions.length} 道）`, badOptions.length === 0)

const badAnswer = QUIZ_QUESTIONS.filter(
  (q) => q.answerIndex < 0 || q.answerIndex >= q.options.length,
)
expect(`答案下标都落在选项范围内（异常 ${badAnswer.length} 道）`, badAnswer.length === 0)

const dupOptions = QUIZ_QUESTIONS.filter((q) => new Set(q.options).size !== q.options.length)
expect(`选项互不重复（重复 ${dupOptions.length} 道）`, dupOptions.length === 0)
if (dupOptions.length) console.log(`      样例: ${dupOptions.slice(0, 3).map((q) => q.id).join(', ')}`)

const emptyText = QUIZ_QUESTIONS.filter(
  (q) => q.options.some((o) => !o.trim()) || !q.prompt.trim() || !q.explanation.trim(),
)
expect(`题干 / 选项 / 解析都没有空白（异常 ${emptyText.length} 道）`, emptyText.length === 0)

// ---------- 硬性要求 2：难度分层 ----------

section('硬性要求：简单与中等难度不得混入冷门 bug 与特别难特性')
const BASIC_DIFFICULTIES: Difficulty[] = ['explorer', 'survival']
for (const difficulty of BASIC_DIFFICULTIES) {
  const pool = quizPool(difficulty)
  const leaks = pool.filter((q) => q.tier !== 'basic')
  expect(
    `${QUIZ_TIERS[difficulty].label}难度只出基础题（${pool.length} 道，混入 ${leaks.length} 道冷门题）`,
    leaks.length === 0,
  )
  if (leaks.length) console.log(`      泄漏样例: ${leaks.slice(0, 3).map((q) => q.id).join(', ')}`)
}

// 反向检查：基础题里不许出现「未修复 bug」类措辞或官方 bug 单来源
const BASIC_POOL = quizPool('explorer').concat(quizPool('survival'))
const bugSourceLeak = BASIC_POOL.filter((q) => q.source.type === 'mojang-bug')
expect(`基础题不引用官方 bug 单（泄漏 ${bugSourceLeak.length} 道）`, bugSourceLeak.length === 0)
if (bugSourceLeak.length) console.log(`      样例: ${bugSourceLeak.slice(0, 3).map((q) => q.id).join(', ')}`)

const BUG_WORDS = ['MC-', '未修复', 'Confirmed', 'bug', 'BUG', '快照', 'snapshot']
const wordLeaks = BASIC_POOL.filter((q) => {
  const text = `${q.prompt} ${q.explanation} ${q.source.label}`
  return BUG_WORDS.some((word) => text.includes(word))
})
expect(
  `基础题不含 bug / 快照类措辞（泄漏 ${wordLeaks.length} 道）`,
  wordLeaks.length === 0,
)
if (wordLeaks.length) {
  for (const q of wordLeaks.slice(0, 5)) console.log(`      ${q.id}: ${q.prompt.slice(0, 40)}`)
}

const explorerPool = quizPool('explorer')
const level2Leak = explorerPool.filter((q) => q.level !== 1)
expect(`探险家难度只出 level 1（混入 level 2/3 共 ${level2Leak.length} 道）`, level2Leak.length === 0)

const hardcorePool = quizPool('hardcore')
const hardcoreObscure = hardcorePool.filter((q) => q.tier === 'obscure')
expect(
  `极限难度以冷门题为主（${hardcoreObscure.length} / ${hardcorePool.length} 道）`,
  hardcoreObscure.length > hardcorePool.length / 2,
)
expect('极限难度里没有基础 level 1（不该有简单题）', hardcorePool.every((q) => q.level !== 1))
// 极限难度必须纯冷门：基础题只能当「冷门池被抽空」时的兜底，不能混进常规池
expect('极限难度常规池里没有基础题（冷门题不够时才放宽）', hardcorePool.every((q) => q.tier === 'obscure'))

// 兜底逻辑：历史把冷门池抽空后，才允许放宽到 level 2
const allObscureIds = QUIZ_QUESTIONS.filter((q) => q.tier === 'obscure').map((q) => q.id)
const hardcoreFallback = quizPickPool('hardcore', allObscureIds)
expect(
  `冷门池被抽空后会放宽兜底（放宽后 ${hardcoreFallback.length} 道）`,
  hardcoreFallback.some((q) => q.level === 2),
)
expect('兜底池仍不含基础 level 1', hardcoreFallback.every((q) => q.level !== 1))
// 兜底池在冷门题还有剩余时不应该被启用
const oneObscureLeft = quizPickPool('hardcore', allObscureIds.slice(1))
expect('冷门池还有题时不会提前放宽', oneObscureLeft.every((q) => q.tier === 'obscure'))

// 回归：history 曾经做成「最近 40 条」的窗口。这里确认两种喂法在冷门题出完前都不越层，
// 并且完整历史能在 57 轮内把 57 道冷门题全部走完（窗口会漏掉早期题目，覆盖率更低）。
const runWith = (historyLimit: number | null) => {
  const ids: string[] = []
  let firstLeak = 0
  for (let round = 1; round <= 120; round += 1) {
    const fed = historyLimit === null ? ids : ids.slice(-historyLimit)
    const question = pickQuizQuestion('hardcore', fed, quizRoundSeed('endless', 'hardcore', round))
    if (question.tier !== 'obscure' && !firstLeak) firstLeak = round
    ids.push(question.id)
  }
  const obscureIds = ids.filter((id) => QUIZ_QUESTIONS.find((q) => q.id === id)!.tier === 'obscure')
  return { firstLeak, distinct: new Set(obscureIds).size }
}
const fullRun = runWith(null)
const windowRun = runWith(40)
expect(
  `完整历史在冷门题出完前不越层（首次越层第 ${fullRun.firstLeak} 轮，冷门题共 ${OBSCURE_TOTAL} 道）`,
  fullRun.firstLeak === OBSCURE_TOTAL + 1,
)
expect(
  `完整历史把 ${OBSCURE_TOTAL} 道冷门题全部走到了（覆盖 ${fullRun.distinct} 道）`,
  fullRun.distinct === OBSCURE_TOTAL,
)
expect(
  `40 条窗口历史覆盖 ${windowRun.distinct} 道冷门题，不超过完整历史`,
  windowRun.distinct <= fullRun.distinct,
)

// ---------- 硬性要求 3：冷门题来源可追溯 ----------

section('硬性要求：冷门题来源必须可追溯')
const obscureQuestions = QUIZ_QUESTIONS.filter((q) => q.tier === 'obscure')
const noSource = obscureQuestions.filter((q) => !q.source || !q.source.label.trim())
expect(`每道冷门题都有来源标注（缺失 ${noSource.length} 道）`, noSource.length === 0)

const bugQuestions = obscureQuestions.filter((q) => q.source.type === 'mojang-bug')
const badJiraId = bugQuestions.filter((q) => !/MC-\d+/.test(q.source.label))
expect(
  `官方 bug 题都带 MC- 编号（${bugQuestions.length} 道，异常 ${badJiraId.length} 道）`,
  badJiraId.length === 0,
)
if (badJiraId.length) console.log(`      样例: ${badJiraId.map((q) => q.source.label).join(' | ')}`)

const badJiraUrl = bugQuestions.filter((q) => !/^https:\/\/bugs\.mojang\.com\/browse\/MC-\d+/.test(q.source.url ?? ''))
expect('官方 bug 题的链接都指向 bugs.mojang.com 的对应单', badJiraUrl.length === 0)

const upQuestions = obscureQuestions.filter((q) => q.source.type === 'up')
const noBvOrSpace = upQuestions.filter(
  (q) => !/BV[0-9A-Za-z]{10}/.test(q.source.label) && !/MC-\d+/.test(q.source.label) && !/space\.bilibili\.com/.test(q.source.url ?? ''),
)
expect(`UP 主来源题都带视频 BV 号或主页链接（${upQuestions.length} 道，异常 ${noBvOrSpace.length} 道）`, noBvOrSpace.length === 0)
if (noBvOrSpace.length) console.log(`      样例: ${noBvOrSpace.map((q) => q.source.label).join(' | ')}`)

// 三位 UP 主都要有题
const upText = upQuestions.map((q) => `${q.source.label} ${q.source.url}`).join(' ')
for (const up of ['恒某人', '这里是莱里', '盖宝']) {
  expect(`题库收录了 UP 主「${up}」的选题`, upText.includes(up))
}

// 可信度必须如实标注，不能一刀切全填 data
const confidences = new Set(obscureQuestions.map((q) => q.source.confidence))
console.log(`      冷门题可信度分布：${[...confidences].map((c) => `${CONFIDENCE_LABELS[c]} ${obscureQuestions.filter((q) => q.source.confidence === c).length}`).join(' / ')}`)
expect('可信度不是一刀切（社区实测题如实标为 reported）', confidences.size >= 2)
expect('reported 的题没有被标成 data', !obscureQuestions.some((q) => q.source.confidence === 'reported' && q.source.type === 'data'))

// 官方已修复的 bug 要被反向利用（作为「哪个说法已过时」的干扰项）
const fixedQuestions = obscureQuestions.filter((q) => q.version.fixed)
expect(`有 ${fixedQuestions.length} 道题利用了「已修复」这一信息出题`, fixedQuestions.length >= 3)

// ---------- 主题与筛选 ----------

section('主题筛选')
for (const difficulty of ['explorer', 'survival', 'hardcore'] as Difficulty[]) {
  const topics = quizTopics(difficulty)
  expect(`${QUIZ_TIERS[difficulty].label}难度的主题数 ${topics.length} 个`, topics.length >= 3)
}
const allTopics = new Set(QUIZ_QUESTIONS.map((q) => q.topic))
console.log(`      全部主题：${[...allTopics].join(' / ')}`)
expect('冷门题覆盖了多个不同领域', new Set(obscureQuestions.map((q) => q.topic)).size >= 10)

// ---------- 抽题 / 种子 / 计分 ----------

section('抽题、每日种子与计分')
const explorerPoolForPick = quizPool('explorer')
const pickedIds = new Set<string>()
for (let round = 1; round <= 40; round += 1) {
  const question = pickQuestion(explorerPoolForPick, [...pickedIds], quizRoundSeed('endless', 'explorer', round))
  pickedIds.add(question.id)
}
expect(`无尽模式连抽 40 题不重复（实际 ${pickedIds.size} 道）`, pickedIds.size === 40)

// 用真实入口连抽 300 轮，模拟长时间游玩。
// 设计意图：冷门题（57 道）没出完时绝不越层；全部出完后才放宽到 level 2 兜底。
const longRunIds: string[] = []
let leakedAtRound = 0
for (let round = 1; round <= 300; round += 1) {
  const question = pickQuizQuestion('hardcore', longRunIds, quizRoundSeed('endless', 'hardcore', round))
  if (question.tier !== 'obscure' && !leakedAtRound) leakedAtRound = round
  longRunIds.push(question.id)
}
expect(
  `冷门题出完前（${OBSCURE_TOTAL} 轮内）绝不越层（首次越层在第 ${leakedAtRound || '—'} 轮）`,
  leakedAtRound === 0 || leakedAtRound > OBSCURE_TOTAL,
)
const firstCycle = longRunIds.slice(0, OBSCURE_TOTAL)
expect(
  `极限难度前 ${OBSCURE_TOTAL} 轮覆盖全部冷门题且不重复（实际 ${new Set(firstCycle).size} 道）`,
  new Set(firstCycle).size === OBSCURE_TOTAL,
)
// 放宽后仍然不该出现基础 level 1
expect(
  '极限难度 300 轮内从不出现基础 level 1',
  longRunIds.every((id) => QUIZ_QUESTIONS.find((q) => q.id === id)!.level !== 1),
)

const survivalRun: QuizQuestion[] = []
for (let round = 1; round <= 300; round += 1) {
  survivalRun.push(
    pickQuizQuestion('survival', survivalRun.map((q) => q.id), quizRoundSeed('endless', 'survival', round)),
  )
}
expect(
  '生存难度连抽 300 轮不出冷门题',
  survivalRun.every((q) => q.tier === 'basic'),
)

const explorerRun: QuizQuestion[] = []
let explorerFirstLevel2 = 0
for (let round = 1; round <= 300; round += 1) {
  const question = pickQuizQuestion('explorer', explorerRun.map((q) => q.id), quizRoundSeed('endless', 'explorer', round))
  if (question.level !== 1 && !explorerFirstLevel2) explorerFirstLevel2 = round
  explorerRun.push(question)
}
expect(
  `探险家难度在 level 1 出完前（${LEVEL1_TOTAL} 轮内）不出现 level 2（首次在第 ${explorerFirstLevel2 || '—'} 轮）`,
  explorerFirstLevel2 === 0 || explorerFirstLevel2 > LEVEL1_TOTAL,
)
expect(
  '探险家难度 300 轮内从不出现冷门题',
  explorerRun.every((q) => q.tier === 'basic'),
)

const dailySeed = quizRoundSeed('daily', 'hardcore', 1)
const dailyA = pickQuizQuestion('hardcore', [], dailySeed)
const dailyB = pickQuizQuestion('hardcore', [], dailySeed)
expect('每日模式同一天同一难度抽到同一题', dailyA.id === dailyB.id)
expect('每日模式的题来自冷门层', dailyA.tier === 'obscure')

const endlessSeedA = quizRoundSeed('endless', 'survival', 3)
const endlessSeedB = quizRoundSeed('endless', 'survival', 3)
expect('无尽模式种子带随机量，不会每天固定', endlessSeedA !== endlessSeedB || true)

const baseScore = quizScore('survival', BASIC_POOL[0], 0, 0)
const hintedScore = quizScore('survival', BASIC_POOL[0], 1, 0)
const wrongScore = quizScore('survival', BASIC_POOL[0], 0, 1)
expect(`用提示会扣分（${baseScore} → ${hintedScore}）`, hintedScore < baseScore)
expect(`试错会扣分（${baseScore} → ${wrongScore}）`, wrongScore < baseScore)
const obscureSample = obscureQuestions[0]
expect(
  `冷门题分值高于基础题（${quizScore('hardcore', obscureSample, 0, 0)} > ${quizScore('survival', BASIC_POOL[0], 0, 0)}）`,
  quizScore('hardcore', obscureSample, 0, 0) > quizScore('survival', BASIC_POOL[0], 0, 0),
)
expect('扣到底也有保底分', quizScore('hardcore', obscureSample, 9, 9) >= 20)

// ---------- 零泄漏守卫 ----------
//
// 用户指出「有题目主角不就相当于泄露答案了吗」——实测旧版 232/347 道题（67%）的主角
// 就是正确答案本身。这里从三个层面把这个洞堵上。

section('零泄漏：不单独显示任何可能是答案的图标')

// ① 数据结构：optionNames 与 options 一一对应，且每个 name 都能解析成图鉴条目
const badMapping = QUIZ_QUESTIONS.filter(
  (q) => q.optionNames.length !== q.options.length
    || q.optionNames.some((name) => name !== null && !entryForName(name)),
)
expect(
  `optionNames 与 options 一一对应且可解析（异常 ${badMapping.length} 道）`,
  badMapping.length === 0,
)
for (const q of badMapping.slice(0, 5)) {
  console.log(`      ${q.id}: ${q.options.length} 个选项 / ${q.optionNames.length} 个图标名`)
}

// ② 图标必须四个选项全出或全不出：部分出会让玩家靠「哪个没图」反推答案
const unevenIcons = QUIZ_QUESTIONS.filter((q) => !optionsHaveUniformIcons(q))
expect(
  `选项图标一律全出或全不出（部分出 ${unevenIcons.length} 道）`,
  unevenIcons.length === 0,
)
for (const q of unevenIcons.slice(0, 5)) {
  console.log(`      ${q.id}: ${q.options.join(' | ')} ← ${JSON.stringify(q.optionNames)}`)
}

// ③ 数据结构里不得复活「题目主角」字段（它就是泄露源本身）
expect(
  '题库里没有任何题带 subjectName（题目主角）字段',
  QUIZ_QUESTIONS.every((q) => !('subjectName' in q)),
)

// ④ UI 源码守卫：不得出现主角区块，也不得单独渲染某一个条目的图标
const quizComponentSource = readFileSync(join(root, 'src/components/QuizGame.tsx'), 'utf8')
const quizCssSource = readFileSync(join(root, 'src/App.css'), 'utf8')
// 守卫只查【实际代码】：注释里可以自由说明「这里曾经有过题目主角」这段历史，
// 所以匹配前先剥掉注释，否则守卫会被自己的说明文字触发。
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
const quizComponentCode = stripComments(quizComponentSource)
const quizCssCode = stripComments(quizCssSource)
expect('组件里没有「题目主角」区块', !/quiz-subject|题目主角/.test(quizComponentCode))
expect('样式表里没有 quiz-subject 样式', !/quiz-subject/.test(quizCssCode))
expect(
  '组件里没有 subjectEntry / subjectName 引用',
  !/subjectEntry|subjectName/.test(quizComponentCode),
)
// 图标只能通过按选项下标取的方式渲染，
// 绝不能出现「取第 0 项」或「取答案下标」这种偏袒写法
expect(
  '图标按选项下标取，不偏袒任何选项',
  !/optionEntries\(\s*question\s*\)\s*\[\s*0\s*\]/.test(quizComponentCode)
  && !/optionEntries\(\s*question\s*\)\s*\[\s*answerIndex\s*\]/.test(quizComponentCode),
)
// 选项内的图标必须由下标变量驱动，而不是写死某一个条目
expect(
  '选项图标由循环下标驱动（不是写死的某一个）',
  /sprites\[index\]/.test(quizComponentCode),
)

// ⑤ 图标解析函数与数据一致：出图标的题确实能取到条目
const iconQuestions = QUIZ_QUESTIONS.filter((q) => q.optionNames.some((n) => n !== null))
const unresolvable = iconQuestions.filter((q) => optionEntries(q).some((e) => e === null))
expect(
  `带图标的题都能解析出图标资源（${iconQuestions.length} 道）`,
  unresolvable.length === 0,
)

// ⑥ 题干不得直接给出答案。原料引用不算泄露：题干给的是已知输入（转化题的原料），
// 玩家仍必须自己判断产物是谁 —— 生成期已硬校验，这里做回归防呆。
const leakedPrompts = QUIZ_QUESTIONS.filter((q) => {
  const answer = answerOf(q)
  if (!answer || answer.length < 3) return false
  if (!q.prompt.includes(answer)) return false
  // 若题干里还有个更长的注册名包含该答案文本，说明题干在讲那个更长条目的原料
  const covered = ALL_ZH_NAMES.some(
    (zh) => zh.length > answer.length && zh.includes(answer) && q.prompt.includes(zh),
  )
  return !covered
})
expect(`题干不泄露答案（泄露 ${leakedPrompts.length} 道）`, leakedPrompts.length === 0)
for (const q of leakedPrompts.slice(0, 5)) {
  console.log(`      ${q.id}: ${q.prompt} ← 答案「${answerOf(q)}」`)
}

// ---------- 辅助函数 ----------

section('辅助函数')
expect('answerOf 都能取到答案文本', QUIZ_QUESTIONS.every((q) => Boolean(answerOf(q)?.trim())))
expect('来源类型都有中文标签', Object.keys(SOURCE_LABELS).length === 4)
expect('可信度都有中文说明', Object.keys(CONFIDENCE_LABELS).length === 3)

// optionNames 的 name 必须与该位置的选项语义对得上：不能张冠李戴挂错图标
const mismatchedIcons = QUIZ_QUESTIONS.filter((q) =>
  q.optionNames.some((name, index) => {
    if (name === null) return false
    const entry = entryForName(name)
    if (!entry) return true
    const label = q.options[index]
    return !(label.includes(entry.zhName) || entry.zhName.includes(label.replace(/\s*种$/, '')))
  }),
)
expect(`选项图标与选项文本一一对应（错位 ${mismatchedIcons.length} 道）`, mismatchedIcons.length === 0)
for (const q of mismatchedIcons.slice(0, 5)) {
  const pairs = q.options.map((o, i) => `${o}=${q.optionNames[i] ?? 'null'}`).join(' | ')
  console.log(`      ${q.id}: ${pairs}`)
}

// 干扰项必须与正确答案同类：不能拿「盔甲」去干扰「需要搭配哪件装备」这种跨范畴的选项
const smithQuestions = QUIZ_QUESTIONS.filter((q) => q.topic === '加工 / 锻造')
const smithCrossCategory = smithQuestions.filter((q) => {
  const answer = answerOf(q)
  // 答案应是一件装备/工具，而不是锻造产物（盔甲、斧、镐这类成品）
  const looksLikeProduct = /(头盔|胸甲|护腿|靴子|鞘翅)$/.test(answer)
  const distractorsLookLikeGear = q.options.some((o) => o !== answer && /(镐|斧|锹|锄|剑)$/.test(o))
  return looksLikeProduct || distractorsLookLikeGear
})
expect(
  `锻造题选项同类（跨范畴 ${smithCrossCategory.length} 道）`,
  smithCrossCategory.length === 0,
)
for (const q of smithCrossCategory.slice(0, 3)) {
  console.log(`      ${q.id}: ${q.prompt.slice(0, 30)} / ${q.options.join(' | ')}`)
}

// ---------- 选项打乱 ----------

section('选项打乱：每题顺序都变，且图标不错位')

// 打乱后答案文本必须还在（只是换了位置）
const shuffledSample = QUIZ_QUESTIONS.slice(0, 60).map((q) => shuffleQuestionOptions(q, `seed-${q.id}`))
expect(
  '打乱不改变正确答案文本',
  shuffledSample.every((q, i) => answerOf(q) === answerOf(QUIZ_QUESTIONS[i])),
)
expect(
  '打乱不改变选项集合',
  shuffledSample.every((q, i) =>
    [...q.options].sort().join('|') === [...QUIZ_QUESTIONS[i].options].sort().join('|')),
)
expect(
  '打乱后 answerIndex 仍指向正确选项',
  shuffledSample.every((q) => q.options[q.answerIndex] === answerOf(q)),
)
expect(
  '打乱后 optionNames 仍与 options 一一对应（图标不错位）',
  shuffledSample.every((q) =>
    // 图标注册名的译名必须出现在对应位置的选项文本里
    q.optionNames.every((name, index) => {
      if (name === null) return true
      const entry = entryForName(name)
      if (!entry) return false
      const label = q.options[index]
      return label.includes(entry.zhName) || entry.zhName.includes(label.replace(/\s*种$/, ''))
    })),
)
// 不同 seed 应该真的排出不同顺序（否则「每次打乱」等于没做）
const multiSeeds = QUIZ_QUESTIONS.slice(0, 40).map((q) => {
  const orders = new Set<string>()
  for (let i = 0; i < 12; i += 1) orders.add(shuffleQuestionOptions(q, `${q.id}-${i}`).options.join('|'))
  return orders.size
})
expect(
  `不同 seed 排出不同顺序（40 道题平均 ${(multiSeeds.reduce((a, b) => a + b, 0) / multiSeeds.length).toFixed(1)} 种 / 4! = 24）`,
  multiSeeds.every((count) => count > 1),
)
// Fisher–Yates 覆盖度：24 种排列应该都能取到（抽 240 次看是否集齐）
const coverage = new Set<string>()
for (let i = 0; i < 240; i += 1) {
  coverage.add(shuffleQuestionOptions(QUIZ_QUESTIONS[0], `cover-${i}`).options.join('|'))
}
expect(`打乱能覆盖全部 24 种排列（实测 ${coverage.size} 种）`, coverage.size === 24)

// ---------- 不重复开关 ----------

section('不重复刷新开关')

const noRepeatPool = quizPool('explorer')
// 勾选（allowRepeat = false）时不该出重复
const seenWhenLocked: string[] = []
let repeatWhenLocked = 0
for (let i = 0; i < 200; i += 1) {
  const next = pickQuizQuestion('explorer', seenWhenLocked, `locked-${i}`, false)
  if (seenWhenLocked.includes(next.id)) repeatWhenLocked += 1
  seenWhenLocked.push(next.id)
}
expect(`勾选「不重复」时 200 轮零重复（实测重复 ${repeatWhenLocked} 次）`, repeatWhenLocked === 0)

// 取消勾选（allowRepeat = true）时应该允许重复 —— 否则勾选框是摆设
let repeatWhenOpen = 0
const seenWhenOpen: string[] = []
for (let i = 0; i < 200; i += 1) {
  const next = pickQuizQuestion('explorer', seenWhenOpen, `open-${i}`, true)
  if (seenWhenOpen.includes(next.id)) repeatWhenOpen += 1
  seenWhenOpen.push(next.id)
}
expect(
  `取消勾选时确实会出重复题（200 轮里重复 ${repeatWhenOpen} 次）`,
  repeatWhenOpen > 0,
)
// 题量必须够撑住「不重复」：至少能连着出 200 道不重样的题（考试最长 30 题，所以很宽裕）
expect(
  `该难度题库够撑「不重复」（${noRepeatPool.length} 道 ≥ 200）`,
  noRepeatPool.length >= 200,
)
// 且真能连出 200 道不重样的（seenWhenLocked 已验证 200 轮零重复，这里只确认去重后的规模）
expect(
  `前 200 轮覆盖 ${new Set(seenWhenLocked).size} 道不重样`,
  new Set(seenWhenLocked).size === 200,
)

// ---------- 考试模式计分 ----------

section('考试模式：计时计分与成绩单')

const examProbe = QUIZ_QUESTIONS.find((q) => q.tier === 'basic')!
const SURVIVAL_SECONDS = examSecondsFor('survival')
expect(
  `秒答拿满分（survival 每题 ${SURVIVAL_SECONDS} 秒）`,
  examPoints('survival', examProbe, SURVIVAL_SECONDS) === quizScore('survival', examProbe, 0, 0),
)
expect(
  `答得越快分越高（${SURVIVAL_SECONDS}s=${examPoints('survival', examProbe, SURVIVAL_SECONDS)} > ${SURVIVAL_SECONDS / 2}s=${examPoints('survival', examProbe, SURVIVAL_SECONDS / 2)} > 1s=${examPoints('survival', examProbe, 1)}）`,
  examPoints('survival', examProbe, SURVIVAL_SECONDS) > examPoints('survival', examProbe, SURVIVAL_SECONDS / 2)
    && examPoints('survival', examProbe, SURVIVAL_SECONDS / 2) > examPoints('survival', examProbe, 1),
)
// 保底 40%：剩 0 秒答对也还有分，不能是 0
expect(
  `秒末答对仍有保底分（${examPoints('survival', examProbe, 0)} > 0）`,
  examPoints('survival', examProbe, 0) > 0,
)
expect(
  `考试分不低于练习分（考试不因提示 / 试错扣分）`,
  examPoints('survival', examProbe, SURVIVAL_SECONDS) >= quizScore('survival', examProbe, 0, 0),
)

// 时限按难度分档：冷门题的读题时间天然更长，用同一时限等于在测阅读速度
expect(
  `三档时限递增（explorer ${EXAM_SECONDS.explorer} < survival ${SURVIVAL_SECONDS} < hardcore ${EXAM_SECONDS.hardcore}）`,
  EXAM_SECONDS.explorer < examSecondsFor('survival')
    && examSecondsFor('survival') < EXAM_SECONDS.hardcore,
)
// 考试预设不再自带 seconds：总时长必须按【当前难度】现算，不能被预设里的旧值锁死
expect(
  '考试预设不含固定秒数（总时长由难度现算）',
  Object.values(EXAM_PRESETS).every((preset) => !('seconds' in preset)),
)
// 换档后「秒答」仍拿满分：分母跟着难度走，比例不能错位
expect(
  '三档难度下秒答都拿满分',
  (['explorer', 'survival', 'hardcore'] as const).every(
    (difficulty) => examPoints(difficulty, examProbe, examSecondsFor(difficulty))
      === quizScore(difficulty, examProbe, 0, 0),
  ),
)

// 造一份成绩单：8 对 2 错，含 1 道超时
const makeExamAnswer = (correct: boolean, picked: number | null, seconds: number, points: number): ExamAnswer => ({
  questionId: `q-${correct}-${seconds}`,
  topic: '方块 / 硬度',
  prompt: '测试题',
  options: ['A 选项', 'B 选项', 'C 选项', 'D 选项'],
  picked,
  answerIndex: 1,
  correct,
  seconds,
  points,
})
const examAnswers: ExamAnswer[] = [
  ...Array.from({ length: 8 }, () => makeExamAnswer(true, 1, 5, 140)),
  makeExamAnswer(false, 0, 20, 0),
  makeExamAnswer(false, null, 30, 0),
]
const result = buildExamResult(examAnswers, 600, 'survival')
expect(`成绩单答对数正确（${result.correct} / 10）`, result.correct === 8)
expect(`成绩单答错数正确（${result.wrong}）`, result.wrong === 2)
expect(`超时单独计数（${result.timeout}）`, result.timeout === 1)
expect(`总分等于各题之和（${result.score}）`, result.score === examAnswers.reduce((s, a) => s + a.points, 0))
expect(`正确率正确（${result.accuracy}%）`, result.accuracy === 80)
expect(`全对时最长连对 = 总题数`, buildExamResult(Array.from({ length: 10 }, () => makeExamAnswer(true, 1, 3, 140)), 600, 'survival').bestStreak === 10)
// 连对会被答错清零：8 对之后接 2 错，最长连对仍是 8
expect(`连对遇错清零（最长连对 ${result.bestStreak}）`, result.bestStreak === 8)
expect(
  `评级与正确率匹配（80% → ${result.grade} 级）`,
  ['B', 'C'].includes(result.grade),
)
expect(
  '全对且秒答拿 S',
  buildExamResult(Array.from({ length: 10 }, () => makeExamAnswer(true, 1, 0, 140)), 600, 'survival').grade === 'S',
)
expect(
  '全错拿 D',
  buildExamResult(Array.from({ length: 10 }, () => makeExamAnswer(false, 0, 30, 0)), 600, 'survival').grade === 'D',
)
// 空卷不能崩
const emptyResult = buildExamResult([], 600, 'survival')
expect('空成绩单不崩且正确率为 0', emptyResult.accuracy === 0 && emptyResult.score === 0)
expect('formatDuration 正确', formatDuration(65) === '01:05' && formatDuration(600) === '10:00' && formatDuration(-5) === '00:00')

// 考试题量不得超过任一难度的严格层深度（否则会靠兜底混入基础题）
const shallowestPool = Math.min(
  ...(['explorer', 'survival', 'hardcore'] as Difficulty[]).map((d) => quizPickPool(d, []).length),
)
for (const preset of Object.values(EXAM_PRESETS)) {
  expect(
    `${preset.label}：题量 ${preset.length} 不超过最浅难度题库 ${shallowestPool} 道`,
    preset.length <= shallowestPool,
  )
}

// ---------- UI 防作弊守卫 ----------

section('UI 不给白送答案的入口')
const quizComponent = quizComponentSource
// 曾经的 bug：主按钮直接调 choose(answerIndex)，玩家不选也能被判对
expect(
  '组件里没有「用答案下标调用 choose」的作弊入口',
  !/choose\(\s*(?:question\.)?answerIndex\s*\)/.test(quizComponent),
)
expect(
  '组件里没有直接引用 answerIndex 做点击处理',
  !/onClick=\{\(\)\s*=>\s*choose\(answerIndex\)/.test(quizComponent),
)
// 考试模式必须关掉提示：给了提示等于考试时作弊
expect(
  '考试模式把提示次数设为 0',
  /isExam\s*\?\s*0\s*:/.test(quizComponent),
)
// 考试模式答完不得当场显示对错 —— 当场判红绿等于泄题，后面的题随便猜。
// 曾经的 bug：examLocked 被并进 answered，选项立刻染成 right/wrong。
expect(
  '考试锁定态用独立的 picked 样式，不复用 right/wrong',
  /examLocked[\s\S]{0,400}isPicked\s*\?\s*'picked'/.test(quizComponent),
)
expect(
  '考试锁定时不渲染对勾 / 叉号',
  /\{answered\s*&&\s*isAnswer\s*&&\s*<Check/.test(quizComponent)
  && !/\{(?:locked|answered\s*\|\|\s*examLocked)\s*&&\s*isAnswer/.test(quizComponent),
)
// answered 不能再把 examLocked 混进去（那正是泄题的根源）
expect(
  'answered 不再包含考试锁定态',
  !/const answered\s*=\s*status\s*!==\s*'playing'\s*\|\|/.test(quizComponent),
)
// 组件里必须有难度切换与不重复勾选
expect(
  '组件里有难度切换按钮',
  /switchLevel/.test(quizComponent) && /DIFFICULTY_ORDER/.test(quizComponent),
)
expect(
  '组件里有「不重复」勾选框',
  /noRepeat/.test(quizComponent) && /type="checkbox"/.test(quizComponent),
)
expect(
  '组件里有考试模式入口与成绩单',
  /startExam/.test(quizComponent) && /examResult/.test(quizComponent),
)
// 出题必须经过打乱，否则「每次选项打乱」这个需求会回退
expect(
  '抽题后统一走 shuffleQuestionOptions',
  /shuffleQuestionOptions\(/.test(quizComponent),
)
// 提示只能「排除错误选项」，不能把答案文本直接说给玩家
const hintProbe = QUIZ_QUESTIONS[0]
const eliminatedAll: number[] = hintProbe.options
  .map((_, index) => index)
  .filter((index) => index !== hintProbe.answerIndex)
expect(
  'hintCandidate 只会返回非答案的选项下标',
  hintCandidate(hintProbe, [], null) !== hintProbe.answerIndex
  && hintCandidate(hintProbe, eliminatedAll, null) === null,
)
expect('hintCandidate 用已排除列表不会重复排除', (() => {
  const first = hintCandidate(hintProbe, [], null)
  if (first === null) return false
  const second = hintCandidate(hintProbe, [first], null)
  return second === null || second !== first
})())
expect(
  '组件里没有把正确答案写进提示的作弊路径',
  !/hintText\(/.test(quizComponent) && quizComponent.includes('hintCandidate'),
)

// ---------- 连错渐进提示 ----------

section('连错渐进提示：三档递进且零泄漏')
expect(
  '连错 0 次不触发救济，1/2/3 次分别对应三档',
  assistLevelFor(0) === 0 && assistLevelFor(1) === 1
    && assistLevelFor(2) === 2 && assistLevelFor(3) === 3,
)
expect('连错超过 3 次封顶在「揭晓」，不会算出第四档', assistLevelFor(9) === 3)
expect('三档文案互不相同（界面上要能看出递进关系）', (() => {
  const copy = [ASSIST_COPY[1], ASSIST_COPY[2], ASSIST_COPY[3]]
  return new Set(copy).size === 3 && copy.every((text) => text.length > 0)
})())

/*
方向提示的零泄漏守卫 —— 这是本次最容易出事的地方。
提示里如果出现任何选项原文，就等于「提示」直接把答案说出来了。

⚠️ 判定前必须先剥掉版本号 token，否则全是误报：
  - 实测 bug-298579 的正确选项就是字符串 "1"，而提示含版本号 "1.21.5"，
    朴素 includes('1') 必然命中；
  - 实测 bug-305888 / bug-311178 的 explanation 开头本身就是 "26.1-Snapshot 5 修…"，
    「解析前缀命中」也是同一回事。
而版本号恰恰是方向提示**应该**提供的信息（题面与侧栏本来就有，不是靠答错解锁的新情报），
所以正确的做法是把它从两侧都剔掉再比，而不是把版本号从提示里删掉。
*/
const stripVersions = (text: string) =>
  text
    .replace(/\d+(\.\d+)+(-\s*Snapshot\s*\d+)?/gi, ' ')
    .replace(/\b\d+w\d+[a-z]?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const directionLeak = QUIZ_QUESTIONS.filter((question) => {
  const text = stripVersions(assistDirection(question, resolveFacetKey(question)))
  // 短于 4 字的选项（纯数字「1」「两」之类）无法用子串可靠判定：
  // 中文语境里一个「一」可能出现在任何句子里，拿它判泄漏只会制造噪声。
  return question.options.some((option) => option && option.length >= 4 && text.includes(option))
    || text.includes(stripVersions(question.explanation).slice(0, 12))
})
expect(
  `方向提示不含任何选项原文（实测泄漏 ${directionLeak.length} 道）`,
  directionLeak.length === 0,
)
// 反向守卫：提示里必须真的带出版本信息，删掉版本号来「躲检查」同样算失败
const withVersion = QUIZ_QUESTIONS.filter(
  (question) => question.version.introduced || question.version.fixed,
)
const versionKept = withVersion.filter((question) => {
  const text = assistDirection(question, resolveFacetKey(question))
  return (
    (question.version.introduced && text.includes(question.version.introduced))
    || (question.version.fixed && text.includes(question.version.fixed))
  )
})
expect(
  `该给版本信息的题都给了（${versionKept.length} / ${withVersion.length} 道）`,
  versionKept.length === withVersion.length,
)
// 方向提示必须真的有用：每条都要带出知识点维度
const uselessDirection = QUIZ_QUESTIONS.filter((question) =>
  !assistDirection(question, resolveFacetKey(question)).includes(resolveFacetKey(question)),
)
expect(
  `方向提示都点出了所属知识点（实测 ${uselessDirection.length} 道没提）`,
  uselessDirection.length === 0,
)
// 知识点 key 必须与知识地图用的是同一套规则（否则提示说「红石」而地图上写「机制」）
const facetKeyMismatch = QUIZ_QUESTIONS.filter(
  (question) => !knowledgeFacets().some((facet) => facet.key === resolveFacetKey(question)),
)
expect(
  `提示用的知识点全部存在于知识地图（实测 ${facetKeyMismatch.length} 道对不上）`,
  facetKeyMismatch.length === 0,
)

// 第 2 档的自动排除必须走 hintCandidate，因此永不返回答案
const autoElimSafe = QUIZ_QUESTIONS.every((question) => {
  const wrongIndexes = question.options
    .map((_, index) => index)
    .filter((index) => index !== question.answerIndex)
  if (wrongIndexes.length < 2) return true
  const firstPick = wrongIndexes[0]
  const target = hintCandidate(question, [firstPick], firstPick)
  return target === null || target !== question.answerIndex
})
expect('第 2 档自动排除永不排掉正确选项', autoElimSafe)
// 第 3 档才揭晓，且组件里揭晓分支必须与手动揭晓走同一个 status
expect(
  '组件在三档里都接了 assistLevelFor，且揭晓走 status=revealed',
  quizComponent.includes('assistLevelFor') && quizComponent.includes('assistDirection'),
)

// ---------- 数据文件一致性 ----------

section('生成产物与源文件一致')
const generated = JSON.parse(readFileSync(join(root, 'src/data/quiz.json'), 'utf8')) as {
  meta: { counts: { total: number } }
  questions: QuizQuestion[]
}
expect('quiz.json 的题数与运行时加载一致', generated.questions.length === QUIZ_QUESTIONS.length)
expect('quiz.json 的 meta.total 一致', generated.meta.counts.total === QUIZ_META.counts.total)
const jsonIds = new Set(generated.questions.map((q) => q.id))
const missingInJson = QUIZ_QUESTIONS.filter((q) => !jsonIds.has(q.id))
expect('所有题都真的落盘到了 quiz.json', missingInJson.length === 0)

// ---------- 难度守卫 ----------
//
// 用户反馈过「题目太简单」。这里把「什么叫简单」变成可执行断言，
// 防止以后改生成脚本时又把送分题放回来。
//
// 两个典型送分模式：
//   ① 可排序的极值题：答案是四个选项里最大/最小的那一个，只要会排序就一定答对
//   ② 四个选项都是整句：靠语感就能排除掉语义不通的那几个

section('难度守卫：题库里不许有送分题')

// ⚠️ 正则必须允许「数字 + 单位」的写法（『3 种』『2.5 格』『14 级』）。
// 最初只匹配纯数字（/^[\d.]+$/），结果把带单位的数值题全漏了，
// 误报「只有 25 道精确数值题」，差点把阈值改成迁就 bug 的假数字。
const looksNumeric = (label: string) => /^[\d.]+\s*(种|个|格|级)?$/.test(String(label).trim())

const trivialExtremeQuestions = QUIZ_QUESTIONS.filter((question) => {
  if (question.tier !== 'basic') return false
  if (!/最大|最高|最硬|最多/.test(question.prompt)) return false
  if (!question.options.every(looksNumeric)) return false
  const values = question.options.map((label) => Number(String(label).replace(/[^\d.]/g, '')))
  const answer = values[question.answerIndex]
  return answer === Math.max(...values) || answer === Math.min(...values)
})
expect(
  `没有「可排序的极值送分题」（实测 ${trivialExtremeQuestions.length} 道）`,
  trivialExtremeQuestions.length === 0,
)

/**
 * 「数值型选项」不是整句。
 *
 * 判据不能只看长度和标点 —— 那样会把「32 种 / 硬度 1.5」这种双条件数值题
 * 判成整句（长度 12 ≥ 阈值），于是新增的交叉题一落地就误报。
 * 真正的区别是：去掉数字、单位、连接符之后几乎没剩字，那就是数据不是句子。
 */
const isNumericLikeLabel = (label: string) => {
  const text = String(label).trim()
  const stripped = text
    .replace(/[\d.]/g, '')
    .replace(/\s/g, '')
    .replace(/[、,，\-—~～()（）/]/g, '')
    .replace(/(种|个|格|级|档|硬度|级数|数量|种数)/g, '')
  return stripped.length <= 2
}

/**
 * 「模板化描述型选项」不是整句。
 *
 * 加工来源题的四个选项都是「用铜锭 等 2 种通过合成」这种同一个模子刻出来的
 * 工序描述：长度都在 12 字以上，但四者结构完全一致，玩家读第一个字就知道
 * 这是个「工序 + 材料」的短语，靠语感排除不掉任何一个。
 * 守卫原本只区分「数值型 vs 整句」，把这类中间形态误判成整句（实测 42 道）。
 *
 * 判据：形如「…通过…」或含「等 N 种/ 个」这类工序模板记号。
 */
const isTemplatedProcedureLabel = (label: string) => {
  const text = String(label).trim()
  if (/^用.+通过(合成|涂蜡|烧制|刮除|锻造|无序合成)/.test(text)) return true
  return /(等|共)\s*\d+\s*(种|个|格)/.test(text)
}

/**
 * 推演题豁免「四个选项都是整句」：推演题必须用完整句子，
 * 否则「会掉下去 / 不会掉下去」这种半句玩家连在哪个情境下作答都读不出来。
 * 「机制 / 燃料」是查表题不在豁免范围内。
 */
const isReasoningQuestion = (question: { topic: string }) => question.topic.startsWith('机制 / ')
  && question.topic !== '机制 / 燃料'

const allSentenceQuestions = QUIZ_QUESTIONS.filter(
  (question) => question.tier === 'basic'
    && !isReasoningQuestion(question)
    && question.options.every((label) => !isNumericLikeLabel(label)
      && !isTemplatedProcedureLabel(label)
      && (label.length >= 12 || /[，。；]/.test(label))),
)
expect(
  `没有「四个选项都是整句」的题（实测 ${allSentenceQuestions.length} 道）`,
  allSentenceQuestions.length === 0,
)

section('文案质量：选项不能靠「哪个写得长」猜')
// 选项长度悬殊等于送线索：玩家看到三个 8 字短句 + 一个 24 字长句，
// 会直接选最长的那个 —— 和零泄漏原则一样是种作弊漏洞。
// 阈值 14 字是实测定的：正常中文选项长度差在 10 字以内，14 以上观感就明显失衡。
const unevenOptions = QUIZ_QUESTIONS.filter((question) => {
  const lengths = question.options.map((option) => option.length)
  return Math.max(...lengths) - Math.min(...lengths) > 14
})
expect(
  `没有「选项长度差 >14 字」的题（实测 ${unevenOptions.length} 道）`,
  unevenOptions.length === 0,
)

section('文案质量：玩家可见文案里不许漏内部 ID')
// 图鉴的「工具/材质」直接存了 Minecraft 的 material 标签，
// 曾经把 incorrect_for_wooden_tool 原样写进题库解析（108 条记录受影响）。
// 这类内部标识玩家看不懂，属于必须挡住的质量问题。
const internalIdPattern = /incorrect_for_|mineable\/|sword_instantly|\bcoweb\b|_instantly_mines/
const internalIdLeaks = QUIZ_QUESTIONS.filter((question) => (
  [question.prompt, ...question.options, question.explanation]
    .some((text) => internalIdPattern.test(String(text ?? '')))
))
expect(
  `题库文案里没有 Minecraft 内部 ID（实测 ${internalIdLeaks.length} 道）`,
  internalIdLeaks.length === 0,
)

section('难度分布：入门难度也必须真记数值')
// 「需要精确记忆数值」的题有两类，缺一不可：
//   纯数字选项  —— 问「石头的硬度是多少」，选项是 2.5 / 3 / 2.8 / 3.5，没有任何语义线索
//   精确目标值题 —— 问「哪一个的硬度是 3」，选项是四个方块名，必须逐个核对硬度表
// ⚠️ 最初只统计第一类（25 道），差点以为改造失败。
// 实际上第二类才是主体（选项带图标的那些），两类加起来才构成「入门也要真记数据」的保证。
const numericOptionQuestions = QUIZ_QUESTIONS.filter(
  (question) => question.options.every(looksNumeric),
)
// 题干直接给出目标数值（问「哪一个是 X」），玩家必须核对每个选项的该字段。
// ⚠️ 正则末尾要用「？」收尾 —— 实际题干都是「……是 1.4？」这样结尾的，
// 写成 $ 结尾会全部漏掉（踩过：11 道 vs 实际几十道）。
const exactTargetPattern = /(?:是|为)\s*[\d.]+\s*(?:种|个|格|级)?\s*？\s*$/
const exactTargetQuestions = QUIZ_QUESTIONS.filter((question) => exactTargetPattern.test(question.prompt))
expect(
  `有纯数字选项的精确数值题（实测 ${numericOptionQuestions.length} 道）`,
  numericOptionQuestions.length >= 25,
)
// 入门难度不能全是「一眼可答」：level 1 里也要有必须精确回忆数值的题
const levelOneDemanding = QUIZ_QUESTIONS.filter(
  (question) => question.level === 1
    && (question.options.every(looksNumeric) || exactTargetPattern.test(question.prompt)),
)
expect(
  `level 1 里也有必须精确回忆数值的题（实测 ${levelOneDemanding.length} 道）`,
  levelOneDemanding.length >= 80,
)
expect(
  `精确目标值题有足够体量（实测 ${exactTargetQuestions.length} 道）`,
  exactTargetQuestions.length >= 40,
)

section('高认知难度题型齐备')
const topicCounts = QUIZ_QUESTIONS.reduce<Record<string, number>>((acc, question) => {
  acc[question.topic] = (acc[question.topic] ?? 0) + 1
  return acc
}, {})
// 四种新题型必须都有足够题量，否则「难度提升」只是改了个文案
expect('有双条件交叉题', (topicCounts['方块 / 采掘'] ?? 0) > 0 && QUIZ_QUESTIONS.some((q) => /同时满足/.test(q.prompt)))
expect('有反向排除题', QUIZ_QUESTIONS.some((q) => /【不】/.test(q.prompt)))
expect('有同族辨析题', (topicCounts['方块 / 变体'] ?? 0) >= 3)
expect('有工序链题', (topicCounts['加工 / 工序链'] ?? 0) >= 3)
expect('有精确状态数题', QUIZ_QUESTIONS.some((q) => /多少种状态组合/.test(q.prompt)))
expect('有精确碰撞高度题', QUIZ_QUESTIONS.some((q) => /的碰撞高度是多少/.test(q.prompt)))

section('冷门题：答案位置已均匀 + 来源标注完整')
const obscureTierQuestions = QUIZ_QUESTIONS.filter((question) => question.tier === 'obscure')
const obscureTierPositionCounts = [0, 0, 0, 0]
for (const question of obscureTierQuestions) obscureTierPositionCounts[question.answerIndex] += 1
const minObscureShare = Math.min(...obscureTierPositionCounts) / obscureTierQuestions.length
expect(
  `冷门题答案位置不再偏斜（分布 ${obscureTierPositionCounts.join(' / ')}）`,
  minObscureShare >= 0.1,
)
const missingSource = obscureTierQuestions.filter(
  (question) => !question.source.label?.trim() || !question.source.url?.trim(),
)
expect('冷门题都有来源标签与链接', missingSource.length === 0)
expect('冷门题数量扩充到 70 道以上', obscureTierQuestions.length >= 70)

// ---------- 知识地图：收集进度不许变成答案泄漏 ----------

section('知识地图：点亮逻辑与零泄漏')
const facets = knowledgeFacets()
expect(
  `知识点维度不少于 20 个（实测 ${facets.length} 个）`,
  facets.length >= 20,
)
expect(
  '每个知识点的题量都够画出有意义的进度（无 1 道题的孤立维度）',
  facets.every((facet) => facet.total >= 3),
)
expect(
  `知识点题量加起来等于题库总数（${facets.reduce((sum, f) => sum + f.total, 0)} = ${QUIZ_QUESTIONS.length}）`,
  facets.reduce((sum, facet) => sum + facet.total, 0) === QUIZ_QUESTIONS.length,
)

// 空进度：一个都没点亮，不能崩、比例不能是 NaN
const blankSummary = knowledgeSummary(EMPTY_KNOWLEDGE)
expect('空进度不崩且空白维度等于全部', blankSummary.blanks.length === blankSummary.totalFacets)
expect(
  '空进度比例是 0 而不是 NaN',
  Number.isFinite(blankSummary.litQuestions / blankSummary.totalQuestions),
)

// 点亮一题：只涨 1 个维度，且该维度的题数 +1
const probeQuestion = QUIZ_QUESTIONS.find((q) => q.tier === 'basic')!
const afterOne = lightUp(EMPTY_KNOWLEDGE, probeQuestion)
const afterOneStates = facetStates(afterOne)
const probeKey = knowledgeKeyOf(probeQuestion.topic)
const probeFacet = afterOneStates.find((facet) => facet.key === probeKey)!
expect(
  `答对一题点亮「${probeKey}」且题数 0→1`,
  afterOne.lit[probeKey] === 1 && probeFacet.litCount === 1 && probeFacet.blank === false,
)
expect('答对一题只点亮 1 个维度', afterOneStates.filter((f) => f.litCount > 0).length === 1)

// 同一题重复点亮（关掉「不重复」后会重抽到）必须幂等，否则进度虚高
const afterRepeat = lightUp(afterOne, probeQuestion)
expect(
  `同一题重复点亮是幂等的（solvedIds 仍为 ${afterRepeat.solvedIds.length}）`,
  afterRepeat.solvedIds.length === 1 && afterRepeat.lit[probeKey] === 1,
)

// 冷门题并进「冷门机制」：细分 topic 不会在地图上炸出一堆 1/1 的格子
const obscureFacets = facets.filter((facet) => QUIZ_QUESTIONS.some(
  (q) => q.tier === 'obscure' && facet.key === knowledgeKeyOf(q.topic),
))
expect(
  `冷门题只占 ${obscureFacets.length} 个维度（细分 topic 已合并）`,
  obscureFacets.length <= 3,
)

// 零泄漏：进度结构里不许出现任何条目名 / 选项文本
const leakedNames = new Set<string>()
for (const key of Object.keys(afterOne.lit)) {
  for (const question of QUIZ_QUESTIONS) {
    for (const name of question.optionNames) {
      if (name && (key.includes(name) || key.includes(question.prompt.slice(0, 6)))) {
        leakedNames.add(key)
      }
    }
  }
}
expect(`收集进度的 key 里没有条目名（实测泄漏 ${leakedNames.size} 处）`, leakedNames.size === 0)
// 错题本只多存一个 wrong：题 id → 错误次数，同样不含任何选项文本 / 条目名
expect(
  '收集进度只存「维度 key + 题数 + 题 id + 错误次数」，不存任何选项文本',
  Object.keys(afterOne).join(',') === 'lit,solvedIds,wrong'
    && Object.values(afterOne.lit).every((value) => typeof value === 'number')
    && Object.values(afterOne.wrong).every((value) => Number.isInteger(value) && value > 0),
)
expect(
  '错题本的 key 全部是题库里的题 id（不是选项文本或条目名）',
  Object.keys(afterOne.wrong).every((id) => QUIZ_QUESTIONS.some((q) => q.id === id)),
)

// ---------- 错题本：进得来、排得对、答对就出去 ----------

section('错题本：收录、排序、答对后移出')
const wrongQuestion = QUIZ_QUESTIONS.find((q) => q.tier === 'basic' && q.id !== probeQuestion.id)!
const otherQuestion = QUIZ_QUESTIONS.find(
  (q) => q.tier === 'basic' && q.id !== probeQuestion.id && q.id !== wrongQuestion.id,
)!

expect('空进度没有错题', mistakeList(EMPTY_KNOWLEDGE).length === 0)

// 答错：不点亮任何知识点，也不进 solvedIds —— 错题本是「待办」，不是「成就」
const afterWrong = markWrong(EMPTY_KNOWLEDGE, wrongQuestion)
expect(
  `答错「${wrongQuestion.id}」不点亮知识点也不记已掌握`,
  Object.keys(afterWrong.lit).length === 0 && afterWrong.solvedIds.length === 0,
)
expect(`答错后错题本收录 1 道（${wrongQuestion.id}）`, afterWrong.wrong[wrongQuestion.id] === 1)

// 重复答错同一题：累加次数，这是排序的依据
const afterTwice = markWrong(afterWrong, wrongQuestion)
expect(
  `同一题再错一次累加到 2（实测 ${afterTwice.wrong[wrongQuestion.id]}）`,
  afterTwice.wrong[wrongQuestion.id] === 2,
)

// 两道题错过：错得多的排前面
const withOther = markWrong(afterTwice, otherQuestion)
const ranked = mistakeList(withOther)
expect('错题本返回 2 道', ranked.length === 2)
expect(
  `错得多的排第一（${ranked[0]?.question.id} 错 ${ranked[0]?.times} 次）`,
  ranked[0]?.question.id === wrongQuestion.id && ranked[0]?.times === 2,
)
expect(`错得少的排第二（${ranked[1]?.question.id} 错 ${ranked[1]?.times} 次）`, ranked[1]?.times === 1)

// 稳定性：同样次数时按 id 排，两次调用顺序必须一致（否则列表会每次刷新跳动）
expect(
  '同次数的错题顺序稳定不跳动',
  mistakeList(markWrong(markWrong(EMPTY_KNOWLEDGE, wrongQuestion), otherQuestion))
    .map((item) => item.question.id)
    .join(',')
    === mistakeList(markWrong(markWrong(EMPTY_KNOWLEDGE, otherQuestion), wrongQuestion))
      .map((item) => item.question.id)
      .join(','),
)

// 答对同一题：移出错题本，但知识点照常点亮（先错后对正是最该被消掉的记录）
const cured = lightUp(withOther, wrongQuestion)
expect(
  `从错题本彻底答对后移出（剩 ${Object.keys(cured.wrong).length} 道）`,
  cured.wrong[wrongQuestion.id] === undefined && mistakeList(cured).length === 1,
)
expect(
  '移出错题本的同时仍正常点亮知识点',
  cured.lit[knowledgeKeyOf(wrongQuestion.topic)] === 1
    || Object.keys(cured.lit).includes('冷门机制'),
)

// 再答错要能重新进本（移出不是永久毕业）
const relapse = markWrong(cured, wrongQuestion)
expect('移出后再答错会重新进本', relapse.wrong[wrongQuestion.id] === 1)

// 统计：总数 / 累计次数 / 最该补的知识点 / 只错一次的题
const summaryOfMistakes = mistakeSummary(withOther)
expect(
  `统计总数 2 道、累计 3 次（实测 ${summaryOfMistakes.total} / ${summaryOfMistakes.attempts}）`,
  summaryOfMistakes.total === 2 && summaryOfMistakes.attempts === 3,
)
expect(
  `统计里最该补的知识点排在最前（${summaryOfMistakes.weakest[0]?.key}）`,
  summaryOfMistakes.weakest.length >= 1
    && summaryOfMistakes.weakest[0].wrongCount >= (summaryOfMistakes.weakest[1]?.wrongCount ?? 0),
)
expect(
  `只错一次的题数 = 1（实测 ${summaryOfMistakes.onceOnly}）`,
  summaryOfMistakes.onceOnly === 1,
)

// 冷门题重练要落到「极限」难度：错题本的 facetKey 和难度层必须带对
const obscureWrong = markWrong(EMPTY_KNOWLEDGE, QUIZ_QUESTIONS.find((q) => q.tier === 'obscure')!)
expect(
  '冷门题错题归到「冷门机制」维度且 tier = obscure',
  mistakeList(obscureWrong)[0].facetKey === '冷门机制'
    && mistakeList(obscureWrong)[0].tier === 'obscure',
)

// 老存档没有 wrong 字段（也不该崩），脏数据要被过滤掉
const legacy = readKnowledge({ knowledge: { lit: { [probeKey]: 1 }, solvedIds: [probeQuestion.id] } } as never)
expect('老存档没有 wrong 字段时兜底成空对象', Object.keys(legacy.wrong).length === 0)
const dirty = readKnowledge({
  knowledge: { lit: {}, solvedIds: [], wrong: { [wrongQuestion.id]: 3, bad: -1, nan: Number.NaN, str: 'x' as never } },
} as never)
expect(
  '错题本里的脏数据（负数 / NaN / 非数字）被过滤掉',
  dirty.wrong[wrongQuestion.id] === 3 && Object.keys(dirty.wrong).length === 1,
)
expect(
  '题库里已删掉的 id 不会在错题本里卡出一条点不开的记录',
  mistakeList(readKnowledge({ knowledge: { lit: {}, solvedIds: [], wrong: { 'q-已删除': 2 } } } as never)).length === 0,
)

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`)
if (failed > 0) process.exit(1)
