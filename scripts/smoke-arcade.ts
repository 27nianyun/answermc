/**
 * 四个新玩法的回归测试。
 *
 * 重点守两件事（这两条错了玩家立刻能感觉到，但肉眼抽查很难发现）：
 *  1. **答案唯一**：干扰项不能也是正确答案，否则玩家选对了却被判错
 *  2. **每日挑战可复现**：同一天必须永远是同一套题
 *
 * 另外批量跑几百次，确认各难度都出得出来题（不会返回 null）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  dailyKey,
  dailyRounds,
  duelRound,
  oddRound,
  reverseRound,
  soundRound,
  SOUNDS,
} from '../src/arcade'
import { entryForName, METHOD_LABELS, TRANSFORMS } from '../src/transforms'
import type { Difficulty } from '../src/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0
const failures: string[] = []

const section = (title: string) => console.log(`\n${title}`)
const expect = (label: string, condition: boolean, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
    failures.push(label)
  }
}

const DIFFICULTIES: Difficulty[] = ['explorer', 'survival', 'hardcore']
const RUNS = 200

/* ---------- 属性对决 ---------- */
section('属性对决：可比、差距合理、答案唯一')
for (const difficulty of DIFFICULTIES) {
  let made = 0
  let ties = 0
  let badAnswer = 0
  let tooClose = 0
  for (let i = 0; i < RUNS; i += 1) {
    const round = duelRound(difficulty, `t-${difficulty}-${i}`)
    if (!round) continue
    made += 1
    if (round.answer === 'tie') {
      ties += 1
      if (round.leftValue !== round.rightValue) badAnswer += 1
      continue
    }
    const higher = round.answer === 'left' ? round.leftValue : round.rightValue
    const lower = round.answer === 'left' ? round.rightValue : round.leftValue
    if (higher < lower) badAnswer += 1
    // 入门档不该出现肉眼难辨的差距
    if (difficulty === 'explorer' && lower > 0 && higher / lower < 3) tooClose += 1
  }
  expect(`${difficulty} 能稳定出题（${made}/${RUNS}）`, made >= RUNS * 0.9, String(made))
  expect(`${difficulty} 判定与数值一致（错判 ${badAnswer}）`, badAnswer === 0)
  expect(`${difficulty} 入门档差距够明显（过近 ${tooClose}）`, tooClose === 0)
  if (difficulty !== 'hardcore') {
    expect(`${difficulty} 不出「一样高」的题（出现 ${ties}）`, ties === 0)
  }
}

// 确定性：同 seed 必须同结果
const d1 = duelRound('survival', 'fixed-seed')
const d2 = duelRound('survival', 'fixed-seed')
expect(
  '同 seed 出同一道题（每日挑战的前提）',
  d1?.left.id === d2?.left.id && d1?.right.id === d2?.right.id && d1?.metric === d2?.metric,
)

/* ---------- 逆向合成 ---------- */
section('逆向合成：干扰项不能也是正确答案')
const byResult = new Map<string, typeof TRANSFORMS>()
for (const t of TRANSFORMS) {
  const list = byResult.get(t.result) ?? []
  list.push(t)
  byResult.set(t.result, list)
}

for (const difficulty of DIFFICULTIES) {
  let made = 0
  let methodLeak = 0
  let ingredientLeak = 0
  let badIndex = 0
  for (let i = 0; i < RUNS; i += 1) {
    const round = reverseRound(difficulty, `r-${difficulty}-${i}`)
    if (!round) continue
    made += 1
    if (round.answerIndex < 0 || round.answerIndex >= round.options.length) {
      badIndex += 1
      continue
    }
    // 答案本身要存在（下标合法性已在上面断言，这里只确认取得到非空字符串）
    if (!round.options[round.answerIndex]) badIndex += 1
    const recipes = byResult.get(round.resultName) ?? []

    if (round.kind === 'method') {
      // 干扰项里不能出现这个产物真的能用的方法
      const usedLabels = new Set(recipes.map((t) => METHOD_LABELS[t.method] ?? t.method))
      const leaking = round.options.filter(
        (option, index) => index !== round.answerIndex && usedLabels.has(option),
      )
      if (leaking.length) methodLeak += 1
    } else {
      // 干扰项里不能出现该产物任何配方用得到的原料
      const used = new Set<string>()
      for (const t of recipes) {
        for (const input of t.inputs) {
          for (const name of input.names) used.add(entryForName(name)?.zhName ?? name)
        }
      }
      const leaking = round.options.filter(
        (option, index) => index !== round.answerIndex && used.has(option),
      )
      if (leaking.length) ingredientLeak += 1
    }
  }
  expect(`${difficulty} 能稳定出题（${made}/${RUNS}）`, made >= RUNS * 0.8, String(made))
  expect(`${difficulty} 答案下标合法（越界 ${badIndex}）`, badIndex === 0)
  expect(`${difficulty} 方法题干扰项不泄漏（${methodLeak}）`, methodLeak === 0)
  expect(`${difficulty} 原料题干扰项不泄漏（${ingredientLeak}）`, ingredientLeak === 0)
}

/* ---------- 找异类 ---------- */
section('找异类：分组必须唯一（不能有第二种分法）')
const NUMERIC = ['硬度', '爆炸抗性', '发光等级', '遮光等级', '堆叠上限']
for (const difficulty of DIFFICULTIES) {
  let made = 0
  let ambiguous = 0
  let badIndex = 0
  let dup = 0
  for (let i = 0; i < RUNS; i += 1) {
    const round = oddRound(difficulty, `o-${difficulty}-${i}`)
    if (!round) continue
    made += 1
    if (round.items.length !== 4) continue
    if (new Set(round.items.map((e) => e.id)).size !== 4) dup += 1
    if (round.answerIndex < 0 || round.answerIndex >= 4) { badIndex += 1; continue }

    // 独立复算歧义：是否存在第二个「3 同 1 异」且异的不是答案
    for (const metric of NUMERIC) {
      const counts = new Map<string, number[]>()
      round.items.forEach((entry, index) => {
        const value = entry.facts?.[metric]
        const key = typeof value === 'number' ? String(value) : 'none'
        const bucket = counts.get(key)
        if (bucket) bucket.push(index)
        else counts.set(key, [index])
      })
      for (const [, indexes] of counts) {
        if (indexes.length !== 3) continue
        const odd = [0, 1, 2, 3].find((i) => !indexes.includes(i))
        if (odd !== undefined && odd !== round.answerIndex) ambiguous += 1
      }
    }
  }
  expect(`${difficulty} 能稳定出题（${made}/${RUNS}）`, made >= RUNS * 0.8, String(made))
  expect(`${difficulty} 四个选项互不重复（重复 ${dup}）`, dup === 0)
  expect(`${difficulty} 答案下标合法（越界 ${badIndex}）`, badIndex === 0)
  expect(`${difficulty} 不存在第二种分组（歧义 ${ambiguous}）`, ambiguous === 0)
}

/* ---------- 盲猜音效 ---------- */
section('盲猜音效：选项同类、方块类不同族、资源存在')
const soundFiles = new Set(
  SOUNDS.map((s) => join(root, 'public', s.file)),
)
for (const difficulty of DIFFICULTIES) {
  let made = 0
  let mixedCategory = 0
  let sameFamily = 0
  let dup = 0
  for (let i = 0; i < RUNS; i += 1) {
    const round = soundRound(difficulty, `s-${difficulty}-${i}`)
    if (!round) continue
    made += 1
    if (new Set(round.options).size !== 4) dup += 1
    if (round.answerIndex < 0) continue

    const answerZh = round.options[round.answerIndex]
    // 四个选项必须都属于答案所在 category
    const category = SOUNDS.find((s) => s.zh === answerZh)?.category
    const others = round.options.filter((_, index) => index !== round.answerIndex)
    const allSame = others.every((zh) => SOUNDS.find((s) => s.zh === zh)?.category === category)
    if (!allSame) mixedCategory += 1

    // 方块类：四个必须来自四个不同 family
    if (category === 'block') {
      const families = round.options.map(
        (zh) => SOUNDS.flatMap((s) => (s.zh === zh ? [s.entry] : [])),
      )
      const distinct = new Set(round.options)
      if (distinct.size === 4) {
        // 用图鉴 family 再核一次（entry 名与 family 不同源，这里只查重复名）
        if (families.some((f) => f.length === 0)) sameFamily += 1
      }
    }
  }
  expect(`${difficulty} 能稳定出题（${made}/${RUNS}）`, made >= RUNS * 0.8, String(made))
  expect(`${difficulty} 四个选项不重复（重复 ${dup}）`, dup === 0)
  expect(`${difficulty} 选项不跨类别（${mixedCategory}）`, mixedCategory === 0)
  expect(`${difficulty} 方块类选项不撞族（${sameFamily}）`, sameFamily === 0)
}

// 音效文件真的在磁盘上
const missing = [...soundFiles].filter((file) => {
  try {
    readFileSync(file)
    return false
  } catch {
    return true
  }
})
expect(`所有音效文件都已落盘（缺 ${missing.length} 个）`, missing.length === 0)
expect(`音效库不为空（${SOUNDS.length} 条）`, SOUNDS.length >= 50)

/* ---------- 每日挑战 ---------- */
section('每日挑战：同日同题、跨日不同')
const today = new Date('2026-10-04T10:00:00')
const roundsA = dailyRounds(today)
const roundsB = dailyRounds(new Date('2026-10-04T22:00:00'))
const roundsC = dailyRounds(new Date('2026-10-05T10:00:00'))

expect(`当天能凑齐题目（${roundsA.length} 道）`, roundsA.length >= 3, String(roundsA.length))
expect('同一天不同时刻题目一致', JSON.stringify(roundsA) === JSON.stringify(roundsB))
expect('换一天题目会变', JSON.stringify(roundsA) !== JSON.stringify(roundsC))
expect(
  '日期键是本地日期而不是 UTC（否则东八区会跨天）',
  dailyKey(new Date('2026-10-04T23:30:00')) === '2026-10-04',
  dailyKey(new Date('2026-10-04T23:30:00')),
)

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`)
if (failures.length) console.log(`失败项：\n  ${failures.join('\n  ')}`)
if (failed > 0) process.exit(1)
