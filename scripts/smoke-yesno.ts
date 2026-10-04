import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { answerQuestion } from '../src/yesno'
import type { CatalogData, CatalogEntry } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(here, '../src/data/catalog.json'), 'utf8')) as CatalogData

const find = (name: string, kind?: string): CatalogEntry => {
  const hit = data.catalog.find((entry) => entry.name === name && (!kind || entry.kind === kind))
  if (!hit) throw new Error(`missing entry: ${name}`)
  return hit
}

const cases: Array<[string, string, boolean, string?]> = [
  ['stone', '它是方块吗？', true],
  ['stone', '它是物品吗？', false],
  ['stone', '它是生物或实体吗？', false],
  ['stone', '它是石质类吗？', true],
  ['stone', '它会发光吗？', false],
  ['stone', '它的硬度大于 1 吗？', true],

  ['glowstone', '它会发光吗？', true],
  ['glowstone', '它的发光等级达到 10 以上吗？', true],

  ['obsidian', '它的硬度大于 5 吗？', true],
  ['obsidian', '它的爆炸抗性大于 10 吗？', true],

  ['diamond_ore', '它是矿石吗？', true],
  ['diamond_ore', '它能堆叠到 64 个吗？', true],

  ['oak_door', '它是方块吗？', true],
  ['oak_door', '它是木质或植物类吗？', true],
  ['oak_door', '它有超过 1 种方块状态组合吗？', true],

  ['glass', '它可透光吗？', true],
  ['glass', '它是玻璃类吗？', true],

  ['creeper', '它是生物或实体吗？', true, 'mob'],
  ['creeper', '它是攻击型生物吗？', true, 'mob'],
  ['creeper', '它是亡灵生物吗？', false, 'mob'],
  ['creeper', '它是被动型生物吗？', false, 'mob'],
  ['creeper', '它可以被驯服吗？', false, 'mob'],

  ['zombie', '它是亡灵生物吗？', true, 'mob'],
  ['zombie', '它是攻击型生物吗？', true, 'mob'],

  ['cow', '它是被动型生物吗？', true, 'mob'],
  ['cow', '它是攻击型生物吗？', false, 'mob'],

  ['wolf', '它可以被驯服吗？', true, 'mob'],
  ['ender_dragon', '它是首领生物吗？', true, 'mob'],
  ['bat', '它会飞吗？', true, 'mob'],
  ['cod', '它是水生生物吗？', true, 'mob'],
  ['acacia_boat', '它是载具类实体吗？', true, 'mob'],
  ['minecart', '它是载具类实体吗？', true, 'mob'],

  ['diamond_sword', '它是武器吗？', true],
  ['diamond_sword', '它是工具吗？', false],
  ['diamond_pickaxe', '它是工具吗？', true],
  ['diamond_helmet', '它是盔甲吗？', true],
  ['bow', '它是武器吗？', true],
  ['bowl', '它是武器吗？', false],
  ['creeper_spawn_egg', '它是刷怪蛋吗？', true],
  ['bread', '它能作为食物吗？', true],
  ['red_dye', '它是染料吗？', true],
  ['music_disc_13', '它是音乐唱片吗？', true],
  ['oak_boat', '它是船或竹筏吗？', true, 'item'],
  ['minecart', '它是矿车吗？', true, 'item'],
  ['water_bucket', '它是桶吗？', true],
  ['redstone', '它与红石相关吗？', true],

  ['torch', '它的发光等级大于 10 吗？', true],
  ['stone', '它的硬度小于 1 吗？', false],
  ['allay', '它的碰撞高度小于 1 格吗？', true],
  ['iron_golem', '它的碰撞高度超过 1.5 格吗？', true],
]

let failed = 0
for (const [entryName, question, expected, kind] of cases) {
  const entry = find(entryName, kind)
  const result = answerQuestion(question, entry)
  const ok = result !== null && result.answer === expected
  if (!ok) failed += 1
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${entryName.padEnd(20)} ${question.padEnd(22)} => ${result ? (result.answer ? '是' : '不是') : 'null'}（期望 ${expected ? '是' : '不是'}）${result ? ` [${result.question.id}]` : ''}`,
  )
}

const unparsable = ['今天天气怎么样', '啊啊啊']
for (const question of unparsable) {
  const result = answerQuestion(question, find('stone'))
  console.log(`${result === null ? 'OK  ' : 'FAIL'} 无法解析 "${question}" => ${result === null ? 'null' : 'has answer'}`)
  if (result !== null) failed += 1
}

console.log(failed === 0 ? `\n全部 ${cases.length + unparsable.length} 条冒烟用例通过` : `\n${failed} 条用例失败`)
process.exit(failed === 0 ? 0 : 1)
