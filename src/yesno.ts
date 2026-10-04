import type { CatalogEntry } from './types'

export type Category = 'kind' | 'material' | 'property' | 'biology' | 'usage'

export interface YesNoQuestion {
  id: string
  label: string
  category: Category
  group: string
  test: (entry: CatalogEntry) => boolean
}

const NAME_LISTS: Record<string, string[]> = {
  boss: ['ender_dragon', 'wither', 'warden', 'elder_guardian'],
  tamable: ['wolf', 'cat', 'horse', 'donkey', 'mule', 'llama', 'parrot', 'camel', 'nautilus', 'zombie_nautilus'],
  aquatic: [
    'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'glow_squid', 'dolphin', 'turtle',
    'axolotl', 'guardian', 'elder_guardian', 'drowned', 'nautilus', 'zombie_nautilus', 'ghast',
  ],
  flying: ['bat', 'bee', 'phantom', 'allay', 'vex', 'ghast', 'happy_ghast', 'blaze', 'ender_dragon', 'wither', 'parrot'],
  undead: [
    'zombie', 'zombie_villager', 'zombified_piglin', 'husk', 'drowned', 'skeleton', 'stray',
    'wither_skeleton', 'skeleton_horse', 'zombie_horse', 'phantom', 'wither', 'bogged', 'parched',
    'zombie_nautilus', 'camel_husk',
  ],
  illager: ['pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'witch'],
  neutral: [
    'enderman', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'spider', 'cave_spider', 'iron_golem',
    'snow_golem', 'polar_bear', 'bee', 'goat', 'panda', 'dolphin', 'llama', 'trader_llama',
    'camel', 'wolf', 'endermite', 'silverfish',
  ],
}

const numberFact = (entry: CatalogEntry, key: string) => Number(entry.facts[key] ?? 0)

const isBoss = (entry: CatalogEntry) => NAME_LISTS.boss.includes(entry.name)

const textOf = (entry: CatalogEntry) => `${entry.name} ${entry.zhName} ${String(entry.family ?? '')}`

export const hasTag = (entry: CatalogEntry, tag: string) => {
  if (entry.kind !== 'mob') return false
  const type = String(entry.facts['实体类型'] ?? '')
  const family = String(entry.family ?? '')

  if (tag === 'boss') return isBoss(entry)
  if (tag === 'tamable') return NAME_LISTS.tamable.includes(entry.name)
  if (tag === 'aquatic') return NAME_LISTS.aquatic.includes(entry.name) || type === 'water_creature'
  if (tag === 'flying') return NAME_LISTS.flying.includes(entry.name)
  if (tag === 'undead') return NAME_LISTS.undead.includes(entry.name)
  if (tag === 'illager') return NAME_LISTS.illager.includes(entry.name)
  if (tag === 'vehicle') return family === '载具' || /minecart|boat|raft/.test(entry.name)
  if (tag === 'neutral') return NAME_LISTS.neutral.includes(entry.name)
  if (tag === 'hostile') {
    return type === 'hostile' || family === '攻击型生物' || isBoss(entry) || NAME_LISTS.undead.includes(entry.name)
  }
  if (tag === 'passive') {
    return ['animal', 'water_creature', 'ambient', 'passive'].includes(type)
      || family === '被动型生物'
  }
  return false
}

export const YES_NO_QUESTIONS: YesNoQuestion[] = [
  { id: 'kind_block', label: '它是方块吗？', category: 'kind', group: '类别', test: (e) => e.kind === 'block' },
  { id: 'kind_item', label: '它是物品吗？', category: 'kind', group: '类别', test: (e) => e.kind === 'item' },
  { id: 'kind_mob', label: '它是生物或实体吗？', category: 'kind', group: '类别', test: (e) => e.kind === 'mob' },
  { id: 'kind_name_wood', label: '中文译名里带「木」字吗？', category: 'kind', group: '类别', test: (e) => /木|竹/.test(e.zhName) },

  { id: 'mat_wood', label: '它是木质或植物类吗？', category: 'material', group: '材质', test: (e) => /木|竹|wood|plant|leaves|log|planks|sapling|bamboo|stem|hyphae|fungus|mushroom/.test(textOf(e)) },
  { id: 'mat_stone', label: '它是石质类吗？', category: 'material', group: '材质', test: (e) => /石|stone|deepslate|bricks|cobble|andesite|diorite|granite|tuff|obsidian|netherrack|end_stone|blackstone/.test(textOf(e)) },
  { id: 'mat_metal', label: '它是金属类吗？', category: 'material', group: '材质', test: (e) => /金属|metal|iron|gold|copper|netherite|chainmail|anvil/.test(textOf(e)) },
  { id: 'mat_glass', label: '它是玻璃类吗？', category: 'material', group: '材质', test: (e) => /glass/.test(e.name) },
  { id: 'mat_wool', label: '它是羊毛或地毯类吗？', category: 'material', group: '材质', test: (e) => /wool|carpet/.test(e.name) },
  { id: 'mat_concrete', label: '它是混凝土或陶瓦类吗？', category: 'material', group: '材质', test: (e) => /concrete|terracotta/.test(e.name) },
  { id: 'mat_liquid', label: '它是液体或流体类吗？', category: 'material', group: '材质', test: (e) => /液体|水|熔岩|岩浆|lava|water|bubble/.test(textOf(e)) },

  { id: 'prop_light', label: '它会发光吗？', category: 'property', group: '属性', test: (e) => numberFact(e, '发光等级') > 0 },
  { id: 'prop_light_10', label: '它的发光等级达到 10 以上吗？', category: 'property', group: '属性', test: (e) => numberFact(e, '发光等级') >= 10 },
  { id: 'prop_transparent', label: '它可透光吗？', category: 'property', group: '属性', test: (e) => e.facts['可透光'] === '是' },
  { id: 'prop_diggable', label: '它可以常规采掘吗？', category: 'property', group: '属性', test: (e) => e.facts['可采掘'] === '是' },
  { id: 'prop_hard_3', label: '它的硬度大于 3 吗？', category: 'property', group: '属性', test: (e) => numberFact(e, '硬度') > 3 },
  { id: 'prop_hard_5', label: '它的硬度大于 5 吗？', category: 'property', group: '属性', test: (e) => numberFact(e, '硬度') > 5 },
  { id: 'prop_blast_10', label: '它的爆炸抗性大于 10 吗？', category: 'property', group: '属性', test: (e) => numberFact(e, '爆炸抗性') > 10 },
  { id: 'prop_full_block', label: '它是完整方块碰撞箱吗？', category: 'property', group: '属性', test: (e) => e.facts['碰撞箱'] === 'block' },
  { id: 'prop_states', label: '它有超过 1 种方块状态组合吗？', category: 'property', group: '属性', test: (e) => e.kind === 'block' && e.variantCount > 1 },
  { id: 'prop_many_states', label: '它有超过 16 种方块状态组合吗？', category: 'property', group: '属性', test: (e) => e.kind === 'block' && e.variantCount > 16 },
  { id: 'prop_variants', label: '它有登记的变种或特殊状态吗？', category: 'property', group: '属性', test: (e) => e.specialStates.length > 0 },

  { id: 'use_stack_any', label: '它能堆叠吗？', category: 'usage', group: '用途', test: (e) => numberFact(e, '堆叠上限') > 1 },
  { id: 'use_stack_16', label: '它能堆叠超过 16 个吗？', category: 'usage', group: '用途', test: (e) => numberFact(e, '堆叠上限') > 16 },
  { id: 'use_stack_64', label: '它能堆叠到 64 个吗？', category: 'usage', group: '用途', test: (e) => numberFact(e, '堆叠上限') >= 64 },
  { id: 'use_tool', label: '它是工具吗？', category: 'usage', group: '用途', test: (e) => /工具|(pickaxe|axe|shovel|hoe|shears|flint_and_steel|fishing_rod|brush|spyglass|compass|clock|bucket|lead|name_tag)/.test(textOf(e)) },
  { id: 'use_weapon', label: '它是武器吗？', category: 'usage', group: '用途', test: (e) => (/武器|(sword|crossbow|trident|spear|mace|arrow)/.test(textOf(e)) || /(^|_)bow(_|$)/.test(e.name)) && !e.name.includes('spear_shard') },
  { id: 'use_armor', label: '它是盔甲吗？', category: 'usage', group: '用途', test: (e) => /盔甲|(helmet|chestplate|leggings|boots|elytra)/.test(textOf(e)) },
  { id: 'use_food', label: '它能作为食物吗？', category: 'usage', group: '用途', test: (e) => /食物|(bread|apple|meat|steak|chicken|mutton|porkchop|fish|cooked|cookie|cake|pie|stew|soup|carrot|potato|beetroot|melon|rabbit|cod|salmon|tropical_fish|pufferfish|berries|kelp|honey|golden_apple|golden_carrot|chorus_fruit|spider_eye|rotten_flesh)/.test(textOf(e)) },
  { id: 'use_spawn_egg', label: '它是刷怪蛋吗？', category: 'usage', group: '用途', test: (e) => e.name.endsWith('_spawn_egg') },
  { id: 'use_redstone', label: '它与红石相关吗？', category: 'usage', group: '用途', test: (e) => /红石|(redstone|comparator|repeater|piston|observer|hopper|dispenser|dropper|lever|pressure_plate|rail|target|daylight|note_block|sculk|copper_bulb)/.test(textOf(e)) },
  { id: 'use_ore', label: '它是矿石吗？', category: 'usage', group: '用途', test: (e) => e.name.endsWith('_ore') },
  { id: 'use_dye', label: '它是染料吗？', category: 'usage', group: '用途', test: (e) => /染料|_dye$/.test(textOf(e)) },
  { id: 'use_disc', label: '它是音乐唱片吗？', category: 'usage', group: '用途', test: (e) => e.name.startsWith('music_disc_') },
  { id: 'use_boat', label: '它是船或竹筏吗？', category: 'usage', group: '用途', test: (e) => /(boat|raft)/.test(e.name) },
  { id: 'use_minecart', label: '它是矿车吗？', category: 'usage', group: '用途', test: (e) => e.name.includes('minecart') },
  { id: 'use_bucket', label: '它是桶吗？', category: 'usage', group: '用途', test: (e) => e.name.includes('bucket') },
  { id: 'use_build', label: '它是常用于建筑的方块吗？', category: 'usage', group: '用途', test: (e) => e.kind === 'block' && numberFact(e, '硬度') >= 1 && e.facts['碰撞箱'] === 'block' },

  { id: 'bio_passive', label: '它是被动型生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'passive') },
  { id: 'bio_hostile', label: '它是攻击型生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'hostile') },
  { id: 'bio_neutral', label: '它是中立型生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'neutral') },
  { id: 'bio_boss', label: '它是首领生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'boss') },
  { id: 'bio_tamable', label: '它可以被驯服吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'tamable') },
  { id: 'bio_big', label: '它的碰撞高度超过 1.5 格吗？', category: 'biology', group: '生物', test: (e) => e.kind === 'mob' && numberFact(e, '碰撞高度') > 1.5 },
  { id: 'bio_small', label: '它的碰撞高度小于 1 格吗？', category: 'biology', group: '生物', test: (e) => e.kind === 'mob' && numberFact(e, '碰撞高度') > 0 && numberFact(e, '碰撞高度') < 1 },
  { id: 'bio_aquatic', label: '它是水生生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'aquatic') },
  { id: 'bio_flying', label: '它会飞吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'flying') },
  { id: 'bio_undead', label: '它是亡灵生物吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'undead') },
  { id: 'bio_illager', label: '它是灾厄村民吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'illager') },
  { id: 'bio_vehicle', label: '它是载具类实体吗？', category: 'biology', group: '生物', test: (e) => hasTag(e, 'vehicle') },
]

const parseThreshold = (value: string) => {
  const match = value.match(/(大于|超过|高于|至少|不小于|不低于|≥|>=|>)\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null
  return { operator: '>' as const, value: Number(match[2]) }
}

const parseLowerThreshold = (value: string) => {
  const match = value.match(/(小于|低于|不足|不到|不超过|至多|≤|<=|<)\s*([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null
  return { operator: '<' as const, value: Number(match[2]) }
}

const CHINESE_DIGITS: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

const genericNumericQuestion = (value: string, entry: CatalogEntry) => {
  const higher = parseThreshold(value)
  const lower = parseLowerThreshold(value)
  const target = higher ?? lower
  if (!target) return null

  const compare = (actual: number) => (target.operator === '>' ? actual > target.value : actual < target.value)

  if (/(硬度)/.test(value)) return compare(numberFact(entry, '硬度'))
  if (/(爆炸抗性|抗性)/.test(value)) return compare(numberFact(entry, '爆炸抗性'))
  if (/(发光|亮度)/.test(value)) return compare(numberFact(entry, '发光等级'))
  if (/(堆叠)/.test(value)) return compare(numberFact(entry, '堆叠上限'))
  if (/(状态|变种)/.test(value)) {
    return compare(entry.kind === 'block' ? entry.variantCount : entry.specialStates.length)
  }
  if (/(高度)/.test(value)) return compare(numberFact(entry, '碰撞高度'))
  if (/(宽度)/.test(value)) return compare(numberFact(entry, '碰撞宽度'))
  return null
}

const genericNameLengthQuestion = (value: string, entry: CatalogEntry) => {
  if (!/(译名|名字|名称|中文名)/.test(value) || !/个字|字/.test(value)) return null
  const digitMatch = value.match(/([0-9]+)\s*个字/)
  if (digitMatch) return entry.zhName.length === Number(digitMatch[1])
  const chineseMatch = value.match(/([一两二三四五六七八九十])\s*个字/)
  if (chineseMatch) return entry.zhName.length === CHINESE_DIGITS[chineseMatch[1]]
  return null
}

// 顺序即优先级：生物类问法优先于类别，类别优先于材质/用途，避免「攻击型生物吗」被误判为武器。
const KEYWORD_MAP: Array<{ keys: RegExp, id: string }> = [
  { keys: /首领|boss|最终boss/, id: 'bio_boss' },
  { keys: /亡灵|不死|僵尸|骷髅/, id: 'bio_undead' },
  { keys: /攻击型|攻击性|敌对|主动攻击|会打我|会攻击我|危险生物/, id: 'bio_hostile' },
  { keys: /中立型|中立/, id: 'bio_neutral' },
  { keys: /被动型|被动|友好|温顺|不主动/, id: 'bio_passive' },
  { keys: /驯服|驯化|养得|宠物|坐骑|骑乘/, id: 'bio_tamable' },
  { keys: /水生|水里|水中|海洋|水下|游水/, id: 'bio_aquatic' },
  { keys: /飞行|会飞|飞在|能飞|飞起来/, id: 'bio_flying' },
  { keys: /灾厄|掠夺者|唤魔者|卫道士|恼鬼/, id: 'bio_illager' },
  { keys: /载具|交通工具|运输|能载/, id: 'bio_vehicle' },

  { keys: /刷怪蛋|刷怪/, id: 'use_spawn_egg' },
  { keys: /方块|砖|建筑方块/, id: 'kind_block' },
  { keys: /物品|道具/, id: 'kind_item' },
  { keys: /生物|实体|怪物|怪|mob/, id: 'kind_mob' },

  { keys: /发光|亮度|光源|照明|会亮/, id: 'prop_light' },
  { keys: /透光|透明|透亮/, id: 'prop_transparent' },
  { keys: /采掘|挖掘|挖得动|可挖|能挖/, id: 'prop_diggable' },
  { keys: /完整方块|实心|满格/, id: 'prop_full_block' },

  { keys: /矿车/, id: 'use_minecart' },
  { keys: /矿石|矿物|矿/, id: 'use_ore' },
  { keys: /刷怪蛋/, id: 'use_spawn_egg' },
  { keys: /盔甲|防具|护甲/, id: 'use_armor' },
  { keys: /武器|剑|弓|弩|三叉戟|锤/, id: 'use_weapon' },
  { keys: /工具|镐|斧头|铲|锄|剪刀/, id: 'use_tool' },
  { keys: /食物|吃的|能吃|食用|可以吃/, id: 'use_food' },
  { keys: /红石|电路|信号/, id: 'use_redstone' },
  { keys: /染料|染色/, id: 'use_dye' },
  { keys: /唱片|音乐/, id: 'use_disc' },
  { keys: /桶/, id: 'use_bucket' },
  { keys: /船|竹筏|筏/, id: 'use_boat' },
  { keys: /堆叠.{0,8}(64|六十四)/, id: 'use_stack_64' },
  { keys: /堆叠.{0,8}(16|十六)/, id: 'use_stack_16' },
  { keys: /堆叠|叠放/, id: 'use_stack_any' },
  { keys: /建筑|搭建|盖房/, id: 'use_build' },

  { keys: /木头|木质|木制|树林|原木|木板/, id: 'mat_wood' },
  { keys: /石头|石质|石制|岩石|矿物方块/, id: 'mat_stone' },
  { keys: /金属|铁|金|铜|合金/, id: 'mat_metal' },
  { keys: /玻璃/, id: 'mat_glass' },
  { keys: /羊毛|地毯/, id: 'mat_wool' },
  { keys: /混凝土|陶瓦/, id: 'mat_concrete' },
  { keys: /液体|流体|熔岩|岩浆|水/, id: 'mat_liquid' },
]

export const normalizeQuestion = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[\s，。？?！!、,.「」【】"'']+/g, '')
  .replace(/^(请问|问一下|问你|那|那么|这么|这个|这种|该)/, '')
  .replace(/^(是不是|是否|有没有|能不能|能否|会不会|是不是说|是|能|会|有)/, '')
  .replace(/吗$|呢$|呀$|啊$/, '')

export const parseQuestion = (rawValue: string) => {
  const value = normalizeQuestion(rawValue)
  if (!value) return null

  for (const { keys, id } of KEYWORD_MAP) {
    if (keys.test(value)) {
      const question = YES_NO_QUESTIONS.find((item) => item.id === id)
      if (question) return question
    }
  }
  return null
}

export const answerQuestion = (rawValue: string, entry: CatalogEntry) => {
  const trimmed = rawValue.trim()
  if (!trimmed) return null

  const question = parseQuestion(trimmed)
  if (question) {
    return { question, answer: question.test(entry) }
  }

  const numeric = genericNumericQuestion(trimmed, entry)
  if (numeric !== null) {
    return {
      question: {
        id: 'custom_numeric',
        label: trimmed.endsWith('吗') || trimmed.endsWith('？') || trimmed.endsWith('?') ? trimmed : `${trimmed}？`,
        category: 'property' as Category,
        group: '自定义',
        test: () => numeric,
      },
      answer: numeric,
    }
  }

  const nameLength = genericNameLengthQuestion(trimmed, entry)
  if (nameLength !== null) {
    return {
      question: {
        id: 'custom_name_length',
        label: trimmed,
        category: 'kind' as Category,
        group: '自定义',
        test: () => nameLength,
      },
      answer: nameLength,
    }
  }

  return null
}

export const suggestedQuestions = (_entry: CatalogEntry, asked: string[], limit = 8) => {
  const askedGroups = new Set(
    YES_NO_QUESTIONS.filter((question) => asked.includes(question.id)).map((question) => question.group),
  )
  const pool = YES_NO_QUESTIONS.filter((question) => !asked.includes(question.id))
  const shuffle = (items: YesNoQuestion[]) => items
    .map((item) => ({ item, rank: Math.random() }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item)

  const fresh = pool.filter((question) => !askedGroups.has(question.group))
  const rest = pool.filter((question) => askedGroups.has(question.group))
  return [...shuffle(fresh), ...shuffle(rest)].slice(0, limit)
}

export const QUESTION_GROUPS = ['类别', '材质', '属性', '用途', '生物'] as const
