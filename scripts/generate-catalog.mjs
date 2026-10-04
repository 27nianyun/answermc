import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const minecraftData = require('minecraft-data')

const VERSION = '26.1'
const mc = minecraftData(VERSION)

if (!mc) {
  throw new Error(`Minecraft Java ${VERSION} data is unavailable.`)
}

const entityVariants = {
  allay: ['普通状态', '跳舞状态', '正在复制'],
  armadillo: ['待机', '卷缩', '受惊', '展开'],
  axolotl: ['粉红色（露西）', '棕色（野生）', '金色', '青色', '蓝色'],
  bee: ['普通状态', '携带花粉', '已授粉', '激怒状态', '蜇刺后'],
  cat: ['虎斑猫', '西服猫', '红虎斑猫', '暹罗猫', '英短猫', '三花猫', '波斯猫', '布偶猫', '白猫', 'Jellie', '黑猫'],
  chicken: ['温带变种', '温暖变种', '寒冷变种', '幼年形态'],
  copper_golem: ['未氧化', '斑驳', '锈蚀', '氧化', '涂蜡', '雕像状态'],
  cow: ['温带变种', '温暖变种', '寒冷变种', '幼年形态'],
  creeper: ['普通状态', '闪电苦力怕（充能）', '引爆中'],
  fox: ['红色狐狸', '雪狐', '睡眠中', '坐下', '潜行'],
  frog: ['温带变种', '温暖变种', '寒冷变种'],
  goat: ['普通山羊', '尖叫山羊', '冲刺状态'],
  horse: ['白色', '奶白色', '栗色', '棕色', '黑色', '灰色', '深棕色', '无斑纹', '白袜', '白斑', '白点', '黑点', '幼年形态', '已驯服'],
  llama: ['奶白色', '白色', '棕色', '灰色', '幼年形态', '已驯服', '装备地毯'],
  magma_cube: ['尺寸 1', '尺寸 2', '尺寸 4 及以上'],
  mooshroom: ['红色哞菇', '棕色哞菇', '已剪除'],
  nautilus: ['成年形态', '幼年形态', '装备鞍', '被骑乘'],
  panda: ['普通熊猫', '懒惰熊猫', '忧愁熊猫', '顽皮熊猫', '棕色熊猫', '虚弱熊猫', '攻击性熊猫', '打滚', '打喷嚏'],
  parrot: ['红蓝金刚鹦鹉', '蓝色鹦鹉', '绿色鹦鹉', '黄蓝金刚鹦鹉', '灰色鹦鹉', '跳舞中', '栖息中'],
  pig: ['温带变种', '温暖变种', '寒冷变种', '幼年形态', '装备鞍'],
  pufferfish: ['小型', '半膨胀', '完全膨胀'],
  rabbit: ['棕色', '白色', '黑色', '黑白', '金色', '胡椒盐', '杀手兔', 'Toast', '幼年形态'],
  salmon: ['小型', '中型', '大型'],
  sheep: ['白色', '橙色', '品红色', '淡蓝色', '黄色', '黄绿色', '粉红色', '灰色', '淡灰色', '青色', '紫色', '蓝色', '棕色', '绿色', '红色', '黑色', '已剪毛', 'jeb_ 彩虹羊'],
  shulker: ['未染色', '白色', '橙色', '品红色', '淡蓝色', '黄色', '黄绿色', '粉红色', '灰色', '淡灰色', '青色', '紫色', '蓝色', '棕色', '绿色', '红色', '黑色'],
  slime: ['尺寸 1', '尺寸 2', '尺寸 4 及以上'],
  sniffer: ['搜寻中', '挖掘中', '起身中', '快乐状态', '幼年形态'],
  snow_golem: ['戴南瓜头', '已剪除南瓜头'],
  strider: ['温暖状态', '寒冷状态', '装备鞍', '幼年形态'],
  tropical_fish: ['2 种体型', '15 种图案', '16 种基础色', '16 种图案色', '2,700 种自然组合'],
  turtle: ['成年形态', '幼年形态', '携带海龟蛋', '正在产卵', '返回出生地'],
  villager: ['7 种群系类型', '15 种职业', '5 个职业等级', '幼年形态', '睡眠中', '交易中'],
  wolf: ['苍白', '森林', '灰烬', '黑色', '栗色', '锈色', '斑点', '条纹', '雪地', '16 种项圈颜色', '激怒状态', '已驯服', '湿润状态', '坐下'],
  zombie_nautilus: ['成年形态', '幼年形态', '装备鞍', '被骑乘'],
  zombie_villager: ['7 种群系类型', '15 种职业', '5 个职业等级', '幼年形态', '转化中'],
}

const stateTranslations = {
  age: '年龄 / 成长阶段',
  baby: '幼年形态',
  variant: '外观变种',
  type: '类型变种',
  color: '颜色变种',
  collar_color: '项圈颜色',
  profession: '职业',
  villager_data: '群系、职业与等级',
  pose: '姿态',
  health: '生命值',
  angry: '激怒状态',
  tame: '已驯服',
  sitting: '坐下',
  sleeping: '睡眠',
  charged: '闪电苦力怕状态',
  ignited: '引爆状态',
  sheared: '已剪毛 / 已剪除',
  saddle: '已装备鞍',
  playing_dead: '装死状态',
  from_bucket: '从桶中放出',
  mob_flags: 'AI 状态标志位',
  ticks_frozen: '冻结时长',
  no_gravity: '无重力状态',
  silent: '静音状态',
  custom_name_visible: '自定义名称可见性',
  facing: '朝向',
  half: '上下半部分',
  hinge: '门轴方向',
  open: '开启状态',
  powered: '红石激活',
  lit: '点亮状态',
  signal_fire: '信号火',
  waterlogged: '含水状态',
  snowy: '覆雪状态',
  axis: '轴向',
  rotation: '旋转值',
  attachment: '附着方式',
  leaves: '树叶距离',
  distance: '距离值',
  bites: '被食用次数',
  berries: '是否结浆果',
  stage: '生长阶段',
  moisture: '湿度',
  level: '层级 / 水位',
  layers: '层数',
  candles: '蜡烛数量',
  eggs: '蛋数量',
  hatch: '孵化进度',
  persistent: '永久保留',
  cracked: '裂纹状态',
  waxed: '涂蜡状态',
  weathered: '氧化阶段',
  oxidation: '氧化等级',
  trial_spawner_state: '试炼刷怪笼状态',
  crafting: '合成中',
  extended: '伸出状态',
  short: '缩短状态',
  upright: '竖直状态',
  hanging: '悬挂状态',
  tip_direction: '尖端朝向',
  dripstone_thickness: '滴水石锥厚度',
  vertical_direction: '垂直方向',
  bloom: '开花状态',
  can_summon: '可召唤状态',
  shrieking: '尖啸状态',
  sculk_sensor_phase: '幽匿感测体相位',
  unpowered: '未激活状态',
  conditional: '条件制约模式',
  trigger: '触发状态',
  mode: '模式',
  part: '组成部分',
  shape: '形状',
  north: '北侧连接',
  east: '东侧连接',
  south: '南侧连接',
  west: '西侧连接',
  up: '上方连接',
  down: '下方连接',
  bottom: '底部状态',
  slot_0_occupied: '槽位 0 已占用',
  slot_1_occupied: '槽位 1 已占用',
  slot_2_occupied: '槽位 2 已占用',
  slot_3_occupied: '槽位 3 已占用',
  slot_4_occupied: '槽位 4 已占用',
  slot_5_occupied: '槽位 5 已占用',
  power: '红石强度',
  delay: '延迟值',
  locked: '锁定状态',
  enabled: '启用状态',
  disarmed: '已解除状态',
  in_wall: '嵌入墙中',
  has_bottle_0: '瓶位 0 已放置',
  has_bottle_1: '瓶位 1 已放置',
  has_bottle_2: '瓶位 2 已放置',
  has_record: '唱片已放入',
  has_book: '书已放入',
  instrument: '音符盒音色',
  note: '音高',
  attached: '附着状态',
  unstable: '不稳定状态',
  berry: '是否结浆果',
  dying: '枯萎状态',
  brightness: '亮度',
  orientation: '朝向',
  vertical: '竖直方向',
}

const categoryTranslations = {
  'Passive mobs': '被动型生物',
  'Hostile mobs': '攻击型生物',
  'Neutral mobs': '中立型生物',
  'Tamable animals': '可驯服生物',
  'Utility mobs': '效用型生物',
  'Boss mobs': '首领生物',
  'Vehicles': '载具',
  'Buckets': '桶',
  'Other entities': '其他实体',
}

const materialTranslations = {
  default: '普通',
  'mineable/axe': '斧',
  'mineable/hoe': '锄',
  'mineable/pickaxe': '镐',
  'mineable/shovel': '锹',
  'mineable/shears': '剪刀',
  'mineable/sword': '剑',
  'mineable/universal': '通用工具',
  wood: '木质',
  stone: '石质',
  plant: '植物',
  'plant_replaceable': '可替代植物',
  water: '水',
  lava: '熔岩',
  air: '空气',
  dirt: '泥土',
  sand: '沙质',
  wool: '羊毛',
  metal: '金属',
  glass: '玻璃',
  ice: '冰',
  snow: '雪',
  cactus: '仙人掌',
  clay: '黏土',
  gourd: '瓜类',
  dragon_egg: '龙蛋',
  portal: '传送门',
  cake: '蛋糕',
  web: '蜘蛛网',
  slime: '黏液',
  bamboo: '竹',
  'bamboo_sapling': '竹笋',
  'barrier': '屏障',
  'piston': '活塞',
  'decoration': '装饰',
  'structural': '结构',
  'liquid': '液体',
  'solid': '固体',
}

const translate = (value, table) => table[value] ?? value

/**
 * 方块材质标签 → 中文。
 *
 * client.jar 里的 material 字段有三种形态，之前的整串查表只覆盖了第一种：
 *   1. 单标签        `mineable/pickaxe`
 *   2. 复合标签      `leaves;mineable/hoe`（分号分隔，同时表示「是树叶」和「用锄挖」）
 *   3. 非 mineable   `incorrect_for_wooden_tool`（意为「徒手就能挖」）
 * 第 2、3 种整串查表必然落空，会把英文内部 ID 直接写进玩家可见文案 ——
 * 实测 108 条记录的「工具/材质」是 `incorrect_for_wooden_tool`，
 * 题库解释里就出现了「正确工具是incorrect_for_wooden_tool」这种句子。
 * 所以这里逐段翻译再拼回去，未知段一律丢弃（宁可少一个信息，不留英文）。
 */
const MATERIAL_SEGMENTS = {
  ...materialTranslations,
  // 「不是斧头能破坏的」= 徒手就能挖。这类标签表达的是「不需要工具」，
  // 单独给一个词条，否则整串落空。
  incorrect_for_wooden_tool: '徒手',
  incorrect_for_stone_tool: '徒手',
  sword_instantly_mines: '剑或徒手',
  coweb: '蜘蛛网',
  web: '蜘蛛网',
  leaves: '树叶',
  wood: '木质',
  plant: '植物',
  vine_or_glow_lichen: '藤蔓或发光苔藓',
  gourd: '葫芦',
  sand: '沙质',
  dirt: '泥土',
  metal: '金属',
  glass: '玻璃',
  wool: '羊毛',
  ice: '冰',
  water: '水',
  lava: '熔岩',
  air: '空气',
  stone: '石质',
  default: '普通',
}

/** 复合标签里表示「怎么挖」的那一段（其余段是材质描述，对玩家没意义） */
const MINING_PREFIX = 'mineable/'

const translateMaterial = (raw) => {
  if (!raw || raw === 'default') return '普通'
  // 优先找 mineable/* 段：它才决定「需要什么工具」
  const segments = String(raw).split(';')
  const mining = segments.find((segment) => segment.startsWith(MINING_PREFIX))
  if (mining) return MATERIAL_SEGMENTS[mining] ?? '工具'
  // 没有 mineable 段：可能是 incorrect_for_*（徒手）或纯材质描述
  const first = segments[0]
  return MATERIAL_SEGMENTS[first] ?? '普通'
}

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = resolve(here, '../.cache/wiki')
const WIKI_MODULES = ['Block', 'Item', 'Entity', 'Effect', 'Enchantment']

const normalizeKey = (value) => value
  .toLowerCase()
  .replace(/^minecraft:/, '')
  .replace(/[\s_\-:]+/g, '')
  .replace(/[()'’.]/g, '')
  .trim()

const stripMarkup = (value) => value
  .replace(/<[^>]*>/g, '')
  .replace(/（[^）]*）/g, '')
  .trim()

/**
 * 拆 wiki 译名的两段。
 *
 * zh.minecraft.wiki 的 Autolink 模块用 `通用名|变种全名` 的格式：
 *   [ "waxed copper bars" ] = '铜栏杆|涂蜡的铜栏杆'
 *   [ "caxa copper ore" ] 会被解析成 normalizeKey 后的 "waxedcopperbars"
 *
 * 斜杠前是**通用名**（一堆变种共用），斜杠后才是**这个条目的专属全名**。
 * 早期版本用 stripMarkup 把竖线后那段直接丢掉，导致 126 组译名撞车 ——
 * 涂蜡避雷针和避雷针都叫「避雷针」，问答题「给避雷针涂蜡会得到什么」直接变成废题。
 *
 * 现在两段都留着，由 pickWikiName 按消歧需要挑。
 */
const parseLuaName = (rawValue) => {
  const cleaned = stripMarkup(rawValue)
  const [generic, specific] = cleaned.split('|').map((part) => part.trim())
  return { generic: generic ?? '', specific: specific ?? '' }
}

const parseLuaNames = (source) => {
  const map = new Map()
  const pattern = /\[\s*"([^"]+)"\s*\]\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'))/g
  for (const match of source.matchAll(pattern)) {
    const key = normalizeKey(match[1])
    const rawValue = match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    const { generic, specific } = parseLuaName(rawValue)
    if (key && generic && !map.has(key)) map.set(key, { generic, specific })
  }
  return map
}

const loadWikiNames = async () => {
  const result = new Map()
  mkdirSync(cacheDir, { recursive: true })
  for (const moduleName of WIKI_MODULES) {
    const cachePath = resolve(cacheDir, `${moduleName}.lua`)
    let source = ''
    try {
      const response = await fetch(`https://zh.minecraft.wiki/w/Module:Autolink/${moduleName}?action=raw`, {
        headers: { 'user-agent': 'MinecraftGuessGame/1.0 (local build)' },
      })
      if (response.ok) {
        source = await response.text()
        writeFileSync(cachePath, source)
      }
    } catch {
      source = ''
    }
    if (!source && existsSync(cachePath)) {
      source = readFileSync(cachePath, 'utf8')
    }
    if (!source) continue
    for (const [key, value] of parseLuaNames(source)) {
      if (!result.has(key)) result.set(key, value)
    }
  }
  return result
}

const wikiNames = await loadWikiNames()

/**
 * 取 wiki 译名，prefer 决定要通用名还是变种全名。
 *
 * 默认拿通用名（与旧行为一致）；消歧阶段拿 specific 全名把撞车的变种区分开。
 */
const chineseFor = (registryName, displayName, prefer = 'generic') => {
  const entry = wikiNames.get(normalizeKey(registryName)) ?? wikiNames.get(normalizeKey(displayName))
  if (!entry) return ''
  if (prefer === 'specific') return entry.specific || entry.generic
  return entry.generic
}

const woodPrefixes = {
  acacia: '金合欢木',
  birch: '白桦木',
  cherry: '樱花木',
  crimson: '绯红',
  dark_oak: '深色橡木',
  jungle: '丛林木',
  mangrove: '红树木',
  oak: '橡木',
  pale_oak: '苍白橡木',
  spruce: '云杉木',
  warped: '诡异',
  bamboo: '竹',
}

const colorPrefixes = {
  white: '白色',
  orange: '橙色',
  magenta: '品红色',
  light_blue: '淡蓝色',
  yellow: '黄色',
  lime: '黄绿色',
  pink: '粉红色',
  gray: '灰色',
  light_gray: '淡灰色',
  cyan: '青色',
  purple: '紫色',
  blue: '蓝色',
  brown: '棕色',
  green: '绿色',
  red: '红色',
  black: '黑色',
}

const suffixPatterns = [
  '_fence_gate', '_pressure_plate', '_hanging_sign', '_chest_boat', '_shulker_box', '_concrete_powder',
  '_trapdoor', '_stairs', '_button', '_planks', '_sign', '_door', '_slab', '_fence', '_wall', '_boat',
  '_stripped_log', '_stripped_wood', '_stripped_hyphae', '_hyphae', '_log', '_wood', '_leaves', '_sapling',
  '_wool', '_carpet', '_candle', '_concrete', '_terracotta', '_bed', '_banner',
  '_glazed_terracotta', '_stained_glass_pane', '_stained_glass', '_glass_pane', '_glass',
  '_shelf', '_flower_pot',
]

const suffixLabels = {
  '_fence_gate': '栅栏门',
  '_pressure_plate': '压力板',
  '_hanging_sign': '悬挂式告示牌',
  '_chest_boat': '运输船',
  '_shulker_box': '潜影盒',
  '_concrete_powder': '混凝土粉末',
  '_trapdoor': '活板门',
  '_stairs': '楼梯',
  '_button': '按钮',
  '_planks': '木板',
  '_sign': '告示牌',
  '_door': '门',
  '_slab': '台阶',
  '_fence': '栅栏',
  '_wall': '墙',
  '_boat': '船',
  '_stripped_log': '去皮原木',
  '_stripped_wood': '去皮木头',
  '_stripped_hyphae': '去皮菌柄',
  '_hyphae': '菌柄',
  '_log': '原木',
  '_wood': '木头',
  '_leaves': '树叶',
  '_sapling': '树苗',
  '_wool': '羊毛',
  '_carpet': '地毯',
  '_candle': '蜡烛',
  '_concrete': '混凝土',
  '_terracotta': '陶瓦',
  '_bed': '床',
  '_banner': '旗帜',
  '_glazed_terracotta': '带釉陶瓦',
  '_stained_glass_pane': '染色玻璃板',
  '_stained_glass': '染色玻璃',
  '_glass_pane': '玻璃板',
  '_glass': '玻璃',
  '_shelf': '展示架',
  '_flower_pot': '花盆',
}

const genericStemNames = {
  '_log': { core: '原木' },
  '_wood': { core: '木头' },
  '_leaves': { core: '树叶' },
  '_sapling': { core: '树苗' },
}

const armorMaterials = {
  leather: '皮革',
  chainmail: '锁链',
  iron: '铁',
  golden: '金',
  diamond: '钻石',
  netherite: '下界合金',
  turtle: '海龟壳',
}

const armorPieces = {
  helmet: '头盔',
  chestplate: '胸甲',
  leggings: '护腿',
  boots: '靴子',
}

const netherStemNames = {
  'crimson_stem': '绯红菌柄',
  'crimson_hyphae': '绯红菌核',
  'stripped_crimson_stem': '去皮绯红菌柄',
  'stripped_crimson_hyphae': '去皮绯红菌核',
  'warped_stem': '诡异菌柄',
  'warped_hyphae': '诡异菌核',
  'stripped_warped_stem': '去皮诡异菌柄',
  'stripped_warped_hyphae': '去皮诡异菌核',
}

// wiki Autolink 没收录到的少数条目，手工补变种全名（否则消歧阶段无从升级）
const manualSpecificNames = {
  filled_map: '已填充的地图',
  breeze_wind_charge: '旋风箭',
}

// 工具按材质补译名，避免木剑/铁剑/钻石剑都退化成"剑"
const toolMaterials = {
  wooden: '木',
  copper: '铜',
  stone: '石',
  golden: '金',
  iron: '铁',
  diamond: '钻石',
  netherite: '下界合金',
}

const toolSuffixes = [
  ['_pickaxe', '镐'],
  ['_sword', '剑'],
  ['_spear', '矛'],
  ['_axe', '斧'],
  ['_shovel', '锹'],
  ['_hoe', '锄'],
]

const resolveToolName = (registryName) => {
  for (const [material, zhMaterial] of Object.entries(toolMaterials)) {
    if (!registryName.startsWith(`${material}_`)) continue
    const suffix = toolSuffixes.find(([needle]) => registryName.endsWith(needle))
    if (suffix) return `${zhMaterial}${suffix[1]}`
  }
  return null
}

const resolveZhName = (registryName, displayName) => {
  if (netherStemNames[registryName]) return netherStemNames[registryName]

  if (registryName === 'bamboo_raft') return '竹筏'
  if (registryName.endsWith('_chest_raft')) return '运输竹筏'

  const toolName = resolveToolName(registryName)
  if (toolName) return toolName

  const isStripped = registryName.startsWith('stripped_')
  const bareName = isStripped ? registryName.slice('stripped_'.length) : registryName

  if (registryName.endsWith('_spawn_egg')) {
    const mobName = registryName.slice(0, -'_spawn_egg'.length)
    const mobZh = chineseFor(mobName, titleCase(mobName))
    if (mobZh) return `${mobZh}刷怪蛋`
  }

  for (const key of Object.keys(genericStemNames)) {
    if (!bareName.endsWith(key)) continue
    const { core } = genericStemNames[key]
    const stem = bareName.slice(0, -key.length)
    const wood = woodPrefixes[stem]
    const prefix = isStripped ? '去皮' : ''

    if (wood) return `${prefix}${wood}${core}`

    const wikiValue = chineseFor(registryName, displayName)
    if (wikiValue && ![core, `去皮${core}`].includes(wikiValue)) return wikiValue
    const stemName = chineseFor(stem, titleCase(stem))
    return `${stemName || displayName}${core}`
  }

  for (const [material, zhMaterial] of Object.entries(armorMaterials)) {
    if (!registryName.startsWith(`${material}_`)) continue
    const piece = registryName.slice(material.length + 1)
    const zhPiece = armorPieces[piece]
    if (zhPiece) return `${zhMaterial}${zhPiece}`
  }

  const suffix = suffixPatterns.find((pattern) => registryName.endsWith(pattern))
  if (suffix) {
    const label = suffixLabels[suffix]
    const stem = registryName.slice(0, -suffix.length)
    const wood = woodPrefixes[stem]
    if (wood) return `${wood}${label}`
    const color = colorPrefixes[stem]
    if (color) return `${color}${label}`
  }

  const wikiValue = chineseFor(registryName, displayName)
  if (wikiValue) return wikiValue
  return displayName
}

// 船/竹筏实体按木材补译名，避免十几种船都叫"船"
const resolveEntityZhName = (registryName, fallback) => {
  const watercraft = [
    ['_chest_boat', '运输船'],
    ['_chest_raft', '运输竹筏'],
    ['_boat', '船'],
    ['_raft', '竹筏'],
  ]
  for (const [suffix, label] of watercraft) {
    if (!registryName.endsWith(suffix)) continue
    const stem = registryName.slice(0, -suffix.length)
    if (stem === 'bamboo') return label
    const wood = woodPrefixes[stem]
    if (wood) return `${wood}${label}`
  }
  return fallback
}

const titleCase = (value) => value
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const effects = Object.values(mc.effects ?? {}).map((effect) => chineseFor(effect.name, effect.displayName ?? effect.name))
const enchantments = Object.values(mc.enchantments ?? {}).map((enchantment) => chineseFor(enchantment.name, enchantment.displayName ?? enchantment.name))
const instruments = Object.values(mc.instruments ?? {}).map((instrument) => `${chineseFor(instrument.name, instrument.name) || titleCase(instrument.name)}号角`)
const readableBoolean = (value, truthy, falsy) => value ? truthy : falsy

const familyTranslations = {
  'Spawn Egg': '刷怪蛋',
  'Wood Set': '木质系列',
  Stairs: '楼梯',
  Slab: '台阶',
  Wall: '墙',
  'Fence Gate': '栅栏门',
  Fence: '栅栏',
  Door: '门',
  Trapdoor: '活板门',
  Button: '按钮',
  'Pressure Plate': '压力板',
  Sign: '告示牌',
  'Hanging Sign': '悬挂式告示牌',
  Bed: '床',
  Banner: '旗帜',
  Candle: '蜡烛',
  'Shulker Box': '潜影盒',
  'Concrete Powder': '混凝土粉末',
  Concrete: '混凝土',
  Terracotta: '陶瓦',
  Wool: '羊毛',
  Carpet: '地毯',
  'Glass Pane': '玻璃板',
  Glass: '玻璃',
  Ore: '矿石',
  Sword: '剑',
  Pickaxe: '镐',
  Axe: '斧',
  Shovel: '锹',
  Hoe: '锄',
  Armor: '盔甲',
  Boat: '船',
  'Chest Boat': '运输船',
  Raft: '竹筏',
  Minecart: '矿车',
  Entity: '实体',
  'Building Block': '建筑方块',
  'General Item': '常规物品',
}

const inferFamily = (name, kind) => {
  const families = [
    ['spawn_egg', 'Spawn Egg'], ['_planks', 'Wood Set'], ['_log', 'Wood Set'], ['_wood', 'Wood Set'],
    ['_stairs', 'Stairs'], ['_slab', 'Slab'], ['_wall', 'Wall'], ['_fence_gate', 'Fence Gate'],
    ['_fence', 'Fence'], ['_door', 'Door'], ['_trapdoor', 'Trapdoor'], ['_button', 'Button'],
    ['_pressure_plate', 'Pressure Plate'], ['_sign', 'Sign'], ['_hanging_sign', 'Hanging Sign'],
    ['_bed', 'Bed'], ['_banner', 'Banner'], ['_candle', 'Candle'], ['_shulker_box', 'Shulker Box'],
    ['_concrete_powder', 'Concrete Powder'], ['_concrete', 'Concrete'], ['_terracotta', 'Terracotta'],
    ['_wool', 'Wool'], ['_carpet', 'Carpet'], ['_glass_pane', 'Glass Pane'], ['_glass', 'Glass'],
    ['_ore', 'Ore'], ['_sword', 'Sword'], ['_pickaxe', 'Pickaxe'], ['_axe', 'Axe'], ['_shovel', 'Shovel'],
    ['_hoe', 'Hoe'], ['_helmet', 'Armor'], ['_chestplate', 'Armor'], ['_leggings', 'Armor'], ['_boots', 'Armor'],
    ['_boat', 'Boat'], ['_chest_boat', 'Chest Boat'], ['_raft', 'Raft'], ['minecart', 'Minecart'],
  ]
  const match = families.find(([needle]) => name.includes(needle))
  if (match) return translate(match[1], familyTranslations)
  if (kind === 'mob') return '生物与实体'
  return kind === 'block' ? '建筑方块' : '常规物品'
}

const itemSpecialStates = (name) => {
  if (['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow'].includes(name)) {
    return effects.map((effect) => `${effect} 效果`)
  }
  if (name === 'enchanted_book') return enchantments.map((enchantment) => `${enchantment} 附魔`)
  if (name === 'goat_horn') return instruments.map((instrument) => `${instrument} 音效`)
  if (name === 'firework_rocket') return ['飞行时长 1–3', '自定义爆裂颜色', '渐变颜色', '拖尾效果', '闪烁效果', '爆裂形状']
  if (name === 'firework_star') return ['自定义爆裂颜色', '渐变颜色', '拖尾效果', '闪烁效果', '爆裂形状']
  if (name === 'filled_map') return ['地图编号', '缩放级别 0–4', '锁定状态', '追踪玩家位置', '自定义图标']
  if (name === 'written_book' || name === 'writable_book') return ['标题', '作者', '成书版本', '页面内容', '文本组件解析']
  if (name === 'bundle') return ['空收纳袋', '部分填充', '已装满', '选中物品栈']
  if (name === 'shield') return ['无图案盾牌', '基础染色底色', '旗帜图案层']
  if (name.endsWith('_banner')) return ['基础颜色', '旗帜图案层', '自定义名称']
  if (name.endsWith('_helmet') || name.endsWith('_chestplate') || name.endsWith('_leggings') || name.endsWith('_boots')) {
    return ['未损坏', '已损坏', '附魔', '皮革装备可自定义染色', '盔甲纹饰材料', '盔甲纹饰图案']
  }
  if (name.endsWith('_spawn_egg')) return ['默认实体数据', '自定义实体组件']
  if (name.includes('bucket')) return ['空桶 / 已装填', '桶内实体变种', '自定义组件数据']
  return []
}

const blocks = Object.values(mc.blocks)
  .filter((block) => block.name !== 'air')
  .map((block) => {
    const states = (block.states ?? []).map((state) => ({
      name: state.name,
      type: state.type,
      values: state.values ?? (state.type === 'bool' ? ['false', 'true'] : Array.from({ length: state.num_values }, (_, index) => String(index))),
    }))
    const variantCount = Math.max(1, block.maxStateId - block.minStateId + 1)
    return {
      id: `block:${block.name}`,
      registryId: block.id,
      kind: 'block',
      name: block.name,
      displayName: block.displayName,
      zhName: resolveZhName(block.name, block.displayName),
      family: inferFamily(block.name, 'block'),
      variantCount,
      states,
      specialStates: states.map((state) => {
        const stateLabel = translate(state.name, stateTranslations)
        const values = state.type === 'bool'
          ? ['是', '否']
          : state.values.map((value) => translate(value, stateTranslations))
        return `${stateLabel}：${values.join(' / ')}`
      }),
      facts: {
        '工具/材质': translateMaterial(block.material),
        '硬度': block.hardness,
        '爆炸抗性': block.resistance,
        '堆叠上限': block.stackSize,
        '可采掘': readableBoolean(block.diggable, '是', '否'),
        '可透光': readableBoolean(block.transparent, '是', '否'),
        '发光等级': block.emitLight,
        '遮光等级': block.filterLight,
        '碰撞箱': block.boundingBox,
      },
    }
  })

const items = Object.values(mc.items)
  .filter((item) => item.name !== 'air')
  .map((item) => {
    const specialStates = itemSpecialStates(item.name)
    return {
      id: `item:${item.name}`,
      registryId: item.id,
      kind: 'item',
      name: item.name,
      displayName: item.displayName,
      zhName: resolveZhName(item.name, item.displayName),
      family: inferFamily(item.name, 'item'),
      variantCount: Math.max(1, specialStates.length),
      states: [],
      specialStates,
      facts: {
        '堆叠上限': item.stackSize,
      },
    }
  })

const entities = Object.values(mc.entities)
  .filter((entity) => !['player', 'fishing_bobber'].includes(entity.name))
  .map((entity) => {
    const metadataKeys = entity.metadataKeys ?? []
    const curatedVariants = entityVariants[entity.name] ?? []
    const translatedMetadata = metadataKeys.map((key) => stateTranslations[key] ?? titleCase(key))
    return {
      id: `mob:${entity.name}`,
      registryId: entity.id,
      kind: 'mob',
      name: entity.name,
      displayName: entity.displayName,
      zhName: resolveEntityZhName(entity.name, chineseFor(entity.name, entity.displayName) || entity.displayName),
      family: translate(String(entity.category ?? ''), categoryTranslations) || inferFamily(entity.name, 'mob'),
      variantCount: Math.max(1, curatedVariants.length),
      states: [],
      specialStates: [...new Set([...curatedVariants, ...translatedMetadata])],
      facts: {
        '实体类型': entity.type,
        '生物分类': translate(String(entity.category ?? ''), categoryTranslations),
        '碰撞宽度': entity.width,
        '碰撞高度': entity.height,
      },
    }
  })

const catalog = [...blocks, ...items, ...entities]

// ---------- 译名消歧：把同类型内撞车的变种升级成专属全名 ----------
//
// wiki 的译名格式是 `通用名|变种全名`，通用名会被一大群变种共用：
//   铜栏杆  <- copper_bars / exposed_ / weathered_ / oxidized_ / waxed_ 全部共用
// 于是一批涂蜡态、氧化态、深板岩态、墙挂态的方块全都叫同一个名字，
// 问答题里「用蜂蜜瓶给避雷针涂蜡，会得到什么？」的答案就成了「避雷针」——
// 题目直接作废。这里把这类撞车条目换成 wiki 给的变种全名。
//
// 只在【同一个 kind 内出现重名】时才升级，避免把「石头既是方块也是物品」这种
// 跨类型的正常复用也改成「石头（方块）」。
const disambiguateZhNames = (entries) => {
  const groups = new Map()
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.zhName}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  let upgraded = 0
  for (const group of groups.values()) {
    // 同名只有一个条目 —— 或者是不同 kind 复用同名，都不算撞车
    if (group.length < 2) continue
    // 只有一个注册名（block/item 同名）也不需要消歧
    if (new Set(group.map((entry) => entry.name)).size < 2) continue

    // 谁手里有 wiki 的变种全名，谁就升级；通用名留给没有专属全名的那条。
    // 不能按注册名字典序挑「基础条目」—— deepslate_gold_ore 排在 gold_ore 前面，
    // 那样会让有专属译名的深层矿反过来霸占「金矿石」，把真正的金矿石挤到重名里。
    const withSpecific = group
      .map((entry) => ({
        entry,
        specific: manualSpecificNames[entry.name] ?? chineseFor(entry.name, entry.displayName, 'specific'),
      }))
      .filter((item) => item.specific && item.specific !== item.entry.zhName)
    // 全员都有专属全名时（理论上不该发生），按注册名排序保证结果稳定
    const ordered = withSpecific.sort((a, b) => a.entry.name.localeCompare(b.entry.name))

    const taken = new Set(group.map((entry) => entry.zhName))
    for (const { entry, specific } of ordered) {
      // 升级后仍然撞车就保留原名（宁可重复也不给错名字）
      if (taken.has(specific)) continue
      entry.zhName = specific
      taken.add(specific)
      upgraded += 1
    }
  }
  return upgraded
}

const disambiguated = disambiguateZhNames(catalog)

const blockStateCount = blocks.reduce((sum, block) => sum + block.variantCount, 0)
const entityStateCount = entities.reduce((sum, entity) => sum + entity.specialStates.length, 0)
const itemStateCount = items.reduce((sum, item) => sum + item.specialStates.length, 0)

const output = {
  meta: {
    edition: 'Java Edition',
    version: VERSION,
    releaseType: mc.version.releaseType,
    generatedFrom: 'PrismarineJS minecraft-data',
    translationSource: '中文 Minecraft Wiki（zh.minecraft.wiki）官方译名数据',
    disambiguatedZhNames: disambiguated,
    counts: {
      blocks: blocks.length,
      blockStates: blockStateCount,
      items: items.length,
      itemSpecialStates: itemStateCount,
      entities: entities.length,
      entitySpecialStates: entityStateCount,
      totalEntries: catalog.length,
      translatedNames: catalog.filter((entry) => /[一-龥]/.test(entry.zhName)).length,
    },
  },
  catalog,
}

const outputPath = resolve(here, '../src/data/catalog.json')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output))
console.log(`Generated ${catalog.length} entries for Minecraft Java ${VERSION}`)
console.log(output.meta.counts)
