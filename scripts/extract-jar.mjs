import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const jarPath = join(root, '.cache/client-26.1.jar')
const outDir = join(root, '.cache/jar')

if (!existsSync(jarPath)) {
  console.error('缺少 .cache/client-26.1.jar，请先下载客户端 jar。')
  process.exit(1)
}

const entries = unzipSync(new Uint8Array(readFileSync(jarPath)))
const wanted = (name) => name.startsWith('assets/minecraft/textures/')
  || name.startsWith('assets/minecraft/models/')
  || name.startsWith('assets/minecraft/blockstates/')
  || name.startsWith('assets/minecraft/items/')
  || name.startsWith('data/minecraft/recipe/')
  || name.startsWith('data/minecraft/tags/items/')
  || name.startsWith('data/minecraft/tags/blocks/')
  || name.startsWith('data/minecraft/tags/block/')
  || name.startsWith('data/minecraft/tags/item/')

let count = 0
let bytes = 0
for (const [name, data] of Object.entries(entries)) {
  if (name.endsWith('/') || !wanted(name) || !data.length) continue
  const target = join(root, '.cache/jar', name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  count += 1
  bytes += data.length
}

console.log(`解压 ${count} 个资源文件（${(bytes / 1024 / 1024).toFixed(1)} MB）到 ${outDir}`)
