/**
 * 查「class 在 JSX 里用了，但 CSS 里没定义」的孤儿类。
 *
 * 起因：`.segmented` 的横向基类从来没写过，只有 `.segmented.vertical` 有样式，
 * 于是问答区的难度 / 模式 / 考试预设三个控件全部退化成无样式的原生 <button>，
 * 渲染出来是「入门进阶极限」六个字糊成一片。
 *
 * 为什么静态扫不够：那次的断言查的是「元素个数」，元素全都在，只是全都挤在一起，
 * 100% 漏过。**class 名存在不等于样式存在**，只有比对 CSS 选择器才能发现。
 *
 * 用法：node scripts/check-orphan-classes.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const SRC = 'src'

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.tsx', '.ts', '.css'].includes(extname(p))) out.push(p)
  }
  return out
}

const files = walk(SRC)
const codeFiles = files.filter((f) => extname(f) !== '.css')
const cssFiles = files.filter((f) => extname(f) === '.css')

/* ---------- 1. 收集 CSS 里定义过的类 ---------- */
/*
判断口径：**这个类名有没有在任何 CSS 规则里出现过**。

为什么不解析「谁修饰谁」：一开始想复杂了，踩了两次。
  ① 纯出现即通过 → 删掉 `.segmented {}` 后仍算合法（.segmented.vertical 还在），静默漏报。
  ② 改成「只认紧跟 { 的主目标」→ 误报 `.vertical`（它只以 .segmented.vertical 形式存在），
     而且注入故障前后结果完全一样，等于没检查。

真正要抓的故障是「class 名字在这份 CSS 里根本没有」，
所以口径就是出现与否；`.segmented` 那种「只有 vertical 变体、基类缺失」的情况，
由 browser-check 的计算样式断言（间隙 / 外框 / active 底色）负责，那才是能真正看见的检查。
两层分工：这里管「完全没定义」，那里管「定义了但布局不对」。
*/
const cssText = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const cssClean = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
const cssClasses = new Set()
for (const m of cssClean.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1])

/* ---------- 2. 收集代码里用到的类名 ---------- */
// 动态拼接的 class 前缀，单独登记为「不可静态校验」
const DYNAMIC = /^(has-|is-|quiz-option|game-|sprite-|craft-|recipe-)/

const used = new Map() // 类名 -> 使用处

for (const f of codeFiles) {
  const text = readFileSync(f, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // 先剥掉 HTML 属性值，否则 loading="eager" 的 eager 会被当成 class
    const code = line
      .replace(/\b(?:loading|decoding|draggable|type|role|aria-[\w-]+|key|href|src|alt|title)\s*=\s*"[^"]*"/g, ' ')
      .replace(/'[^']*'/g, "''")   // 字符串字面量整体不参与类名提取
    const literals = [
      ...code.matchAll(/className\s*=\s*"([^"]*)"/g),
      ...code.matchAll(/className\s*=\s*\{'([^']*)'\}/g),
      ...code.matchAll(/\bclass\s*=\s*"([^"]*)"/g),
    ]
    for (const m of literals) {
      for (const raw of m[1].split(/\s+/)) {
        const c = raw.trim()
        if (!c) continue
        if (!used.has(c)) used.set(c, [])
        used.get(c).push(`${f}:${i + 1}`)
      }
    }
    // 三元里的状态类：condition ? 'wrong' : 'dim'
    for (const m of code.matchAll(/\?\s*'([\w-]+)'\s*:\s*'([\w-]+)'/g)) {
      for (const c of [m[1], m[2]]) {
        if (!used.has(c)) used.set(c, [])
        used.get(c).push(`${f}:${i + 1}`)
      }
    }
  })
}

/* ---------- 3. 比对 ---------- */
/*
允许缺失的白名单。每条都必须是**核实过**的，不是「先放行再说」：

- `active` / `dim` / `right` / `wrong` / `out` / `picked` / `idle`：挂在 .quiz-option 上，
  由 `.quiz-option.right` 这类后代选择器定义，裸类名不出现是正常的。
- `lit` / `blank`（知识地图）：`blank` 走 `.knowledge-facets li.blank`；
  `lit` 是**故意的默认态**，靠 nameColor 与进度条跟 blank 区分。
  浏览器实测：lit 文字 rgb(36,40,32) + 进度条深绿，blank 文字 rgb(113,117,101) + 灰色空条。
- `hidden` / `sr-only`：语义类，可能来自组件库约定。
*/
const ALLOW = new Set([
  'active', 'dim', 'right', 'wrong', 'out', 'picked', 'idle', 'error', 'ok',
  'lit', 'blank',
  'sr-only', 'hidden',
])

const orphans = []
for (const [name, places] of used) {
  if (cssClasses.has(name)) continue
  if (ALLOW.has(name)) continue
  if (DYNAMIC.test(name)) continue
  orphans.push({ name, places })
}

/* ---------- 4. 变量层：var(--x) 必须在 :root 里有定义 ---------- */
/*
起因：写自检面板时用了 `font-family: var(--mono)`，而这个项目从来没有定义过
`--mono`（全项目惯例是直写 `ui-monospace, "Cascadia Code", monospace`）。
CSS 变量未定义**不报错**，浏览器静默丢弃这条声明，于是等宽字体无声失效 ——
class 名检查完全看不到这一类故障，它只认 `.foo` 不认 `var(--foo)`。
*/
const definedVars = new Set()
for (const m of cssText.matchAll(/(--[-\w]+)\s*:/g)) definedVars.add(m[1])

const missingVars = []
for (const f of cssFiles) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[-\w]+)/g)) {
      if (definedVars.has(m[1])) continue
      // 同一变量在同一文件里只报一次，否则一个变量能刷出十几行噪声
      if (missingVars.some((v) => v.name === m[1] && v.file === f)) continue
      missingVars.push({ name: m[1], file: f, line: i + 1 })
    }
  })
}

console.log(`扫描 ${files.length} 个文件（CSS ${cssFiles.length} / 代码 ${codeFiles.length}）`)
console.log(`代码用到 ${used.size} 个类名，CSS 定义 ${cssClasses.size} 个`)
console.log(`CSS 引用 ${definedVars.size} 个已定义变量${missingVars.length ? `，${missingVars.length} 个未定义` : ''}`)

const problems = []

if (orphans.length > 0) {
  problems.push(`发现 ${orphans.length} 个「代码在用、CSS 没定义」的类：\n`)
  for (const o of orphans) {
    problems.push(`  .${o.name}`)
    for (const p of o.places.slice(0, 4)) problems.push(`      ${p}`)
    if (o.places.length > 4) problems.push(`      ...另有 ${o.places.length - 4} 处`)
    problems.push('')
  }
  problems.push('提示：这些元素会退化成浏览器默认样式（无边框 / 无内边距 / 挤在一起）。')
}

if (missingVars.length > 0) {
  problems.push(`\n发现 ${missingVars.length} 个「CSS 引用了、但 :root 没定义」的变量：\n`)
  for (const v of missingVars) problems.push(`  var(${v.name})  ${v.file}:${v.line}`)
  problems.push('\n提示：未定义的 CSS 变量不报错，浏览器会静默丢弃整条声明。')
}

if (problems.length === 0) {
  console.log('\n✓ 没有孤儿类，也没有未定义变量：代码里用到的 class 与 var() 都有对应定义')
  process.exit(0)
}

console.log(`\n✗ ${problems.join('\n')}`)
process.exit(1)
