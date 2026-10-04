import {
  buildPalette,
  buildToolPalette,
  chainForResult,
  chainPool,
  checkPlacement,
  correctToolFor,
  entryForTransform,
  expectedSlots,
  FUEL_NAMES,
  isFuelName,
  isToolMethod,
  pickChain,
  toolResultFor,
  transformPool,
  TRANSFORMS,
} from '../src/transforms'
import type { Difficulty, Kind, Transform } from '../src/types'

let passed = 0
let failed = 0
const expect = (label: string, condition: boolean) => {
  if (condition) {
    passed += 1
    console.log(`OK   ${label}`)
  } else {
    failed += 1
    console.log(`FAIL ${label}`)
  }
}

const pool = transformPool(['block', 'item', 'mob'])
expect(`转化池可用（${pool.length} 条）`, pool.length > 600)
expect('生物没有转化产物', pool.every((t) => entryForTransform(t)?.kind !== 'mob'))

const byMethod = (m: string) => pool.filter((t) => t.method === m)
expect('有序合成存在', byMethod('craft_shaped').length > 100)
expect('烧制存在', byMethod('smelt').length > 30)
expect('切石存在', byMethod('stonecut').length > 100)
expect('去皮存在', byMethod('strip').length > 10)
expect('涂蜡存在', byMethod('wax').length > 10)
expect('锻造存在', byMethod('smith').length > 5)

const find = (pred: (t: Transform) => boolean) => pool.find(pred)!

// 烧制：现在需要燃料
const smelt = find((t) => t.method === 'smelt' && t.inputs.length === 2)
expect('找到烧制样例（含燃料）', Boolean(smelt))
expect('烧制样例的燃料槽有标记', smelt.inputs[1].fuelSlot === true)
expect('燃料槽不塞具体候选名（避免撑爆材料盘）', smelt.inputs[1].names.length === 0)
const smeltInput = smelt.inputs[0].names[0]
const smeltFuel = expectedSlots(smelt)[1]
expect('烧制正确摆放（材料+燃料）', checkPlacement(smelt, [smeltInput, smeltFuel]).correct)
expect('烧制只放材料判错', !checkPlacement(smelt, [smeltInput]).correct)
expect('烧制放错燃料判错', !checkPlacement(smelt, [smeltInput, 'stone']).correct)
expect('烧制燃料位置放材料判错', !checkPlacement(smelt, [smeltFuel, smeltInput]).correct)

// ---- 燃料可互换：所有可燃物在任意烧制/冶炼/烟熏/篝火里都通用 ----
const furnaceTransforms = pool.filter((t) => t.inputs.some((i) => i.fuelSlot))
expect(`烧制类转化都带燃料槽（${furnaceTransforms.length} 条）`, furnaceTransforms.length > 90)

const fuels = FUEL_NAMES
expect(`燃料表非空（${fuels.length} 项）`, fuels.length > 250)
expect('煤与木炭都在燃料表里', isFuelName('coal') && isFuelName('charcoal'))
expect('原木能当燃料', isFuelName('oak_log') && isFuelName('birch_log'))
expect('木板能当燃料', isFuelName('oak_planks') && isFuelName('spruce_planks'))
expect('木制工具能当燃料', isFuelName('wooden_pickaxe') && isFuelName('wooden_axe') && isFuelName('wooden_sword'))
expect('木制品能当燃料', isFuelName('crafting_table') && isFuelName('bookshelf') && isFuelName('chest'))
expect('竹子与草木能当燃料', isFuelName('bamboo') && isFuelName('stick') && isFuelName('oak_sapling'))
expect('特殊燃料（熔岩桶/烈焰棒/干海带块/煤炭块）都在', ['lava_bucket', 'blaze_rod', 'dried_kelp_block', 'coal_block'].every(isFuelName))
expect('不可燃物不能当燃料（石头/铁锭/玻璃）', !isFuelName('stone') && !isFuelName('iron_ingot') && !isFuelName('glass'))
// 下界菌木在原版里被显式排除，别把它当燃料
expect('下界菌木不算燃料', !isFuelName('warped_planks') && !isFuelName('crimson_stem'))

// 全量交叉验证：每一项燃料 × 每条烧制转化都必须判对
let fuelAccepted = 0
let fuelRejected = 0
for (const t of furnaceTransforms) {
  const ingredient = t.inputs[0].names[0]
  for (const fuel of fuels) {
    if (checkPlacement(t, [ingredient, fuel]).correct) fuelAccepted += 1
  }
  if (!checkPlacement(t, [ingredient, 'stone']).correct) fuelRejected += 1
}
expect(`每条烧制的每种燃料都判对（${fuelAccepted}/${furnaceTransforms.length * fuels.length}）`,
  fuelAccepted === furnaceTransforms.length * fuels.length)
expect('石头当燃料一律判错', fuelRejected === furnaceTransforms.length)

// 材料与燃料互换位置仍然判错（不能靠"位置对了就过"蒙混）
const fuelSwapLeaks = furnaceTransforms.filter((t) => {
  const ingredient = t.inputs[0].names[0]
  return checkPlacement(t, ['coal', ingredient]).correct
}).length
expect('材料与燃料放反位置一律判错', fuelSwapLeaks === 0)

// 燃料槽与干扰项：盘面上展示的燃料不能被判成"用不上的干扰项"，
// 也不能把另外 200 多种燃料塞进盘面（那会把材料盘撑成一堵墙）。
// 注意度量方式：不能直接用 isFuelName 计数——「原木→木炭」的材料本身就是 36 种燃料原木，
// 会被误算成"展示了 40 个燃料"。正确做法是看 buildPalette 额外加进来、且不属于材料的那些。
const paletteChecks = (['explorer', 'survival', 'hardcore'] as Difficulty[]).map((difficulty) => {
  const t = furnaceTransforms.find((x) => x.inputs[0].names.length === 1 && !isFuelName(x.inputs[0].names[0]))!
  const material = new Set(t.inputs[0].names)
  const palette = buildPalette(t, difficulty, `fuel-${difficulty}`)
  const shown = palette.filter((item) => isFuelName(item.name) && !material.has(item.name))
  return {
    difficulty,
    shown: shown.length,
    // 盘面上的每个燃料都必须真的能通过校验
    allUsable: shown.every((item) => checkPlacement(t, [t.inputs[0].names[0], item.name]).correct),
    // 展示的燃料不该混进材料位（那种情况玩家会摆错格子）
    noStray: shown.every((item) => !t.inputs.some((i) => i.names.includes(item.name))),
  }
})
expect('盘面燃料数量按难度递增且不撑爆（2/3/4）',
  paletteChecks[0].shown === 2 && paletteChecks[1].shown === 3 && paletteChecks[2].shown === 4)
expect('盘面上展示的燃料都真的能烧', paletteChecks.every((r) => r.allUsable))
expect('盘面不会把其他燃料误当干扰项', paletteChecks.every((r) => r.noStray))

// 宽材料烧制（「原木→木炭」，36 种原木都能当材料）也不该把 200+ 燃料塞进盘面
const charcoalSmelt = furnaceTransforms.find((t) => t.result === 'charcoal')!
const charcoalMaterial = new Set(charcoalSmelt.inputs[0].names)
const charcoalPalette = buildPalette(charcoalSmelt, 'hardcore', 'charcoal-palette')
const extraFuels = charcoalPalette.filter((item) => isFuelName(item.name) && !charcoalMaterial.has(item.name))
expect('宽材料烧制额外展示的燃料仍只有 4 个', extraFuels.length === 4)
expect('宽材料烧制的燃料选项也都能烧',
  extraFuels.every((item) => checkPlacement(charcoalSmelt, [charcoalSmelt.inputs[0].names[0], item.name]).correct))
expect('宽材料烧制的盘面不会超过 50 项', charcoalPalette.length <= 50)
expect('提示/揭晓给出的默认燃料可用',
  furnaceTransforms.every((t) => isFuelName(expectedSlots(t)[1])))


// 单输入：切石
const cut = find((t) => t.method === 'stonecut' && t.inputs.length === 1)
expect('切石正确摆放', checkPlacement(cut, [cut.inputs[0].names[0]]).correct)

// 双输入：涂蜡
const wax = find((t) => t.method === 'wax' && t.inputs.length === 2)
expect('找到涂蜡样例', Boolean(wax))
const waxOk = checkPlacement(wax, [wax.inputs[0].names[0], wax.inputs[1].names[0]]).correct
expect('涂蜡两材料正确', waxOk)
expect('涂蜡只放一个判错', !checkPlacement(wax, [wax.inputs[0].names[0]]).correct)
expect('涂蜡放错材料判错', !checkPlacement(wax, [wax.inputs[0].names[0], wax.result]).correct)

// 有序合成：整体平移 / 左右镜像仍正确
const small = find((t) => t.method === 'craft_shaped' && t.width <= 2 && t.height <= 2)
const canon = expectedSlots(small)
const shifted = Array.from({ length: 9 }, () => null as string | null)
canon.forEach((cell, index) => {
  if (!cell) return
  const row = Math.floor(index / 3)
  const col = index % 3
  const target = (row + 1) * 3 + col + 1
  if (target < 9) shifted[target] = cell
})
expect(`${small.result} 整体平移后仍正确`, checkPlacement(small, shifted).correct)
expect(`${small.result} 标准摆放正确`, checkPlacement(small, canon).correct)

const piston = find((t) => t.method === 'craft_shaped' && t.shape && t.shape.length >= 3 && t.shape[0].length >= 3)
if (piston) {
  const mirrored = Array.from({ length: 9 }, () => null as string | null)
  piston.shape!.forEach((row, r) => {
    const rev = [...row].reverse()
    rev.forEach((cell, c) => { if (cell) mirrored[r * 3 + c] = cell })
  })
  expect('活塞类有序配方左右镜像也正确', checkPlacement(piston, mirrored).correct)
}

// 无序合成：打散摆放正确、少放判错
const shape = find((t) => t.method === 'craft_shapeless')
const slots = [0, 4, 8, 2, 6, 1, 3, 5, 7]
const scattered = Array.from({ length: 9 }, () => null as string | null)
shape.inputs.forEach((input, i) => { scattered[slots[i]] = input.names[0] })
expect('无序配方打散摆放正确', checkPlacement(shape, scattered).correct)
const missing = [...scattered]
missing[slots[shape.inputs.length - 1]] = null
expect('无序配方少放一个判错', !checkPlacement(shape, missing).correct)

// 材料盘：含全部正确材料、不含产物、含相似干扰项
const palette = buildPalette(small, 'hardcore', 'seed-1')
const pnames = palette.map((p) => p.name)
const correctLeaves = [...new Set(small.inputs.flatMap((i) => i.names))]
expect('材料盘含全部正确材料', correctLeaves.every((n) => pnames.includes(n)))
expect('材料盘不含产物', !pnames.includes(small.result))
expect('材料盘含干扰项', pnames.length > correctLeaves.length)

// 难度越高干扰项越多
const e = buildPalette(small, 'explorer' as Difficulty, 's').length
const h = buildPalette(small, 'hardcore' as Difficulty, 's').length
expect('难度越高材料盘越大', h >= e)

// ---- 有序配方的等价摆放 ----
// 规则：① 任意平移 ② 左右镜像 ③ 3 格以上还允许 180° 旋转。
// 不做 90°/270°（3×2 的门转 90° 会变成活板门的合法摆法）；1~2 格不做 180°
// （bundle 这类竖排配方「旋转」与「上下颠倒材料」是同一件事）。
const toGrid9 = (rows: (string | null)[][]): (string | null)[] => {
  const g: (string | null)[] = Array.from({ length: 9 }, () => null)
  rows.forEach((row, r) => row.forEach((v, c) => { g[r * 3 + c] = v }))
  return g
}
const cropGrid = (g: (string | null)[]) => {
  const rows = [0, 1, 2].map((r) => g.slice(r * 3, r * 3 + 3))
  const filled = rows.filter((row) => row.some(Boolean))
  if (!filled.length) return [] as (string | null)[][]
  const cols: number[] = []
  filled.forEach((row) => row.forEach((v, c) => { if (v) cols.push(c) }))
  const first = Math.min(...cols)
  const last = Math.max(...cols)
  // 每行补齐到同样宽度，保证后续变换是规整矩形
  return filled.map((row) => {
    const sliced = row.slice(first, last + 1)
    while (sliced.length < last - first + 1) sliced.push(null)
    return sliced
  })
}
const flipH = (m: (string | null)[][]) => m.map((r) => [...r].reverse())
const flipV = (m: (string | null)[][]) => [...m].reverse()
const rotHalf = (m: (string | null)[][]) => flipH(flipV(m))

const shapedAll = pool.filter((t) => t.layout === 'grid-shaped' && t.shape)
let shiftOk = 0
let shiftTotal = 0
for (const t of shapedAll) {
  const exp = toGrid9(t.shape!)
  const occ: [number, number][] = []
  exp.forEach((v, i) => { if (v) occ.push([Math.floor(i / 3), i % 3]) })
  const minR = Math.min(...occ.map((o) => o[0]))
  const maxR = Math.max(...occ.map((o) => o[0]))
  const minC = Math.min(...occ.map((o) => o[1]))
  const maxC = Math.max(...occ.map((o) => o[1]))
  for (let dr = 0; dr <= 2 - (maxR - minR); dr += 1) {
    for (let dc = 0; dc <= 2 - (maxC - minC); dc += 1) {
      const g: (string | null)[] = Array.from({ length: 9 }, () => null)
      occ.forEach(([r, c]) => { g[(r - minR + dr) * 3 + (c - minC + dc)] = exp[r * 3 + c] })
      shiftTotal += 1
      if (checkPlacement(t, g).correct) shiftOk += 1
    }
  }
}
expect(`有序配方任意平移都能合成（${shiftOk}/${shiftTotal}）`, shiftOk === shiftTotal)

// 左右镜像对所有配方都应通过
let mirrorOk = 0
for (const t of shapedAll) {
  if (checkPlacement(t, toGrid9(flipH(t.shape!))).correct) mirrorOk += 1
}
expect(`有序配方左右镜像都能合成（${mirrorOk}/${shapedAll.length}）`, mirrorOk === shapedAll.length)

// 3 格以上的配方，180° 旋转应通过
const bigShaped = shapedAll.filter((t) => t.inputs.length >= 3)
let halfOk = 0
for (const t of bigShaped) {
  const rotated = rotHalf(cropGrid(toGrid9(t.shape!)))
  if (rotated.length <= 3 && (rotated[0]?.length ?? 0) <= 3 && checkPlacement(t, toGrid9(rotated)).correct) halfOk += 1
}
expect(`3 格以上配方 180° 旋转能合成（${halfOk}/${bigShaped.length}）`, halfOk === bigShaped.length)

// 反向：交换两个不同材料必须判错（含 1~2 格的竖排配方）
let swapLeak = 0
const swapLeaks: string[] = []
for (const t of shapedAll) {
  const exp = toGrid9(t.shape!)
  const cells = exp.map((v, i) => ({ v, i })).filter((x) => x.v)
  if (cells.length < 2 || new Set(cells.map((c) => c.v)).size < 2) continue
  const g = [...exp]
  const a = cells[0]
  const b = cells.find((c) => c.v !== a.v)!
  g[a.i] = b.v
  g[b.i] = a.v
  if (checkPlacement(t, g).correct) { swapLeak += 1; if (swapLeaks.length < 5) swapLeaks.push(t.id) }
}
expect('交换两个不同材料一律判错（含 bundle 等竖排配方）', swapLeak === 0)
if (swapLeaks.length) console.log(`      误判: ${swapLeaks.join(', ')}`)

// 反向：90° 旋转必须判错（避免与其它配方互相误判）
let quarterLeak = 0
for (const t of shapedAll) {
  const base = cropGrid(toGrid9(t.shape!))
  const h = base.length
  const w = base[0]?.length ?? 0
  if (h === w) continue
  const rotated = Array.from({ length: w }, (_, c) => Array.from({ length: h }, (_, r) => base[h - 1 - r][c]))
  if (rotated.length > 3 || (rotated[0]?.length ?? 0) > 3) continue
  if (checkPlacement(t, toGrid9(rotated)).correct) quarterLeak += 1
}
expect('非方阵配方 90° 旋转判错（避免门/活板门互相误判）', quarterLeak === 0)

// 组合工序：两步链可解
const chainTarget = (() => {
  for (const t of pool) {
    if (t.method !== 'craft_shaped' && t.method !== 'craft_shapeless') continue
    const chain = chainForResult(t.result, 's')
    if (chain && chain.steps.length === 2) return chain
  }
  return null
})()
expect('能找到一条两步组合工序', Boolean(chainTarget))
if (chainTarget) {
  let allOk = true
  for (const step of chainTarget.steps) {
    const slotsStep = expectedSlots(step.transform)
    if (!checkPlacement(step.transform, slotsStep).correct) allOk = false
  }
  expect('组合工序每步标准摆放都能通过校验', allOk)
}

// pickChain 在方块/物品筛选下能产出
const pickedChain = pickChain(['block', 'item'] as Kind[], [], 'seed-2')
expect('pickChain 返回有效链', Boolean(pickedChain) && pickedChain!.steps.length === 2)

// 组合工序不得出现「绕一圈」：第一步原料 = 最终目标，或第一步产物 = 最终目标
const loopTargets = chainPool(['block', 'item'] as Kind[])
let noLoop = true
let loopSample = ''
for (const target of loopTargets) {
  const chain = chainForResult(target, `loop-${target}`)
  if (!chain || chain.steps.length !== 2) continue
  const [first, second] = chain.steps
  const firstInputs = first.transform.inputs.flatMap((i) => i.names)
  if (first.transform.result === target || firstInputs.includes(target)) {
    noLoop = false
    loopSample = `${firstInputs[0]} --${first.transform.method}--> ${first.transform.result} --${second.transform.method}--> ${target}`
    break
  }
}
expect('组合工序没有回环（做两步不会回到原点）', noLoop)
if (!noLoop) console.log(`      回环样例: ${loopSample}`)

// 组合工序的中间产物必须是「真材料」，不能是拿来当燃料的东西
// （燃料槽有 300+ 候选，若不排除会生成「先烧出煤 → 再把煤当燃料烧 X」这种假链条）
let fuelStepLeaks = 0
let fuelStepSample = ''
let chainsWithFurnace = 0
for (const target of loopTargets) {
  const chain = chainForResult(target, `fuel-${target}`)
  if (!chain || chain.steps.length !== 2) continue
  const [first, second] = chain.steps
  const secondRealInputs = second.transform.inputs.filter((i) => !i.fuelSlot).flatMap((i) => i.names)
  if (!secondRealInputs.includes(first.produces)) {
    fuelStepLeaks += 1
    if (!fuelStepSample) {
      fuelStepSample = `${first.produces} --${second.transform.method}--> ${target}`
    }
  }
  if (second.transform.inputs.some((i) => i.fuelSlot)) chainsWithFurnace += 1
}
expect('组合工序的中间产物不会被当成燃料（无假链条）', fuelStepLeaks === 0)
if (fuelStepSample) console.log(`      假链条样例: ${fuelStepSample}`)
expect(`组合工序里存在含燃料槽的烧制步骤（${chainsWithFurnace} 条）`, chainsWithFurnace > 0)

// 组合工序里工具步骤的 belt 可用
let toolChainChecked = 0
let toolChainOk = true
for (const target of loopTargets) {
  if (toolChainChecked >= 12) break
  const chain = chainForResult(target, `toolchain-${target}`)
  if (!chain) continue
  for (const step of chain.steps) {
    if (!isToolMethod(step.transform.method)) continue
    toolChainChecked += 1
    const belt = buildToolPalette(step.transform, 'survival' as Difficulty, 'tc')
    const correct = correctToolFor(step.transform)
    const source = step.transform.inputs[0]?.names[0]
    if (!belt.some((b) => b.correct) || !correct || !source) toolChainOk = false
    if (belt.length < 2) toolChainOk = false
    if (correct && toolResultFor(source, correct) !== step.transform.result) toolChainOk = false
    if (toolChainChecked >= 12) break
  }
}
expect('组合工序含工具步骤且 belt / 产物映射正确', toolChainChecked > 0 && toolChainOk)

// 工具类处理：去皮 / 涂蜡 / 刮蜡
const strip = find((t) => t.method === 'strip')
expect('找到去皮样例', Boolean(strip))
if (strip) {
  expect('去皮是工具类方法', isToolMethod(strip.method))
  expect('去皮正确工具是斧', correctToolFor(strip) === 'axe')
  const source = strip.inputs[0].names[0]
  expect('斧能处理出正确产物', toolResultFor(source, 'axe') === strip.result)
  expect('蜜脾不能处理原木', toolResultFor(source, 'honeycomb') === null)
  const toolPalette = buildToolPalette(strip, 'hardcore', 'seed-tools')
  expect('工具 belt 含正确工具', toolPalette.some((t) => t.correct))
  expect('工具 belt 含干扰工具', toolPalette.some((t) => !t.correct))
}

const waxTool = find((t) => t.method === 'wax')
expect('找到涂蜡样例', Boolean(waxTool))
if (waxTool) {
  expect('涂蜡正确工具是蜜脾', correctToolFor(waxTool) === 'honeycomb')
  const source = waxTool.inputs[0].names[0]
  expect('蜜脾能处理出正确产物', toolResultFor(source, 'honeycomb') === waxTool.result)
  expect('斧不能处理该目标', toolResultFor(source, 'axe') === null)
}

// 刮蜡方向必须是「waxed_* → 本体」，不能反
const scrape = find((t) => t.method === 'scrape')
expect('找到刮蜡样例', Boolean(scrape))
if (scrape) {
  expect('刮蜡输入是涂蜡方块', scrape.inputs[0].names[0].startsWith('waxed_'))
  expect('刮蜡输出是未涂蜡本体', !scrape.result.startsWith('waxed_'))
  expect('刮蜡正确工具是斧', correctToolFor(scrape) === 'axe')
  expect('斧刮蜡得到正确产物', toolResultFor(scrape.inputs[0].names[0], 'axe') === scrape.result)
}

// 全部转化产物都能在图鉴中找到
let entryOk = true
for (const t of TRANSFORMS as Transform[]) {
  if (!entryForTransform(t)) { entryOk = false; break }
}
expect('全部转化产物可在图鉴中找到', entryOk)

console.log(`\n${failed ? `失败 ${failed} 条` : '全部'} 转化冒烟用例：${passed} 通过 / ${failed} 失败`)
if (failed) process.exit(1)
