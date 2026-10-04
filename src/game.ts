import { hasTag } from './yesno'
import type { CatalogEntry, Difficulty, Kind } from './types'

export const KIND_LABELS: Record<Kind, string> = {
  block: '方块',
  item: '物品',
  mob: '生物与实体',
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  explorer: '探险家',
  survival: '生存',
  hardcore: '极限',
}

export const normalizeAnswer = (value: string) => value
  .toLowerCase()
  .replace(/^minecraft:/, '')
  .replace(/[\s_\-:：（）()'’.·・]+/g, '')
  .trim()

export const isCorrectAnswer = (value: string, entry: CatalogEntry) => {
  const normalized = normalizeAnswer(value)
  return normalized === normalizeAnswer(entry.name)
    || normalized === normalizeAnswer(entry.displayName)
    || normalized === normalizeAnswer(entry.zhName)
}

export interface Clue {
  tag: string
  text: string
}

const readableBoolean = (value: unknown, truthy: string, falsy: string) => value ? truthy : falsy

const TOOL_PHRASES: Record<string, string> = {
  镐: '镐',
  斧: '斧头',
  锹: '铲子',
  锄: '锄头',
  剪刀: '剪刀',
}

const TOOL_ALIASES: Record<string, string> = {
  pickaxe: '镐',
  axe: '斧头',
  shovel: '铲子',
  hoe: '锄头',
  shears: '剪刀',
  sword: '剑',
}

// 返回 null 表示"没有趁手的工具"，这时不再画蛇添足地补一句"用空手会快"
const toolPhrase = (raw: string): string | null => {
  const value = String(raw ?? '')
  if (!value || value === '未知' || value === '普通') return null
  if (TOOL_PHRASES[value]) return TOOL_PHRASES[value]
  const match = value.match(/mineable\/(\w+)/)
  if (match && TOOL_ALIASES[match[1]]) return TOOL_ALIASES[match[1]]
  if (value.includes(';')) {
    const parts = value.split(';').reverse()
    for (const part of parts) {
      const nested = part.match(/mineable\/(\w+)/)
      if (nested && TOOL_ALIASES[nested[1]]) return TOOL_ALIASES[nested[1]]
    }
  }
  return null
}

const toolNote = (raw: string): string => {
  const value = String(raw ?? '')
  if (value.includes('sword_instantly_mines')) return '用剑砍一下就断'
  if (value.includes('incorrect_for_wooden_tool')) return '木工具挖了不掉东西，得用好一点的工具'
  return ''
}

const hardnessPhrase = (raw: unknown) => {
  const hardness = Number(raw ?? 0)
  if (!Number.isFinite(hardness) || hardness < 0) return '它根本拆不掉'
  if (hardness === 0) return '一碰就掉'
  if (hardness < 0.6) return '一拳就能打掉'
  if (hardness < 3) return `徒手拆大约要 ${Math.round(hardness * 1.5 * 10) / 10} 秒`
  if (hardness < 6) return `有点硬，徒手拆大约要 ${Math.round(hardness * 1.5)} 秒`
  if (hardness < 25) return '相当硬，徒手要挖上半天'
  return '硬得离谱，徒手基本拆不动'
}

const itemPurpose = (name: string) => {
  if (/_spawn_egg$/.test(name)) return '右键它就能直接召唤出对应的生物'
  if (/(helmet|chestplate|leggings|boots)/.test(name)) return '它能穿在身上当防具'
  if (/elytra/.test(name)) return '穿上它可以滑翔'
  if (/(^|_)sword(_|$)/.test(name)) return '它是拿来打架的武器'
  if (/(^|_)axe$/.test(name)) return '它是砍树用的斧头'
  if (/(^|_)pickaxe$/.test(name)) return '它是挖矿挖石头用的镐'
  if (/(^|_)shovel$/.test(name)) return '它是铲土铲沙用的铲子'
  if (/(^|_)hoe$/.test(name)) return '它是种地翻土用的锄头'
  if (/shears/.test(name)) return '它是剪刀，剪羊毛、剪树叶都靠它'
  if (/(^|_)bow(_|$)|crossbow/.test(name)) return '它是远程武器，能射箭'
  if (/trident/.test(name)) return '它是三叉戟，能扔出去也能近战'
  if (/mace/.test(name)) return '它是重锤，砸下去越重伤害越高'
  if (/shield/.test(name)) return '它是盾牌，能挡下伤害'
  if (/fishing_rod/.test(name)) return '它是钓鱼竿'
  if (/flint_and_steel/.test(name)) return '它能点火'
  if (/bucket/.test(name)) return '它是桶，能装水、岩浆这类东西'
  if (/(boat|raft)/.test(name)) return '它能放在水上当交通工具'
  if (/minecart/.test(name)) return '它是矿车，要放在铁轨上跑'
  if (/music_disc_/.test(name)) return '它是音乐唱片，放进唱片机能放曲子'
  if (/_dye$/.test(name)) return '它是染料，能给羊毛、玻璃染色'
  if (/potion/.test(name)) return '它是药水，用了会给状态'
  if (/banner/.test(name)) return '它是旗帜，能挂在墙上或举着'
  if (/(bread|apple|meat|steak|chicken|mutton|porkchop|cookie|cake|stew|soup|carrot|potato|melon|berries|kelp|rabbit|cooked)/.test(name)) return '它是能吃的东西'
  if (/(compass|clock|spyglass|map|brush|lead|name_tag|totem)/.test(name)) return '它是随身带着用的小工具'
  return '它是拿在手里用的东西'
}

const mobTemper = (entry: CatalogEntry) => {
  if (hasTag(entry, 'boss')) return '它是首领级的家伙，血条很厚'
  if (hasTag(entry, 'hostile')) return '它会主动攻击你，碰上就要小心'
  if (hasTag(entry, 'passive')) return '它不会主动打你'
  if (hasTag(entry, 'neutral')) return '平时不理你，惹到它才会动手'
  return '它谈不上敌意，属于中立或特殊的存在'
}

const mobTrait = (entry: CatalogEntry) => {
  if (hasTag(entry, 'vehicle')) return '它是能坐上去的载具'
  if (hasTag(entry, 'flying')) return '它会在天上飞'
  if (hasTag(entry, 'aquatic')) return '它待在水里，离了水会难受'
  if (hasTag(entry, 'undead')) return '它是亡灵：不怕火，治疗药水反而会伤到它'
  if (hasTag(entry, 'tamable')) return '它可以被驯服，能当成伙伴带走'
  if (hasTag(entry, 'illager')) return '它是灾厄村民一伙的'
  return '它是平时在陆地上活动的普通生物'
}

const sizePhrase = (height: number) => {
  if (height <= 0) return ''
  if (height >= 2.2) return '比玩家高出一头'
  if (height >= 1.5) return '和玩家差不多高'
  if (height >= 1) return '比玩家矮一点'
  return '个头很小，比玩家矮不少'
}

const FLUID_BLOCKS = new Set(['water', 'lava', 'flowing_water', 'flowing_lava', 'bubble_column'])

export const makeClues = (entry: CatalogEntry): Clue[] => {
  const chineseLength = entry.zhName.replace(/\s/g, '').length
  const firstChineseChar = entry.zhName.slice(0, 1)
  const nameClue: Clue = {
    tag: '名字',
    text: `它的中文译名一共 ${chineseLength} 个字，第一个字是「${firstChineseChar}」。`,
  }
  const family = String(entry.family ?? '')
  const hasFamily = family && family !== 'UNKNOWN' && family !== '常规物品'

  if (entry.kind === 'block') {
    const material = String(entry.facts['工具/材质'] ?? '')
    const light = Number(entry.facts['发光等级'] ?? 0)
    const diggable = entry.facts['可采掘'] === '是'
    const seeThrough = readableBoolean(entry.facts['可透光'] === '是', '光能透过去', '它是实心的，会挡光')
    const isFluid = FLUID_BLOCKS.has(entry.name)

    return [
      {
        tag: '类别',
        text: hasFamily ? `这是一个方块，按图鉴分在「${family}」这一类。` : '这是一个方块，可以直接摆在世界里。',
      },
      {
        tag: '手感',
        text: isFluid
          ? '它是会流动的液体，挖不掉，得用桶来装。'
          : diggable
            ? `${[hardnessPhrase(entry.facts['硬度']), toolPhrase(material) ? `用${toolPhrase(material)}挖会快很多` : '', toolNote(material)].filter(Boolean).join('，')}。`
            : '它正常情况下挖不动，属于拆不掉的那一类。',
      },
      {
        tag: '光亮',
        text: light > 0
          ? `它自己会发光，亮度 ${light} 级（火把是 14 级），${seeThrough}。`
          : `它自己不发光，${seeThrough}。`,
      },
      {
        tag: '摆放',
        text: entry.variantCount > 1
          ? `摆下去时有 ${entry.variantCount.toLocaleString('zh-CN')} 种朝向或状态组合，比如朝向、开关、含水这类。`
          : '它只有一种摆法，没有朝向变化。',
      },
      nameClue,
    ]
  }

  if (entry.kind === 'mob') {
    const width = Number(entry.facts['碰撞宽度'] ?? 0)
    const height = Number(entry.facts['碰撞高度'] ?? 0)
    const size = sizePhrase(height)

    return [
      {
        tag: '类别',
        text: hasFamily ? `这是一个生物或实体，图鉴把它放在「${family}」里。` : '这是一个生物或实体，会在世界里活动。',
      },
      { tag: '脾气', text: `${mobTemper(entry)}。` },
      {
        tag: '个头',
        text: size
          ? `它高约 ${height.toFixed(2)} 格、宽约 ${width.toFixed(2)} 格，${size}（玩家约 1.8 格）。`
          : `它高约 ${height.toFixed(2)} 格、宽约 ${width.toFixed(2)} 格。`,
      },
      { tag: '习性', text: `${mobTrait(entry)}。` },
      nameClue,
    ]
  }

  const stackSize = Number(entry.facts['堆叠上限'] ?? 64)
  return [
    {
      tag: '类别',
      text: hasFamily ? `这是一件物品，图鉴把它分在「${family}」这一类。` : '这是一件物品，放在背包格子里的那种。',
    },
    { tag: '用途', text: `${itemPurpose(entry.name)}。` },
    {
      tag: '堆叠',
      text: stackSize > 1
        ? `背包里一格最多能叠 ${stackSize} 个。`
        : '它不能堆叠，一格只能放一个。',
    },
    {
      tag: '细节',
      text: entry.specialStates.length
        ? `它身上会记录 ${entry.specialStates.length} 项额外信息，比如耐久、附魔、染色这类。`
        : '它本身没有额外记录，不同的样子都是单独算一个物品。',
    },
    nameClue,
  ]
}

const hashString = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const seededIndex = (seed: string, length: number) => hashString(seed) % Math.max(1, length)

export const pickEntry = (
  pool: CatalogEntry[],
  previousIds: string[],
  seed?: string,
) => {
  const freshPool = pool.filter((entry) => !previousIds.includes(entry.id))
  const source = freshPool.length ? freshPool : pool
  if (!source.length) throw new Error('当前筛选条件下没有可用题目。')
  const index = seed ? seededIndex(seed, source.length) : Math.floor(Math.random() * source.length)
  return source[index]
}

export const getScore = (difficulty: Difficulty, hintsUsed: number, wrongAttempts: number) => {
  const base = difficulty === 'hardcore' ? 180 : difficulty === 'survival' ? 130 : 100
  return Math.max(20, base - hintsUsed * 18 - wrongAttempts * 12)
}

export const getInitialHintCount = (difficulty: Difficulty) => {
  if (difficulty === 'explorer') return 3
  if (difficulty === 'survival') return 2
  return 1
}
