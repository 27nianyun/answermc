/**
 * 查「答案与解释自相矛盾」的题。
 *
 * 起因：末影水晶那题把「只要 1 颗」判为正确，解释里却写「正确答案是 4 颗」——
 * 选项里明明有「要 4 颗，这是设计的答案」，判的却是 1 颗。
 *
 * 这类 bug 静态断言查不出来（answerIndex 是个合法下标、选项数组长度也对），
 * 只能靠「解释里提到的数字是否和选项里的正确答案对得上」来发现。
 *
 * 做法：把解释和所有选项里的数字都抽出来，
 * 如果解释断言了某个数 N，而选项里存在另一个数 M 且 M 被判为答案，就报出来。
 *
 * 用法：node scripts/check-answer-consistency.mjs
 */
import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('src/data/quiz.json', 'utf8'))
const questions = raw.questions ?? raw

/** 抽数字：支持 4 / 4 颗 / 1 颗 / 百分之五十 这类；忽略 26.1 / 1014 这类版本号与 id */
const numbersOf = (s) => {
  if (!s) return []
  // 先去掉版本号、快照号、URL、MC-xxxxx，避免把 26.1 当成答案数字
  const cleaned = String(s)
    .replace(/MC-\d+/g, ' ')
    .replace(/\b\d+\.\d+(\.\d+)?\b/g, ' ')       // 26.1 / 1.9.4
    .replace(/\d{4,}/g, ' ')                        // 年份 / 大数字
    .replace(/https?:\/\/\S+/g, ' ')
  const out = []
  for (const m of cleaned.matchAll(/(\d+)\s*(颗|个|次|级|格|层|倍|段|天|秒|分钟|点)?/g)) {
    out.push({ n: Number(m[1]), unit: m[2] ?? '', text: m[0] })
  }
  return out
}

const problems = []

for (const q of questions) {
  const opts = q.options ?? []
  const ai = q.answerIndex
  if (typeof ai !== 'number' || ai < 0 || ai >= opts.length) continue

  const answerText = String(opts[ai] ?? '')
  const answerNums = new Set(numbersOf(answerText).map((x) => x.n))
  const expl = String(q.explanation ?? '')

  // 解释里出现「正确答案是 N」这类断言
  const claimMatch = [...expl.matchAll(/正确答案(?:是|为)\s*(\d+)/g)].map((m) => Number(m[1]))
  if (claimMatch.length === 0) continue

  for (const claimed of claimMatch) {
    if (answerNums.has(claimed)) continue
    // 解释断言的数不在被选项里 —— 说明答案下标指错了，或解释写错了
    problems.push({
      id: q.id,
      prompt: q.prompt,
      answerIndex: ai,
      answerText,
      claimed,
      // 被选项里到底有没有这个数
      claimedExistsAsOption: opts.some((o) => numbersOf(String(o)).some((x) => x.n === claimed)),
      whichOptionHasClaimed: opts.findIndex((o) => numbersOf(String(o)).some((x) => x.n === claimed)),
      expl: expl.slice(0, 160),
    })
  }
}

console.log(`扫描 ${questions.length} 道题\n`)

if (problems.length === 0) {
  console.log('✓ 没有「解释断言的答案」与「被判为正确的选项」矛盾的问题')
  process.exit(0)
}

console.log(`✗ 发现 ${problems.length} 道答案与解释矛盾的题：\n`)
for (const p of problems) {
  console.log(`  [${p.id}]`)
  console.log(`    题干：${String(p.prompt).slice(0, 90)}`)
  console.log(`    判定答案（index ${p.answerIndex}）：${p.answerText}`)
  console.log(`    解释声称：正确答案 ${p.claimed}`)
  console.log(`    声称的数是否存在于选项：${p.claimedExistsAsOption ? `是（index ${p.whichOptionHasClaimed}）` : '否'}`)
  console.log(`    解释：${p.expl}`)
  console.log('')
}
process.exit(1)
