/**
 * 成就数据校验。
 *
 * 存在的意义：这份数据是从Wiki 分段抄来的，抄错是必然风险
 * （第一版就抄错了 4 条中文名、1 条父指针，还漏了 12 条）。
 * 所以每抓一段就跑一次，让问题在写界面之前暴露。
 *
 * 判定分两级：
 *   致命（exit 1）—— 断链、重复 id、中文名夹英文。这几种会直接让题目出错。
 *   缺失（只报数）—— 段没抓全。补齐是数据工作，不该挡住别的开发。
 */
import {
  ACHIEVEMENT_COUNT,
  ADVANCEMENTS,
  ADVANCEMENT_TABS,
  INCOMPLETE,
  IS_COMPLETE,
} from '../src/data/achievements.ts'

const byId = new Map(ADVANCEMENTS.map((a) => [a.id, a]))
let fatal = 0
const warn = (msg) => console.log(`  [缺失] ${msg}`)
const err = (msg) => {
  console.log(`  [致命] ${msg}`)
  fatal += 1
}

console.log(
  `成就数据：${ACHIEVEMENT_COUNT} 条 / 官方 126 条${IS_COMPLETE ? '（已完整）' : '（未抓全）'}`,
)

/* ---------- 1) 各 tab 条数 ---------- */
console.log('\n1) 各 tab 条数 vs 官方标称')
for (const tab of ADVANCEMENT_TABS) {
  const got = ADVANCEMENTS.filter((a) => a.tab === tab.id).length
  if (got >= tab.total) {
    console.log(`  ${tab.id.padEnd(10)} ${String(got).padStart(3)}/${tab.total}  完整`)
  } else {
    warn(`${tab.id.padEnd(10)} ${got}/${tab.total}  缺 ${tab.total - got} 条（INCOMPLETE 标记为 ${INCOMPLETE[tab.id]}）`)
  }
}

/* ---------- 2) 重复 id ---------- */
console.log('\n2) id 唯一性')
{
  const seen = new Set()
  const dup = []
  for (const a of ADVANCEMENTS) {
    if (seen.has(a.id)) dup.push(a.id)
    seen.add(a.id)
  }
  if (dup.length) err(`重复 id: ${dup.join(', ')}`)
  else console.log(`  ${ACHIEVEMENT_COUNT} 个 id 无重复`)
}

/* ---------- 3) 根成就 ---------- */
console.log('\n3) 根成就（每个 tab 恰好一个）')
{
  const roots = ADVANCEMENTS.filter((a) => a.parent === null)
  if (roots.length === 5) {
    console.log('  5 个 tab 各一个根成就')
  } else {
    // 根少于 5 个，多半是那个 tab 整段没抓到（husbandry 就是如此），
    // 属于「数据缺失」而不是「结构损坏」—— 只在真的抓全了却对不上时才致命。
    const emptyTabs = ADVANCEMENT_TABS.filter(
      (t) => ADVANCEMENTS.filter((a) => a.tab === t.id).length === 0,
    ).map((t) => t.id)
    if (INCOMPLETE.husbandry > 0 || emptyTabs.length > 0) {
      warn(
        `根成就数 = ${roots.length}（应为 5）；未抓全的 tab: ${emptyTabs.join(', ') || '无'} —— 属数据缺失`,
      )
    } else {
      err(`根成就数 = ${roots.length}，应为 5`)
    }
  }
  for (const tab of ADVANCEMENT_TABS) {
    const has = Boolean(byId.get(tab.root))
    const got = ADVANCEMENTS.filter((a) => a.tab === tab.id).length
    // 条数为 0 的 tab 不该要求它有 root；只对「抓了数据却缺 root」报致命
    if (!has && got > 0) err(`tab ${tab.id} 已有 ${got} 条数据，但 root（${tab.root}）缺失`)
  }
}

/* ---------- 4) 父指针有效性 + 断链/成环 ---------- */
console.log('\n4) 父指针与前置链')
{
  const badParent = ADVANCEMENTS.filter((a) => a.parent !== null && !byId.has(a.parent))
  if (badParent.length) {
    for (const a of badParent) err(`${a.id} 的 parent 指向不存在的 id: ${a.parent}`)
  } else {
    console.log('  所有 parent 都能找到对应条目')
  }

  const crossTab = ADVANCEMENTS.filter(
    (a) => a.parent !== null && byId.get(a.parent)?.tab !== a.tab,
  )
  if (crossTab.length) {
    for (const a of crossTab) {
      err(`${a.id}（${a.tab}）的 parent 在别的 tab: ${a.parent}（${byTabName(a.parent)}）`)
    }
  } else {
    console.log('  没有跨 tab 的父指针')
  }

  const trace = (id) => {
    let steps = 0
    const local = new Set()
    let cur = byId.get(id)
    while (cur) {
      if (local.has(cur.id)) return 'CYCLE'
      local.add(cur.id)
      if (!cur.parent) return steps
      const next = byId.get(cur.parent)
      if (!next) return `BROKEN:${cur.parent}`
      // 每往上一层算一步：depth = 从 id 回溯到根要跳几次
      steps += 1
      cur = next
    }
    return steps
  }
  const broken = []
  const maxDepth = { value: -1, id: '' }
  for (const a of ADVANCEMENTS) {
    const t = trace(a.id)
    if (t === 'CYCLE') broken.push(`${a.id}（成环）`)
    else if (typeof t === 'string') broken.push(`${a.id}（${t}）`)
    // ⚠️ 必须跳过根成就（parent=null，trace 返回 0），
    // 否则根永远是 0 步、最深链也报 0 步，看着像「全都断开」。
    else if (a.parent !== null && t > maxDepth.value) {
      maxDepth.value = t
      maxDepth.id = a.id
    }
  }
  if (broken.length) for (const b of broken) err(`前置链异常: ${b}`)
  else if (maxDepth.value < 0) console.log('  没有断链或环；但还没有非根条目可比深度')
  else console.log(`  没有断链或环；最长前置链 ${maxDepth.value} 步（${maxDepth.id}）`)
}

/* ---------- 5) id 前缀与 tab 一致 ---------- */
console.log('\n5) id 前缀与 tab 对应')
{
  const wrong = ADVANCEMENTS.filter((a) => {
    const prefix = a.tab === 'minecraft' ? 'story/' : `${a.tab}/`
    return !a.id.startsWith(prefix)
  })
  if (wrong.length) for (const a of wrong) err(`${a.id} 的 tab 是 ${a.tab}，前缀对不上`)
  else console.log('  全部一致（我的世界 tab 用 story/ 前缀，其余用 tab 名）')
}

/* ---------- 6) 中文名必须是官方汉化 ---------- */
console.log('\n6) 中文名检查（官方汉化，不能夹英文）')
{
  // 官方汉化名里确实含少量英文（如「Minecraft：试炼版」「老 Betsy」），
  // 所以不能一刀切禁字母，只查「夹了未翻译的英文单词」这种。
  const ALLOWED = ['Minecraft', 'Betsy']
  const notTranslated = ADVANCEMENTS.filter((a) => {
    const words = a.zh.replace(/[：？！，。]/g, '').match(/[A-Za-z]{2,}/g)
    if (!words) return false
    return words.some((w) => !ALLOWED.includes(w))
  })
  if (notTranslated.length) {
    for (const a of notTranslated) err(`中文名疑似未翻译: ${a.id} -> "${a.zh}"`)
  } else {
    console.log('  未发现未翻译条目')
  }

  const empty = ADVANCEMENTS.filter((a) => !a.zh || !a.zh.trim())
  if (empty.length) err(`${empty.length} 条中文名为空`)
}

/* ---------- 7) 字段完整性 ---------- */
console.log('\n7) 字段完整性')
{
  const bad = ADVANCEMENTS.filter(
    (a) => !a.id || !a.name || !a.zh || !a.description || !a.tab || !a.type,
  )
  if (bad.length) err(`${bad.length} 条字段缺失`)
  else console.log('  id / name / zh / description / tab / type 全部非空')

  const badType = ADVANCEMENTS.filter((a) => !['advancement', 'goal', 'challenge'].includes(a.type))
  if (badType.length) err(`type 取值非法: ${badType.map((a) => a.id).join(', ')}`)

  const badXp = ADVANCEMENTS.filter(
    (a) => a.xp !== null && (a.xp < 0 || !Number.isInteger(a.xp)),
  )
  if (badXp.length) err(`xp 取值非法: ${badXp.map((a) => a.id).join(', ')}`)
}

/* ---------- 8) 分布（参考用） ---------- */
console.log('\n8) 分布（参考用）')
{
  const types = {}
  for (const a of ADVANCEMENTS) types[a.type] = (types[a.type] ?? 0) + 1
  console.log(`边框类型: ${JSON.stringify(types)}`)
  const xps = ADVANCEMENTS.filter((a) => a.xp !== null)
  console.log(`有 XP 奖励: ${xps.length} 条，最高 ${Math.max(...xps.map((a) => a.xp))} XP`)
  const hidden = ADVANCEMENTS.filter((a) => a.hidden)
  console.log(`隐藏成就: ${hidden.length} 条 -> ${hidden.map((a) => a.zh).join('、')}`)
  const trial = ADVANCEMENTS.filter((a) => a.trial)
  console.log(`试炼版专属: ${trial.length} 条 -> ${trial.map((a) => a.zh).join('、')}`)
}

function byTabName(id) {
  return byId.get(id)?.tab ?? '未知'
}

console.log(fatal === 0 ? '\n致命问题：0' : `\n致命问题：${fatal}`)
if (fatal === 0 && !IS_COMPLETE) {
  console.log('（数据未抓全，但结构无误 —— 补齐前不要用于出题）')
}
process.exit(fatal === 0 ? 0 : 1)
