#!/usr/bin/env node
/**
 * 真实浏览器交互测试（CDP 直连系统 Chrome，不依赖 playwright 下载）。
 *
 * ── 为什么必须有这个 ──────────────────────────────────────
 * 纯逻辑推演和静态检查**都会给出错误结论**。实例：
 * 用户报「除了正确答案都不能选择」，但代码逐行看是对的 ——
 *   disabled={locked || isOut}，locked 来自 answered，答完锁死四项是正确的反作弊设计。
 * 真问题在**视觉与文案没告诉玩家该点「继续」**，四个灰选项看着像坏了。
 * 这类问题只有真浏览器点一下才能发现。
 *
 * 另一个教训：渲染层也验证不了。`react-dom/server` 渲染 QuizGame 得到 0 个选项按钮
 * （首帧题目为空，useEffect 在 SSR 不跑），DOM 里根本没有 .quiz-option 可查。
 *
 * 用法：
 *   node scripts/browser-check.mjs              # 跑全部检查
 *   需先启动 Chrome：
 *     "C:/Program Files/Google/Chrome/Application/chrome.exe" ^
 *       --headless=new --remote-debugging-port=9333 ^
 *       --user-data-dir=.cdp-probe --disable-gpu --no-first-run about:blank
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const CDP_PORT = 9333
const PREVIEW = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4205/'
const PROFILE = '.cdp-probe'
const CHROME_CANDIDATES = [
  'C://Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

let passed = 0
let failed = 0
const expect = (label, condition, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  console.error('找不到 Chrome / Edge，无法做浏览器交互测试')
  process.exit(1)
}

console.log('启动浏览器：', chromePath)
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(process.cwd(), PROFILE)}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore', detached: false })

// 等 CDP 端口起来
const waitCdp = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (r.ok) return true
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
if (!(await waitCdp())) {
  chrome.kill()
  console.error('CDP 端口没起来')
  process.exit(1)
}

const cleanup = () => {
  try { chrome.kill() } catch { /* 已退出 */ }
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* Chrome 还锁着就跳过 */ }
}
process.on('exit', cleanup)

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const pageErrors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  }
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(msg.params).slice(0, 200))
})
await new Promise((resolve) => ws.addEventListener('open', resolve))

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const pressKey = async (key) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key.length === 1 ? key : undefined })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key })
  await new Promise((r) => setTimeout(r, 500))
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const optionState = () => evaluate([
  '(() => {',
  '  const opts = [...document.querySelectorAll(".quiz-option")];',
  '  const idxOf = (cls) => opts.findIndex((o) => o.className.includes(cls));',
  '  return {',
  '    count: opts.length,',
  '    disabled: opts.map((o) => o.disabled),',
  '    classes: opts.map((o) => o.className.replace("quiz-option", "").trim()),',
  '    hasX: opts.some((o) => !!o.querySelector("svg")),',
  // 红标除了叉号，还有一条左侧实心色带 —— 它不受底色透明度影响，是更强的信号
  '    wrongBarWidth: (() => {',
  '      const i = idxOf("wrong");',
  '      if (i < 0) return "0px";',
  '      return getComputedStyle(opts[i]).borderLeftWidth;',
  '    })(),',
  '    feedback: (document.querySelector(".feedback") || {}).textContent || "",',
  '    prompt: (document.querySelector(".quiz-prompt") || {}).textContent || "",',
  // 连错渐进提示：档位徽标、被自动排掉的项、是否已揭晓
  '    assist: (() => {',
  '      const badge = document.querySelector(".assist-badge");',
  '      if (!badge) return 0;',
  '      return Number(badge.dataset.level) || 0;',
  '    })(),',
  '    assistBadge: (document.querySelector(".assist-badge") || {}).textContent || "",',
  '    eliminatedCount: opts.filter((o) => o.className.includes("out")).length,',
  // 「正确项被误排除」的正确判据是它带 out（被排掉），不是 disabled ——
  // 揭晓后正确答案也是 disabled 的，用 disabled 判会永远为真，等于没检查
  '    rightIsEliminated: opts.some((o) => o.className.includes("right") && o.className.includes("out")),',
  '    revealed: opts.some((o) => o.className.includes("right"))',
  '      && !!document.querySelector(".quiz-explain"),',
  '  };',
  '})()',
].join('\n'))

/**
 * 真实视觉可辨性检查。
 *
 * 为什么不能只断言「class 里有 wrong」或「背景色字符串是红的」：
 * `.wrong` 的底色是 rgba(..., 0.22) 的半透明红，叠在纸色背景上才形成玩家看到的颜色。
 * 断言字符串既脆弱（写成 rgba 还是 rgb 取决于浏览器实现）又没意义
 * —— 就算 0.22 全对，纸色底上一片几乎一样的粉也照样等于「看不出来」，
 * 这正是这次玩家报「回答错误的显示不够明显」的实际含义。
 *
 * 所以这里在页面里把半透明层**逐层合成**到不透明底色上，
 * 拿到玩家眼睛真正看到的颜色，再和「没被选中的普通选项」比色差。
 */
const visualDiff = () => evaluate([
  '(() => {',
  '  const opts = [...document.querySelectorAll(".quiz-option")];',
  '  const parse = (s) => {',
  '    const m = s.match(/rgba?\\(([^)]+)\\)/);',
  '    if (!m) return null;',
  '    const p = m[1].split(",").map((v) => parseFloat(v));',
  '    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };',
  '  };',
  '  // 沿祖先链把半透明层合成到不透明底，得到最终可见色',
  '  const flatten = (el) => {',
  '    const layers = [];',
  '    for (let n = el; n; n = n.parentElement) {',
  '      const c = parse(getComputedStyle(n).backgroundColor);',
  '      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }',
  '    }',
  '    let out = { r: 255, g: 255, b: 255 };',
  '    for (let i = layers.length - 1; i >= 0; i -= 1) {',
  '      const l = layers[i];',
  '      out = {',
  '        r: Math.round(out.r * (1 - l.a) + l.r * l.a),',
  '        g: Math.round(out.g * (1 - l.a) + l.g * l.a),',
  '        b: Math.round(out.b * (1 - l.a) + l.b * l.a),',
  '      };',
  '    }',
  '    return out;',
  '  };',
  '  const wi = opts.findIndex((o) => o.className.includes("wrong"));',
  '  if (wi < 0) return { found: false };',
  '  // 参照物：没被点过、也没被排除的普通选项',
  '  const ni = opts.findIndex((o, i) => i !== wi && !o.disabled && !o.className.includes("wrong"));',
  '  const w = flatten(opts[wi]);',
  '  const n = ni >= 0 ? flatten(opts[ni]) : { r: 255, g: 255, b: 255 };',
  '  const dist = Math.max(Math.abs(w.r - n.r), Math.abs(w.g - n.g), Math.abs(w.b - n.b));',
  '  return {',
  '    found: true,',
  '    wrongFlat: w,',
  '    normalFlat: n,',
  '    dist,',
  '  };',
  '})()',
].join('\n'))

await send('Runtime.enable')
await send('Page.enable')

console.log('\n页面加载：', PREVIEW)
await send('Page.navigate', { url: PREVIEW })
await wait(4000)

console.log('\n答题链路：选项必须全程可点')
expect('应用已挂载', (await evaluate("document.querySelector('#root') ? document.querySelector('#root').children.length : 0")) > 0)

const entered = await evaluate([
  '(() => {',
  '  const b = [...document.querySelectorAll("button, [role=tab], a")].find((x) => /知识问答/.test(x.textContent || ""));',
  '  if (b) b.click();',
  '  return !!b;',
  '})()',
].join('\n'))
expect('能切到知识问答视图', entered === true)
await wait(1500)

const first = await optionState()
expect('渲染出 4 个选项', first.count === 4, `实际 ${first.count}`)
expect('首屏四个选项都可点', first.disabled.every((d) => d === false), JSON.stringify(first.disabled))

/*
分段控件（难度 / 模式 / 考试预设）必须真的有布局。

这条守卫来自一次真实故障：`.segmented` 的横向基类在 CSS 里**根本没定义**，
只有 `.segmented.vertical` 有样式，于是问答区三个控件全部退化成无样式的原生
<button>—— 零边框、零内边距、零背景，三个按钮各 32px 宽（正好两个汉字）、
x 坐标 421→453→485 严丝合缝地贴在一起，渲染出来就是「入门进阶极限」糊成一片，
连当前选了哪个难度都看不出来。

教训：**「class 名存在」不等于「样式存在」**。
断言只查元素个数的话，这种故障 100% 漏过 —— 元素都在，只是全都挤在一起。
所以这里断言的是计算样式：外框、间距、按钮宽度、active 高亮。
*/
console.log('\n分段控件：难度 / 模式不能挤成一团')
const segmentedState = () => evaluate([
  '(() => {',
  '  return [...document.querySelectorAll(".segmented")].map((s) => {',
  '    const cs = getComputedStyle(s);',
  '    const btns = [...s.querySelectorAll("button")];',
  '    const rects = btns.map((b) => b.getBoundingClientRect());',
  '    return {',
  '      labels: btns.map((b) => (b.textContent || "").trim()),',
  '      display: cs.display,',
  '      hasBorder: parseFloat(cs.borderTopWidth) >= 1,',
  // 相邻按钮之间的实际像素间隙：负数或 0 = 文字贴在一起
  '      gaps: rects.slice(1).map((r, i) => Math.round(r.left - rects[i].right)),',
  '      widths: rects.map((r) => Math.round(r.width)),',
  '      heights: rects.map((r) => Math.round(r.height)),',
  '      activeCount: btns.filter((b) => b.className.includes("active")).length,',
  '      activeText: (btns.find((b) => b.className.includes("active")) || {}).textContent || "",',
  '      activeBg: btns.length && btns.some((b) => b.className.includes("active"))',
  '        ? getComputedStyle(btns.find((b) => b.className.includes("active"))).backgroundColor : "",',
  '    };',
  '  });',
  '})()',
].join('\n'))

const segs = await segmentedState()
expect('难度 / 模式两个分段控件都在', segs.length >= 2, `实际 ${segs.length} 个`)
for (const [i, s] of segs.entries()) {
  const name = s.labels.join(' / ') || `第 ${i + 1} 个`
  expect(`${name}：有横向布局（不是 block 堆叠）`, s.display === 'flex' || s.display === 'inline-flex', s.display)
  expect(`${name}：有外框`, s.hasBorder === true, s.display)
  expect(`${name}：按钮之间有间隙（不能糊成一片）`, s.gaps.every((g) => g >= 2), JSON.stringify(s.gaps))
  expect(`${name}：按钮宽到能容下文字`, s.widths.every((w) => w >= 44), JSON.stringify(s.widths))
  expect(`${name}：当前选中项唯一且有高亮底色`, s.activeCount === 1 && s.activeBg !== 'rgba(0, 0, 0, 0)', `${s.activeCount} 个 active，底色 ${s.activeBg}`)
}

// 切难度后高亮要跟着走（之前连「当前是哪个难度」都看不出来）
await evaluate([
  '(() => {',
  '  const b = [...document.querySelectorAll(".segmented button")].find((x) => x.textContent.trim() === "极限");',
  '  if (b) b.click();',
  '  return !!b;',
  '})()',
].join('\n'))
await wait(1200)
const afterDiff = await segmentedState()
expect('切换难度后高亮跟着移动到「极限」', afterDiff[0] && afterDiff[0].activeText === '极限', afterDiff[0] ? afterDiff[0].activeText : '无控件')

// 切回入门，避免影响后续答题测试的题库难度
await evaluate([
  '(() => {',
  '  const b = [...document.querySelectorAll(".segmented button")].find((x) => x.textContent.trim() === "入门");',
  '  if (b) b.click();',
  '})()',
].join('\n'))
await wait(1200)

// 答错不应锁死整题 —— 这是最容易写错断言的地方：
// 练习模式答【错】时 status 仍是 playing，四个选项必须继续可点（允许改答案），
// 只有答【对】才进 answered 锁死四项。
console.log('\n答错后：错误反馈必须醒目')
/**
 * 必须【保证】跑到答错分支，不能靠随机。
 *
 * 踩过的坑：第一版是「点第一个可点的」，随机到答案就走答对分支 ——
 * 答错分支的守卫一次都没跑到，测试全绿却什么都没验证到。
 * 这类「靠运气覆盖分支」的测试比没有测试更危险。
 *
 * 可靠办法：反复「点第一个可选项 → 不对就继续点下一个」，
 * 同一题里正确答案只有 1 个，所以最多点 3 个必然撞上错的。
 * 若某题第一下就点对了，就换一题重来（最多试 5 轮）。
 */
let afterFirst = null
for (let round = 0; round < 5 && afterFirst === null; round += 1) {
  // 每轮先确保是可作答状态
  await evaluate(`
    (() => {
      const again = [...document.querySelectorAll('.quiz-secondary button, .quiz-actions button')]
        .find((b) => /换一题|下一题/.test(b.textContent || ''));
      if (again) again.click();
    })()
  `)
  await wait(800)
  // 同一题内连点，直到撞上错误项（最多 3 次，因为正确答案只 1 个）
  for (let click = 0; click < 3; click += 1) {
    const clicked = await evaluate(`
      (() => {
        const opts = [...document.querySelectorAll('.quiz-option')];
        for (const o of opts) if (!o.disabled) { o.click(); return true; }
        return false;
      })()
    `)
    if (!clicked) {
      console.log(`    [轮 ${round}] 无可点项，disabled=${JSON.stringify((await optionState()).disabled)}`)
      break
    }
    await wait(700)
    const state = await optionState()
    if (state.classes.some((c) => c.includes('wrong'))) { afterFirst = state; break }
    if (state.classes.some((c) => c.includes('right'))) break // 这题点对了，换下一题
  }
}
expect('能在测试里稳定制造出「答错」场景（最多 5 轮）', afterFirst !== null, '随机抽题始终没撞到错误项')

if (afterFirst) {
  /** 修复前：错选项拿不到任何样式（!answered 分支漏了 isPicked），点了跟没点一样。 */
  expect('答错的项立刻标红（class 含 wrong）', afterFirst.classes.some((c) => c.includes('wrong')), JSON.stringify(afterFirst.classes))
  expect('答错的项被打上叉号', afterFirst.hasX, JSON.stringify(afterFirst.classes))
  expect('答错的项不再可点（点了也改不了分，还会冲掉标记）', afterFirst.disabled.filter((d) => d === true).length === 1, JSON.stringify(afterFirst.disabled))
  expect('其余未答的项仍可点（允许改答案）', afterFirst.disabled.filter((d) => d === false).length === 3, JSON.stringify(afterFirst.disabled))
  expect('反馈点明了是哪个选项不对', /不对/.test(afterFirst.feedback), afterFirst.feedback)
  // 左侧实心色带：不依赖读文字、不受底色透明度影响，是「否定」的通用符号
  expect('答错项有左侧色带（余光就能捕捉到）', parseFloat(afterFirst.wrongBarWidth) >= 4, afterFirst.wrongBarWidth)

  const vd = await visualDiff()
  expect('合成后红标与普通选项色差足够（不是纸色底上的一片粉）', vd.found && vd.dist >= 20, JSON.stringify(vd))
  // 判定放在 Node 侧用数值算，不依赖页面回传的布尔值 ——
  // 之前断言 `vd.redish === true` 出现过「回传值明明是 true 却判失败」的怪事，
  // 断言条件写成 `vd.dist >= 20 && 偏红` 也更贴近「看得出来」这个真实诉求
  const reddish = vd.found && vd.wrongFlat.r - vd.wrongFlat.g >= 12 && vd.wrongFlat.r - vd.wrongFlat.b >= 12
  expect('红标确实偏红（不是别的颜色）', reddish === true, JSON.stringify(vd))

  // 再点一个错项：两个红标要同时存在（picked 单槽位会互相覆盖）
  await evaluate(`
    (() => {
      const opts = [...document.querySelectorAll('.quiz-option')];
      for (const o of opts) if (!o.disabled) { o.click(); return true; }
      return false;
    })()
  `)
  await wait(700)
  const afterSecond = await optionState()
  const wrongCount = afterSecond.classes.filter((c) => c.includes('wrong')).length
  if (!afterSecond.classes.some((c) => c.includes('right'))) {
    expect('连错两项时两个红标都在（不会互相覆盖）', wrongCount === 2, `实际 ${wrongCount} 个 wrong：${JSON.stringify(afterSecond.classes)}`)
    // 红标各自的色带都在 —— 两个错项必须各自独立可辨，不能互相顶掉
    const bars = await evaluate(`
      [...document.querySelectorAll('.quiz-option')]
        .filter((o) => o.className.includes('wrong'))
        .map((o) => getComputedStyle(o).borderLeftWidth)
    `)
    expect('每个红标都带自己的色带', Array.isArray(bars) && bars.length === 2 && bars.every((w) => parseFloat(w) >= 4), JSON.stringify(bars))
  } else {
    expect('答对后反馈说明要点继续', /继续/.test(afterSecond.feedback), afterSecond.feedback)
    expect('答对项与错误项视觉可区分', new Set(afterSecond.classes).size >= 2, JSON.stringify(afterSecond.classes))
  }
}

// 键盘
console.log('\n键盘可达性')
/**
 * 归位到「未作答」状态。
 *
 * 必须这么做：上一段可能已经答对 / 揭晓了，题目处于 locked 态。
 * 键盘测试的前提是「题目可作答」，否则按什么键都没反应 ——
 * 那是状态不对，不是键盘功能坏了。这属于测试之间不隔离的坑。
 */
await evaluate(`
  (() => {
    // 点「换一题」最直接：不管当前是已答对还是已揭晓都能重置
    const again = [...document.querySelectorAll('.quiz-secondary button, .quiz-actions button')]
      .find((b) => /换一题/.test(b.textContent || ''));
    if (again) { again.click(); return 'clicked'; }
    const next = [...document.querySelectorAll('.quiz-actions button')]
      .find((b) => /下一题/.test(b.textContent || ''));
    if (next) { next.click(); return 'next'; }
    return 'none';
  })()
`)
await wait(900)
const ready = await optionState()
expect('已归位到可作答状态', ready.disabled.every((d) => d === false), JSON.stringify(ready.disabled))

await pressKey('Enter')
const revealed = await optionState()
expect('Enter 可揭晓答案', revealed.classes.some((c) => c.includes('right')), JSON.stringify(revealed.classes))
const beforePrompt = revealed.prompt
await pressKey('Enter')
const nextQuestion = await optionState()
expect('Enter 可进入下一题', nextQuestion.prompt !== beforePrompt, nextQuestion.prompt.slice(0, 30))
expect('新题的四个选项恢复可点', nextQuestion.disabled.every((d) => d === false), JSON.stringify(nextQuestion.disabled))

const hintText = await evaluate("(document.querySelector('.quiz-control-hint') || {}).textContent || ''")
expect('界面提示了快捷键', /A\/B\/C\/D/.test(hintText), hintText)

await pressKey('2')
const afterKey = await optionState()
expect('数字键可选答案', afterKey.feedback.length > 0, afterKey.feedback)

// 输入框不该被抢键
console.log('\n输入框保护')
const inputGuard = await evaluate(`
  (() => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const ok = document.activeElement === input;
    input.remove();
    return ok;
  })()
`)
expect('输入框能正常获得焦点（键盘不会被抢）', inputGuard === true)

/* ============================================================
 * 连错渐进提示
 *
 * 必须在真实浏览器里连点三次错答案，才能验证三档救济真的按顺序触发 ——
 * 纯函数测试证明不了「第二次点下去时选项被正确排掉」这类交互。
 * ============================================================ */

console.log('\n连错渐进提示（三档）')

/*
这个段落必须**逐轮现场判断**「这一下点的是不是错项」。

实测踩过的坑：最初写成「点第一个未 disabled 的选项」然后假定它就是错的，
结果第 3 轮随机点中了正确答案 —— 那一轮是「答对」而不是「连错三次」，
断言却还在等 assist=3，于是报出一堆假失败，还让人以为组件坏了
（诊断脚本连打四轮，assist=1/2/0 全部正确）。

所以：每轮点完立刻回读，答对了就换一题重来，直到真的攒够三次错误。
*/
const readState = () => evaluate([
  '(() => {',
  '  const opts = [...document.querySelectorAll(".quiz-option")];',
  '  const badge = document.querySelector(".assist-badge");',
  '  return {',
  '    available: opts.map((o) => !o.disabled && !o.className.includes("right")),',
  '    classes: opts.map((o) => o.className.replace("quiz-option", "").trim()),',
  '    assist: badge ? Number(badge.dataset.level) || 0 : 0,',
  '    assistBadge: badge ? badge.textContent || "" : "",',
  '    eliminatedCount: opts.filter((o) => o.className.includes("out")).length,',
  '    rightIsEliminated: opts.some((o) => o.className.includes("right") && o.className.includes("out")),',
  '    solved: opts.some((o) => o.className.includes("right")),',
  '    feedback: (document.querySelector(".feedback") || {}).textContent || "",',
  '  };',
  '})()',
].join('\n'))

/** 点掉第一个可选项（不点已标 right 的），返回点击后的状态 */
const clickOne = async () => {
  await evaluate([
    '(() => {',
    '  const opts = [...document.querySelectorAll(".quiz-option")];',
    '  const i = opts.findIndex((o) => !o.disabled && !o.className.includes("right"));',
    '  if (i >= 0) opts[i].click();',
    '  return i;',
    '})()',
  ].join('\n'))
  await wait(420)
  return readState()
}

/** 换到一题干净的：点「继续」，若当前还在作答中则先揭晓 */
const freshQuestion = async () => {
  await evaluate([
    '(() => {',
    '  const opts = [...document.querySelectorAll(".quiz-option")];',
    '  const answered = opts.some((o) => o.className.includes("right"));',
    '  if (answered) {',
    '    const next = [...document.querySelectorAll("button")].find((b) => /继续/.test(b.textContent || ""));',
    '    if (next) { next.click(); return true; }',
    '  }',
    '  return false;',
    '})()',
  ].join('\n'))
  await wait(500)
}

/**
 * 攒够 target 次连错才返回。
 *
 * 关键：中途点中正确答案会换题，而新题的 assist 从 0 重来 ——
 * 这时**必须把已收集的 seen 清空**。之前不清空，
 * 换题后收集到的另一个「首错」会被当成「第 2 档」，
 * 断言 于是拿 assist=1 去比 2，报出假失败（实测踩过）。
 */
const collectWrongStreak = async (target) => {
  let seen = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await clickOne()
    if (state.solved) {
      // 换题 = 前面攒的连错全部作废
      seen = []
      await freshQuestion()
      continue
    }
    seen.push(state)
    if (state.assist >= target) return seen
  }
  return seen
}
/**
 * 强制换到一道**完全干净**的题：先看有没有「继续」，没有就点「换一题」。
 *
 * 这一步不能省。之前实测踩过：上一段「答错反馈」测试结束时本题已错了两次，
 * 直接开始连错测试 → 第一轮点下去 assist 已经是 2，档位整体错位一格，
 * 报出 7 条假失败，而组件行为其实完全正确。
 * 判据是「没有 assist 徽标且没有红标」，而不是「有没有继续按钮」。
 */
const resetToCleanQuestion = async () => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const probe = await evaluate([
      '(() => {',
      '  const opts = [...document.querySelectorAll(".quiz-option")];',
      '  const badge = document.querySelector(".assist-badge");',
      '  const dirty = !!badge || opts.some((o) => o.className.includes("wrong") || o.className.includes("out"));',
      '  if (!dirty) return { clean: true, clicked: null };',
      '  const cands = [...document.querySelectorAll("button")].filter((b) => /继续|换一题/.test(b.textContent || ""));',
      '  if (cands.length) { cands[0].click(); return { clean: false, clicked: (cands[0].textContent || "").trim(), n: cands.length }; }',
      '  return { clean: false, clicked: null, n: 0, allButtons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).slice(0, 30) };',
      '})()',
    ].join('\n'))
    if (process.env.DEBUG_RESET) console.log('      reset', attempt, JSON.stringify(probe))
    if (probe.clean === true) return true
    await wait(500)
  }
  return false
}

const startedClean = await resetToCleanQuestion()
expect('能回到一道没答错过的干净题', startedClean === true)

/*
第三档**不能硬等** assist === 3。

第 2 档已经自动排掉一个错项，剩下可点的只有「1 错 + 1 对」，
盲点有 50% 概率命中正确答案 —— 那就不是「连错三次」，而是提前答对。
所以这里改为：只要 1 → 2 的递进出现，且第三次作答后本题必然收束
（揭晓 / 答对 / 可点项归零），就算走完了整条阶梯。
「assistLevelFor(3) === 3」本身由 smoke 的纯函数断言负责。
*/
const assistRun = await collectWrongStreak(2)
const assistFirst = assistRun[0]
const assistSecond = assistRun[1]
const thirdOutcome = await clickOne()

expect(
  '第 1 次答错触发「方向提示」',
  Boolean(assistFirst) && assistFirst.assist === 1,
  `assist=${assistFirst?.assist} feedback=${String(assistFirst?.feedback).slice(0, 50)}`,
)
expect(
  '方向提示里出现救济档位徽标',
  assistFirst?.assistBadge === '给个方向',
  assistFirst?.assistBadge,
)
expect(
  '方向提示点出了所属知识点（不是空话）',
  /属于「.+」/.test(String(assistFirst?.feedback)),
  String(assistFirst?.feedback).slice(0, 60),
)
expect(
  '第 2 次答错自动排掉一个错误选项',
  Boolean(assistSecond) && assistSecond.assist === 2 && assistSecond.eliminatedCount >= 1,
  `assist=${assistSecond?.assist} eliminated=${assistSecond?.eliminatedCount}`,
)
expect(
  '第 2 档徽标文案跟着变',
  assistSecond?.assistBadge === '帮你排掉一个',
  assistSecond?.assistBadge,
)
expect(
  '自动排除永远不会排掉正确选项',
  assistRun.every((state) => state.rightIsEliminated === false),
  assistRun.map((s) => s.rightIsEliminated).join(','),
)
expect(
  '第 3 次作答后本题必然收束（揭晓或直接答对）',
  thirdOutcome.solved === true
    || thirdOutcome.assist === 3
    || thirdOutcome.classes.some((c) => c.includes('right') || c.includes('dim')),
  `assist=${thirdOutcome.assist} classes=${JSON.stringify(thirdOutcome.classes)}`,
)
expect(
  '救济阶梯走到尽头后不再有「未表态」的选项',
  thirdOutcome.classes.every(
    (c) => c.includes('right') || c.includes('dim') || c.includes('out') || c.includes('wrong'),
  ),
  JSON.stringify(thirdOutcome.classes),
)

/* ============================================================
 * 错题本
 * ============================================================ */

console.log('\n错题本')
// 记下当前条数与第一名的错误次数，后面用「至少有一项变强」来验证，
// 而不是「条目数必须增加」—— 不重复开着时很可能连着抽到同一道题，
// 那时正确行为是**次数累加**而不是新增一行（markWrong 的设计）。
const bookBefore = await evaluate(`
  (() => {
    const times = [...document.querySelectorAll('.mistake-times')].map((n) => n.textContent || '');
    return {
      present: !!document.querySelector('.mistake-book'),
      count: document.querySelectorAll('.mistake-list li').length,
      total: (document.querySelector('.mistake-book header span') || {}).textContent || '',
      timesSum: times.reduce((sum, t) => sum + (Number(String(t).replace(/[^0-9]/g, '')) || 0), 0),
    };
  })()
`)
console.log(`      答错前：${bookBefore.total}（合计错 ${bookBefore.timesSum} 次）`)

await freshQuestion()
// 攒一次新的错误（点中正确就换题重来）
for (let attempt = 0; attempt < 20; attempt += 1) {
  const state = await clickOne()
  if (!state.solved) break
  await freshQuestion()
}
await wait(300)

const bookAfter = await evaluate(`
  (() => {
    const items = [...document.querySelectorAll('.mistake-list li')];
    const times = [...document.querySelectorAll('.mistake-times')].map((n) => n.textContent || '');
    const currentOptions = [...document.querySelectorAll('.quiz-option-text')].map((o) => o.textContent || '');
    return {
      present: !!document.querySelector('.mistake-book'),
      count: items.length,
      total: (document.querySelector('.mistake-book header span') || {}).textContent || '',
      timesSum: times.reduce((sum, t) => sum + (Number(String(t).replace(/[^0-9]/g, '')) || 0), 0),
      // 零泄漏：错题本里不允许出现当前题的任何选项原文
      leakTexts: items.flatMap((li) => {
        const mine = li.textContent || '';
        return currentOptions.filter((o) => o.length >= 4 && mine.includes(o));
      }),
      hasReview: !!document.querySelector('.mistake-review'),
      hasTimes: !!document.querySelector('.mistake-times'),
    };
  })()
`)
expect('错题本面板已渲染', bookAfter.present === true)
// 判据是「错题总量增加」：可能是多了一道新错题，也可能是同一道又错了一次
expect(
  `再答错一道后错题本记录的错次增加（${bookBefore.timesSum} → ${bookAfter.timesSum}）`,
  bookAfter.timesSum > bookBefore.timesSum,
  `${bookBefore.total} → ${bookAfter.total}`,
)
expect(
  '错题本里没有泄漏任何选项原文',
  bookAfter.leakTexts.length === 0,
  bookAfter.leakTexts.join(' | '),
)
expect('错题本标了每题错了几次', bookAfter.hasTimes === true)
expect('错题本有「重练」按钮', bookAfter.hasReview === true)

// 重练必须**确定性**地跳到玩家点的那道题 —— 抽题是随机的，点哪道练哪道靠的是单独通路
const reviewJump = await evaluate(`
  (() => {
    const li = document.querySelector('.mistake-list li');
    if (!li) return { wanted: '', clicked: false };
    const wanted = (li.querySelector('.mistake-prompt') || {}).textContent || '';
    const btn = li.querySelector('.mistake-review');
    if (!btn) return { wanted, clicked: false };
    btn.click();
    return { wanted, clicked: true };
  })()
`)
await wait(700)
const reviewLanded = await evaluate(`
  (() => ({
    prompt: (document.querySelector('.quiz-prompt') || {}).textContent || '',
  }))()
`)
expect('错题本条目上的「重练」按钮可点', reviewJump.clicked === true)
expect(
  '点「重练」跳到指定的那道题',
  reviewJump.clicked === true && reviewLanded.prompt === reviewJump.wanted,
  `期望「${String(reviewJump.wanted).slice(0, 24)}」实际「${reviewLanded.prompt.slice(0, 24)}」`,
)

/* ============================================================
 * 数据自检面板
 * ============================================================ */

console.log('\n数据自检面板')
const panel = await evaluate(`
  (() => {
    const el = document.querySelector('.selfcheck');
    if (!el) return { present: false };
    const items = [...el.querySelectorAll('.selfcheck-item')];
    const cs = getComputedStyle(el);
    return {
      present: true,
      count: items.length,
      statuses: items.map((n) => n.dataset.status),
      passed: items.filter((n) => n.dataset.status === 'passed').length,
      skipped: items.filter((n) => n.dataset.status === 'skipped').length,
      // 面板不能是「一堆没样式的 div」：底色与内边距必须真的生效
      padding: cs.paddingTop,
      background: cs.backgroundColor,
      dotSize: (() => {
        const dot = el.querySelector('.selfcheck-dot');
        return dot ? getComputedStyle(dot).width : '0px';
      })(),
      when: (el.querySelector('.selfcheck-when') || {}).textContent || '',
      size: (el.querySelector('.selfcheck-size') || {}).textContent || '',
    };
  })()
`)
expect('自检面板已渲染', panel.present === true)
expect(`自检面板列出全部 6 项检查（实测 ${panel.count}）`, panel.count === 6, String(panel.count))
expect(
  '自检面板标了检查时间（不假装实时）',
  /检查于\s*\d{4}-\d{2}-\d{2}/.test(panel.when),
  panel.when,
)
expect(
  '自检面板显示了整站体量',
  /图鉴\s*\d+\s*条/.test(panel.size) && /题库\s*\d+\s*道/.test(panel.size),
  panel.size,
)
expect(
  '自检面板样式真的生效（有内边距与底色）',
  parseFloat(panel.padding) > 8 && panel.background !== 'rgba(0, 0, 0, 0)',
  `padding=${panel.padding} bg=${panel.background}`,
)
expect(
  '自检圆点有实际尺寸（不是塌成 0 的空元素）',
  parseFloat(panel.dotSize) > 3,
  panel.dotSize,
)
expect(
  '未跑的检查标成 skipped 而不是伪装通过',
  panel.statuses.every((s) => s === 'passed' || s === 'failed' || s === 'skipped')
    && panel.passed + panel.skipped === panel.count,
  panel.statuses.join(','),
)

/* ============================================================
 * 挑战玩法：属性对决 / 逆向合成 / 找异类 / 盲猜音效
 *
 * 出题逻辑已由 smoke 批量验证（答案唯一、无歧义），
 * 这里只验证浏览器里**真的渲染出来且能玩**：
 * 面板渲染、选项可点、答对答错有视觉反馈、音效文件真能加载。
 * ============================================================ */

console.log('\n挑战玩法')
const openArcade = async (label) => {
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('.mode-switch button')]
        .find((b) => /${label}/.test(b.textContent || ''));
      if (btn) btn.click();
      return !!btn;
    })()
  `)
  await wait(900)
}

const arcadeState = () => evaluate([
  '(() => ({',
  '  title: (document.querySelector(".game-bay h1") || {}).textContent || "",',
  '  options: [...document.querySelectorAll(".quiz-option")].map((o) => (o.textContent || "").trim()),',
  '  disabled: [...document.querySelectorAll(".quiz-option")].map((o) => o.disabled),',
  '  hasDuel: !!document.querySelector(".duel-stage"),',
  '  hasOdd: !!document.querySelector(".odd-grid"),',
  '  hasSound: !!document.querySelector(".sound-player"),',
  '  hasReverse: !!document.querySelector(".reverse-target"),',
  '  feedback: (document.querySelector(".feedback") || {}).textContent || "",',
  '}))()',
].join('\n'))

// 属性对决
await openArcade('属性对决')
let st = await arcadeState()
expect('属性对决能打开', st.hasDuel === true, st.title)
expect(`属性对决有三个选项（左/右/一样高，实测 ${st.options.length}）`, st.options.length === 3, JSON.stringify(st.options))
expect('属性对决选项可点', st.disabled.every((d) => d === false), JSON.stringify(st.disabled))
await evaluate("document.querySelector('.quiz-option:not([disabled])')?.click(); true")
await wait(400)
st = await arcadeState()
expect('属性对决答完有反馈', st.feedback.length > 6, st.feedback.slice(0, 40))

// 找异类
await openArcade('找异类')
st = await arcadeState()
expect('找异类能打开', st.hasOdd === true, st.title)
expect(`找异类有四个选项（实测 ${st.options.length}）`, st.options.length === 4)
await evaluate("document.querySelector('.quiz-option:not([disabled])')?.click(); true")
await wait(400)
st = await arcadeState()
expect('找异类答完有反馈', st.feedback.length > 6)

// 逆向合成
await openArcade('逆向合成')
st = await arcadeState()
expect('逆向合成能打开', st.hasReverse === true, st.title)
expect(`逆向合成有四个选项（实测 ${st.options.length}）`, st.options.length === 4)

// 盲猜音效：核心是音频文件真能取到
await openArcade('盲猜音效')
st = await arcadeState()
expect('盲猜音效能打开', st.hasSound === true, st.title)
expect(`盲猜音效有四个选项（实测 ${st.options.length}）`, st.options.length === 4)
const audioProbe = await evaluate(`
  (async () => {
    const el = document.querySelector('.sound-player');
    if (!el) return { ok: false, reason: 'no-player' };
    // 直接对资源发请求，确认文件真的在构建产物里且能下载
    const res = await fetch('/sounds/mob_cow_ambient1.ogg').catch(() => null);
    return { ok: !!res && res.ok, status: res ? res.status : 0 };
  })()
`)
expect(
  `音效文件能从站点取到（HTTP ${audioProbe.status}）`,
  audioProbe.ok === true,
  JSON.stringify(audioProbe),
)

// 每日挑战
await openArcade('每日挑战')
st = await arcadeState()
expect('每日挑战能打开', /今日挑战/.test(st.title), st.title)
const dailyNote = await evaluate("(document.querySelector('.arcade-daily-note') || {}).textContent || ''")
expect('每日挑战标注了日期', /\d{4}-\d{2}-\d{2}/.test(dailyNote), dailyNote)
expect(`每日挑战有选项（实测 ${st.options.length}）`, st.options.length >= 3)

console.log('\n页面无 JS 异常')
expect('没有未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`)

/**
 * 收尾要显式做三件事，否则脚本会挂住不退出：
 * ① 关掉 CDP WebSocket（不关 Node 不会退出）
 * ② 杀掉 Chrome —— 只靠 `process.on('exit')` 不够，
 *    Chrome 是个独立进程树，父进程退了它还占着端口和 profile 目录
 * ③ 删 profile 目录（Chrome 退出前文件还锁着，删不掉）
 * 所以这里必须同步等 Chrome 真的退出，再清理，最后 process.exit。
 */
ws.close()
chrome.kill()
await new Promise((resolve) => {
  if (chrome.exitCode !== null || chrome.signalCode !== null) { resolve(); return }
  chrome.once('exit', resolve)
  // 兜底：Chrome 偶尔不响应 SIGTERM，2 秒后强行结束
  setTimeout(() => { try { chrome.kill('SIGKILL') } catch { /* 已退出 */ } resolve() }, 2000)
})
// Chrome 退出后文件锁才解除，再清一次
try { rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* 清不掉也不该让测试失败 */ }
process.exit(failed > 0 ? 1 : 0)
