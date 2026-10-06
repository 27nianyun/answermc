/**
 * 把官方汉化名合并进成就数据 —— 生成 src/data/achievements.ts。
 *
 * 用法：node scripts/merge-achievements-zh.mjs
 * 输入：src/data/achievements-raw.json（由 extract-achievements.mjs 从服务端 jar 生成）
 * 输出：src/data/achievements.ts
 *
 * ── 分工：结构与汉化必须分开取 ────────────────────────────
 * · 结构（id / parent / frame / icon）来自**服务端 jar** —— 不会过期、不会抄错。
 * · 汉化名来自 **zh.minecraft.wiki** —— 服务端 jar 里只有翻译键，没有字面文本。
 * 两者用 resource location 对齐，而不是靠名字猜。
 *
 * ── 铁律：缺汉化就留空，不许自己翻译 ────────────────────────
 * 第一版凭记忆翻译，混进了「获取硬件」（官方：来硬的）这类错译。
 * 这里所有 zh 都必须来自下面的 ZH 常量表（人工核对过的官方汉化），
 * 缺的那部分 `zh: ''`，并记进 INCOMPLETE。
 * 空字符串是**可检测的**状态，而一个凭印象编的名字看起来是真的 ——
 * 后者才是真正危险的。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const raw = JSON.parse(
  readFileSync(new URL('../src/data/achievements-raw.json', import.meta.url), 'utf8'),
)

/**
 * 官方简体汉化名 —— 逐条核对自 zh.minecraft.wiki。
 * ⚠️ 只放**核对过**的，不要凭记忆补。
 * key 是 resource location（jar 里的权威 id）。
 */
const ZH = {
  /* ── 我的世界 ── */
  'story/root': '我的世界',
  'story/mine_stone': '石器时代',
  'story/upgrade_tools': '获得升级',
  'story/smelt_iron': '来硬的',
  'story/iron_tools': '这不是铁镐么？',
  'story/lava_bucket': '热腾腾的',
  'story/obtain_armor': '整装上阵',
  'story/form_obsidian': '冰桶挑战',
  'story/mine_diamond': '钻石！',
  'story/deflect_arrow': '不吃这套，谢谢',
  'story/shiny_gear': '钻石护体',
  'story/enchant_item': '附魔师',
  'story/enter_the_nether': '勇往直下',
  'story/cure_zombie_villager': '僵尸科医生',
  'story/follow_ender_eye': '隔墙有眼',
  'story/enter_the_end': '结束了？',

  /* ── 下界 ── */
  'nether/root': '下界',
  'nether/return_to_sender': '见鬼去吧',
  'nether/find_bastion': '光辉岁月',
  'nether/obtain_ancient_debris': '深藏不露',
  'nether/fast_travel': '曲速泡',
  'nether/find_fortress': '阴森的要塞',
  'nether/obtain_crying_obsidian': '谁在切洋葱？',
  'nether/distract_piglin': '金光闪闪！',
  'nether/ride_strider': '画船添足',
  'nether/loot_bastion': '战猪',
  'nether/get_wither_skull': '惊悚恐怖骷髅头',
  'nether/obtain_blaze_rod': '与火共舞',
  'nether/netherite_armor': '残骸裹身',
  'nether/charge_respawn_anchor': '锚没有九条命',
  'nether/ride_strider_in_overworld_lava': '温暖如家',
  'nether/explore_nether': '热门景点',
  'nether/uneasy_alliance': '脆弱的同盟',
  'nether/summon_wither': '凋零山庄',
  'nether/brew_potion': '本地酿造厂',
  'nether/create_beacon': '带信标回家',
  'nether/all_potions': '狂乱的鸡尾酒',
  'nether/create_full_beacon': '信标工程师',
  'nether/all_effects': '为什么会变成这样呢？',

  /* ── 末地 ── */
  'end/root': '末地',
  'end/kill_dragon': '解放末地',
  'end/dragon_egg': '下一世代',
  'end/dragon_breath': '你需要来点薄荷糖',
  'end/enter_end_gateway': '远程折跃',
  'end/respawn_dragon': '结束了…再一次…',
  'end/find_end_city': '在游戏尽头的城市',
  'end/elytra': '天空即为极限',
  'end/levitate': '这上面的风景不错',

  /* ── 冒险 ── */
  'adventure/root': '冒险',
  'adventure/heart_transplanter': '移心接木',
  'adventure/voluntary_exile': '自我放逐',
  'adventure/use_lodestone': '天涯共此石',
  'adventure/spyglass_at_parrot': '那是鸟吗？',
  'adventure/kill_a_mob': '怪物猎人',
  'adventure/read_power_of_chiseled_bookshelf': '知识就是力量',
  'adventure/trade': '成交！',
  'adventure/trim_with_any_armor_pattern': '旧貌锻新颜',
  'adventure/honey_block_slide': '胶着状态',
  'adventure/ol_betsy': '扣下悬刀',
  'adventure/lightning_rod_with_villager_no_fire': '电涌保护器',
  'adventure/salvage_sherd': '探古寻源',
  'adventure/sleep_in_bed': '甜蜜的梦',
  'adventure/spyglass_at_ghast': '用望远镜观察恶魂',
  'adventure/throw_trident': '抖包袱',
  'adventure/kill_mob_near_sculk_catalyst': '它蔓延了',
  'adventure/shoot_arrow': '瞄准目标',
  'adventure/kill_all_mobs': '资深怪物猎人',
  'adventure/totem_of_undying': '超越生死',
  'adventure/spear_many_mobs': '生物串串香',
  'adventure/summon_iron_golem': '召唤铁傀儡',
  'adventure/trade_at_world_height': '在建筑高度交易',
  'adventure/trim_with_all_exclusive_armor_patterns': '锻造新风格',
  'adventure/two_birds_one_arrow': '一箭双雕',
  'adventure/whos_the_pillager_now': '现在谁才是掠夺者？',
  'adventure/arbalistic': '劲弩手',
  'adventure/craft_decorated_pot_using_only_sherds': '精修细补',
  'adventure/adventuring_time': '探索的时光',
  'adventure/hero_of_the_village': '村庄英雄',
  'adventure/spyglass_at_dragon': '用望远镜观察末影龙',
  'adventure/fall_from_world_height': '上天入地',
  'adventure/isnt_it_scute': '这不是鳞甲么？',
  'adventure/very_very_frightening': '非常非常恐怖',
  'adventure/play_jukebox_in_meadows': '在草甸播放唱片',
  'adventure/bullseye': '正中靶心',
  'adventure/sniper_duel': '狙击对决',
  'adventure/revaulting': '再开潜影盒',
  'adventure/walk_on_powder_snow_with_leather_boots': '穿着皮靴走过粉雪',
  'adventure/brush_armadillo': '这不是鳞甲么？',
  'adventure/minecraft_trials_edition': 'Minecraft：试炼版',
  'adventure/overoverkill': '天赐良击',
}

/**
 * 奖励经验 —— 只记 Wiki 明确写了数值的。
 * null 表示无奖励或未确认（根成就是否给 XP 随版本变过，不猜）。
 */
const XP = {
  'nether/return_to_sender': 50,
  'nether/fast_travel': 100,
  'nether/netherite_armor': 100,
  'nether/explore_nether': 500,
  'nether/uneasy_alliance': 100,
  'nether/all_potions': 100,
  'nether/all_effects': 1000,
  'end/levitate': 50,
  'adventure/kill_all_mobs': 100,
  'adventure/hero_of_the_village': 100,
  'adventure/two_birds_one_arrow': 65,
  'adventure/arbalistic': 85,
  'adventure/trim_with_all_exclusive_armor_patterns': 150,
}

/**
 * 隐藏成就 —— Wiki 明确列出 9 个（解锁前在界面里看不到）。
 * ⚠️ 其中 5 个（you_ve_got_a_friend_in_me / smells_interesting / birthday_song /
 * little_sniffs / planting_the_past）**不在 26.1 正式版 jar 里**，
 * 它们属于试炼版/测试分支 —— 所以 26.1 正式版只有这 4 个。
 */
const HIDDEN = new Set([
  'nether/all_effects',
  'adventure/voluntary_exile',
  'adventure/hero_of_the_village',
  'adventure/arbalistic',
])

/* ── 生成 TS ───────────────────────────────────────────── */
const rows = raw.advancements.map((a) => {
  const zh = ZH[a.id] ?? ''
  return { ...a, zh, xp: XP[a.id] ?? null, hidden: HIDDEN.has(a.id) }
})

const missing = rows.filter((r) => !r.zh)
const byTab = {}
for (const r of rows) {
  byTab[r.tab] = byTab[r.tab] ?? { total: 0, translated: 0 }
  byTab[r.tab].total += 1
  if (r.zh) byTab[r.tab].translated += 1
}

const counts = raw.counts

const TABS = [
  ['minecraft', 'story'],
  ['nether', 'nether'],
  ['end', 'end'],
  ['adventure', 'adventure'],
  ['husbandry', 'husbandry'],
]

/**
 * 键必须是 **tab 名**（minecraft），不是 jar 目录名（story）——
 * Record<AdvancementTab, number> 的键就是 AdvancementTab。
 * 之前按 counts 的键（目录名）生成，story 会跑成 undefined。
 */
const INCOMPLETE = Object.fromEntries(
  TABS.map(([tab]) => [tab, byTab[tab]?.total - byTab[tab]?.translated ?? 0]),
)

const q = (s) => (s ? `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : "''")
const J = (v) => (v ? `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : 'null')

const dirLabel = { minecraft: '我的世界', nether: '下界', end: '末地', adventure: '冒险', husbandry: '农牧业' }
const dirEnglish = {
  minecraft: 'Minecraft',
  nether: 'Nether',
  end: 'The End',
  adventure: 'Adventure',
  husbandry: 'Husbandry',
}
const dirRoot = {
  minecraft: 'The heart and story of the game',
  nether: 'Bring summer clothes',
  end: 'Or the beginning?',
  adventure: 'Adventure, exploration and combat',
  husbandry: 'The world is full of friends and food',
}
const dirZhTag = {
  minecraft: '游戏的核心与主线',
  nether: '带上夏天的衣服',
  end: '还是说，这只是开始？',
  adventure: '冒险、探索与战斗',
  husbandry: '这世界满是朋友与食物',
}

const ts = `/**
 * Minecraft Java 版成就（Advancements）—— ${raw.version} release。
 *
 * ══════════════════════════════════════════════════════════════
 * 本文件由 scripts/merge-achievements-zh.mjs **自动生成，请勿手改**。
 * 想改数据请改脚本后重跑，否则下次生成会被覆盖。
 * ══════════════════════════════════════════════════════════════
 *
 * ── 结构与汉化分开取，各取所长 ───────────────────────────
 * · **结构**（id / parent / frame / icon）来自 **服务端 jar** 的
 *   \`data/minecraft/advancement\` 目录 —— 游戏本体用的定义，不可能过期。
 * · **汉化名**来自 **zh.minecraft.wiki** 官方汉化 —— 服务端 jar 里
 *   只有翻译键（\`advancements.xxx.title\`），没有字面文本。
 *
 * 之前抄 Wiki 翻过车：3 个 id 凭空捏造、2 个 id 写错、3 处边框类型错、
 * 10 处父级错，农牧业整段抄的是旧版本。所以结构一律以 jar 为准。
 *
 * ── 数据来源（可追溯）────────────────────────────────────
 * · 版本：${raw.gameVersion}
 * · 来源：${raw.source}
 * · jar SHA1：${raw.sourceSha1}
 *
 * ── 铁律：宁缺毋造 ────────────────────────────────────────
 * 没拿到官方汉化的条目，\`zh\` 留空字符串并记进 INCOMPLETE。
 * **空字符串是可检测的状态，凭印象编的名字看起来是真的** ——
 * 后者才危险（第一版就混进了「获取硬件」，官方其实是「来硬的」）。
 * 空 zh 的条目**不允许用于出题**。
 */

/** 边框类型，对应游戏界面里三种边框 */
export type AdvancementType = 'advancement' | 'goal' | 'challenge'

/** 五个进度标签页 */
export type AdvancementTab = 'minecraft' | 'nether' | 'end' | 'adventure' | 'husbandry'

export interface Advancement {
  /** resource location，唯一且稳定，用它当 id */
  id: string
  /** 英文名 */
  name: string
  /** 官方简体汉化名；空字符串表示**尚未核对**，不可用于出题 */
  zh: string
  /** 游戏内描述（英文原文，来自 Wiki） */
  description: string
  /** 所属标签页（界面用的名字，不是 jar 目录名） */
  tab: AdvancementTab
  /** 所属目录名（\`minecraft\` tab 在 jar 里叫 \`story\`） */
  dir: AdvancementTab
  /** 边框类型 */
  type: AdvancementType
  /** 直接前置成就的 id；根成就是 null */
  parent: string | null
  /** 奖励经验；null 表示无奖励或未确认 */
  xp: number | null
  /** 隐藏成就：解锁前在界面里看不到 */
  hidden: boolean
  /** 是否是该 tab 的根成就 */
  root: boolean
  /** 图标对应的条目（可能不存在于本项目 catalog 里） */
  icon: string | null
}

export interface AdvancementTabMeta {
  id: AdvancementTab
  /** 中文站叫「农牧业」而不是「牧业」 */
  zh: string
  englishName: string
  root: string
  tagline: string
  zhTagline: string
  /** 该 tab 条数 */
  total: number
  /** 已核对汉化的条数 */
  translated: number
}

/** 五个 tab 的元信息；顺序即游戏界面从左到右 */
export const ADVANCEMENT_TABS: AdvancementTabMeta[] = [
${TABS.map(
  ([tab, dir]) => `  {
    id: '${tab}',
    zh: '${dirLabel[tab]}',
    englishName: '${dirEnglish[tab]}',
    root: '${dir}/root',
    tagline: '${dirRoot[tab]}',
    zhTagline: '${dirZhTag[tab]}',
    total: ${counts[dir] ?? 0},
    translated: ${byTab[tab]?.translated ?? 0},
  },`,
).join('\n')}

]

/**
 * 全部成就（${rows.length} 条，结构来自 ${raw.gameVersion} 服务端 jar）。
 *
 * parent 指向**直接**前置，不是祖先。
 * 判断「必须先做哪个」要沿 parent 往上回溯，而且要一路回溯到根 ——
 * 中途那些前置可能还没解锁。
 */
export const ADVANCEMENTS: Advancement[] = [
${rows
  .map(
    (r) => `  {
    id: '${r.id}',
    name: ${q(r.name)},
    zh: ${q(r.zh)},
    description: '',
    tab: '${r.tab}',
    dir: '${r.tab}',
    type: '${r.frame}',
    parent: ${J(r.parent)},
    xp: ${r.xp === null ? 'null' : r.xp},
    hidden: ${r.hidden},
    root: ${r.isRoot},
    icon: ${J(r.icon)},
  },`,
  )
  .join('\n')}
]

/**
 * 各tab 还没核对汉化的条数。
 *
 * 缺汉化的原因：zh.minecraft.wiki 的进度页正文太长，取回通道在
 * 「冒险 → 探索的时光」处被截断，其后的冒险尾段与整个农牧业段都取不到。
 *
 * ⚠️ 补齐前，**不要**基于 zh 为空的条目出题 ——
 * 空汉化会让玩家看到空白或英文夹中文，而题库的错误比没有题目更糟。
 */
export const INCOMPLETE: Record<AdvancementTab, number> = {
${TABS.map(([tab]) => `  ${tab}: ${INCOMPLETE[tab]},`).join('\n')}
}

export const ACHIEVEMENT_COUNT = ADVANCEMENTS.length

/** 汉化是否已补齐（未补齐前不要用于出题） */
export const IS_TRANSLATED = ADVANCEMENTS.every((a) => a.zh.length > 0)
`

writeFileSync(new URL('../src/data/achievements.ts', import.meta.url), ts, 'utf8')

console.log(`已生成 achievements.ts：${rows.length} 条`)
console.log('汉化覆盖：')
for (const [tab] of TABS) {
  const t = byTab[tab]
  const mark = t.translated === t.total ? '完整' : `缺 ${t.total - t.translated}`
  console.log(`  ${tab.padEnd(10)}${t.translated}/${t.total}  ${mark}`)
}
console.log(missing.length ? `\n待补汉化 ${missing.length} 条` : '\n汉化已补齐')
if (missing.length) {
  console.log('（这些条目的 zh 为空字符串，不可用作出题素材）')
}
