/**
 * 下载指定版本的 Minecraft 客户端 jar（用于生成官方材质图标）。
 * 用法：node scripts/fetch-client-jar.mjs [版本号，默认取题库 meta.version]
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const cacheDir = join(root, '.cache')

const catalog = JSON.parse(readFileSync(join(root, 'src/data/catalog.json'), 'utf8'))
const version = process.argv[2] ?? catalog.meta.version

mkdirSync(cacheDir, { recursive: true })

const manifestPath = join(cacheDir, 'manifest.json')
if (!existsSync(manifestPath)) {
  const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  if (!response.ok) throw new Error(`下载版本清单失败：${response.status}`)
  writeFileSync(manifestPath, await response.text())
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entry = manifest.versions.find((item) => item.id === version)
if (!entry) throw new Error(`清单里没有版本 ${version}`)

const versionMetaPath = join(cacheDir, `${version}.json`)
if (!existsSync(versionMetaPath)) {
  const response = await fetch(entry.url)
  if (!response.ok) throw new Error(`下载版本元数据失败：${response.status}`)
  writeFileSync(versionMetaPath, await response.text())
}

const versionMeta = JSON.parse(readFileSync(versionMetaPath, 'utf8'))
const client = versionMeta.downloads.client
const jarPath = join(cacheDir, `client-${version}.jar`)

if (existsSync(jarPath) && statSync(jarPath).size === client.size) {
  console.log(`客户端 jar 已存在：${jarPath}`)
} else {
  console.log(`下载 client.jar（${(client.size / 1024 / 1024).toFixed(1)} MB）…`)
  const response = await fetch(client.url)
  if (!response.ok) throw new Error(`下载 client.jar 失败：${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(jarPath, buffer)
  console.log(`已保存：${jarPath}`)
}

console.log(`下一步：node scripts/extract-jar.mjs && node scripts/generate-sprites.mjs`)
