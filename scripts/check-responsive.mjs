/**
 * 响应式与视图巡检。
 *
 * 上一轮的 bug（难度按钮糊成一片）只会在特定宽度下暴露，
 * 而 check:browser 固定 1400px 单一视口 —— 窄屏完全没测过。
 * 这个脚本在多个宽度下检查：控制条是否溢出、选项是否还能点、有没有横向滚动。
 */
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const { spawn } = await import('node:child_process')
const { mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const PREVIEW = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4205/'
const WIDTHS = [1440, 1100, 900, 720, 560, 390]

const profile = mkdtempSync(join(tmpdir(), 'respcheck'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9450',
  '--user-data-dir=' + profile, '--no-first-run', '--hide-scrollbars',
], { stdio: 'ignore' })

let ws
let seq = 0
const pending = new Map()
for (let i = 0; i < 60; i += 1) {
  try {
    const r = await fetch('http://127.0.0.1:9450/json/list')
    const list = await r.json()
    const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break }
  } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 300))
}
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id) }
})
await new Promise((r) => ws.addEventListener('open', r))

const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, { resolve })
  ws.send(JSON.stringify({ id, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0
const expect = (label, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: PREVIEW })
await wait(4200)
await ev(`[...document.querySelectorAll('button, [role=tab], a')].find((x) => /知识问答/.test(x.textContent || ''))?.click()`)
await wait(2200)

const probe = () => ev(`(() => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;
  // 找出横向溢出的元素
  const bleeders = [];
  for (const el of document.querySelectorAll('.game-bay *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > doc.clientWidth + 1) {
      bleeders.push(el.className + ' right=' + Math.round(r.right));
    }
    if (bleeders.length >= 5) break;
  }
  const segs = [...document.querySelectorAll('.segmented')].map((s) => {
    const btns = [...s.querySelectorAll('button')];
    const rects = btns.map((b) => b.getBoundingClientRect());
    return {
      labels: btns.map((b) => (b.textContent || '').trim()).join('/'),
      gaps: rects.slice(1).map((r, i) => Math.round(r.left - rects[i].right)),
      widths: rects.map((r) => Math.round(r.width)),
      h: Math.round(rects[0]?.height || 0),
    };
  });
  const opts = [...document.querySelectorAll('.quiz-option')];
  return JSON.stringify({
    overflow,
    bleeders,
    segs,
    optCount: opts.length,
    optClickable: opts.filter((o) => !o.disabled).length,
    optW: opts[0] ? Math.round(opts[0].getBoundingClientRect().width) : 0,
    // 选项文字被截断（省略号）通常是窄屏下真出问题了
    optClipped: opts.filter((o) => o.scrollWidth > o.clientWidth + 2).length,
  });
})()`)

console.log('响应式巡检：', PREVIEW)
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 700 })
  await wait(900)
  const s = JSON.parse(await probe())
  console.log(`\n── ${w}px ──`)
  expect('无横向滚动', s.overflow <= 1, `溢出 ${s.overflow}px${s.bleeders.length ? '：' + s.bleeders.join(' | ') : ''}`)
  expect('四个选项都在', s.optCount === 4, `实际 ${s.optCount}`)
  expect('四个选项都可点', s.optClickable === 4, `实际 ${s.optClickable}`)
  expect('选项文字未被截断', s.optClipped === 0, `${s.optClipped} 个选项文字溢出`)
  for (const seg of s.segs) {
    expect(`${seg.labels}：按钮不重叠`, seg.gaps.every((g) => g >= 1), JSON.stringify(seg.gaps))
    expect(`${seg.labels}：按钮够宽`, seg.widths.every((x) => x >= 32), JSON.stringify(seg.widths))
  }
}

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`)
ws.close()
chrome.kill()
await new Promise((r) => setTimeout(r, 1500))
try { rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(failed === 0 ? 0 : 1)
