/**
 * 量一量题库的「可猜度」分布。
 *
 * 背景：用户反馈「题目太简单了」。但「简单」这件事很难凭感觉判断 ——
 * 极值题（哪个最硬）看着简单，排除法却很有效；反向题（哪一个不是）看着简单，
 * 却要排除三个才能答。所以这里按题面特征给每道题估一个「可猜度」分值：
 *
 *   分数越高 = 越容易靠常识 / 排除法蒙对（送分）
 *   分数越低 = 越必须真记数据（硬核）
 *
 * 判据刻意做成与运行时零泄漏校验同一套正则，避免「这里说不难、那里又被拦下」的双标。
 */
import { readFileSync } from 'node:fs'

const quiz = JSON.parse(readFileSync(new URL('../src/data/quiz.json', import.meta.url), 'utf8'))

/** 选项是不是「纯数字 / 数字 + 单位」—— 纯数字选项意味着没有语义线索，只能靠记忆 */
const isNumericLabel = (label) => /^[\d.]+\s*(种|个|格|级)?$/.test(label.trim())

/** 选项是不是「能靠语义猜出来的」—— 完整句子属于这类，靠语感就能排除 */
const isSentenceLabel = (label) => label.length >= 12 || /[，。；]/.test(label)

const guessability = (question) => {
  let score = 0
  const labels = question.options
  const numericCount = labels.filter(isNumericLabel).length
  const sentenceCount = labels.filter(isSentenceLabel).length

  // 纯数字选项：没有任何语义线索，必须真记数值 —— 大幅降低可猜度
  if (numericCount === 4) score -= 2
  // 四个都是完整句子：靠语感就能排除大半 —— 大幅提高可猜度
  if (sentenceCount === 4) score += 2

  // 反向题：问「哪一个不是」，必须确认其余三个都对
  if (/【不】|不能|不会|做不到/.test(question.prompt)) score -= 1.5
  // 双条件题：只看一行数据会被精准绊倒
  if (/同时满足/.test(question.prompt)) score -= 1.5
  // 同族辨析：四个选项长得极像，语义线索失效
  if (/系列/.test(question.prompt)) score -= 1.5
  // 精确数值题：不能排序、不能排除
  if (/是多少|多少种|多少个|一共有多少/.test(question.prompt)) score -= 1

  return score
}

const buckets = [
  { name: '硬核（必须查表）', min: -Infinity, max: -2 },
  { name: '较难', min: -2, max: 0 },
  { name: '中等', min: 0, max: 1.5 },
  { name: '送分（靠常识就能答）', min: 1.5, max: Infinity },
]

console.log('=== 基础题可猜度分布 ===')
const basic = quiz.questions.filter((q) => q.tier === 'basic')
for (const bucket of buckets) {
  const hit = basic.filter((q) => {
    const score = guessability(q)
    return score > bucket.min && score <= bucket.max
  })
  console.log(`  ${bucket.name} -> ${hit.length} 道`)
}

console.log('')
console.log('=== 「送分题」抽样（这些就是要改掉的）===')
for (const bucket of buckets.slice(2)) {
  const hit = basic.filter((q) => {
    const score = guessability(q)
    return score > bucket.min && score <= bucket.max
  })
  for (const q of hit.slice(0, 8)) {
    console.log(`  [level ${q.level}][${q.topic}] ${q.prompt}`)
    console.log(`      ${q.options.join(' / ')}`)
  }
  if (hit.length) console.log('')
}

console.log('=== 按 level 拆分可猜度 ===')
for (const level of [1, 2, 3]) {
  const hit = basic.filter((q) => q.level === level)
  if (!hit.length) continue
  const scores = hit.map(guessability)
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length
  console.log(`  level ${level}: ${hit.length} 道，平均可猜度 ${average.toFixed(2)}`)
}