import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  Check,
  Cube,
  Drop,
  Eraser,
  Eye,
  Fire,
  Hammer,
  Knife,
  Lightbulb,
  Scales,
  Scissors,
  Shuffle,
  Warning,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getScore } from '../game'
import { spriteUrlFor } from '../sprites'
import {
  acceptedNames,
  buildPalette,
  buildToolPalette,
  chainForResult,
  checkPlacement,
  correctToolFor,
  entryForName,
  entryForTransform,
  expectedSlots,
  fuelSlotIndex,
  isToolMethod,
  METHOD_LABELS,
  nextHintCell,
  pickChain,
  pickTransform,
  roundSeed,
  slotCount,
  toolResultFor,
  transformPool,
} from '../transforms'
import type { ChainStep } from '../transforms'
import type { Difficulty, GameMode, Kind, PlayerStats, Transform } from '../types'

const METHOD_ICON: Record<string, typeof Hammer> = {
  craft_shaped: Cube,
  craft_shapeless: Cube,
  smelt: Fire,
  blast: Fire,
  smoke: Fire,
  campfire: Fire,
  stonecut: Scissors,
  wax: Drop,
  scrape: Drop,
  strip: Knife,
  smith: Hammer,
}

interface SlotBoardProps {
  transform: Transform
  slots: (string | null)[]
  locked: boolean[]
  wrongCells: number[]
  disabled: boolean
  onPlace: (index: number, name?: string | null) => void
}

function SlotBoard({ transform, slots, locked, wrongCells, disabled, onPlace }: SlotBoardProps) {
  const count = slotCount(transform)
  const renderSlot = (index: number) => {
    const name = slots[index]
    const entry = name ? entryForName(name) : null
    const sprite = entry ? spriteUrlFor(entry) : null
    const isWrong = wrongCells.includes(index)
    const isLocked = locked[index]
    return (
      <button
        key={index}
        type="button"
        aria-disabled={disabled}
        className={`craft-cell ${name ? 'filled' : ''} ${isLocked ? 'locked' : ''} ${isWrong ? 'wrong' : ''}`}
        onClick={() => onPlace(index, name ? null : undefined)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          onPlace(index, event.dataTransfer.getData('text/plain') || undefined)
        }}
        title={entry ? entry.zhName : '空格'}
        aria-label={`第 ${index + 1} 格${entry ? `：${entry.zhName}` : '：空'}`}
      >
        {sprite
          ? <img src={sprite} alt="" draggable={false} />
          : name && <span className="craft-cell-text">{entry?.zhName.slice(0, 2)}</span>}
        {isLocked && <span className="craft-lock" aria-hidden="true"><Lightbulb weight="fill" /></span>}
      </button>
    )
  }

  const stationClass = `method-${transform.method}`

  if (transform.layout === 'single') {
    return (
      <div className={`slot-single ${stationClass}`}>
        {renderSlot(0)}
        <span className="slot-label">{transform.method === 'stonecut' ? '待切材料' : '待处理材料'}</span>
      </div>
    )
  }
  if (transform.layout === 'dual') {
    return (
      <div className={`slot-dual ${stationClass}`}>
        {renderSlot(0)}
        <span className="slot-plus" aria-hidden="true">+</span>
        {renderSlot(1)}
      </div>
    )
  }
  if (transform.layout === 'furnace') {
    return (
      <div className={`slot-furnace ${stationClass}`}>
        <div className="furnace-slot">
          {renderSlot(0)}
          <span className="slot-label">材料</span>
        </div>
        <span className="slot-plus" aria-hidden="true">+</span>
        <div className="furnace-slot">
          {renderSlot(1)}
          <span className="slot-label">燃料</span>
        </div>
      </div>
    )
  }
  return (
    <div className="craft-grid-wrap">
      <div className={`craft-grid ${stationClass}`} role="grid" aria-label="3×3 工作台">
        {Array.from({ length: count }, (_, index) => renderSlot(index))}
      </div>
      <p className="craft-grid-hint">整份配方可以放在 3×3 的任意位置，左右挪一格、转半圈也照样能合成 —— 只要材料的相对结构没变。</p>
    </div>
  )
}

interface PaletteProps {
  items: { name: string; zhName: string; sprite: string | null }[]
  selected: string | null
  onSelect: (name: string) => void
  note: string
  disabled: boolean
}

function Palette({ items, selected, onSelect, note, disabled }: PaletteProps) {
  return (
    <section className="craft-palette" aria-label="候选材料">
      <span className="eyebrow">材料</span>
      <h2>点一下选中，再点格子放进去（也可以直接拖）</h2>
      <div className="palette-list">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            className={selected === item.name ? 'active' : ''}
            draggable={!disabled}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', item.name)}
            onClick={() => onSelect(item.name)}
            title={item.name}
          >
            {item.sprite
              ? <img src={item.sprite} alt="" draggable={false} />
              : <span className="palette-empty" aria-hidden="true" />}
            <span>{item.zhName}</span>
          </button>
        ))}
      </div>
      <p className="palette-note">{note}</p>
    </section>
  )
}

/**
 * chainData 还是 null 时的空步骤表。
 *
 * 必须是模块级常量而不是每次渲染新建 `[]`：
 * useMemo 的依赖数组按引用比较，每次都新建空数组会让 memo 永远失效。
 */
const EMPTY_STEPS: ChainStep[] = []

const methodBadge = (method: string) => {
  const Icon = METHOD_ICON[method] ?? Hammer
  return (
    <span className={`method-badge method-${method}`}>
      <Icon weight="duotone" />
      {METHOD_LABELS[method] ?? method}
    </span>
  )
}

interface ChainToolStepProps {
  stepIndex: number
  method: string
  sourceName: string
  resultName: string
  resultSprite: string | null
  count: number
  tools: { name: string; zhName: string; sprite: string | null }[]
  selectedTool: string | null
  done: boolean
  wrong: boolean
  disabled: boolean
  onSelectTool: (stepIndex: number, name: string) => void
  onApply: (stepIndex: number, toolName: string) => void
}

function ChainToolStep({
  stepIndex,
  method,
  sourceName,
  resultName,
  resultSprite,
  count,
  tools,
  selectedTool,
  done,
  wrong,
  disabled,
  onSelectTool,
  onApply,
}: ChainToolStepProps) {
  const sourceEntry = entryForName(sourceName)
  const sourceSprite = sourceEntry ? spriteUrlFor(sourceEntry) : null
  const targetEntry = entryForName(resultName)
  const ready = Boolean(selectedTool) && !disabled
  const apply = () => {
    if (selectedTool) onApply(stepIndex, selectedTool)
  }

  return (
    <div className={`chain-tool-step ${done ? 'done' : ''} ${wrong ? 'wrong' : ''}`}>
      <div className="chain-step-head">
        <span className="chain-step-no">第 {stepIndex + 1} 步</span>
        {methodBadge(method)}
      </div>

      <div className="chain-tool-work">
        <button
          type="button"
          className={`tool-target-block small ${ready ? 'ready' : ''}`}
          onClick={apply}
          disabled={disabled}
          title={ready ? '点击用选中的工具处理' : '先选一个工具'}
        >
          {sourceSprite ? <img src={sourceSprite} alt="" draggable={false} /> : <span className="craft-result-empty" aria-hidden="true" />}
          {done && <span className="chain-tool-done" aria-hidden="true"><Check weight="bold" /></span>}
        </button>
        <div className="chain-tool-meta">
          <strong>{sourceEntry?.zhName ?? sourceName}</strong>
          <small>目标方块</small>
        </div>
      </div>

      <div className="chain-tool-belt">
        <span className="chain-tool-belt-label">选工具</span>
        <div className="tool-list compact">
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className={`tool-item ${selectedTool === tool.name ? 'active' : ''}`}
              onClick={() => onSelectTool(stepIndex, tool.name)}
              disabled={disabled}
              title={tool.zhName}
            >
              {tool.sprite ? <img src={tool.sprite} alt="" draggable={false} /> : <span className="palette-empty" aria-hidden="true" />}
              <span>{tool.zhName}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="chain-produces">
        <span aria-hidden="true">→</span>
        {resultSprite ? <img src={resultSprite} alt="" draggable={false} /> : null}
        <strong>{targetEntry?.zhName ?? resultName}</strong>
        {count > 1 && <em>×{count}</em>}
      </div>
    </div>
  )
}

export function CraftingGame({
  difficulty,
  gameMode,
  kinds,
  persistStats,
  chain = false,
}: {
  difficulty: Difficulty
  gameMode: GameMode
  kinds: Kind[]
  persistStats: (recipe: (previous: PlayerStats) => PlayerStats) => void
  chain?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [round, setRound] = useState(1)
  const [history, setHistory] = useState<string[]>([])

  const pool = useMemo(() => transformPool(kinds), [kinds])

  const [transform, setTransform] = useState<Transform | null>(null)
  const [chainData, setChainData] = useState<ReturnType<typeof chainForResult> | null>(null)

  const [slots, setSlots] = useState<(string | null)[]>([])
  const [locked, setLocked] = useState<boolean[]>([])
  const [stepSlots, setStepSlots] = useState<(string | null)[][]>([])
  const [stepLocked, setStepLocked] = useState<boolean[][]>([])

  const [selected, setSelected] = useState<string | null>(null)
  const [palette, setPalette] = useState<{ name: string; zhName: string; sprite: string | null }[]>([])
  const [toolPalette, setToolPalette] = useState<{ name: string; zhName: string; sprite: string | null; correct: boolean }[]>([])
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  // 组合工序：每步独立的工具 belt / 选中工具 / 是否已用正确工具处理
  const [stepToolPalettes, setStepToolPalettes] = useState<{ name: string; zhName: string; sprite: string | null; correct: boolean }[][]>([])
  const [stepTools, setStepTools] = useState<(string | null)[]>([])
  const [stepToolDone, setStepToolDone] = useState<boolean[]>([])
  const [activeToolStep, setActiveToolStep] = useState<number | null>(null)
  const [status, setStatus] = useState<'playing' | 'correct' | 'revealed'>('playing')
  const [attempts, setAttempts] = useState(0)
  const [hints, setHints] = useState(0)
  const [wrongCells, setWrongCells] = useState<number[]>([])
  const [wrongSteps, setWrongSteps] = useState<number[]>([])
  const [feedback, setFeedback] = useState('')

  const seed = useMemo(
    () => roundSeed(gameMode, kinds, round, chain ? 'chain' : 'craft'),
    [gameMode, kinds, round, chain],
  )

  const startRound = useCallback(() => {
    if (!pool.length) return
    const nextHistory = history
    if (chain) {
      const chainResult = pickChain(kinds, nextHistory, seed)
      if (!chainResult) {
        setFeedback('暂时没有可组合的目标，换个筛选试试。')
        return
      }
      setChainData(chainResult)
      setTransform(null)
      const steps = chainResult.steps
      setStepSlots(steps.map((step) => Array.from({ length: slotCount(step.transform) }, () => null)))
      setStepLocked(steps.map((step) => Array.from({ length: slotCount(step.transform) }, () => false)))
      setStepToolPalettes(steps.map((step) => (isToolMethod(step.transform.method)
        ? buildToolPalette(step.transform, difficulty, seed)
        : [])))
      setStepTools(steps.map(() => null))
      setStepToolDone(steps.map(() => false))
      setActiveToolStep(null)
      // 每一步要用的材料（含烧制步骤的代表燃料），最后一步的盘面为基础，其余步骤缺的补上
      const allLeaves = [...new Set(steps.flatMap((step) => acceptedNames(step.transform, difficulty, seed)))]
      const base = buildPalette(steps[steps.length - 1].transform, difficulty, seed)
      const baseNames = new Set(base.map((b) => b.name))
      const extra = allLeaves
        .filter((name) => !baseNames.has(name) && entryForName(name))
        .map((name) => {
          const entry = entryForName(name)!
          return { name, zhName: entry.zhName, sprite: spriteUrlFor(entry) }
        })
      setPalette([
        ...base.map((item) => ({ name: item.name, zhName: item.zhName, sprite: spriteUrlFor(item.entry) })),
        ...extra,
      ])
    } else {
      const next = pickTransform(pool, nextHistory, seed)
      setTransform(next)
      setChainData(null)
      setSlots(Array.from({ length: slotCount(next) }, () => null))
      setLocked(Array.from({ length: slotCount(next) }, () => false))
      if (isToolMethod(next.method)) {
        setToolPalette(buildToolPalette(next, difficulty, seed))
        setPalette([])
      } else {
        const built = buildPalette(next, difficulty, seed)
        setPalette(built.map((item) => ({ name: item.name, zhName: item.zhName, sprite: spriteUrlFor(item.entry) })))
        setToolPalette([])
      }
    }
    setSelected(null)
    setActiveTool(null)
    setCursorPos(null)
    setStatus('playing')
    setAttempts(0)
    setHints(0)
    setWrongCells([])
    setWrongSteps([])
    setFeedback('')
    setHistory((previous) => [...previous.slice(-39), chain ? chainData?.target ?? '' : transform?.result ?? ''])
  }, [pool, kinds, history, seed, chain, difficulty, chainData, transform])

  useEffect(() => {
    setHistory([])
    setRound(1)
    startRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds, difficulty, chain])

  const heldToolName = chain
    ? (activeToolStep !== null ? stepTools[activeToolStep] ?? null : null)
    : activeTool
  const heldToolSprite = chain
    ? (activeToolStep !== null
      ? stepToolPalettes[activeToolStep]?.find((t) => t.name === stepTools[activeToolStep])?.sprite ?? null
      : null)
    : toolPalette.find((t) => t.name === activeTool)?.sprite ?? null

  useEffect(() => {
    if (!heldToolName) return undefined
    const handleMove = (event: MouseEvent) => setCursorPos({ x: event.clientX, y: event.clientY })
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [heldToolName])

  const placeSingle = (index: number, name?: string | null) => {
    if (status !== 'playing' || !transform) return
    if (locked[index]) return
    const value = name ?? selected
    setSlots((previous) => {
      const next = [...previous]
      next[index] = previous[index] && !value ? null : value ?? previous[index]
      return next
    })
    setWrongCells([])
    setFeedback('')
  }

  const placeStep = (stepIndex: number, index: number, name?: string | null) => {
    if (status !== 'playing' || !chainData) return
    if (stepLocked[stepIndex]?.[index]) return
    const value = name ?? selected
    setStepSlots((previous) => {
      const next = previous.map((s) => [...s])
      next[stepIndex][index] = previous[stepIndex][index] && !value ? null : value ?? previous[stepIndex][index]
      return next
    })
    setWrongSteps([])
    setFeedback('')
  }

  const verify = () => {
    if (status !== 'playing') return
    if (chain) {
      if (!chainData) return
      const results = chainData.steps.map((step, i) => (
        isToolMethod(step.transform.method)
          ? { correct: Boolean(stepToolDone[i]) }
          : checkPlacement(step.transform, stepSlots[i])
      ))
      const allCorrect = results.every((r) => r.correct)
      if (allCorrect) {
        const points = getScore(difficulty, hints, attempts)
        setStatus('correct')
        setFeedback(`工序全部正确，获得 ${points} 分。`)
        persistStats((previous) => ({
          ...previous,
          score: previous.score + points,
          streak: previous.streak + 1,
          bestStreak: Math.max(previous.bestStreak, previous.streak + 1),
          solved: previous.solved + 1,
        }))
        return
      }
      setWrongSteps(results.map((r, i) => (r.correct ? -1 : i)).filter((i) => i >= 0))
      setAttempts((previous) => previous + 1)
      setFeedback('有一步还不对：材料类检查摆放，工具类先用正确工具点掉目标方块。')
      persistStats((previous) => ({ ...previous, streak: 0 }))
      return
    }
    if (!transform) return
    if (!slots.some(Boolean)) {
      setFeedback('先把材料放进对应格子里。')
      return
    }
    const result = checkPlacement(transform, slots)
    if (result.correct) {
      const points = getScore(difficulty, hints, attempts)
      setStatus('correct')
      setWrongCells([])
      setFeedback(`配方正确，获得 ${points} 分。`)
      persistStats((previous) => ({
        ...previous,
        score: previous.score + points,
        streak: previous.streak + 1,
        bestStreak: Math.max(previous.bestStreak, previous.streak + 1),
        solved: previous.solved + 1,
      }))
      return
    }
    setWrongCells(result.wrongCells)
    setAttempts((previous) => previous + 1)
    setFeedback('还差点意思，再对照一下材料与位置。')
    persistStats((previous) => ({ ...previous, streak: 0 }))
  }

  const hintCell = () => {
    if (status !== 'playing') return
    if (chain) {
      if (!chainData) return
      for (let stepIndex = 0; stepIndex < chainData.steps.length; stepIndex += 1) {
        const step = chainData.steps[stepIndex]
        if (isToolMethod(step.transform.method)) {
          if (stepToolDone[stepIndex]) continue
          const correct = correctToolFor(step.transform)
          if (!correct) continue
          setStepTools((previous) => {
            const next = [...previous]
            next[stepIndex] = correct
            return next
          })
          setActiveToolStep(stepIndex)
          setHints((h) => h + 1)
          setFeedback(`第 ${stepIndex + 1} 步已提示正确工具，本题得分会相应减少。`)
          return
        }
        const cell = nextHintCell(step.transform, stepSlots[stepIndex], stepLocked[stepIndex])
        if (cell === null) continue
        const expected = expectedSlots(step.transform)[cell]
        setStepSlots((previous) => {
          const next = previous.map((s) => [...s])
          next[stepIndex][cell] = expected
          return next
        })
        setStepLocked((previous) => {
          const next = previous.map((s) => [...s])
          next[stepIndex][cell] = true
          return next
        })
        setHints((h) => h + 1)
        setFeedback('已替你放好一格，本题得分会相应减少。')
        return
      }
      setFeedback('没有可以提示的步骤了。')
      return
    }
    if (!transform) return
    const cell = nextHintCell(transform, slots, locked)
    if (cell === null) {
      setFeedback('没有可以提示的格子了。')
      return
    }
    const expected = expectedSlots(transform)[cell]
    setSlots((previous) => {
      const next = [...previous]
      next[cell] = expected
      return next
    })
    setLocked((previous) => {
      const next = [...previous]
      next[cell] = true
      return next
    })
    setHints((h) => h + 1)
    setWrongCells([])
    setFeedback('已替你放好一格，本题得分会相应减少。')
  }

  const reveal = () => {
    if (status !== 'playing') return
    if (chain) {
      if (!chainData) return
      setStepSlots(chainData.steps.map((step) => expectedSlots(step.transform)))
      setStepLocked(chainData.steps.map((step) => Array.from({ length: slotCount(step.transform) }, () => true)))
      // 工具类步骤：直接点亮正确工具并标记为已完成
      setStepTools(chainData.steps.map((step) => (
        isToolMethod(step.transform.method) ? correctToolFor(step.transform) : null
      )))
      setStepToolDone(chainData.steps.map((step) => isToolMethod(step.transform.method)))
      setActiveToolStep(null)
      setStatus('revealed')
      setFeedback('这是完整的组合工序：先完成上一步，再做下一步。')
      persistStats((previous) => ({ ...previous, streak: 0, skipped: previous.skipped + 1 }))
      return
    }
    if (!transform) return
    setSlots(expectedSlots(transform))
    setLocked(Array.from({ length: slotCount(transform) }, () => true))
    setStatus('revealed')
    setFeedback(`正确答案是 ${entryForTransform(transform)?.zhName ?? transform.result} 的${METHOD_LABELS[transform.method]}配方。`)
    persistStats((previous) => ({ ...previous, streak: 0, skipped: previous.skipped + 1 }))
  }

  const applyTool = (toolName: string) => {
    if (status !== 'playing' || !transform) return
    const correct = correctToolFor(transform)
    if (!correct) return
    if (toolName === correct) {
      const points = getScore(difficulty, hints, attempts)
      setStatus('correct')
      setFeedback(`处理正确，获得 ${points} 分。`)
      persistStats((previous) => ({
        ...previous,
        score: previous.score + points,
        streak: previous.streak + 1,
        bestStreak: Math.max(previous.bestStreak, previous.streak + 1),
        solved: previous.solved + 1,
      }))
      return
    }
    const targetName = transform.inputs[0]?.names[0]
    const wrongResult = targetName ? toolResultFor(targetName, toolName) : null
    setAttempts((previous) => previous + 1)
    persistStats((previous) => ({ ...previous, streak: 0 }))
    if (wrongResult) {
      const entry = entryForName(wrongResult)
      setFeedback(`你把它处理成了 ${entry?.zhName ?? wrongResult}，但目标产物不是这个。`)
    } else {
      setFeedback('不能用这个工具处理。')
    }
  }

  const applyStepTool = (stepIndex: number, toolName: string) => {
    if (status !== 'playing' || !chainData) return
    const step = chainData.steps[stepIndex]
    if (!step || !isToolMethod(step.transform.method)) return
    const correct = correctToolFor(step.transform)
    if (!correct) return
    if (toolName === correct) {
      setStepToolDone((previous) => {
        const next = [...previous]
        next[stepIndex] = true
        return next
      })
      setFeedback(`第 ${stepIndex + 1} 步处理正确。`)
      return
    }
    const source = step.transform.inputs[0]?.names[0]
    const wrongResult = source ? toolResultFor(source, toolName) : null
    setAttempts((previous) => previous + 1)
    persistStats((previous) => ({ ...previous, streak: 0 }))
    if (wrongResult) {
      const entry = entryForName(wrongResult)
      setFeedback(`你把它处理成了 ${entry?.zhName ?? wrongResult}，但目标产物不是这个。`)
    } else {
      setFeedback('不能用这个工具处理。')
    }
  }

  const hintTool = () => {
    if (status !== 'playing' || !transform) return
    const correct = correctToolFor(transform)
    if (!correct) return
    setActiveTool(correct)
    setHints((previous) => previous + 1)
    setFeedback('已提示正确工具，本题得分会相应减少。')
  }

  const revealTool = () => {
    if (status !== 'playing' || !transform) return
    const correct = correctToolFor(transform)
    if (!correct) return
    setStatus('revealed')
    setActiveTool(correct)
    setFeedback(`正确工具是 ${toolPalette.find((t) => t.name === correct)?.zhName ?? correct}。`)
    persistStats((previous) => ({ ...previous, streak: 0, skipped: previous.skipped + 1 }))
  }

  const nextRound = () => {
    setRound((previous) => previous + 1)
    startRound()
  }

  /**
   * 以下四个派生值必须在所有 early return 之前算完。
   *
   * Hook 不能条件调用：写在 `if (chain) { ... }` 里面的话，
   * 玩家从「组合工序」切到「合成配方」时 Hook 数量会突然减少，
   * React 直接抛错「Rendered fewer hooks than expected」把整页搞崩。
   * chainData 可能为 null，所以每个都做了空值兜底。
   */
  const steps = chainData?.steps ?? EMPTY_STEPS
  // 只有「非工具」步骤才用材料盘；工具步骤自带工具 belt
  const slotSteps = useMemo(
    () => steps.filter((step) => !isToolMethod(step.transform.method)),
    [steps],
  )
  /**
   * 材料盘里「本轮用得上」的名称集合。
   *
   * 必须 useMemo：acceptedNames 要对每一步做一次配方展开（每步遍历全部转化条目），
   * 步数一多就是几十上百次计算。而这条路径在渲染体内 —— 玩家每放一次材料、
   * 每点一次工具都会重渲整个组件，不缓存就是每次交互都重算一遍。
   */
  const slotLeaves = useMemo(
    () => new Set(slotSteps.flatMap((s) => acceptedNames(s.transform, difficulty, seed))),
    [slotSteps, difficulty, seed],
  )
  const doneCount = useMemo(
    () => steps.filter((step, i) => (isToolMethod(step.transform.method) ? stepToolDone[i] : false)).length,
    [steps, stepToolDone],
  )
  const toolStepCount = useMemo(
    () => steps.filter((s) => isToolMethod(s.transform.method)).length,
    [steps],
  )

  if (!pool.length) {
    return (
      <section className="game-bay">
        <div className="craft-empty">
          <Warning size={34} weight="duotone" />
          <h1>当前筛选条件下没有可用转化</h1>
          <p>请在左侧勾选「方块」或「物品」，这两类才有合成 / 烧制等配方。</p>
        </div>
      </section>
    )
  }

  if (chain) {
    if (!chainData) return null
    const targetEntry = entryForName(chainData.target)
    const targetSprite = targetEntry ? spriteUrlFor(targetEntry) : null
    const paletteNote = slotSteps.length
      ? `材料里混了 ${Math.max(0, palette.length - slotLeaves.size)} 个用不上的干扰项。`
      : '本轮每一步都是工具类处理：选工具 → 点目标方块。'
    return (
      <section className="game-bay">
        <div className="game-heading">
          <div>
            <span className="eyebrow">COMBINED CRAFT / ROUND {String(round).padStart(3, '0')}</span>
            <h1>组合工序：先操作，再合成。</h1>
            <p className="chain-lead">
              每一步的材料都可以放在工作台的任意位置，转半圈、左右镜像也算同一份配方 —— 只要材料的相对结构没变。
            </p>
          </div>
          <div className="difficulty-badge"><Shuffle weight="duotone" />组合工序</div>
        </div>

        <div className="round-status" aria-label="本轮进度">
          <div>
            <span>工序</span>
            <strong>{toolStepCount ? `${doneCount} / ${toolStepCount} 工具` : `${chainData.steps.length} 步`}</strong>
          </div>
          <div><span>提示</span><strong>{String(hints).padStart(2, '0')}</strong></div>
          <div><span>试错</span><strong>{String(attempts).padStart(2, '0')}</strong></div>
          <div><span>本题可得</span><strong>{getScore(difficulty, hints, attempts)}</strong></div>
        </div>

        <div className="chain-target">
          <span className="eyebrow">最终产物</span>
          <div className="craft-result">
            {targetSprite ? <img src={targetSprite} alt="" draggable={false} /> : <span className="craft-result-empty" aria-hidden="true" />}
          </div>
          <h2>{targetEntry?.zhName}</h2>
          <code>{targetEntry?.displayName} · minecraft:{chainData.target}</code>
        </div>

        <div className="chain-steps">
          {chainData.steps.map((step, stepIndex) => {
            const entry = entryForTransform(step.transform)
            const sprite = entry ? spriteUrlFor(entry) : null
            if (isToolMethod(step.transform.method)) {
              return (
                <ChainToolStep
                  key={stepIndex}
                  stepIndex={stepIndex}
                  method={step.transform.method}
                  sourceName={step.transform.inputs[0]?.names[0] ?? ''}
                  resultName={step.transform.result}
                  resultSprite={sprite}
                  count={step.transform.count}
                  tools={stepToolPalettes[stepIndex] ?? []}
                  selectedTool={stepTools[stepIndex] ?? null}
                  done={Boolean(stepToolDone[stepIndex])}
                  wrong={wrongSteps.includes(stepIndex)}
                  disabled={status !== 'playing'}
                  onSelectTool={(index, name) => {
                    setStepTools((previous) => {
                      const next = [...previous]
                      next[index] = previous[index] === name ? null : name
                      return next
                    })
                    setActiveToolStep(index)
                    setFeedback('')
                  }}
                  onApply={applyStepTool}
                />
              )
            }
            return (
              <div className={`chain-step ${wrongSteps.includes(stepIndex) ? 'wrong' : ''}`} key={stepIndex}>
                <div className="chain-step-head">
                  <span className="chain-step-no">第 {stepIndex + 1} 步</span>
                  {methodBadge(step.transform.method)}
                </div>
                <SlotBoard
                  transform={step.transform}
                  slots={stepSlots[stepIndex]}
                  locked={stepLocked[stepIndex]}
                  wrongCells={[]}
                  disabled={status !== 'playing'}
                  onPlace={(index, name) => placeStep(stepIndex, index, name)}
                />
                <div className="chain-produces">
                  <span aria-hidden="true">→</span>
                  {sprite ? <img src={sprite} alt="" draggable={false} /> : null}
                  <strong>{entry?.zhName ?? step.produces}</strong>
                  {step.transform.count > 1 && <em>×{step.transform.count}</em>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="craft-side">
          {slotSteps.length > 0 ? (
            <Palette items={palette} selected={selected} onSelect={(name) => setSelected((p) => (p === name ? null : name))} note={paletteNote} disabled={status !== 'playing'} />
          ) : (
            <div className="chain-tool-only-note">
              <Scales weight="duotone" />
              <div>
                <strong>本轮没有需要摆材料的步骤</strong>
                <p>{paletteNote}</p>
              </div>
            </div>
          )}
          <div className="craft-actions">
            <button className="submit-button" type="button" onClick={status === 'playing' ? verify : nextRound}>
              {status === 'playing' ? <><Hammer /> 校验工序</> : <><ArrowClockwise /> 下一题</>}
            </button>
            <div className="craft-secondary">
              <button type="button" onClick={hintCell} disabled={status !== 'playing'}><Lightbulb weight="duotone" /> 提示一格</button>
              {status === 'playing'
                ? <button type="button" onClick={reveal}><Eye /> 揭晓工序</button>
                : <button type="button" onClick={nextRound}><Check /> 继续</button>}
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={`${status}-${feedback}`} className={`feedback ${status}`} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} aria-live="polite">
              <span>{feedback || '按从上到下的顺序完成每一步，最后点校验。'}</span>
            </motion.div>
          </AnimatePresence>
        </div>

        {heldToolName && cursorPos && heldToolSprite && (
          <div
            className="tool-cursor"
            style={{ left: cursorPos.x + 12, top: cursorPos.y + 12 }}
            aria-hidden="true"
          >
            <img src={heldToolSprite} alt="" draggable={false} />
          </div>
        )}
      </section>
    )
  }

  if (!transform) return null
  const resultEntry = entryForTransform(transform)
  const resultSprite = resultEntry ? spriteUrlFor(resultEntry) : null

  // 工具类处理：去皮 / 刮蜡 / 涂蜡
  if (isToolMethod(transform.method)) {
    const targetName = transform.inputs[0]?.names[0]
    const targetEntry = targetName ? entryForName(targetName) : null
    const targetSprite = targetEntry ? spriteUrlFor(targetEntry) : null
    const activeToolSprite = activeTool ? toolPalette.find((t) => t.name === activeTool)?.sprite : null

    return (
      <section className="game-bay">
        <div className="game-heading">
          <div>
            <span className="eyebrow">TOOL BENCH / ROUND {String(round).padStart(3, '0')}</span>
            <h1>选对工具，点击目标方块进行处理。</h1>
          </div>
          <div className="difficulty-badge">{methodBadge(transform.method)}</div>
        </div>

        <div className="round-status" aria-label="本轮进度">
          <div><span>工具</span><strong>{activeTool ? toolPalette.find((t) => t.name === activeTool)?.zhName ?? '-' : '未选'}</strong></div>
          <div><span>提示</span><strong>{String(hints).padStart(2, '0')}</strong></div>
          <div><span>试错</span><strong>{String(attempts).padStart(2, '0')}</strong></div>
          <div><span>本题可得</span><strong>{getScore(difficulty, hints, attempts)}</strong></div>
        </div>

        <div className="tool-layout">
          <div className="tool-target">
            <span className="eyebrow">目标方块</span>
            <button
              type="button"
              className={`tool-target-block ${activeTool ? 'ready' : ''} ${status !== 'playing' ? 'disabled' : ''}`}
              onClick={() => activeTool && applyTool(activeTool)}
              disabled={status !== 'playing'}
              title={activeTool ? '点击处理' : '先选一个工具'}
            >
              {targetSprite ? <img src={targetSprite} alt="" draggable={false} /> : <span className="craft-result-empty" aria-hidden="true" />}
            </button>
            <h2>{targetEntry?.zhName}</h2>
            <code>{targetEntry?.displayName} · minecraft:{targetName}</code>
          </div>

          <div className="tool-arrow" aria-hidden="true">→</div>

          <div className="tool-result">
            <span className="eyebrow">目标产物</span>
            <div className={`tool-result-block ${status}`}>
              {status === 'playing'
                ? <span className="tool-result-placeholder">?</span>
                : <>
                    {resultSprite ? <img src={resultSprite} alt="" draggable={false} /> : <span className="craft-result-empty" aria-hidden="true" />}
                    <h2>{resultEntry?.zhName}</h2>
                  </>}
            </div>
          </div>
        </div>

        <div className="tool-belt">
          <span className="eyebrow">工具 belt</span>
          <h2>点选一个工具，再点击上方目标方块</h2>
          <div className="tool-list">
            {toolPalette.map((tool) => (
              <button
                key={tool.name}
                type="button"
                className={`tool-item ${activeTool === tool.name ? 'active' : ''}`}
                onClick={() => setActiveTool((previous) => (previous === tool.name ? null : tool.name))}
                disabled={status !== 'playing'}
                title={tool.zhName}
              >
                {tool.sprite ? <img src={tool.sprite} alt="" draggable={false} /> : <span className="palette-empty" aria-hidden="true" />}
                <span>{tool.zhName}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="craft-side">
          <div className="craft-actions">
            <button className="submit-button" type="button" onClick={status === 'playing' ? () => activeTool && applyTool(activeTool) : nextRound}>
              {status === 'playing' ? <><Hammer /> 处理方块</> : <><ArrowClockwise /> 下一题</>}
            </button>
            <div className="craft-secondary">
              <button type="button" onClick={hintTool} disabled={status !== 'playing'}><Lightbulb weight="duotone" /> 提示工具</button>
              {status === 'playing'
                ? <button type="button" onClick={revealTool}><Eye /> 揭晓</button>
                : <button type="button" onClick={nextRound}><Check /> 继续</button>}
            </div>
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
              <span>{feedback || '先点下面工具 belt 里的工具，再点上方目标方块。'}</span>
            </motion.div>
          </AnimatePresence>
        </div>

        {activeTool && cursorPos && activeToolSprite && (
          <div
            className="tool-cursor"
            style={{ left: cursorPos.x + 12, top: cursorPos.y + 12 }}
            aria-hidden="true"
          >
            <img src={activeToolSprite} alt="" draggable={false} />
          </div>
        )}
      </section>
    )
  }
  const neededCount = transform.layout === 'grid-shapeless'
    ? transform.inputs.length
    : transform.layout === 'single' || transform.layout === 'dual'
      ? transform.inputs.length
      : expectedSlots(transform).filter(Boolean).length
  const placedCount = slots.filter(Boolean).length
  const usableCount = new Set(acceptedNames(transform, difficulty, seed)).size
  const isFurnaceRound = fuelSlotIndex(transform) >= 0
  const paletteNote = isFurnaceRound
    ? `材料里混了 ${Math.max(0, palette.length - usableCount)} 个用不上的干扰项；燃料槽里上面几个，随便拿一个都能烧。`
    : `材料里混了 ${Math.max(0, palette.length - usableCount)} 个用不上的干扰项。`

  return (
    <section className="game-bay">
      <div className="game-heading">
        <div>
          <span className="eyebrow">CRAFTING BENCH / ROUND {String(round).padStart(3, '0')}</span>
          <h1>照着材料，摆出正确的转化方式。</h1>
        </div>
        <div className="difficulty-badge">
          {methodBadge(transform.method)}
        </div>
      </div>

      <div className="round-status" aria-label="本轮进度">
        <div><span>材料位</span><strong>{placedCount} / {neededCount}</strong></div>
        <div><span>提示</span><strong>{String(hints).padStart(2, '0')}</strong></div>
        <div><span>试错</span><strong>{String(attempts).padStart(2, '0')}</strong></div>
        <div><span>本题可得</span><strong>{getScore(difficulty, hints, attempts)}</strong></div>
      </div>

      <div className="craft-layout">
        <div className="craft-target">
          <span className="eyebrow">产物</span>
          <div className="craft-result">
            {resultSprite
              ? <img src={resultSprite} alt="" draggable={false} />
              : <span className="craft-result-empty" aria-hidden="true" />}
            {transform.count > 1 && <em>×{transform.count}</em>}
          </div>
          <h2>{resultEntry?.zhName}</h2>
          <code>{resultEntry?.displayName} · minecraft:{transform.result}</code>
          <p className="craft-hint">
            {transform.layout === 'furnace'
              ? '烧制要把「材料」和「燃料」两格都放对。只要是能点着的东西都能当燃料 —— 煤、木炭、原木、木板、木制工具、竹子、羊毛，甚至工作台和书架；材料盘上那几个燃料随便挑一个放就行。'
              : transform.layout === 'single' || transform.layout === 'dual'
                ? '把需要的材料放进对应格子，操作方式已标在右上角。'
                : transform.method === 'craft_shapeless'
                  ? '这是无序配方：只要把正确的材料放进工作台，摆在哪一格都算对。'
                  : '这是有序配方：形状对就行，整体可以上下左右平移，左右镜像也算对。'}
          </p>
        </div>

        <div className="craft-bench">
          <div className="bench-head">
            <span className="eyebrow">
              {transform.layout === 'furnace'
                ? '熔炉'
                : transform.layout === 'grid-shaped' || transform.layout === 'grid-shapeless'
                  ? '工作台'
                  : '操作台'}
            </span>
            <div className="bench-tools">
              <button type="button" onClick={() => setSlots(Array.from({ length: slotCount(transform) }, () => null))} disabled={status !== 'playing'}>
                <Eraser /> 清空
              </button>
            </div>
          </div>
          <SlotBoard
            transform={transform}
            slots={slots}
            locked={locked}
            wrongCells={wrongCells}
            disabled={status !== 'playing'}
            onPlace={placeSingle}
          />
          <div className={`craft-output ${status}`}>
            {status === 'playing'
              ? <span>等待合成…</span>
              : <>
                {resultSprite && <img src={resultSprite} alt="" draggable={false} />}
                <strong>{resultEntry?.zhName}{transform.count > 1 ? ` ×${transform.count}` : ''}</strong>
              </>}
          </div>
        </div>

        <div className="craft-side">
          <Palette
            items={palette}
            selected={selected}
            onSelect={(name) => setSelected((previous) => (previous === name ? null : name))}
            note={paletteNote}
            disabled={status !== 'playing'}
          />
          <div className="craft-actions">
            <button className="submit-button" type="button" onClick={status === 'playing' ? verify : nextRound}>
              {status === 'playing' ? <><Hammer /> 校验配方</> : <><ArrowClockwise /> 下一题</>}
            </button>
            <div className="craft-secondary">
              <button type="button" onClick={hintCell} disabled={status !== 'playing'}><Lightbulb weight="duotone" /> 提示一格</button>
              {status === 'playing'
                ? <button type="button" onClick={reveal}><Eye /> 揭晓配方</button>
                : <button type="button" onClick={nextRound}><Check /> 继续</button>}
            </div>
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
              <span>{feedback || '先选材料，再在格子里摆出正确配方。'}</span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
