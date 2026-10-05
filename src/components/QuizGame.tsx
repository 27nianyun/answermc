import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  Bug,
  Check,
  Database,
  Eye,
  Info,
  Lightbulb,
  SealCheck,
  ShieldWarning,
  SkipForward,
  SpeakerHigh,
  Stack,
  HourglassMedium,
  Target,
  Timer,
  X,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { spriteUrlFor } from '../sprites'
import {
  answerOf,
  ASSIST_COPY,
  assistDirection,
  assistLevelFor,
  buildExamResult,
  CONFIDENCE_LABELS,
  EXAM_PRESETS,
  examSecondsFor,
  examPoints,
  formatDuration,
  hintCandidate,
  pickQuizQuestion,
  QUIZ_META,
  QUIZ_TIERS,
  quizPool,
  quizRoundSeed,
  quizScore,
  quizTopics,
  optionEntries,
  QUIZ_QUESTIONS,
  shuffleQuestionOptions,
  SOURCE_LABELS,
  versionBadge,
} from '../quiz'
import type { AssistLevel, ExamAnswer, ExamLength, ExamResult } from '../quiz'
import { lightUp, markWrong, readKnowledge, resolveFacetKey } from '../knowledge'
import { accuracyLabel, fetchStats, reportAnswer } from '../stats'
import type { QuestionStat } from '../stats'
import type { Difficulty, GameMode, PlayerStats, QuizQuestion } from '../types'

const SOURCE_ICON = {
  data: Database,
  recipe: Stack,
  'mojang-bug': Bug,
  up: SpeakerHigh,
} as const

const STATUS_TEXT: Record<string, string> = {
  playing: '选择一个答案。',
  correct: '答对了。',
  revealed: '已揭晓答案。',
}

/**
 * 答完后的反馈文案。
 *
 * ⚠️ 这里必须明确告诉玩家「下一步点继续」。
 * 答对 / 揭晓后四个选项会全部 disabled（防止改答案刷分，这是对的），
 * 但如果文案只说「答对了，获得 126 分」，玩家看着四个灰掉的选项
 * 会以为界面坏了 —— 实测这正是「除了正确答案都不能选择」的来源：
 * 视觉上灰得像禁用，其实只是在等「继续」。
 */
const ANSWERED_HINT = '本题已结束，点「继续」出下一题。'

/** 难度按钮的展示顺序：简单 → 中等 → 极限 */
const DIFFICULTY_ORDER: Difficulty[] = ['explorer', 'survival', 'hardcore']
const DIFFICULTY_ICONS = {
  explorer: '入门',
  survival: '进阶',
  hardcore: '极限',
} as const

type QuizMode = 'practice' | 'exam'

export function QuizGame({
  difficulty,
  gameMode,
  onDifficultyChange,
  persistStats,
  /** 错题本点「重练」时由外部指定要练哪道题；为空则正常抽题 */
  reviewRequest,
  onReviewConsumed,
}: {
  difficulty: Difficulty
  gameMode: GameMode
  /** 组件内切难度时同步回 App，让侧栏下拉跟着变，两处不打架 */
  onDifficultyChange: (next: Difficulty) => void
  persistStats: (recipe: (previous: PlayerStats) => PlayerStats) => void
  /**
   * 错题本跳转请求。做成「一次性消费」而不是长期受控的 selectedId：
   * 侧栏点一下 → 这里练完 → 消费掉 → 回到正常抽题，
   * 不用让父组件操心什么时候该把选中态清空。
   */
  reviewRequest?: { questionId: string; nonce: number } | null
  onReviewConsumed?: () => void
}) {
  const reduceMotion = useReducedMotion()

  // 组件内部自己管难度，这样切换不用回 App 那一圈（侧栏下拉仍然同步显示）
  const [level, setLevel] = useState<Difficulty>(difficulty)
  const [mode, setMode] = useState<QuizMode>('practice')
  /** 勾选后每次「换一题」都保证出一道没出过的；取消则允许重复 */
  const [noRepeat, setNoRepeat] = useState(true)

  // 玩家从侧栏下拉改难度时同步进组件，否则两处难度会各说各话
  useEffect(() => {
    setLevel(difficulty)
    setHistory([])
    setRound(1)
    setDrawSeq((previous) => previous + 1)
  }, [difficulty])

  const [round, setRound] = useState(1)
  /**
   * 抽题信号：只增不减。
   *
   * 之前用 `setRound(1)` 当「强制重抽」的手段，但 round 本来就是 1 时
   * setState 不变 → 不重渲染 → 依赖 round 的 effect 不跑 → 题目不刷新
   *（勾选「不重复」时必现）。改成一个只增不减的计数器，每 +1 必定重抽一次。
   */
  const [drawSeq, setDrawSeq] = useState(0)
  const [question, setQuestion] = useState<QuizQuestion | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [status, setStatus] = useState<'playing' | 'correct' | 'revealed'>('playing')
  const [hints, setHints] = useState(0)
  const [attempts, setAttempts] = useState(0)
  /**
   * 已经答错过的选项下标。
   *
   * 为什么不能靠 `picked` 一个槽位：picked 只能记住最后一次点击。
   * 玩家点 A 错 → 点 B 也错，B 会覆盖 A 的红标，A 的错误痕迹就没了。
   * 四个选项最多错 3 个，所以这里显式记一份集合。
   *
   * 附带作用：已答错的项不再可点（见 `disabled`）——
   * 继续点它既不会改分（答案还是错的），又会冲掉标记，纯属有害无益。
   */
  const [wrongPicks, setWrongPicks] = useState<number[]>([])
  const [eliminated, setEliminated] = useState<number[]>([])
  const [feedback, setFeedback] = useState('')
  /** 本题已触发到第几档连错救济（0 = 还没触发），用于在反馈区显示救济档位 */
  const [assistLevel, setAssistLevel] = useState<AssistLevel>(0)
  const [history, setHistory] = useState<string[]>([])
  const [topicFilter, setTopicFilter] = useState<string>('全部')
  /**
   * 加载失败的贴图 URL。
   *
   * 四个选项必须一致地出图标 —— 只要有一个缺图，玩家就能靠「哪个没图」反推答案，
   * 等于零泄漏原则被绕过。所以这里记录失败过的 URL，一旦有任一选项失败，
   * 整道题的四个选项统一退回纯文字，绝不出现「三个有图一个没图」。
   */
  const [brokenSprites, setBrokenSprites] = useState<ReadonlySet<string>>(() => new Set())

  // ---------- 考试模式状态 ----------
  const [examLength, setExamLength] = useState<ExamLength>(10)
  const [examIndex, setExamIndex] = useState(0)
  const [examAnswers, setExamAnswers] = useState<ExamAnswer[]>([])
  /**
   * 已答考试题的同步副本。
   *
   * setState updater 是纯函数、而且 StrictMode 下会双调用，不能在里面做「读上一条再拼新条」
   * 这种累积逻辑（双调用会拿到同一个 previous，各拼一条，结果只多一条还算幸运；
   * 一旦双调用时 previous 不同就会丢数据）。改用 ref 持有权威值，state 只负责渲染。
   */
  const examAnswersRef = useRef<ExamAnswer[]>([])
  // 初值取入门档：真正的取值在 startExam / nextExamQuestion 里按当前难度重置
  const [timeLeft, setTimeLeft] = useState(30)
  /**
   * 倒计时的真实值放在 ref 里，state 只用于渲染。
   * 因为 state 更新有延迟，拿它判断「是否归零」在临界那秒会慢一拍甚至漏判。
   */
  const timeLeftRef = useRef(30)
  const [examResult, setExamResult] = useState<ExamResult | null>(null)
  const [running, setRunning] = useState(false)
  // 本题进入时刻，用于算这道题用了几秒
  const questionEnteredAt = useRef<number>(Date.now())

  const rule = QUIZ_TIERS[level]
  const isExam = mode === 'exam'

  const pool = useMemo(() => {
    const base = quizPool(level)
    return topicFilter === '全部' ? base : base.filter((item) => item.topic === topicFilter)
  }, [level, topicFilter])
  const topics = useMemo(() => ['全部', ...quizTopics(level)], [level])

  // 考试模式固定按整套抽题，不受主题筛选影响（考试要的是覆盖面，不是专项）
  const examPreset = EXAM_PRESETS[examLength]
  /**
   * 本场考试每题的秒数 —— 跟着难度走（入门 30 / 进阶 45 / 极限 60）。
   *
   * 必须从 level 现算而不是存成 state：难度可以在考试中途切，
   * 存 state 就要在切换处手动同步，漏一处就会用旧时限判分。
   */
  const examSeconds = examSecondsFor(level)
  /** 整场考试的时长上限，用于成绩单显示「限时」 */
  const examTotalSeconds = examPreset.length * examSeconds

  /**
   * 抽一道题并打乱选项。
   *
   * 关键：allowRepeat 只在勾选「不重复」时才为 false。取消勾选后允许出重复题，
   * 这是用户明确要的行为（题库出完时还能继续玩）。
   */
  const drawQuestion = useCallback((
    targetDifficulty: Difficulty,
    previousIds: string[],
    seed: string,
    allowRepeat: boolean,
  ) => {
    const pickedQuestion = pickQuizQuestion(targetDifficulty, previousIds, seed, allowRepeat)
    // 每出一道题都重新打乱选项：记答案位置是习惯，固定顺序等于送分
    return shuffleQuestionOptions(pickedQuestion, `${seed}-opts`)
  }, [])

  const startRound = useCallback((nextRound: number) => {
    const seed = quizRoundSeed(gameMode, level, nextRound)
    // history 存的是本局出过的【全部】题目而不是最近 N 条：只留窗口会把早期题目忘掉，
    // 让兜底误判成「严格层已抽空」，极限难度就会混进基础题。
    const next = drawQuestion(level, history, seed, !noRepeat)
    setQuestion(next)
    setPicked(null)
    setStatus('playing')
    setHints(0)
    setAttempts(0)
    setEliminated([])
    setWrongPicks([])
    setAssistLevel(0)
    setFeedback('')
    setHistory((previous) => [...previous, next.id])
    questionEnteredAt.current = Date.now()
  }, [drawQuestion, gameMode, history, level, noRepeat])

  /**
   * 重练一道指定的题（错题本点进来时用）。
   *
   * 为什么要专门开一条路，而不是把 id 塞进「不重复」名单再抽一次：
   * 抽题是按难度池随机 + 兜底，选中的题可能根本不是玩家点的那道。
   * 「点哪道练哪道」必须是确定性的。
   *
   * 切到练习模式：考试模式有倒计时和锁定，复习时还要赶时间太苛刻。
   * 难度按题目本身走 —— 冷门题（obscure）必须用极限档抽，否则会被基础题挤掉。
   */
  const reviewQuestion = useCallback((questionId: string) => {
    const target = QUIZ_QUESTIONS.find((item) => item.id === questionId)
    if (!target) return
    if (mode === 'exam') setMode('practice')
    // 冷门题只在极限难度池里，反之亦然 —— 跟着题目本身走最不会出错
    const needed = target.tier === 'obscure' ? 'hardcore' : 'explorer'
    if (level !== needed) setLevel(needed)
    // 仍然要打乱选项：错题本直接练不等于可以背答案位置
    setQuestion(shuffleQuestionOptions(target, `review-${questionId}-${Date.now()}`))
    setPicked(null)
    setStatus('playing')
    setHints(0)
    setAttempts(0)
    setEliminated([])
    setWrongPicks([])
    setAssistLevel(0)
    setFeedback('')
    questionEnteredAt.current = Date.now()
  }, [level, mode])

  /**
   * 消费错题本的「重练这道题」请求。
   *
   * 依赖里的 nonce 是关键：同一道题可能被反复点，只靠 questionId 变化的话，
   * 第二次点同一个 id 就不触发了。父组件每次点击递增 nonce，保证点几次都练得到。
   *
   * 只依赖 nonce 是刻意的：reviewQuestion 本身依赖 level/mode，
   * 放进依赖数组会在切难度时重跑，把刚点开的题立刻换掉。
   *
   * 位置纪律：必须在 `if (!question) return null` 之前。
   */
  useEffect(() => {
    if (!reviewRequest) return
    reviewQuestion(reviewRequest.questionId)
    onReviewConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRequest?.nonce])

  /**
   * 练习模式：一进入 / 换难度 / 换主题 / 下一题 都重抽。
   *
   * 依赖里刻意不放 history 和 noRepeat：startRound 内部要读它们，
   * 放进来会让「答一题 → history 变 → effect 重跑」形成死循环。
   * 勾选「不重复」这类需要强制重抽的场景统一走 bumpDraw()，信号明确。
   */
  useEffect(() => {
    if (isExam) return
    startRound(round)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, topicFilter, round, drawSeq, isExam])

  /** 强制重抽一题。drawSeq 只增不减，保证每次调用都能触发 effect。 */
  const bumpDraw = useCallback(() => {
    setHistory([])
    setRound(1)
    setDrawSeq((previous) => previous + 1)
  }, [])

  // ---------- 考试模式：开始 ----------
  const startExam = useCallback(() => {
    examAnswersRef.current = []
    setExamAnswers([])
    setExamIndex(0)
    setExamResult(null)
    setTimeLeft(examSeconds)
    timeLeftRef.current = examSeconds
    setRunning(true)
    setHistory([])
    setRound(1)
    setDrawSeq((previous) => previous + 1)
    setTopicFilter('全部')
    // 考试要覆盖面，所以题量不许超过题库深度
    const seed = `exam-${level}-${examLength}-${Date.now()}`
    const first = drawQuestion(level, [], seed, false)
    setQuestion(first)
    setPicked(null)
    setWrongPicks([])
    setAssistLevel(0)
    setStatus('playing')
    setFeedback('')
    setHistory([first.id])
    questionEnteredAt.current = Date.now()
  }, [drawQuestion, examLength, examSeconds, level])

  /**
   * 记录一道考试题的结果并进入下一题（或交卷）。
   *
   * 返回这条记录的实际得分，调用方（choose）用它更新侧栏统计 ——
   * 两边必须用同一个 examPoints 口径，否则成绩单显示 82 分、侧栏只加 60 分。
   */
  const commitExamAnswer = useCallback((choice: number | null): ExamAnswer | null => {
    if (!question) return null
    const spent = Math.max(0, (Date.now() - questionEnteredAt.current) / 1000)
    const correct = choice !== null && choice === question.answerIndex
    const record: ExamAnswer = {
      questionId: question.id,
      topic: question.topic,
      prompt: question.prompt,
      // 存下打乱后的选项顺序，成绩单要靠它还原「当时选了什么」
      options: [...question.options],
      picked: choice,
      answerIndex: question.answerIndex,
      correct,
      seconds: Math.round(spent),
      // 超时未作答记 0 分，答错也记 0 分
      points: correct ? examPoints(level, question, Math.max(0, examSeconds - spent)) : 0,
    }
    /**
     * 交卷判定放在 updater 外面。
     *
     * updater 必须是纯函数 —— StrictMode 下会双调用，在里面 setRunning / setExamResult
     * 会让副作用执行两次。之前虽然结果幂等、看不出异常，但这是明确的反模式：
     * 一旦以后交卷逻辑里加上「写本地记录」之类的副作用，就会真的写两遍。
     */
    const next = [...examAnswersRef.current, record]
    examAnswersRef.current = next
    setExamAnswers(next)
    if (next.length >= examPreset.length) {
      setRunning(false)
      setExamResult(buildExamResult(next, examTotalSeconds, level))
    }
    return record
  }, [question, examPreset.length, examTotalSeconds, examSeconds, level])

  /**
   * 始终指向当前题，供 timer 这类「不该把 question 放进依赖数组」的回调使用。
   *
   * 位置纪律：写在 `if (!question) return null` **之前** ——
   * useRef 也是 Hook，条件调用会抛「Rendered fewer hooks than expected」。
   */
  const questionRef = useRef<QuizQuestion | null>(null)
  useEffect(() => {
    questionRef.current = question
  }, [question])

  /**
   * 考试倒计时：每秒走一格，归零算超时未作答。
   *
   * 不在 setState 的 updater 里做副作用（提交答案），updater 必须是纯函数。
   */
  useEffect(() => {
    if (!isExam || !running) return
    const timer = window.setInterval(() => {
      timeLeftRef.current -= 1
      const left = timeLeftRef.current
      setTimeLeft(left)
      if (left > 0) return
      window.clearInterval(timer)
      // 超时：记一条未作答。commitExamAnswer 内部会在到达题量时自动交卷
      setPicked(null)
      // 超时也是「没掌握」—— 这道题该进错题本，否则玩家复习时看不到它。
      // 从 ref 拿当前题：timer 闭包里不能直接依赖 question，
      // 否则换题会重建定时器（这本身没错，但会把 effect 依赖搅乱）。
      const timedOut = questionRef.current
      if (timedOut) {
        persistStats((previous) => ({
          ...previous,
          streak: 0,
          knowledge: markWrong(readKnowledge(previous), timedOut),
        }))
      }
      commitExamAnswer(null)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isExam, running, persistStats, commitExamAnswer])

  const nextExamQuestion = useCallback(() => {
    if (!question) return
    const seed = `exam-${level}-${examLength}-${examIndex + 1}-${Date.now()}`
    // 考试内部也按整套去重：题量不该超过严格层的深度
    const next = drawQuestion(level, history, seed, false)
    setQuestion(next)
    setPicked(null)
    setWrongPicks([])
    setAssistLevel(0)
    setStatus('playing')
    setHistory((previous) => [...previous, next.id])
    setTimeLeft(examSeconds)
    timeLeftRef.current = examSeconds
    setExamIndex((previous) => previous + 1)
    questionEnteredAt.current = Date.now()
  }, [drawQuestion, examIndex, examLength, examSeconds, history, level, question])

  /**
   * 每个选项的图标在渲染时按需取。
   *
   * 两个坑：
   * 1. 必须 useMemo —— optionEntries 要遍历题库建索引、spriteUrlFor 要查 manifest，
   *    不缓存的话每次渲染（尤其是每秒跳动的考试倒计时）都要重算一遍 4 个选项。
   * 2. 必须写在 `if (!question) return null` 之前 —— Hook 不能条件调用，
   *    首帧题目为空直接 return 的话，Hook 数量会随题目加载与否跳变，React 直接抛错。
   */
  const sprites = useMemo(() => {
    if (!question) return []
    const resolved = optionEntries(question).map((entry) => (entry ? spriteUrlFor(entry) : null))
    // 四个选项要么全出图标、要么全不出。任一张图加载失败就整题退回纯文字。
    const anyBroken = resolved.some((url) => url && brokenSprites.has(url))
    return anyBroken ? resolved.map(() => null) : resolved
  }, [question, brokenSprites])

  /*
  全球正确率：只是一项增强，拿不到就不显示，答题本身照常。
  位置纪律同其他 Hook —— 写在所有条件返回之前。
  */
  const [questionStat, setQuestionStat] = useState<QuestionStat | undefined>(undefined)

  useEffect(() => {
    if (!question) return
    // 竞态保护：快速连点换题时，先发的请求可能后返回，会把旧题的统计盖到新题上
    let cancelled = false
    void fetchStats([question.id]).then((map) => {
      if (!cancelled) setQuestionStat(map.get(question.id))
    })
    return () => { cancelled = true }
  }, [question?.id])

  /**
   * 键盘答题：A/B/C/D 或 1/2/3/4 直接选，Enter / 空格出下一题。
   *
   * 这不是为了「显得专业」，而是实测出来的必要性：
   * 答完一题后四个选项会全部 disabled（防止改答案刷分，这个是对的），
   * 纯鼠标操作要先把鼠标移到选项区、再移到下方「继续」，来回两次。
   *
   * 位置纪律：必须写在 `if (!question) return null` 之前 ——
   * Hook 不能条件调用，否则题目加载那一帧 Hook 数量跳变，React 直接抛错白屏。
   *
   * 三个必须防的坑：
   * ① 焦点在 input/textarea/select 里时不能抢键（问答输入框、图鉴搜索都会误触）；
   * ② 考试模式【不绑】Enter 出下一题 —— 那等于考试中跳题，必须走「提前交卷」；
   * ③ 依赖里不能出现早退之后才定义的局部变量（answerIndex / locked），
   *    所以这里一律从 question / status / picked 直接判断。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (!question) return
      // 考试进行中：只允许选答案，Enter/空格一律不响应
      if (isExam && running && (event.key === 'Enter' || event.key === ' ')) return

      const key = event.key.toUpperCase()
      const index = 'ABCD'.indexOf(key) >= 0 ? 'ABCD'.indexOf(key) : '1234'.indexOf(key)
      const answeredNow = status !== 'playing'
      const examLockedNow = isExam && running && picked !== null

      if (index >= 0) {
        if (answeredNow || examLockedNow) return
        choose(index)
        event.preventDefault()
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (answeredNow) nextRound()
        else if (!isExam) reveal()
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!question) return null

  const answerIndex = question.answerIndex
  const sourceIcon = SOURCE_ICON[question.source.type] ?? Info
  const SourceIcon = sourceIcon
  const badge = versionBadge(question)
  // 考试模式不给提示：给了就等于考试时作弊
  const maxHints = isExam ? 0 : level === 'hardcore' ? 1 : 2
  const possibleScore = isExam ? examPoints(level, question, timeLeft) : quizScore(level, question, hints, attempts)
  // 练习模式：答完 / 揭晓后才算 answered
  const answered = status !== 'playing'
  /**
   * 考试模式：点完就锁定，但【不显示对错】。
   *
   * 之前这里把 examLocked 混进 answered，导致点完答案后选项立刻染成红绿 ——
   * 等于当场把答案告诉玩家，后面的题自然随便猜。考试必须等交卷才揭晓。
   */
  const examLocked = isExam && running && picked !== null
  const locked = answered || examLocked

  const switchLevel = (next: Difficulty) => {
    setLevel(next)
    // 同步回 App，侧栏的难度下拉要跟着一起变
    onDifficultyChange(next)
    setTopicFilter('全部')
    // 考试进行中切难度：时限变了（30/45/60），必须重置当前题的倒计时。
    // 不重置的话会出现「按 60 秒的题面、只剩按 30 秒剩下来的时间」，
    // 白白吃掉玩家一半时间。examSecondsFor(next) 要在 next 上算，
    // 不能用还没更新的 level。
    if (isExam && running) {
      const seconds = examSecondsFor(next)
      setTimeLeft(seconds)
      timeLeftRef.current = seconds
    }
    bumpDraw()
  }

  const switchMode = (next: QuizMode) => {
    setMode(next)
    setExamResult(null)
    examAnswersRef.current = []
    setExamAnswers([])
    setRunning(false)
    setPicked(null)
    setWrongPicks([])
    setAssistLevel(0)
    setStatus('playing')
    setFeedback('')
    bumpDraw()
  }

  const choose = (index: number) => {
    // wrongPicks：已答错过的项不再接受点击 —— 点了也不会改分，还会把红标冲掉
    if (answered || eliminated.includes(index) || wrongPicks.includes(index)) return

    /**
     * 进度上报：答对点亮知识点，答错进错题本。
     *
     * 两条记录方向相反，都只存**题目 id 和计数**，不存答案、不存玩家选了什么：
     * 答对 → lightUp：记「这个知识点维度答对过几题」
     * 答错 → markWrong：记「这道题错过几次」，进错题本待复习
     * （零泄漏详见 knowledge.ts 顶部说明）
     */
    const withKnowledge = (previous: PlayerStats, correct: boolean): PlayerStats => {
      const before = readKnowledge(previous)
      const next = correct ? lightUp(before, question) : markWrong(before, question)
      // 两个写入函数对「无变化」都幂等：
      //  - lightUp：已答对过的题不重复计数
      //  - markWrong：错同一题会累加次数，所以这里只比长度就够了
      // 没变化就不写回，避免每次都往 localStorage 塞一份一样的大对象
      const unchanged = before.solvedIds.length === next.solvedIds.length
        && (before.wrong[question.id] ?? 0) === (next.wrong[question.id] ?? 0)
      if (unchanged) return previous
      return { ...previous, knowledge: next }
    }

    // 考试模式：判分 + 立即跳下一题，不给即时反馈
    if (isExam && running) {
      setPicked(index)
      const correct = index === answerIndex
      // 统计上报：考试不显示即时对错，正确率只在交卷后的回顾里看，但数据照样记
      setQuestionStat(reportAnswer(question.id, correct) ?? questionStat)
      // 分数必须用 commitExamAnswer 算出来的那个 points（难度系数 × 时间系数），
      // 不能写死 60 —— 否则侧栏累计分和成绩单总分对不上。
      const record = commitExamAnswer(index)
      const gained = record?.points ?? 0
      persistStats((previous) => ({
        ...withKnowledge(previous, correct),
        score: previous.score + gained,
        streak: correct ? previous.streak + 1 : 0,
        bestStreak: Math.max(previous.bestStreak, correct ? previous.streak + 1 : previous.bestStreak),
        solved: correct ? previous.solved + 1 : previous.solved,
      }))
      return
    }

    setPicked(index)
    // 上报这次作答，并把乐观累加后的统计直接落到 state —— 玩家立刻看到
    // 包含自己这一票的正确率，不用等下一轮网络查询
    setQuestionStat(reportAnswer(question.id, index === answerIndex) ?? questionStat)
    if (index === answerIndex) {
      const points = quizScore(level, question, hints, attempts)
      setStatus('correct')
      setFeedback(`答对了，获得 ${points} 分。`)
      persistStats((previous) => ({
        ...withKnowledge(previous, true),
        score: previous.score + points,
        streak: previous.streak + 1,
        bestStreak: Math.max(previous.bestStreak, previous.streak + 1),
        solved: previous.solved + 1,
      }))
      return
    }
    setAttempts((previous) => previous + 1)
    setWrongPicks((previous) => [...previous, index])
    // streak 清零 + 这道题进错题本（withKnowledge 内部只写 id 和次数）
    persistStats((previous) => ({ ...withKnowledge(previous, false), streak: 0 }))

    /**
     * 连错渐进提示：连着错就别只说一句「不对」。
     *
     * assistLevelFor 按**本题的累计错误次数**（wrongPicks 长度）分三档：
     *   1 → 方向提示：只引用题面本来就有的信息（知识点 + 版本），不是新解锁的情报
     *   2 → 自动排掉一个他还没点过的错误选项，走 hintCandidate（设计上永不返回答案）
     *   3 → 直接揭晓答案与解析，此时这题早已进错题本，藏着没有收益
     *
     * 排除与揭晓都**不额外扣分**：quizScore 已经按 attempts 递减过了，
     * 再扣一次就是双重惩罚，玩家会宁愿直接看答案。
     */
    const assist = assistLevelFor(wrongPicks.length + 1)
    if (assist === 1) {
      setAssistLevel(1)
      setFeedback(`「${question.options[index]}」不对。${assistDirection(question, resolveFacetKey(question))}`)
    } else if (assist === 2) {
      // 优先排掉「还没点过」的那个错误项：把已经证伪的再排一次等于没给新信息
      const target = hintCandidate(question, [...eliminated, ...wrongPicks, index], index)
      if (target === null) {
        setAssistLevel(3)
        setStatus('revealed')
        setFeedback(`「${question.options[index]}」不对，选项已经排完了，直接看答案。`)
        return
      }
      setEliminated((previous) => [...previous, target])
      setAssistLevel(2)
      setFeedback(`「${question.options[index]}」不对。${ASSIST_COPY[2]}：${question.options[target]}。`)
    } else {
      setAssistLevel(3)
      setStatus('revealed')
      setFeedback(`「${question.options[index]}」不对。连错三次，直接揭晓答案。`)
    }
  }

  const useHint = () => {
    if (answered || hints >= maxHints) return
    // 提示只排除一个错误选项，绝不直接告诉玩家答案
    const target = hintCandidate(question, eliminated, picked)
    if (target === null) {
      setFeedback('已经排除到只剩正确答案了。')
      return
    }
    setEliminated((previous) => [...previous, target])
    setHints((previous) => previous + 1)
    setFeedback(`已排除「${question.options[target]}」，本题得分相应减少。`)
  }

  const reveal = () => {
    if (answered) return
    setStatus('revealed')
    setFeedback('已揭晓答案与解析。')
    persistStats((previous) => ({ ...previous, streak: 0, skipped: previous.skipped + 1 }))
  }

  const nextRound = () => {
    if (isExam && running) {
      nextExamQuestion()
      return
    }
    setRound((previous) => previous + 1)
  }

  // ---------- 考试模式：成绩单 ----------
  if (isExam && examResult) {
    return (
      <section className="game-bay">
        <div className="game-heading">
          <div>
            <span className="eyebrow">EXAM RESULT / {rule.label}</span>
            <h1>考试成绩单</h1>
          </div>
          <div className={`difficulty-badge exam-grade g-${examResult.grade.toLowerCase()}`}>
            <SealCheck weight="duotone" />
            {examResult.grade} 级
          </div>
        </div>

        <div className="exam-result">
          <div className="exam-score-lead">
            <strong>{examResult.score}</strong>
            <span>总分</span>
          </div>
          <dl className="exam-result-grid">
            <div><dt>答对</dt><dd>{examResult.correct} / {examResult.answers.length}</dd></div>
            <div><dt>正确率</dt><dd>{examResult.accuracy}%</dd></div>
            <div><dt>答错</dt><dd>{examResult.wrong}</dd></div>
            <div><dt>超时未答</dt><dd>{examResult.timeout}</dd></div>
            <div><dt>最长连对</dt><dd>{examResult.bestStreak}</dd></div>
            <div><dt>限时</dt><dd>{formatDuration(examTotalSeconds)}</dd></div>
          </dl>
        </div>

        <div className="quiz-explain-card">
          <div className="quiz-explain-head">
            <Info weight="duotone" />
            <strong>逐题回顾</strong>
          </div>
          <ol className="exam-review">
            {examResult.answers.map((answer, index) => (
              <li key={`${answer.questionId}-${index}`} className={answer.correct ? 'ok' : 'bad'}>
                <span className="exam-review-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="exam-review-body">
                  <span className="exam-review-prompt">{answer.prompt}</span>
                  <span className="exam-review-detail">
                    {answer.picked === null
                      ? '未作答（超时或跳过）'
                      : <>你选了「{answer.options[answer.picked]}」</>}
                    {!answer.correct && answer.picked !== null && (
                      <> · 正确答案「{answer.options[answer.answerIndex]}」</>
                    )}
                  </span>
                </div>
                <span className="exam-review-seconds">{answer.seconds}s</span>
                <span className="exam-review-points">{answer.points} 分</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="quiz-actions">
          <button className="submit-button" type="button" onClick={startExam}>
            <><ArrowClockwise /> 再考一次</>
          </button>
          <div className="quiz-secondary">
            <button type="button" onClick={() => switchMode('practice')}>
              <><Target /> 回到练习模式</>
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="game-bay">
      <div className="game-heading">
        <div>
          <span className="eyebrow">
            {isExam ? 'EXAM' : 'KNOWLEDGE QUIZ'} / {String(isExam ? examIndex + 1 : round).padStart(3, '0')}
          </span>
          <h1>{isExam ? `考试模式：每题 ${examSeconds} 秒，答完才给结果。` : '每题都带版本信息，选一个答案。'}</h1>
        </div>
        <div className="difficulty-badge">
          <SealCheck weight="duotone" />
          {rule.label}
        </div>
      </div>

      {/* 难度 / 模式 / 不重复 —— 都放在答题区里，不用回侧栏 */}
      <div className="quiz-controls">
        <div className="quiz-control-row">
          <span className="quiz-control-label">难度</span>
          <div className="segmented">
            {DIFFICULTY_ORDER.map((item) => (
              <button
                key={item}
                className={level === item ? 'active' : ''}
                type="button"
                aria-pressed={level === item}
                // 考试进行中锁死难度：时限和判分基准都是按难度定的，
                // 中途换难度会让同一场考试里两套标准混用，成绩单没法解释。
                disabled={isExam && running}
                onClick={() => switchLevel(item)}
              >
                {DIFFICULTY_ICONS[item]}
              </button>
            ))}
          </div>
          <span className="quiz-control-hint">
            {rule.label}
            {isExam ? '' : ' · 键盘 A/B/C/D 或 1-4 直接选，Enter 下一题'}
          </span>
        </div>

        <div className="quiz-control-row">
          <span className="quiz-control-label">模式</span>
          <div className="segmented">
            <button className={mode === 'practice' ? 'active' : ''} type="button" onClick={() => switchMode('practice')}>
              练习
            </button>
            <button className={mode === 'exam' ? 'active' : ''} type="button" onClick={() => switchMode('exam')}>
              考试
            </button>
          </div>
          {isExam ? (
            <div className="segmented">
              {Object.values(EXAM_PRESETS).map((preset) => (
                <button
                  key={preset.length}
                  className={examLength === preset.length ? 'active' : ''}
                  type="button"
                  disabled={running}
                  onClick={() => setExamLength(preset.length)}
                >
                  {preset.length} 题
                </button>
              ))}
            </div>
          ) : (
            <label className="quiz-check">
              <input
                type="checkbox"
                checked={noRepeat}
                onChange={(event) => {
                  setNoRepeat(event.target.checked)
                  // 勾选状态变了但 round 可能已经是 1，必须靠 bumpDraw 强制重抽
                  bumpDraw()
                }}
              />
              <span>不重复刷新一道题</span>
            </label>
          )}
        </div>
      </div>

      {/* 考试模式：开始前的说明卡 */}
      {isExam && !running && (
        <div className="exam-brief">
          <HourglassMedium weight="duotone" />
          <div>
            <strong>{examPreset.label} · {rule.label} · 限时 {formatDuration(examTotalSeconds)}</strong>
            <span>
              每题 {examSeconds} 秒（时限跟着难度走），倒计时归零按未作答计 0 分。
              答得越快分越高（满速答对拿满额），全部答完才给解析。考试不提供排除提示。
            </span>
          </div>
          <button className="submit-button" type="button" onClick={startExam}>
            <><Timer /> 开始考试</>
          </button>
        </div>
      )}

      <div className="round-status" aria-label="本轮进度">
        <div><span>题库</span><strong>{pool.length} 道</strong></div>
        {isExam ? (
          <>
            <div><span>进度</span><strong>{examAnswers.length} / {examPreset.length}</strong></div>
            <div className={timeLeft <= 5 ? 'urgent' : ''}><span>剩余</span><strong>{timeLeft}s</strong></div>
            <div><span>已得</span><strong>{examAnswers.reduce((sum, a) => sum + a.points, 0)}</strong></div>
            <div><span>超时</span><strong>{examAnswers.filter((a) => a.picked === null).length}</strong></div>
          </>
        ) : (
          <>
            <div><span>提示</span><strong>{String(hints).padStart(2, '0')}</strong></div>
            <div><span>试错</span><strong>{String(attempts).padStart(2, '0')}</strong></div>
            <div><span>本题可得</span><strong>{possibleScore}</strong></div>
          </>
        )}
      </div>

      <div className="quiz-meta-bar">
        <div className="quiz-topic-tabs">
          {topics.map((topic) => (
            <button
              key={topic}
              className={topicFilter === topic ? 'active' : ''}
              type="button"
              disabled={isExam && running}
              onClick={() => setTopicFilter(topic)}
            >
              {topic}
            </button>
          ))}
        </div>
        <p>{rule.note}</p>
      </div>

      <div className="quiz-stage">
        <div className="quiz-card">
          <div className="quiz-card-head">
            <span className="quiz-topic">{question.topic}</span>
            <div className="quiz-version" aria-label="本题版本信息">
              {badge.map((text) => <span key={text}>{text}</span>)}
            </div>
          </div>

          <h2 className="quiz-prompt">{question.prompt}</h2>

          {/*
            零泄漏：这里刻意没有「题目主角」区块。
            四选一单独显示一个方块图标 = 直接泄露答案（旧版实测 232/347 道题的主角就是答案），
            所以改成每个选项各显示自己的官方材质图标，四个选项一律平权。
          */}
          <div className="quiz-options" role="radiogroup" aria-label="答案选项">
            {question.options.map((option, index) => {
              const isAnswer = index === answerIndex
              const isPicked = index === picked
              const isOut = eliminated.includes(index)
              /**
               * 状态机：三种互斥的处境，各自有各自的视觉语言。
               *
               * ① 考试锁定态：只标「我选了哪个」，**绝不标对错** ——
               *    当场判对错等于泄题，后面的题随便猜。
               * ② 还在作答（!answered）：这里原先只判了 isOut，**漏了 isPicked**，
               *    结果练习模式答错后那个错选项拿不到任何样式 —— 点了跟没点一样，
               *    玩家完全看不出自己错在哪（实测反馈只有一句「不对，再看看剩下几个选项」）。
               *    现在补上 isWrong：答错立刻给红底 + 叉号，并把这题从待选里排掉。
               * ③ 已答对 / 已揭晓：正确答案标 right，其余压暗。
               */
              const isWrong = !answered && !examLocked && wrongPicks.includes(index) && !isAnswer
              const state = examLocked
                ? isPicked ? 'picked' : 'idle'
                : !answered
                  ? isWrong ? 'wrong' : isOut ? 'out' : ''
                  : isAnswer ? 'right' : isPicked ? 'wrong' : 'dim'
              const sprite = sprites[index]
              return (
                <button
                  key={`${question.id}-${index}`}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  className={`quiz-option ${state}${sprite ? ' has-icon' : ''}`}
                  disabled={locked || isOut || (!examLocked && wrongPicks.includes(index))}
                  onClick={() => choose(index)}
                >
                  <span className="quiz-option-key">{String.fromCharCode(65 + index)}</span>
                  {sprite && (
                    <span className="quiz-option-sprite">
                      {/*
                        官方材质是可选增强项，加载失败时静默降级成纯文字选项 ——
                        破图比没图更难看，而且四个选项必须一致（不能靠「哪个没图」反推答案），
                        所以失败时整道题退回纯文字形态，而不是只让某一个选项缺图。
                      */}
                      <img
                        src={sprite}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={() => {
                          setBrokenSprites((previous) => {
                            if (previous.has(sprite)) return previous
                            const next = new Set(previous)
                            next.add(sprite)
                            return next
                          })
                        }}
                      />
                    </span>
                  )}
                  <span className="quiz-option-text">{option}</span>
                  {/* 答对 / 揭晓后才显示对勾（考试锁定态不显示，避免泄题） */}
                  {answered && isAnswer && <Check weight="bold" />}
                  {/*
                    叉号条件从 `answered && isPicked && !isAnswer` 改成 `isWrong`：
                    练习模式答错的那一刻（!answered）就该打叉，
                    否则玩家点了错误项却什么都没变，只有一句「不对」—— 这正是
                    「回答错误的显示不够明显」的另一半原因。
                    `isWrong` 已排除考试锁定态，所以考试仍然不会当场泄题。
                  */}
                  {isWrong && <X weight="bold" />}
                </button>
              )
            })}
          </div>

          {!isExam && (
            <div className="quiz-source">
              <SourceIcon weight="duotone" />
              <div>
                <strong>{SOURCE_LABELS[question.source.type]} · {question.source.label}</strong>
                <small>{CONFIDENCE_LABELS[question.source.confidence]}</small>
              </div>
              {question.source.url && (
                <a href={question.source.url} target="_blank" rel="noreferrer noopener">来源链接</a>
              )}
            </div>
          )}
        </div>

        <div className="quiz-side">
          <div className="quiz-version-card">
            <span className="eyebrow">版本基准</span>
            <div className="quiz-version-lead">
              <strong>{QUIZ_META.latestRelease}</strong>
              <span>{QUIZ_META.latestReleaseName} · {QUIZ_META.latestReleaseDate}</span>
            </div>
            <dl>
              <div><dt>题库数据版本</dt><dd>Java {QUIZ_META.dataVersion}</dd></div>
              <div><dt>本题成立版本</dt><dd>{question.version.verifiedIn}</dd></div>
              {question.version.introduced && <div><dt>机制引入</dt><dd>{question.version.introduced}</dd></div>}
              {question.version.fixed && <div><dt>修复版本</dt><dd>{question.version.fixed}</dd></div>}
              <div><dt>题库规模</dt><dd>{QUIZ_META.counts.total} 道</dd></div>
            </dl>
            <small>
              简单与中等难度只出 MC 基础知识；冷门机制与 {QUIZ_META.bugTracker} 上的未修复 bug 只在极限难度出现。
            </small>
          </div>

          <div className="quiz-actions">
            {/* 点选项即判分，所以主按钮只负责推进：答完 / 揭晓后变「下一题」 */}
            <button
              className="submit-button"
              type="button"
              disabled={!locked}
              onClick={nextRound}
            >
              {locked
                ? <><SkipForward /> 下一题</>
                : <><Target /> 先选一个答案</>}
            </button>
            {!isExam && (
              <div className="quiz-secondary">
                <button type="button" onClick={useHint} disabled={answered || hints >= maxHints}><Lightbulb weight="duotone" /> 排除一个</button>
                {answered
                  ? <button type="button" onClick={nextRound}><Check /> 继续</button>
                  : <button type="button" onClick={reveal}><Eye /> 揭晓答案</button>}
                <button type="button" onClick={nextRound}><SkipForward /> 换一题</button>
              </div>
            )}
            {isExam && running && (
              <div className="quiz-secondary">
                <button type="button" onClick={() => {
                  setRunning(false)
                  // 读 ref 而不是 state：刚答完一题的那一帧 state 还没提交，
                  // 用 state 会少算最后一条。ref 是同步写入的，永远是最新。
                  setExamResult(buildExamResult(examAnswersRef.current, examTotalSeconds, level))
                }}>
                  <HourglassMedium /> 提前交卷
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${status}-${feedback}`}
              className={`feedback ${status}`}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              aria-live="polite"
            >
              {/*
                救济档位徽标：只在练习模式、答错后、题未结束的那一帧出现。
                考试模式绝对不能出现 —— 当场泄题等于后面的题随便猜。
                揭晓（answered）后也不再显示，因为答案已经在解析条里了。
              */}
              {!isExam && assistLevel > 0 && !answered && (
                <em className="assist-badge" data-level={assistLevel}>
                  {ASSIST_COPY[assistLevel]}
                </em>
              )}
              <span>
                {answered
                  ? `${feedback || STATUS_TEXT.playing} ${ANSWERED_HINT}`
                  : (feedback || STATUS_TEXT.playing)}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {answered && (
          <motion.div
            className={`quiz-explain ${status}`}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="quiz-explain-head">
              {status === 'correct' ? <Check weight="duotone" /> : <ShieldWarning weight="duotone" />}
              <strong>正确答案：{answerOf(question)}</strong>
              <span>{question.explanation}</span>
            </div>
            <div className="quiz-explain-tags">
              <span className="quiz-tag">版本 {badge.join(' · ')}</span>
              {/*
                全球正确率。样本不足 5 次或统计服务不可用时 accuracyLabel 返回 null，
                这时整块不渲染 —— 宁可不显示，也不显示「全球 0% 的人答对」这种
                把「没人答过」误读成「特别难」的数字。
              */}
              {accuracyLabel(questionStat) && (
                <span className="quiz-tag quiz-tag-stat">{accuracyLabel(questionStat)}</span>
              )}
              <a className="quiz-tag" href={QUIZ_META.latestRelease ? `https://minecraft.wiki/w/Java_Edition_${QUIZ_META.latestRelease}` : undefined} target="_blank" rel="noreferrer noopener">
                {QUIZ_META.edition} {QUIZ_META.latestRelease}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
