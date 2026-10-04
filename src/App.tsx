import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  BookOpen,
  CalendarDots,
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  Copy,
  Cube,
  Database,
  Eye,
  Flame,
  GameController,
  Hammer,
  Hourglass,
  Lightbulb,
  MagnifyingGlass,
  Pause,
  Play,
  Question,
  Scales,
  SealCheck,
  Shuffle,
  Skull,
  Sparkle,
  SpeakerHigh,
  Target,
  X,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import rawCatalog from './data/catalog.json'
import rawSelfcheck from './data/selfcheck.json'
import { DIFFICULTY_LABELS, getInitialHintCount, getScore, isCorrectAnswer, KIND_LABELS, makeClues, pickEntry } from './game'
import { answerQuestion, suggestedQuestions } from './yesno'
import { EntrySprite } from './components/EntrySprite'
import { ArcadeGame } from './components/ArcadeGame'
import type { ArcadeView } from './components/ArcadeGame'
import { CraftingGame } from './components/CraftingGame'
import { QuizGame } from './components/QuizGame'
import { QUIZ_META, QUIZ_TIERS } from './quiz'
import {
  facetStates as facetStatesFor,
  knowledgeSummary as summarizeKnowledge,
  mistakeList as mistakeListFor,
  mistakeSummary as summarizeMistakes,
  readKnowledge,
} from './knowledge'
import { spriteUrlFor } from './sprites'
import type { CatalogData, CatalogEntry, Difficulty, GameMode, Kind, PlayerStats, RoundStatus } from './types'
import { expectedSlots as canonicalGrid, entryForName, entryForTransform, METHOD_LABELS, transformsForName } from './transforms'
import type { Transform } from './types'
import './App.css'

const data = rawCatalog as unknown as CatalogData
const ALL_KINDS: Kind[] = ['block', 'item', 'mob']

/**
 * 自检报告（由 npm run selfcheck 离线生成并落盘）。
 *
 * 面板只读这份 JSON，不在浏览器里跑检查 —— 那些检查要读磁盘和起 Chrome。
 * 显式声明形状而不是直接 `as`：JSON 是外部产物，字段缺失时要在编译期暴露出来，
 * 而不是运行时白屏。
 */
interface SelfcheckReport {
  generatedAt: string
  offline: boolean
  counts: { total: number; passed: number; failed: number; skipped: number }
  checks: Array<{
    id: string
    label: string
    detail: string
    command: string
    status: 'passed' | 'failed' | 'skipped'
    ms: number
    lines: string[]
  }>
  size: { catalog: number; transformations: number; questions: number; sprites: number }
}

const selfcheck = rawSelfcheck as SelfcheckReport

/** 把 ISO 时间显示成本地时刻；解析失败就原样返回，不让面板崩掉 */
const formatCheckedAt = (iso: string): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const SELFCHECK_AT = formatCheckedAt(selfcheck.generatedAt)

const EMPTY_STATS: PlayerStats = {
  score: 0,
  streak: 0,
  bestStreak: 0,
  solved: 0,
  skipped: 0,
  knowledge: { lit: {}, solvedIds: [], wrong: {} },
}

interface QaRecord {
  key: string
  label: string
  answer: boolean
  group: string
}

const readStats = (): PlayerStats => {
  try {
    return JSON.parse(localStorage.getItem('mc-guess-stats') ?? '') as PlayerStats
  } catch {
    return EMPTY_STATS
  }
}

const todayKey = () => new Date().toISOString().slice(0, 10)

function LoadingScreen() {
  return (
    <main className="loading-shell" aria-label="正在加载题库">
      <div className="loading-brand" />
      <div className="loading-grid">
        <div className="loading-panel" />
        <div className="loading-panel loading-panel-wide" />
      </div>
      <p>正在装载 Java 版完整注册表…</p>
    </main>
  )
}

function MiniRecipe({ recipe }: { recipe: Transform }) {
  const isGrid = recipe.layout === 'grid-shaped' || recipe.layout === 'grid-shapeless'
  const cells = canonicalGrid(recipe)
  if (!isGrid) {
    const resultEntry = entryForTransform(recipe)
    return (
      <div className="mini-recipe mini-inline">
        <span className={`method-badge method-${recipe.method}`}>{METHOD_LABELS[recipe.method]}</span>
        <span className="mini-inline-items">
          {recipe.inputs.map((input, index) => {
            // 燃料槽是「任意可燃物」，没有具体候选名，统一显示成「燃料」
            const entry = input.fuelSlot ? null : entryForName(input.names[0])
            return (
              <span key={index} className="mini-inline-item">
                {input.fuelSlot ? '任意燃料' : (entry?.zhName ?? input.names[0])}
                {recipe.inputs.length > 1 && index < recipe.inputs.length - 1 ? ' + ' : ''}
              </span>
            )
          })}
          <span className="mini-arrow" aria-hidden="true">→</span>
          <strong>{resultEntry?.zhName ?? recipe.result}</strong>
        </span>
      </div>
    )
  }
  return (
    <div className="mini-recipe">
      <div className="mini-grid">
        {cells.map((cell, index) => {
          const entry = cell ? entryForName(cell) : null
          const sprite = entry ? spriteUrlFor(entry) : null
          return (
            <span key={index} className={cell ? 'filled' : ''}>
              {sprite ? <img src={sprite} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
            </span>
          )
        })}
      </div>
      <small>{recipe.method === 'craft_shapeless' ? '无序' : '有序'} · 产出 {recipe.count} · {METHOD_LABELS[recipe.method]}</small>
    </div>
  )
}

/** 主玩法 + 挑战玩法合起来的视图联合类型 */
type GameView = 'guess' | 'craft' | 'chain' | 'quiz' | ArcadeView

/**
 * 挑战玩法的入口清单。
 *
 * 和上面四个主玩法分开渲染：九个入口平铺会让侧栏很长，
 * 而且两者的心智不同 —— 主玩法是「认出这是什么」，挑战玩法是「比大小 / 倒推 / 听声」。
 */
const ARCADE_VIEWS: Array<{ view: ArcadeView; label: string; Icon: typeof Scales }> = [
  { view: 'duel', label: '属性对决', Icon: Scales },
  { view: 'reverse', label: '逆向合成', Icon: Shuffle },
  { view: 'odd', label: '找异类', Icon: Hourglass },
  { view: 'sound', label: '盲猜音效', Icon: SpeakerHigh },
  { view: 'daily', label: '每日挑战', Icon: CalendarDots },
]

function App() {
  const reduceMotion = useReducedMotion()
  const [loading, setLoading] = useState(true)
  const [gameView, setGameView] = useState<GameView>('guess')
  /** 当前是否在挑战玩法里 —— 侧栏与主区都要按它分流 */
  const isArcade = ARCADE_VIEWS.some((item) => item.view === gameView)
  const [gameMode, setGameMode] = useState<GameMode>('endless')
  const [difficulty, setDifficulty] = useState<Difficulty>('survival')
  const [selectedKinds, setSelectedKinds] = useState<Kind[]>(ALL_KINDS)
  const [history, setHistory] = useState<string[]>([])
  const [current, setCurrent] = useState<CatalogEntry>(() => pickEntry(data.catalog, []))
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<RoundStatus>('playing')
  const [revealedClues, setRevealedClues] = useState(getInitialHintCount('survival'))
  const [attempts, setAttempts] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [round, setRound] = useState(1)
  const [stats, setStats] = useState<PlayerStats>(readStats)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [collectionQuery, setCollectionQuery] = useState('')
  const [collectionKind, setCollectionKind] = useState<Kind | 'all'>('all')
  const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null)
  const [motionPaused, setMotionPaused] = useState(false)
  const [copied, setCopied] = useState(false)
  const [questionInput, setQuestionInput] = useState('')
  const [qaLog, setQaLog] = useState<QaRecord[]>([])
  const [askedIds, setAskedIds] = useState<string[]>([])
  const [askError, setAskError] = useState('')

  const pool = useMemo(
    () => data.catalog.filter((entry) => selectedKinds.includes(entry.kind)),
    [selectedKinds],
  )
  const clues = useMemo(() => makeClues(current), [current])
  const suggestions = useMemo(() => {
    const query = input.trim().toLowerCase()
    if (!query || status !== 'playing') return []
    const matchesId = (entry: CatalogEntry) => entry.name.includes(query.replaceAll(' ', '_'))
    return pool
      .filter((entry) => entry.zhName.toLowerCase().includes(query)
        || entry.displayName.toLowerCase().includes(query)
        || matchesId(entry))
      .slice(0, 6)
  }, [input, pool, status])

  const suggestedAsks = useMemo(
    () => suggestedQuestions(current, askedIds, 8),
    [askedIds, current],
  )

  const collectionResults = useMemo(() => {
    const query = collectionQuery.trim().toLowerCase()
    return data.catalog.filter((entry) => {
      const kindMatches = collectionKind === 'all' || entry.kind === collectionKind
      const queryMatches = !query
        || entry.zhName.toLowerCase().includes(query)
        || entry.displayName.toLowerCase().includes(query)
        || entry.name.includes(query.replaceAll(' ', '_'))
      return kindMatches && queryMatches
    })
  }, [collectionKind, collectionQuery])

  const persistStats = useCallback((recipe: (previous: PlayerStats) => PlayerStats) => {
    setStats((previous) => {
      const next = recipe(previous)
      localStorage.setItem('mc-guess-stats', JSON.stringify(next))
      return next
    })
  }, [])

  /**
   * 知识地图的派生值。
   *
   * 挂在 App 而不是 QuizGame 里：QuizGame 只负责答对时上报，
   * 展示留在侧栏，切到猜谜 / 合成视图时面板整体不渲染。
   * 老存档没有 knowledge 字段，readKnowledge 兜底成空进度。
   */
  const facetStates = useMemo(() => facetStatesFor(readKnowledge(stats)), [stats])
  const knowledge = useMemo(() => summarizeKnowledge(readKnowledge(stats)), [stats])
  /**
   * 错题本。与知识地图同源（同一份 readKnowledge），但方向相反：
   * 知识地图是「掌握了多少」，错题本是「还有哪些该复习」。
   *
   * 两者刻意不合并成一个组件：一个是成就、一个是待办，
   * 混在一起侧栏就既不像奖杯也不像任务列表。
   */
  const mistakes = useMemo(() => mistakeListFor(readKnowledge(stats)), [stats])
  const mistakeStats = useMemo(() => summarizeMistakes(readKnowledge(stats)), [stats])
  /**
   * 错题本「重练这道题」的一次性请求。
   * 用 nonce 而不是把选中项长期受控：点一下 → QuizGame 练完 → 消费掉 → 回到正常抽题。
   * 父组件不用管何时清空选中态，nonce 保证同一道题点几次都练得到。
   */
  const [reviewRequest, setReviewRequest] = useState<{ questionId: string; nonce: number } | null>(null)
  const startReview = useCallback((questionId: string) => {
    setReviewRequest((previous) => ({ questionId, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [])
  const clearReview = useCallback(() => setReviewRequest(null), [])
  const knowledgeTotalRatio = knowledge.totalQuestions > 0
    ? knowledge.litQuestions / knowledge.totalQuestions
    : 0

  const startRound = useCallback((kinds = selectedKinds, mode = gameMode) => {
    const nextPool = data.catalog.filter((entry) => kinds.includes(entry.kind))
    const dailySeed = mode === 'daily' ? `${todayKey()}-${kinds.join('-')}` : undefined
    const next = pickEntry(nextPool, history, dailySeed)
    setCurrent(next)
    setHistory((previous) => [...previous.slice(-39), next.id])
    setInput('')
    setAttempts([])
    setFeedback('')
    setStatus('playing')
    setRevealedClues(getInitialHintCount(difficulty))
    setQuestionInput('')
    setQaLog([])
    setAskedIds([])
    setAskError('')
    setRound((previous) => previous + 1)
  }, [difficulty, gameMode, history, selectedKinds])

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 420)
    return () => window.clearTimeout(timer)
  }, [])

  const handleKindToggle = (kind: Kind) => {
    const nextKinds = selectedKinds.includes(kind)
      ? selectedKinds.filter((candidate) => candidate !== kind)
      : [...selectedKinds, kind]
    if (!nextKinds.length) {
      setFeedback('至少保留一种题目类型。')
      return
    }
    setSelectedKinds(nextKinds)
    setFeedback('题库筛选已更新。')
    startRound(nextKinds, gameMode)
  }

  const handleModeChange = (mode: GameMode) => {
    setGameMode(mode)
    startRound(selectedKinds, mode)
  }

  const handleSubmit = () => {
    if (status !== 'playing') {
      if (gameMode === 'endless') {
        startRound()
      } else {
        handleModeChange('endless')
      }
      return
    }
    if (!input.trim()) {
      setFeedback('先输入中文译名、英文名或注册名。')
      return
    }
    if (isCorrectAnswer(input, current)) {
      const points = getScore(difficulty, revealedClues, attempts.length)
      setStatus('correct')
      setFeedback(`命中目标，获得 ${points} 分。`)
      persistStats((previous) => ({
        ...previous,
        score: previous.score + points,
        streak: previous.streak + 1,
        bestStreak: Math.max(previous.bestStreak, previous.streak + 1),
        solved: previous.solved + 1,
      }))
      return
    }
    setAttempts((previous) => [...previous, input.trim()])
    setRevealedClues((previous) => Math.min(clues.length, previous + 1))
    setFeedback('没有命中。再公开一条线索。')
    setInput('')
    persistStats((previous) => ({ ...previous, streak: 0 }))
  }

  const askQuestion = (rawValue: string) => {
    const value = rawValue.trim()
    if (status !== 'playing') {
      setAskError('本题已结束，换一题继续提问吧。')
      return
    }
    if (!value) {
      setAskError('先写一个问句，例如「它是方块吗」。')
      return
    }
    const result = answerQuestion(value, current)
    if (!result) {
      setAskError('这句话我没读懂，换个说法或点下面的推荐问句。')
      return
    }
    const record: QaRecord = {
      key: `${result.question.id}-${Date.now()}-${qaLog.length}`,
      label: result.question.label,
      answer: result.answer,
      group: result.question.group,
    }
    setQaLog((previous) => [record, ...previous])
    setAskedIds((previous) => (previous.includes(result.question.id) ? previous : [...previous, result.question.id]))
    setQuestionInput('')
    setAskError('')
  }

  const revealHint = () => {
    if (revealedClues >= clues.length || status !== 'playing') return
    setRevealedClues((previous) => Math.min(clues.length, previous + 1))
    setFeedback('线索已公开，本题得分会相应减少。')
  }

  const giveUp = () => {
    setStatus('revealed')
    setRevealedClues(clues.length)
    setFeedback(`答案是 ${current.zhName}（${current.displayName}）。`)
    persistStats((previous) => ({ ...previous, streak: 0, skipped: previous.skipped + 1 }))
  }

  const shareResult = async () => {
    const result = `猜方块 · ${DIFFICULTY_LABELS[difficulty]}\n${status === 'correct' ? '已猜中' : '已揭晓'}：${current.zhName}\n尝试 ${attempts.length + (status === 'correct' ? 1 : 0)} 次 · 提问 ${qaLog.length} 句 · 连胜 ${stats.streak} · 总分 ${stats.score}`
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setFeedback('浏览器未允许复制，请手动分享结果。')
    }
  }

  if (loading) return <LoadingScreen />

  if (!data.catalog.length) {
    return (
      <main className="error-state">
        <Database size={34} weight="duotone" />
        <h1>题库没有成功载入</h1>
        <p>请重新生成本地数据并刷新页面。</p>
      </main>
    )
  }

  return (
    <div className={motionPaused ? 'app reduce-motion' : 'app'}>
      <header className="topbar">
        <button className="brand" type="button" onClick={() => startRound()} aria-label="开始新题">
          <span className="brand-cube"><Cube weight="fill" /></span>
          <span>
            <strong>猜方块</strong>
            <small>MINEDEX // FIELD TEST</small>
          </span>
        </button>
        <div className="version-strip" aria-label="当前题库版本">
          <span className="live-dot" />
          JAVA {data.meta.version}
          <span>{data.meta.counts.totalEntries.toLocaleString('zh-CN')} 个条目</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={() => setMotionPaused((value) => !value)} title={motionPaused ? '恢复动画' : '暂停动画'}>
            {motionPaused ? <Play /> : <Pause />}
          </button>
          <button className="library-button" type="button" onClick={() => setCollectionOpen(true)}>
            <BookOpen weight="duotone" />
            全图鉴
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-rail">
          <section className="rail-section">
            <span className="eyebrow">00 / 主玩法</span>
            <div className="mode-switch">
              <button className={gameView === 'guess' ? 'active' : ''} type="button" onClick={() => setGameView('guess')}>
                <Question /> 猜物品
              </button>
              <button className={gameView === 'craft' ? 'active' : ''} type="button" onClick={() => setGameView('craft')}>
                <Cube /> 合成配方
              </button>
              <button className={gameView === 'chain' ? 'active' : ''} type="button" onClick={() => setGameView('chain')}>
                <Hammer /> 组合工序
              </button>
              <button className={gameView === 'quiz' ? 'active' : ''} type="button" onClick={() => setGameView('quiz')}>
                <SealCheck /> 知识问答
              </button>
            </div>

            {/*
              新玩法单独一组。九个入口平铺会把侧栏撑得很长，
              而且「猜」类和「挑战」类玩的心智不一样，混在一起反而难找。
            */}
            <span className="eyebrow mode-group">01 / 挑战玩法</span>
            <div className="mode-switch">
              {ARCADE_VIEWS.map(({ view, label, Icon }) => (
                <button
                  className={gameView === view ? 'active' : ''}
                  key={view}
                  type="button"
                  onClick={() => setGameView(view)}
                >
                  <Icon /> {label}
                </button>
              ))}
            </div>
            {gameView === 'quiz' && (
              <p className="rail-note">
                <strong>每题都带版本信息</strong>
                现行 {QUIZ_META.latestRelease}（{QUIZ_META.latestReleaseName}）· 数据 {QUIZ_META.dataVersion} · 共 {QUIZ_META.counts.total} 道题。
                当前难度：{QUIZ_TIERS[difficulty].label}。答题区里可以直接切难度、切练习 / 考试模式。
              </p>
            )}
          </section>

          {gameView !== 'quiz' && (
          <section className="rail-section">
            <span className="eyebrow">01 / 题目来源</span>
            <div className="segmented vertical">
              {ALL_KINDS.map((kind) => (
                <button
                  className={selectedKinds.includes(kind) ? 'active' : ''}
                  key={kind}
                  type="button"
                  onClick={() => handleKindToggle(kind)}
                  aria-pressed={selectedKinds.includes(kind)}
                >
                  <span>{KIND_LABELS[kind]}</span>
                  <small>{kind === 'block' ? data.meta.counts.blocks : kind === 'item' ? data.meta.counts.items : data.meta.counts.entities}</small>
                </button>
              ))}
            </div>
          </section>
          )}

          <section className="rail-section">
            <span className="eyebrow">02 / 游戏模式</span>
            <div className="mode-switch">
              <button className={gameMode === 'endless' ? 'active' : ''} type="button" onClick={() => handleModeChange('endless')}>
                <ArrowClockwise /> 无尽
              </button>
              <button className={gameMode === 'daily' ? 'active' : ''} type="button" onClick={() => handleModeChange('daily')}>
                <Target /> 每日
              </button>
            </div>
          </section>

          <section className="rail-section">
            <span className="eyebrow">03 / 难度</span>
            <label className="select-label" htmlFor="difficulty">{gameView === 'quiz' ? '出题范围' : '提示公开程度'}</label>
            <select id="difficulty" value={difficulty} onChange={(event) => {
              const nextDifficulty = event.target.value as Difficulty
              setDifficulty(nextDifficulty)
              setRevealedClues(getInitialHintCount(nextDifficulty))
            }}>
              {gameView === 'quiz' ? (
                <>
                  <option value="explorer">探险家 · 只考 MC 基础事实</option>
                  <option value="survival">生存 · 基础 + 配方与加工</option>
                  <option value="hardcore">极限 · 冷门机制与官方 Bug</option>
                </>
              ) : (
                <>
                  <option value="explorer">探险家 · 3 条起始线索</option>
                  <option value="survival">生存 · 2 条起始线索</option>
                  <option value="hardcore">极限 · 1 条起始线索</option>
                </>
              )}
            </select>
          </section>

          <section className="stat-ledger" aria-label="游戏统计">
            <div>
              <span>总分</span>
              <strong>{stats.score.toLocaleString('zh-CN')}</strong>
            </div>
            <div>
              <span>连胜</span>
              <strong>{String(stats.streak).padStart(2, '0')}</strong>
            </div>
            <div>
              <span>最佳</span>
              <strong>{String(stats.bestStreak).padStart(2, '0')}</strong>
            </div>
          </section>

          {/* 知识地图：只在答题视图出现 —— 收集进度来自答题，其他玩法没有贡献 */}
          {gameView === 'quiz' && (
            <section className="knowledge-map" aria-label="知识地图">
              <header>
                <h2>知识地图</h2>
                <span>
                  {knowledge.litFacets} / {knowledge.totalFacets} 个知识点
                </span>
              </header>
              <p className="knowledge-hint">
                答对一题就点亮一个知识点。进度只记「掌握过哪些维度」，不记答案。
              </p>
              <div className="knowledge-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(knowledgeTotalRatio * 100)}%` }} />
              </div>
              <small className="knowledge-sub">
                已掌握 {knowledge.litQuestions} / {knowledge.totalQuestions} 道题
              </small>
              <ul className="knowledge-facets">
                {facetStates.map((facet) => (
                  <li
                    key={facet.key}
                    className={facet.blank ? 'blank' : 'lit'}
                    title={`${facet.group} · ${facet.litCount} / ${facet.total} 道`}
                  >
                    <span className="knowledge-facet-name">{facet.key}</span>
                    <span className="knowledge-facet-track" aria-hidden="true">
                      <span style={{ width: `${Math.round(facet.ratio * 100)}%` }} />
                    </span>
                    <span className="knowledge-facet-count">
                      {facet.litCount}/{facet.total}
                    </span>
                  </li>
                ))}
              </ul>
              {knowledge.blanks.length > 0 && (
                <p className="knowledge-blanks">
                  完全空白的维度（{knowledge.blanks.length} 个）：
                  {knowledge.blanks.slice(0, 5).map((facet) => facet.key).join('、')}
                  {knowledge.blanks.length > 5 ? ' 等' : ''}
                </p>
              )}
            </section>
          )}

          {/*
            错题本。只在答题视图出现 —— 错题也来自答题。
            零泄漏：不显示答案、不显示玩家当初选了什么，只显示「哪道题错了几次」。
            点「重练」是玩家主动去答，答错时本来也看不到对错。
          */}
          {gameView === 'quiz' && (
            <section className="mistake-book" aria-label="错题本">
              <header>
                <h2>错题本</h2>
                <span>
                  {mistakeStats.total > 0
                    ? `${mistakeStats.total} 道待复习`
                    : '暂无错题'}
                </span>
              </header>
              {mistakeStats.total === 0 ? (
                <p className="mistake-empty">
                  答错的题会自动收进来。连续答对一次就自动移出。
                </p>
              ) : (
                <>
                  <p className="mistake-hint">
                    累计答错 {mistakeStats.attempts} 次
                    {mistakeStats.onceOnly > 0 && `，其中 ${mistakeStats.onceOnly} 道只错过一次`}
                  </p>
                  {mistakeStats.weakest.length > 0 && (
                    <div className="mistake-weakest">
                      <span className="mistake-weakest-label">最该补的知识点</span>
                      <ul>
                        {mistakeStats.weakest
                          .filter((item) => item.wrongCount > 0)
                          .map((item) => (
                            <li key={item.key} title={`${item.group} · 累计错 ${item.wrongCount} 次，该维度共 ${item.total} 道`}>
                              <strong>{item.key}</strong>
                              <span>错 {item.wrongCount} 次</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                  <ol className="mistake-list">
                    {mistakes.slice(0, 12).map((item) => (
                      <li key={item.question.id}>
                        <div className="mistake-body">
                          <span className="mistake-prompt">{item.question.prompt}</span>
                          <span className="mistake-meta">
                            {item.facetKey}
                            {item.tier === 'obscure' && ' · 极限'}
                          </span>
                        </div>
                        <span className="mistake-times" title={`答错 ${item.times} 次`}>
                          ×{item.times}
                        </span>
                        <button
                          type="button"
                          className="mistake-review"
                          onClick={() => startReview(item.question.id)}
                        >
                          重练
                        </button>
                      </li>
                    ))}
                  </ol>
                  {mistakes.length > 12 && (
                    <p className="mistake-more">
                      还有 {mistakes.length - 12} 道错题，按错误次数排在前面的优先复习。
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {/*
            数据自检面板。
            与错题本不同，它跟玩家答得对不对无关，讲的是「这个项目的素材和题库还健不健康」。
            所以三个视图都显示，不藏进答题页。

            数据是**离线跑出来落盘**的（npm run selfcheck），不是实时探测 ——
            面板上标了检查时间，不假装是实时的。其中三项要真实 HTTP 服务才能跑，
            离线生成时会标成「本次未跑」而不是伪装通过。
          */}
          <section className="selfcheck" aria-label="数据自检">
            <header>
              <h2>数据自检</h2>
              <span>
                {selfcheck.counts.failed > 0
                  ? `${selfcheck.counts.failed} 项异常`
                  : `${selfcheck.counts.passed} / ${selfcheck.counts.total} 通过`}
              </span>
            </header>
            <p className="selfcheck-when">
              检查于 {SELFCHECK_AT} · {selfcheck.offline ? '离线三项（未跑浏览器与预览类）' : '全量'}
            </p>
            <ul className="selfcheck-list">
              {selfcheck.checks.map((check) => (
                <li key={check.id} data-status={check.status} className={`selfcheck-item is-${check.status}`}>
                  <span className="selfcheck-dot" aria-hidden="true" />
                  <div className="selfcheck-body">
                    <strong>
                      {check.label}
                      {check.status === 'skipped'
                        ? <em>本次未跑</em>
                        : <em>{check.ms}ms</em>}
                    </strong>
                    <small>{check.detail}</small>
                    {check.lines.length > 0 && (
                      <ul className="selfcheck-lines">
                        {check.lines.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    )}
                    {check.status === 'failed' && (
                      <code className="selfcheck-cmd">{check.command}</code>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="selfcheck-size">
              图鉴 {selfcheck.size.catalog} 条 · 工序 {selfcheck.size.transformations} 条 · 题库 {selfcheck.size.questions} 道 · 贴图 {selfcheck.size.sprites} 张
            </p>
          </section>
        </aside>

        {isArcade ? (
          <ArcadeGame
            view={gameView as ArcadeView}
            difficulty={difficulty}
            onExit={() => setGameView('guess')}
          />
        ) : gameView === 'quiz' ? (
          <QuizGame
            difficulty={difficulty}
            gameMode={gameMode}
            onDifficultyChange={(next) => {
              setDifficulty(next)
              setRevealedClues(getInitialHintCount(next))
            }}
            persistStats={persistStats}
            reviewRequest={reviewRequest}
            onReviewConsumed={clearReview}
          />
        ) : gameView === 'guess' ? (
        <section className="game-bay">
          <div className="game-heading">
            <div>
              <span className="eyebrow">FIELD TEST / ROUND {String(round).padStart(3, '0')}</span>
              <h1>看线索、问是非，锁定目标。</h1>
            </div>
            <div className="difficulty-badge">
              {difficulty === 'hardcore' ? <Skull weight="duotone" /> : difficulty === 'survival' ? <Flame weight="duotone" /> : <Sparkle weight="duotone" />}
              {DIFFICULTY_LABELS[difficulty]}
            </div>
          </div>

          <div className="round-status" aria-label="本轮进度">
            <div>
              <span>线索</span>
              <strong>{revealedClues} / {clues.length}</strong>
            </div>
            <div>
              <span>提问</span>
              <strong>{String(qaLog.length).padStart(2, '0')}</strong>
            </div>
            <div>
              <span>试错</span>
              <strong>{String(attempts.length).padStart(2, '0')}</strong>
            </div>
            <div>
              <span>本题可得</span>
              <strong>{getScore(difficulty, revealedClues, attempts.length)}</strong>
            </div>
          </div>

          <div className="game-grid">
            <div className="target-zone">
              <div className="target-meta">
                <span>{KIND_LABELS[current.kind]}</span>
                <span>#{String(current.registryId).padStart(4, '0')}</span>
              </div>
              <EntrySprite
                key={current.id}
                entry={current}
                solved={status !== 'playing'}
                eager
              />
              <AnimatePresence mode="wait">
                {status === 'playing' ? (
                  <motion.div key="unknown" className="answer-mask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <small>IDENTITY LOCKED</small>
                    <strong>{Array.from({ length: Math.min(14, current.zhName.length) }, () => '■').join(' ')}</strong>
                  </motion.div>
                ) : (
                  <motion.div key="answer" className={`answer-reveal ${status}`} initial={reduceMotion ? false : { y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                    <small>{status === 'correct' ? 'TARGET CONFIRMED' : 'TARGET REVEALED'}</small>
                    <strong>{current.zhName}</strong>
                    <code>{current.displayName} · minecraft:{current.name}</code>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="side-stack">
              <section className="clue-zone" aria-label="线索">
                <div className="clue-title">
                  <div>
                    <span className="eyebrow">04 / 线索</span>
                    <h2>已解锁 {revealedClues} / {clues.length} 条</h2>
                  </div>
                  <div className="signal-bars" aria-hidden="true">
                    {clues.map((_, index) => <span key={index} className={index < revealedClues ? 'on' : ''} />)}
                  </div>
                </div>
                <ol className="clue-list" aria-live="polite">
                  {clues.map((clue, index) => (
                    <motion.li
                      key={`${current.id}-${index}`}
                      className={index < revealedClues ? 'revealed' : 'locked'}
                      initial={false}
                      animate={{ opacity: index < revealedClues ? 1 : 0.5 }}
                    >
                      <span className="clue-index">{String(index + 1).padStart(2, '0')}</span>
                      <div className="clue-body">
                        <span className="clue-tag">{index < revealedClues ? clue.tag : '待解锁'}</span>
                        <p>{index < revealedClues ? clue.text : '这条线索还没放出，多问一句或猜错一次就会解锁。'}</p>
                      </div>
                      {index < revealedClues ? <Eye weight="duotone" /> : <span className="lock-mark" />}
                    </motion.li>
                  ))}
                </ol>
              </section>

              <section className="ask-zone" aria-label="是非问答">
                <div className="ask-head">
                  <div>
                    <span className="eyebrow">05 / 是非问答</span>
                    <h2>你说一句，我只回答「是」或「不是」</h2>
                  </div>
                  <div className="ask-count">
                    <Question weight="duotone" />
                    <strong>{String(qaLog.length).padStart(2, '0')}</strong>
                  </div>
                </div>

                <div className="ask-input-row">
                  <ChatCircleDots aria-hidden="true" />
                  <input
                    id="question"
                    autoComplete="off"
                    lang="zh-CN"
                    value={questionInput}
                    disabled={status !== 'playing'}
                    onChange={(event) => setQuestionInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') askQuestion(questionInput)
                    }}
                    placeholder="它是方块吗？它会发光吗？硬度大于 3 吗？"
                  />
                  <button type="button" onClick={() => askQuestion(questionInput)} disabled={status !== 'playing'}>
                    提问
                  </button>
                </div>

            <div className="ask-chips">
              <span className="ask-chips-label">试试这些问法</span>
              {suggestedAsks.map((question) => (
                <button key={question.id} type="button" onClick={() => askQuestion(question.label)} disabled={status !== 'playing'}>
                  {question.label}
                </button>
              ))}
            </div>

            {askError && <p className="ask-error">{askError}</p>}

            <div className="qa-log-wrap">
              {qaLog.length ? (
                <ol className="qa-log">
                  <AnimatePresence initial={false}>
                    {qaLog.map((record) => (
                      <motion.li
                        key={record.key}
                        className={record.answer ? 'yes' : 'no'}
                        initial={reduceMotion ? false : { opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                      >
                        <span className="qa-group">{record.group}</span>
                        <p>{record.label}</p>
                        <strong>{record.answer ? '是' : '不是'}</strong>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
              ) : (
                <p className="qa-empty">
                  <ChatCircleDots size={22} />
                  直接问我任何是非题，或者点上面推荐的问句开始缩小范围。
                </p>
              )}
            </div>
            </section>
            </div>
          </div>

          <div className="answer-console">
            <div className="input-block">
              <span className="eyebrow">06 / 报上名字</span>
              <label htmlFor="answer">输入中文标准译名（也支持英文名与注册名）</label>
              <div className="input-row">
                <MagnifyingGlass aria-hidden="true" />
                <input
                  id="answer"
                  autoComplete="off"
                  lang="zh-CN"
                  value={input}
                  disabled={status !== 'playing'}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSubmit()
                  }}
                  placeholder="例如：橡木门 / Oak Door / oak_door"
                />
                <button className="submit-button" type="button" onClick={handleSubmit}>
                  {status === 'playing' ? '确认答案' : gameMode === 'endless' ? '下一题' : '进入无尽'}
                </button>
              </div>
              <AnimatePresence>
                {suggestions.length > 0 && (
                  <motion.div className="suggestions" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                    {suggestions.map((entry) => (
                      <button key={entry.id} type="button" onClick={() => setInput(entry.displayName)}>
                        <span>{entry.displayName}</span>
                        <small>{KIND_LABELS[entry.kind]} · {entry.zhName} · {entry.name}</small>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="console-actions">
              <button type="button" onClick={revealHint} disabled={revealedClues >= clues.length || status !== 'playing'}>
                <Lightbulb weight="duotone" /> 再给提示
              </button>
              {status === 'playing' ? (
                <button type="button" onClick={giveUp}><Eye /> 揭晓答案</button>
              ) : (
                <button type="button" onClick={shareResult}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '分享战绩'}</button>
              )}
            </div>
            <div className={`feedback ${status}`} aria-live="polite">
              <span>{feedback || '答案支持中文标准译名、官方英文名与 minecraft 注册名。'}</span>
              {attempts.length > 0 && <small>未命中：{attempts.slice(-3).join(' / ')}</small>}
            </div>
          </div>
        </section>
        ) : (
          <CraftingGame
            difficulty={difficulty}
            gameMode={gameMode}
            kinds={selectedKinds}
            persistStats={persistStats}
            chain={gameView === 'chain'}
          />
        )}
      </main>

      <footer className="coverage-bar">
        <div><Database weight="duotone" /><span>方块状态</span><strong>{data.meta.counts.blockStates.toLocaleString('zh-CN')}</strong></div>
        <div><GameController weight="duotone" /><span>生物特殊状态</span><strong>{data.meta.counts.entitySpecialStates.toLocaleString('zh-CN')}</strong></div>
        <div><ClockCounterClockwise weight="duotone" /><span>物品组件变体</span><strong>{data.meta.counts.itemSpecialStates.toLocaleString('zh-CN')}</strong></div>
        <p>图标与建模：Mojang 官方客户端资源（Java {data.meta.version}）· 译名来源：{data.meta.translationSource ?? '中文 Minecraft Wiki'} · 非 Mojang 官方产品</p>
      </footer>

      <AnimatePresence>
        {collectionOpen && (
          <motion.div className="collection-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCollectionOpen(false)
          }}>
            <motion.section className="collection-panel" role="dialog" aria-modal="true" aria-label="Minecraft 全图鉴" initial={reduceMotion ? false : { x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }}>
              <header>
                <div>
                  <span className="eyebrow">MINEDEX / JAVA {data.meta.version}</span>
                  <h2>完整图鉴</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => setCollectionOpen(false)} title="关闭图鉴"><X /></button>
              </header>
              <div className="collection-tools">
                <label>
                  <span>检索名称</span>
                  <div><MagnifyingGlass /><input value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} placeholder="搜索 2,827 个条目（支持中文译名）" /></div>
                </label>
                <div className="collection-tabs">
                  {(['all', ...ALL_KINDS] as const).map((kind) => (
                    <button key={kind} className={collectionKind === kind ? 'active' : ''} type="button" onClick={() => setCollectionKind(kind)}>
                      {kind === 'all' ? '全部' : KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="collection-content">
                <div className="catalog-list">
                  <div className="catalog-count">找到 {collectionResults.length.toLocaleString('zh-CN')} 项 · 当前显示前 200 项</div>
                  {collectionResults.length ? collectionResults.slice(0, 200).map((entry) => (
                    <button key={entry.id} className={selectedEntry?.id === entry.id ? 'selected' : ''} type="button" onClick={() => setSelectedEntry(entry)}>
                      <span className={`kind-pip ${entry.kind}`} />
                      {spriteUrlFor(entry)
                        ? <img className="row-sprite" src={spriteUrlFor(entry) ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} />
                        : <span className="row-sprite row-sprite-empty" aria-hidden="true" />}
                      <span><strong>{entry.zhName}</strong><small>{entry.displayName} · {entry.name}</small></span>
                      <em>{entry.variantCount > 1 ? `${entry.variantCount.toLocaleString('zh-CN')} 状态` : KIND_LABELS[entry.kind]}</em>
                    </button>
                  )) : (
                    <div className="catalog-empty"><MagnifyingGlass size={30} /><strong>没有匹配条目</strong><span>试试中文译名、英文名或 minecraft 注册名。</span></div>
                  )}
                </div>
                <div className="catalog-detail">
                  {selectedEntry ? (
                    <>
                      <EntrySprite entry={selectedEntry} solved eager className="detail-sprite" />
                      <span className="eyebrow">{KIND_LABELS[selectedEntry.kind]} / #{selectedEntry.registryId}</span>
                      <h3>{selectedEntry.zhName}</h3>
                      <code>{selectedEntry.displayName} · minecraft:{selectedEntry.name}</code>
                      <dl>
                        <div><dt>家族</dt><dd>{selectedEntry.family}</dd></div>
                        <div><dt>状态量</dt><dd>{selectedEntry.variantCount.toLocaleString('zh-CN')}</dd></div>
                        {Object.entries(selectedEntry.facts).slice(0, 6).map(([key, value]) => (
                          <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
                        ))}
                      </dl>
                      <div className="state-index">
                        <h4>变种与特殊状态</h4>
                        {selectedEntry.specialStates.length ? selectedEntry.specialStates.map((state) => <span key={state}>{state}</span>) : <p>该注册条目没有额外状态。</p>}
                      </div>
                      <div className="state-index">
                        <h4>合成配方</h4>
                        {transformsForName(selectedEntry.name, 3).length
                          ? transformsForName(selectedEntry.name, 3).map((recipe) => <MiniRecipe key={recipe.id} recipe={recipe} />)
                          : <p>该条目没有合成表（只能靠掉落、交易或其他方式获得）。</p>}
                      </div>
                    </>
                  ) : (
                    <div className="catalog-prompt"><Cube size={42} weight="duotone" /><strong>选择一个条目</strong><span>查看完整属性、合法方块状态与特殊实体状态。</span></div>
                  )}
                </div>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
