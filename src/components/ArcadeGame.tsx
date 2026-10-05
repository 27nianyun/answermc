import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  Check,
  SpeakerHigh,
  X,
} from '@phosphor-icons/react'

import {
  dailyKey,
  dailyRounds,
  DAILY_LABELS,
  duelRound,
  oddRound,
  reverseRound,
  soundRound,
  SOUND_META,
} from '../arcade'
import type {
  DailyRound,
  DuelRound,
  OddRound,
  ReverseRound,
  SoundRound,
} from '../arcade'
import { accuracyLabel, fetchStats, reportAnswer } from '../stats'
import type { QuestionStat } from '../stats'
import { EntrySprite } from './EntrySprite'
import type { Difficulty } from '../types'

/**
 * 四个新玩法 + 每日挑战。
 *
 * ── 为什么合成一个组件而不是五个 ────────────────────────────
 * 它们共享同一套外壳：出题 → 四选一 → 反馈 → 下一题，
 * 拆成五个文件会让「反馈样式」「计分」「键盘操作」复制五遍。
 * 差异只在题目渲染，所以按 kind 分支渲染题目区即可。
 *
 * ── 与零泄漏的关系 ──────────────────────────────────────────
 * 这些玩法**不是猜谜**：两个方块直接摆出来、音效直接放出来，
 * 题目本身就是公开信息，不存在「未揭晓」状态，因此不受那条铁律约束。
 * 该守的是**答案唯一**（出题侧已用 smoke 保证）。
 */

export type ArcadeView = 'duel' | 'reverse' | 'odd' | 'sound' | 'daily'

/*
标题只在组件内部用，刻意不导出：
Fast Refresh 要求组件文件只导出组件，导出常量会让热更新失效。
（App.tsx 侧栏用的是自己那份 ARCADE_VIEWS 的 label，不依赖这里。）
*/
const ARCADE_TITLES: Record<ArcadeView, { title: string; eyebrow: string }> = {
  duel: { title: '猜谁的更高', eyebrow: 'DUEL / 属性对决' },
  reverse: { title: '这个是怎么做出来的', eyebrow: 'REVERSE / 逆向合成' },
  odd: { title: '找出不合群的', eyebrow: 'ODD ONE OUT / 找异类' },
  sound: { title: '听声辨物', eyebrow: 'SOUND / 盲猜音效' },
  daily: { title: '今日挑战', eyebrow: 'DAILY / 每日一套' },
}

/** 每日挑战里每道题的作答结果 */
type Outcome = 'correct' | 'wrong' | null

interface ArcadeGameProps {
  view: ArcadeView
  difficulty: Difficulty
  onExit: () => void
}

export function ArcadeGame({ view, difficulty, onExit }: ArcadeGameProps) {
  const reduceMotion = useReducedMotion()
  const [round, setRound] = useState(1)
  const [picked, setPicked] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  /** 每日挑战当前题的全球正确率（聚合值，拿不到则为 undefined，不渲染） */
  const [dailyStat, setDailyStat] = useState<QuestionStat | undefined>(undefined)

  // Hook 位置纪律：所有 Hook 必须写在任何条件早退之前
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const isDaily = view === 'daily'

  /** 每日挑战：整套题按日期固定，不随 round 变化 */
  const dailySet = useMemo<DailyRound[]>(
    () => (isDaily ? dailyRounds() : []),
    // dailyRounds 只依赖当天日期，日期在一天内不变，不必进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDaily, dailyKey()],
  )

  const duel = useMemo<DuelRound | null>(
    () => (view === 'duel' ? duelRound(difficulty, `duel-${round}-${difficulty}`) : null),
    [view, difficulty, round],
  )
  const reverse = useMemo<ReverseRound | null>(
    () => (view === 'reverse' ? reverseRound(difficulty, `reverse-${round}-${difficulty}`) : null),
    [view, difficulty, round],
  )
  const odd = useMemo<OddRound | null>(
    () => (view === 'odd' ? oddRound(difficulty, `odd-${round}-${difficulty}`) : null),
    [view, difficulty, round],
  )
  const sound = useMemo<SoundRound | null>(
    () => (view === 'sound' ? soundRound(difficulty, `sound-${round}-${difficulty}`) : null),
    [view, difficulty, round],
  )

  /** 每日挑战的当前题 */
  const dailyItem = isDaily ? dailySet[(round - 1) % Math.max(1, dailySet.length)] : null

  /** 每日挑战每道题的稳定 id（按日期 + 玩法类型），用于全球正确率聚合 */
  const dailyId = isDaily && dailyItem ? `daily:${dailyKey()}:${dailyItem.kind}` : null

  /** 当前题的四个选项（不同玩法来源不同） */
  const options: string[] = useMemo(() => {
    if (isDaily) {
      const item = dailyItem
      if (!item) return []
      if (item.duel) return ['左边', '右边', '一样高']
      if (item.reverse) return item.reverse.options
      if (item.odd) return item.odd.items.map((entry) => entry.zhName)
      if (item.sound) return item.sound.options
      return []
    }
    if (duel) return ['左边', '右边', '一样高']
    if (reverse) return reverse.options
    if (odd) return odd.items.map((entry) => entry.zhName)
    if (sound) return sound.options
    return []
  }, [isDaily, dailyItem, duel, reverse, odd, sound])

  /** 正确答案下标 */
  const answerIndex = useMemo(() => {
    if (isDaily) {
      const item = dailyItem
      if (!item) return -1
      if (item.duel) {
        return item.duel.answer === 'left' ? 0 : item.duel.answer === 'right' ? 1 : 2
      }
      return item.reverse?.answerIndex ?? item.odd?.answerIndex ?? item.sound?.answerIndex ?? -1
    }
    if (duel) return duel.answer === 'left' ? 0 : duel.answer === 'right' ? 1 : 2
    return reverse?.answerIndex ?? odd?.answerIndex ?? sound?.answerIndex ?? -1
  }, [isDaily, dailyItem, duel, reverse, odd, sound])

  const answered = picked !== null
  const outcome: Outcome = picked === null ? null : picked === answerIndex ? 'correct' : 'wrong'

  /** 答后揭示的说明 */
  const note = useMemo(() => {
    if (!answered) return ''
    if (isDaily) {
      const item = dailyItem
      if (!item) return ''
      if (item.duel) return item.duel.explanation
      if (item.reverse) return item.reverse.explanation
      if (item.odd) return item.odd.reason
      if (item.sound) return `这是${item.sound.sound.zh}的声音。`
      return ''
    }
    if (duel) return duel.explanation
    if (reverse) return reverse.explanation
    if (odd) return odd.reason
    if (sound) return `这是${sound.sound.zh}的声音。`
    return ''
  }, [answered, isDaily, dailyItem, duel, reverse, odd, sound])

  /** 当前要播放的音效文件路径 */
  const soundFile = isDaily ? dailyItem?.sound?.sound.file : sound?.sound.file

  const playSound = useCallback(() => {
    if (!soundFile) return
    // 每次重播都重新起一个 Audio：同一个实例连续 play() 会被浏览器忽略
    const audio = new Audio(soundFile)
    audioRef.current = audio
    void audio.play().catch(() => { /* 用户还没交互过，静默失败即可 */ })
  }, [soundFile])

  // 换题时自动播一次（音效玩法的核心交互）
  useEffect(() => {
    if (!soundFile) return
    const timer = setTimeout(playSound, 220)
    return () => clearTimeout(timer)
  }, [soundFile, playSound])

  // 切换玩法或难度时重置本局
  useEffect(() => {
    setRound(1)
    setPicked(null)
  }, [view, difficulty])

  // 每日挑战：拉取当前题的全球正确率。拿不到就保持 undefined（不渲染那一行），
  // 答题本身照常，统计只是增强项。竞态保护同 QuizGame。
  useEffect(() => {
    if (!isDaily || !dailyId) return
    let cancelled = false
    void fetchStats([dailyId]).then((map) => {
      if (!cancelled) setDailyStat(map.get(dailyId))
    })
    return () => { cancelled = true }
  }, [isDaily, dailyId])

  const choose = (index: number) => {
    if (answered) return
    setPicked(index)
    // 每日挑战：把这次作答记进全球正确率（其他玩法每题都是随机抽的，
    // 按题聚合没有意义；只有每日挑战固定同一天同一套，聚合才有可比性）
    if (isDaily && dailyId) {
      setDailyStat(reportAnswer(dailyId, index === answerIndex) ?? dailyStat)
    }
    if (index === answerIndex) {
      const next = streak + 1
      setStreak(next)
      setBest((previous) => Math.max(previous, next))
      setCorrectCount((previous) => previous + 1)
    } else {
      setStreak(0)
    }
  }

  const nextRound = () => {
    setRound((previous) => previous + 1)
    setPicked(null)
  }

  const heading = ARCADE_TITLES[view]

  const renderPrompt = () => {
    if (isDaily && dailyItem) {
      const kindLabel = DAILY_LABELS[dailyItem.kind]
      if (dailyItem.duel) {
        return (
          <>
            <p className="arcade-lead">
              <span className="arcade-kind">{kindLabel}</span>
              谁的<strong>{dailyItem.duel.metric}</strong>更高？
            </p>
            <div className="duel-stage">
              <DuelSide entry={dailyItem.duel.left} side="左" />
              <span className="duel-vs">VS</span>
              <DuelSide entry={dailyItem.duel.right} side="右" />
            </div>
          </>
        )
      }
      if (dailyItem.reverse) {
        return (
          <>
            <p className="arcade-lead">
              <span className="arcade-kind">{kindLabel}</span>
              <strong>{dailyItem.reverse.result.zhName}</strong>是怎么来的？
            </p>
            <div className="reverse-target">
              <EntrySprite entry={dailyItem.reverse.result} solved className="sprite-compact" />
              <div>
                <strong>{dailyItem.reverse.result.zhName}</strong>
                <span>
                  {dailyItem.reverse.kind === 'method'
                    ? '选出它所用的加工方式'
                    : '选出还缺的那一样原料'}
                </span>
                {dailyItem.reverse.given.length > 0 && (
                  <em>已知还需要：{dailyItem.reverse.given.join('、')}</em>
                )}
              </div>
            </div>
          </>
        )
      }
      if (dailyItem.odd) {
        return (
          <>
            <p className="arcade-lead">
              <span className="arcade-kind">{kindLabel}</span>
              四个里哪一个不是同一族？
            </p>
            <div className="odd-grid">
              {dailyItem.odd.items.map((entry) => (
                <div className="odd-cell" key={entry.id}>
                  <EntrySprite entry={entry} solved className="sprite-compact" />
                  <span>{entry.zhName}</span>
                </div>
              ))}
            </div>
          </>
        )
      }
      if (dailyItem.sound) {
        return (
          <>
            <p className="arcade-lead">
              <span className="arcade-kind">{kindLabel}</span>
              这是什么发出的声音？
            </p>
            <SoundPlayer onPlay={playSound} />
          </>
        )
      }
      return null
    }

    if (duel) {
      return (
        <>
          <p className="arcade-lead">谁的<strong>{duel.metric}</strong>更高？</p>
          <div className="duel-stage">
            <DuelSide entry={duel.left} side="左" />
            <span className="duel-vs">VS</span>
            <DuelSide entry={duel.right} side="右" />
          </div>
        </>
      )
    }
    if (reverse) {
      return (
        <>
          <p className="arcade-lead"><strong>{reverse.result.zhName}</strong>是怎么来的？</p>
          <div className="reverse-target">
            <EntrySprite entry={reverse.result} solved className="sprite-compact" />
            <div>
              <strong>{reverse.result.zhName}</strong>
              <span>
                {reverse.kind === 'method' ? '选出它所用的加工方式' : '选出还缺的那一样原料'}
              </span>
              {reverse.given.length > 0 && <em>已知还需要：{reverse.given.join('、')}</em>}
            </div>
          </div>
        </>
      )
    }
    if (odd) {
      return (
        <>
          <p className="arcade-lead">四个里哪一个不是同一族？</p>
          <div className="odd-grid">
            {odd.items.map((entry) => (
              <div className="odd-cell" key={entry.id}>
                <EntrySprite entry={entry} solved className="sprite-compact" />
                <span>{entry.zhName}</span>
              </div>
            ))}
          </div>
        </>
      )
    }
    if (sound) {
      return (
        <>
          <p className="arcade-lead">这是什么发出的声音？</p>
          <SoundPlayer onPlay={playSound} />
        </>
      )
    }
    return null
  }

  if (!options.length) {
    return (
      <section className="game-bay">
        <div className="game-heading">
          <div>
            <span className="eyebrow">{heading.eyebrow}</span>
            <h1>{heading.title}</h1>
          </div>
          <button type="button" className="ghost-button" onClick={onExit}>返回</button>
        </div>
        <p className="arcade-lead">这个难度下暂时没有可用的题目，换个难度试试。</p>
      </section>
    )
  }

  return (
    <section className="game-bay">
      <div className="game-heading">
        <div>
          <span className="eyebrow">{heading.eyebrow}</span>
          <h1>{heading.title}</h1>
        </div>
        <div className="arcade-meter">
          <div><span>连对</span><strong>{streak}</strong></div>
          <div><span>最佳</span><strong>{best}</strong></div>
          <div><span>答对</span><strong>{correctCount}</strong></div>
          <button type="button" className="ghost-button" onClick={onExit}>返回</button>
        </div>
      </div>

      {isDaily && (
        <p className="arcade-daily-note">
          {dailyKey()} 的每日一套 · 共 {dailySet.length} 题 · 全世界同一天拿到的都是这套
        </p>
      )}

      <div className="arcade-card">
        {renderPrompt()}

        <div className="quiz-options" role="radiogroup" aria-label="答案选项">
          {options.map((option, index) => {
            const isAnswer = index === answerIndex
            const isPicked = index === picked
            const state = !answered
              ? ''
              : isAnswer
                ? 'right'
                : isPicked
                  ? 'wrong'
                  : 'dim'
            return (
              <button
                key={`${option}-${index}`}
                type="button"
                role="radio"
                aria-checked={isPicked}
                className={`quiz-option ${state}`}
                disabled={answered}
                onClick={() => choose(index)}
              >
                <span className="quiz-option-key">{String.fromCharCode(65 + index)}</span>
                <span className="quiz-option-text">{option}</span>
                {answered && isAnswer && <Check weight="bold" />}
                {answered && isPicked && !isAnswer && <X weight="bold" />}
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${round}-${picked}`}
            className={`feedback ${outcome ?? 'playing'}`}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            aria-live="polite"
          >
            <span>
              {!answered
                ? '选一个答案。'
                : `${outcome === 'correct' ? '答对了。' : '不对。'} ${note}`}
            </span>
          </motion.div>
        </AnimatePresence>

        {answered && (
          <>
            <div className="arcade-actions">
              <button type="button" onClick={nextRound}>
                <ArrowClockwise /> 下一题
              </button>
              {view === 'sound' && (
                <button type="button" onClick={playSound}>
                  <SpeakerHigh /> 再听一次
                </button>
              )}
            </div>
            {isDaily && accuracyLabel(dailyStat) && (
              <p className="arcade-daily-stat">{accuracyLabel(dailyStat)}</p>
            )}
          </>
        )}
      </div>

      {view === 'sound' && (
        <p className="arcade-foot">
          音效取自官方客户端资源 · 数据版本 {SOUND_META.version} · 共 {SOUND_META.count} 条
        </p>
      )}
    </section>
  )
}

/** 属性对决的一侧：图标 + 名字（数值要等答完才揭晓，否则就是送分） */
function DuelSide({ entry, side }: { entry: import('../types').CatalogEntry; side: string }) {
  return (
    <div className="duel-side">
      <span className="duel-side-tag">{side}</span>
      <EntrySprite entry={entry} solved className="sprite-compact" />
      <strong>{entry.zhName}</strong>
    </div>
  )
}

function SoundPlayer({ onPlay }: { onPlay: () => void }) {
  return (
    <button type="button" className="sound-player" onClick={onPlay}>
      <span className="sound-wave" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
      <span>播放音效</span>
      <SpeakerHigh weight="duotone" />
    </button>
  )
}
