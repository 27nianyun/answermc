#!/usr/bin/env node
/**
 * 预览服务自检：确认「服务返回的 HTML」和「磁盘上的文件」是一致的。
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────
 * `vite preview` 会把 index.html 缓存在内存里。只要服务还活着，
 * 你之后重新构建（vite build 会**清空输出目录**），它返回的 HTML
 * 就还引用着上一版的 js —— 而那个文件已经被删了 → 404 → 白屏。
 *
 * 症状极具误导性：页面看起来像「按钮点不动」「交互失灵」，
 * 实际上整个应用根本没加载。所以这类问题必须先排除「资源可达性」，
 * 再去查交互代码，否则会在错的方向上查很久。
 *
 * 用法：
 *   node scripts/check-preview.mjs [port] [dir]
 * 默认 port=4205，dir=dist-verify（与本项目 preview 保持一致）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] ?? '4205'
const dir = process.argv[3] ?? 'dist-verify'
const base = `http://127.0.0.1:${port}`

const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

const ok = (message) => console.log(`  ✓ ${message}`)

console.log(`预览自检：${base}（服务目录 ${dir}）\n`)

let html
try {
  const response = await fetch(`${base}/`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  html = await response.text()
} catch (error) {
  console.error(`✗ 连不上预览服务：${error.message}`)
  console.error('  启动：npx vite preview --outDir dist-verify --port 4205 --host 127.0.0.1')
  process.exit(1)
}

ok('服务可达')

// 抽出 HTML 里引用的所有本地资源
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1])
if (assets.length === 0) {
  fail('HTML 里没有引用任何 /assets 资源，页面多半是空的')
  process.exit(1)
}

// 关键守卫：服务引用的文件必须在磁盘上存在
// 这一条能直接抓出「磁盘是新的、服务的还是旧的」这种不一致
const missingOnDisk = assets.filter((asset) => !existsSync(join(dir, asset)))
if (missingOnDisk.length > 0) {
  console.error(`\n✗ 服务返回的 HTML 引用了 ${missingOnDisk.length} 个磁盘上不存在的文件：`)
  for (const asset of missingOnDisk) console.error(`    ${asset}`)
  console.error('\n  这是「白屏 / 什么都点不了」的根因，不是交互 bug。')
  console.error(`  修复：重新构建 ${dir} 并重启 preview（vite preview 会缓存 index.html）：`)
  console.error(`    npx vite build --outDir ${dir}`)
  console.error(`    # 杀掉占用 ${port} 的进程后重启`)
  process.exit(1)
}
ok(`引用的 ${assets.length} 个资源在磁盘上都存在`)

// 再确认真的能下载（磁盘存在 ≠ 服务能提供，权限/路径问题也会 404）
const unreachable = []
for (const asset of assets) {
  const response = await fetch(`${base}/${asset}`, { method: 'HEAD' }).catch(() => null)
  if (!response || !response.ok) unreachable.push(`${asset}（${response ? `HTTP ${response.status}` : '连接失败'}）`)
}
if (unreachable.length > 0) {
  fail(`${unreachable.length} 个资源无法下载：${unreachable.join('、')}`)
  process.exit(1)
}
ok('所有引用资源都能正常下载')

console.log('\n预览服务状态正常。')
