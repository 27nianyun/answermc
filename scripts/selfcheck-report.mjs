#!/usr/bin/env node
/**
 * 自检面板数据源：把各项 check 脚本的结果汇成一份 JSON。
 *
 * ── 为什么要有这个文件 ────────────────────────────────────
 * 检查脚本本来只在终端里跑，跑完就散掉了 —— 能回答的是「上次跑的时候健不健康」，
 * 而不是「现在到底健不健康」。这个脚本把结果落盘，
 * 前端的「数据自检」面板直接读它，页面上就能看到当前状态。
 *
 * ── 为什么不直接在前端跑检查 ──────────────────────────────
 * 那些检查要读磁盘（贴图、catalog 2827 条）、要起 Chrome 做 CDP 真实交互，
 * 浏览器里做不了。诚实的做法是**离线跑、落盘、页面只读**，
 * 并在面板上标明每项的检查时间，而不是假装是实时的。
 *
 * 用法：
 *   node scripts/selfcheck-report.mjs                       全跑（需先 build 并起 preview）
 *   node scripts/selfcheck-report.mjs --offline             只跑不依赖服务的项
 *   PREVIEW_URL=http://127.0.0.1:4211/ node scripts/selfcheck-report.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/data/selfcheck.json')
const OFFLINE = process.argv.includes('--offline')

/**
 * 检查项清单。
 *
 * `needsServer` 的三项要真实 HTTP 服务：预览自检要确认服务返回的 HTML 引用的是
 * 当前构建产物，响应式巡检要开 6 个视口实测布局，浏览器检查要走 CDP。
 * 离线模式下它们标成 skipped 而不是伪装通过 —— 面板上要能一眼看出「这项没跑」。
 *
 * `args` 是按需拼的位置参数。注意 check-preview 的第二个参数是**服务目录**，
 * 它的历史默认值是 dist-verify，而本项目日常预览的是 dist —— 不传就会拿
 * 另一个目录去比对，报出一堆「文件不存在」的假故障。
 */
const PREVIEW_PORT = (() => {
  try {
    return new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:4205/').port || '4205'
  } catch {
    return '4205'
  }
})()
const PREVIEW_DIR = process.env.PREVIEW_DIR ?? 'dist'

const CHECKS = [
  {
    id: 'classes',
    label: '样式孤儿类',
    command: ['node', 'scripts/check-orphan-classes.mjs'],
    detail: '代码里用到的 class 与 var() 是否都有定义',
  },
  {
    id: 'answers',
    label: '答案自洽',
    command: ['node', 'scripts/check-answer-consistency.mjs'],
    detail: '解释里说的「正确答案 N」与被判为正确的选项是否一致',
  },
  {
    id: 'sprites',
    label: '贴图健康',
    command: ['node', 'scripts/check-sprites.mjs'],
    detail: 'catalog 每条是否都有可用贴图，有无孤儿素材',
  },
  {
    id: 'preview',
    label: '构建产物引用',
    command: ['node', 'scripts/check-preview.mjs', PREVIEW_PORT, PREVIEW_DIR],
    detail: '预览服务返回的 HTML 是否引用当前构建里的文件',
    needsServer: true,
  },
  {
    id: 'responsive',
    label: '多视口布局',
    command: ['node', 'scripts/check-responsive.mjs'],
    detail: '1440 / 1100 / 900 / 720 / 560 / 390 六档下的溢出与可点性',
    needsServer: true,
  },
  {
    id: 'browser',
    label: '真实浏览器交互',
    command: ['node', 'scripts/browser-check.mjs'],
    detail: 'CDP 驱动 Chrome 跑完整交互，含答错视觉与分段控件',
    needsServer: true,
  },
]

const run = (command) => new Promise((resolve) => {
  const started = Date.now()
  const child = spawn(command[0], command.slice(1), {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const done = (code) => resolve({ code, output, ms: Date.now() - started })
  child.on('close', done)
  child.on('error', (error) => done(-1, String(error.message ?? error)))
})

/** 从输出里刨出可读的结论行（✓ / ✗ 那几行），收窄长度以便放进卡片 */
const digest = (output) => output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^[✓✗]/.test(line))
  .map((line) => line.replace(/^[✓✗]\s*/, '').slice(0, 110))
  .slice(0, 4)

const results = []
for (const check of CHECKS) {
  if (OFFLINE && check.needsServer) {
    results.push({
      id: check.id,
      label: check.label,
      detail: check.detail,
      command: check.command.join(' '),
      status: 'skipped',
      ms: 0,
      lines: [],
    })
    continue
  }
  process.stdout.write(`跑「${check.label}」… `)
  const { code, output, ms } = await run(check.command)
  process.stdout.write(code === 0 ? `通过（${ms}ms）\n` : `失败（${ms}ms）\n`)
  results.push({
    id: check.id,
    label: check.label,
    detail: check.detail,
    command: check.command.join(' '),
    status: code === 0 ? 'passed' : 'failed',
    ms,
    lines: digest(output),
  })
}

const counts = {
  total: results.length,
  passed: results.filter((r) => r.status === 'passed').length,
  failed: results.filter((r) => r.status === 'failed').length,
  skipped: results.filter((r) => r.status === 'skipped').length,
}

const readJson = (relative) => JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))

const payload = {
  generatedAt: new Date().toISOString(),
  offline: OFFLINE,
  counts,
  checks: results,
  // 整站体量：面板上顺手让人知道这个项目有多大
  size: {
    catalog: readJson('src/data/catalog.json').catalog.length,
    transformations: readJson('src/data/transformations.json').transforms.length,
    questions: readJson('src/data/quiz.json').questions.length,
    sprites: Object.keys(readJson('src/data/sprites.json').map).length,
  },
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

console.log(`\n通过 ${counts.passed} / ${counts.total}（跳过 ${counts.skipped}，失败 ${counts.failed}）`)
console.log(`已写入 ${OUT}`)
process.exit(counts.failed > 0 ? 1 : 0)
