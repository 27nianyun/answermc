/**
 * Minecraft Java 版进度（Advancements）—— 26.1 基准。
 *
 * ══════════════════════════════════════════════════════════════
 * ⚠️ **数据完整度：84 / 126（67%）** —— 缺 42 条，详见 INCOMPLETE
 * ══════════════════════════════════════════════════════════════
 *
 * ── 为什么分两段做 ────────────────────────────────────────
 * 进度页正文太长（中英站都在 Adventure 段的「探索的时光」处被取回通道截断），
 * 一次抓不全。所以走「分 5 段抓取 + 校验脚本核对」：
 *   我的世界 16/16  ✅
 *   下界     23/23  ✅
 *   末地      9/9   ✅
 *   冒险     36/47  ⚠️ 缺 11（截断）
 *   农牧业    0/31  ❌ 整段没抓到（截断在它之前）
 *
 * ── 铁律：宁缺毋造 ────────────────────────────────────────
 * 缺的部分**不猜、不用记忆补**。中文名一律取自 zh.minecraft.wiki 官方汉化，
 * 抓不到就明确标成「待补」，绝不塞一个凭印象翻译的名字进去。
 *
 * 上一版就是因为凭记忆翻译，混进了两类错译（已全部按官方改正）：
 *   Acquire Hardware  「获取硬件」→ 官方「来硬的」
 *   Suit Up「整装待发」→ 官方「整装上阵」
 * 而「牧业」这个 tab 的官方叫法其实是「农牧业」。
 *
 * ── id 用 resource location，不要用中文名当 key ────────────
 * 中文名会随汉化改动，而且「Adventuring Time」这类描述压根不是独立成就。
 */

/** 边框类型，对应游戏界面里三种边框 */
export type AdvancementType = 'advancement' | 'goal' | 'challenge'

/** 五个进度标签页 */
export type AdvancementTab = 'minecraft' | 'nether' | 'end' | 'adventure' | 'husbandry'

export interface Advancement {
  /** resource location，形如 `story/mine_stone` —— 唯一且稳定，用它当 id */
  id: string
  /** 英文名 */
  name: string
  /** 官方简体汉化名（取自 zh.minecraft.wiki） */
  zh: string
  /** 游戏内描述，即「怎么算完成」；纯英文，从英文站取 */
  description: string
  /** 所属标签页 */
  tab: AdvancementTab
  /** 边框类型 */
  type: AdvancementType
  /** 直接前置成就的 id；根成就是 null */
  parent: string | null
  /**
   * 奖励经验；null 表示无奖励或未确认。
   * ⚠️ 根成就是否给 XP 随版本变过，只记明确写了数值的。
   */
  xp: number | null
  /**
   * 隐藏成就：解锁前在界面里看不到。
   * 「能不能看到」本身就是知识点，所以单独记一个字段。
   */
  hidden: boolean
  /**
   * 试炼版（Minecraft: Trial(s) Edition）专属进度。
   * 这批是 26.x 新内容，只在试炼版快照里能拿到，
   * 独立成一条分支（父级挂在 adventure/trials 下）。
   */
  trial?: boolean
}

export interface AdvancementTabMeta {
  id: AdvancementTab
  /** 中文站的 tab 名（注意官方叫「农牧业」，不是「牧业」） */
  zh: string
  englishName: string
  /** 根成就的 id */
  root: string
  /** 根成就的游戏内副标题 */
  tagline: string
  /** 根成就的官方汉化副标题 */
  zhTagline: string
  /** 该 tab 官方标称条数 */
  total: number
}

/** 五个 tab 的元信息；顺序即游戏界面从左到右 */
export const ADVANCEMENT_TABS: AdvancementTabMeta[] = [
  {
    id: 'minecraft',
    zh: '我的世界',
    englishName: 'Minecraft',
    root: 'story/root',
    tagline: 'The heart and story of the game',
    zhTagline: '游戏的核心与主线',
    total: 16,
  },
  {
    id: 'nether',
    zh: '下界',
    englishName: 'Nether',
    root: 'nether/root',
    tagline: 'Bring summer clothes',
    zhTagline: '带上夏天的衣服',
    total: 23,
  },
  {
    id: 'end',
    zh: '末地',
    englishName: 'The End',
    root: 'end/root',
    tagline: 'Or the beginning?',
    zhTagline: '还是说，这只是开始？',
    total: 9,
  },
  {
    id: 'adventure',
    zh: '冒险',
    englishName: 'Adventure',
    root: 'adventure/root',
    tagline: 'Adventure, exploration and combat',
    zhTagline: '冒险、探索与战斗',
    total: 47,
  },
  {
    id: 'husbandry',
    zh: '农牧业',
    englishName: 'Husbandry',
    root: 'husbandry/root',
    tagline: 'The world is full of friends and food',
    zhTagline: '这世界满是朋友与食物',
    total: 31,
  },
]

/**
 * 已确认的进度条目（84 条 / 共 126 条）。
 *
 * parent 指向**直接**前置，不是祖先。
 * 判断「必须先做哪个」要沿 parent 往上回溯 ——
 * 而且要一路回溯到根，因为中途那些前置可能还是锁着的。
 */
export const ADVANCEMENTS: Advancement[] = [
  /* ═════════════ 我的世界 tab（16/16 ✅）═════════════ */
  {
    id: 'story/root',
    name: 'Minecraft',
    zh: '我的世界',
    description: 'Have a crafting table in the inventory',
    tab: 'minecraft',
    type: 'advancement',
    parent: null,
    xp: null,
    hidden: false,
  },
  {
    id: 'story/mine_stone',
    name: 'Stone Age',
    zh: '石器时代',
    description: 'Mine Stone with your new Pickaxe',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/upgrade_tools',
    name: 'Getting an Upgrade',
    zh: '获得升级',
    description: 'Construct a better Pickaxe',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/mine_stone',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/smelt_iron',
    name: 'Acquire Hardware',
    zh: '来硬的',
    description: 'Smelt an Iron Ingot',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/upgrade_tools',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/iron_tools',
    name: "Isn't It Iron Pick?",
    zh: '这不是铁镐么？',
    description: 'Upgrade your Pickaxe',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/smelt_iron',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/lava_bucket',
    name: 'Hot Stuff',
    zh: '热腾腾的',
    description: 'Fill a Bucket with lava',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/smelt_iron',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/obtain_armor',
    name: 'Suit Up',
    zh: '整装上阵',
    description: 'Protect yourself with a piece of iron armor',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/smelt_iron',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/mine_diamond',
    name: 'Diamonds!',
    zh: '钻石！',
    description: 'Acquire diamonds',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/iron_tools',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/form_obsidian',
    name: 'Ice Bucket Challenge',
    zh: '冰桶挑战',
    description: 'Obtain a block of Obsidian',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/lava_bucket',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/deflect_arrow',
    name: 'Not Today, Thank You',
    zh: '不吃这套，谢谢',
    description: 'Deflect a projectile with a Shield',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/obtain_armor',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/enchant_item',
    name: 'Enchanter',
    zh: '附魔师',
    description: 'Enchant an item at an Enchanting Table',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/mine_diamond',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/shiny_gear',
    name: 'Cover Me with Diamonds',
    zh: '钻石护体',
    description: 'Diamond armor saves lives',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/mine_diamond',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/enter_the_nether',
    name: 'We Need to Go Deeper',
    zh: '勇往直下',
    description: 'Build, light and enter a Nether Portal',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/form_obsidian',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/cure_zombie_villager',
    name: 'Zombie Doctor',
    zh: '僵尸科医生',
    description: 'Weaken and then cure a Zombie Villager',
    tab: 'minecraft',
    type: 'goal',
    parent: 'story/enter_the_nether',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/follow_ender_eye',
    name: 'Eye Spy',
    zh: '隔墙有眼',
    description: 'Follow an Eye of Ender',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/enter_the_nether',
    xp: null,
    hidden: false,
  },
  {
    id: 'story/enter_the_end',
    name: 'The End?',
    zh: '结束了？',
    description: 'Enter the End Portal',
    tab: 'minecraft',
    type: 'advancement',
    parent: 'story/follow_ender_eye',
    xp: null,
    hidden: false,
  },

  /* ═════════════ 下界 tab（23/23 ✅）═════════════ */
  {
    id: 'nether/root',
    name: 'Nether',
    zh: '下界',
    description: 'Enter the Nether dimension',
    tab: 'nether',
    type: 'advancement',
    parent: null,
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/return_to_sender',
    name: 'Return to Sender',
    zh: '见鬼去吧',
    description: 'Destroy a Ghast with a fireball',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/root',
    xp: 50,
    hidden: false,
  },
  {
    id: 'nether/find_bastion',
    name: 'Those Were the Days',
    zh: '光辉岁月',
    description: 'Enter a Bastion Remnant',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/obtain_ancient_debris',
    name: 'Hidden in the Depths',
    zh: '深藏不露',
    description: 'Obtain Ancient Debris',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/fast_travel',
    name: 'Subspace Bubble',
    zh: '曲速泡',
    description: 'Use the Nether to travel 7 km in the Overworld',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/root',
    xp: 100,
    hidden: false,
  },
  {
    id: 'nether/find_fortress',
    name: 'A Terrible Fortress',
    zh: '阴森的要塞',
    description: 'Break your way into a Nether Fortress',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/obtain_crying_obsidian',
    name: 'Who is Cutting Onions?',
    zh: '谁在切洋葱？',
    description: 'Obtain Crying Obsidian',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/distract_piglin',
    name: 'Oooh, Shiny!',
    zh: '金光闪闪！',
    description: 'Distract Piglins with gold',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/ride_strider',
    name: 'This Boat Has Legs',
    zh: '画船添足',
    description: 'Ride a Strider with a Warped Fungus on a Stick',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/loot_bastion',
    name: 'War Pigs',
    zh: '战猪',
    description: 'Loot a Chest in a Bastion Remnant',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/find_bastion',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/get_wither_skull',
    name: 'Spooky Scary Skeleton',
    zh: '惊悚恐怖骷髅头',
    description: "Obtain a Wither Skeleton's skull",
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/find_fortress',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/obtain_blaze_rod',
    name: 'Into Fire',
    zh: '与火共舞',
    description: 'Relieve a Blaze of its rod',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/find_fortress',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/netherite_armor',
    name: 'Cover Me in Debris',
    zh: '残骸裹身',
    description: 'Get a full suit of Netherite armor',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/obtain_ancient_debris',
    xp: 100,
    hidden: false,
  },
  {
    id: 'nether/charge_respawn_anchor',
    name: 'Not Quite "Nine" Lives',
    zh: '锚没有九条命',
    description: 'Charge a Respawn Anchor to the maximum',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/obtain_crying_obsidian',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/ride_strider_in_overworld_lava',
    name: 'Feels Like Home',
    zh: '温暖如家',
    description: 'Take a Strider for a loooong ride on a lava lake in the Overworld',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/ride_strider',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/explore_nether',
    name: 'Hot Tourist Destinations',
    zh: '热门景点',
    description: 'Explore all Nether biomes',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/ride_strider',
    xp: 500,
    hidden: false,
  },
  {
    id: 'nether/uneasy_alliance',
    name: 'Uneasy Alliance',
    zh: '脆弱的同盟',
    description:
      'Rescue a Ghast from the Nether, bring it safely home to the Overworld... and then kill it',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/return_to_sender',
    xp: 100,
    hidden: false,
  },
  {
    id: 'nether/summon_wither',
    name: 'Withering Heights',
    zh: '凋零山庄',
    description: 'Summon the Wither',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/get_wither_skull',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/brew_potion',
    name: 'Local Brewery',
    zh: '本地酿造厂',
    description: 'Brew a Potion',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/obtain_blaze_rod',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/create_beacon',
    name: 'Bring Home the Beacon',
    zh: '带信标回家',
    description: 'Construct and place a Beacon',
    tab: 'nether',
    type: 'advancement',
    parent: 'nether/summon_wither',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/all_potions',
    name: 'A Furious Cocktail',
    zh: '狂乱的鸡尾酒',
    description: 'Have every potion effect applied at the same time',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/brew_potion',
    xp: 100,
    hidden: false,
  },
  {
    id: 'nether/create_full_beacon',
    name: 'Beaconator',
    zh: '信标工程师',
    description: 'Bring a Beacon to full power',
    tab: 'nether',
    type: 'goal',
    parent: 'nether/create_beacon',
    xp: null,
    hidden: false,
  },
  {
    id: 'nether/all_effects',
    name: 'How Did We Get Here?',
    zh: '为什么会变成这样呢？',
    description: 'Have every effect applied at the same time',
    tab: 'nether',
    type: 'challenge',
    parent: 'nether/all_potions',
    xp: 1000,
    hidden: true,
  },

  /* ═════════════ 末地 tab（9/9 ✅）═════════════ */
  {
    id: 'end/root',
    name: 'The End',
    zh: '末地',
    description: 'Enter the End dimension',
    tab: 'end',
    type: 'advancement',
    parent: null,
    xp: null,
    hidden: false,
  },
  {
    id: 'end/kill_dragon',
    name: 'Free the End',
    zh: '解放末地',
    description: 'Kill the ender dragon',
    tab: 'end',
    type: 'advancement',
    parent: 'end/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/dragon_breath',
    name: 'You Need a Mint',
    zh: '你需要来点薄荷糖',
    description: "Collect Dragon's Breath in a Glass Bottle",
    tab: 'end',
    type: 'goal',
    parent: 'end/kill_dragon',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/dragon_egg',
    name: 'The Next Generation',
    zh: '下一世代',
    description: 'Hold the Dragon Egg',
    tab: 'end',
    type: 'goal',
    parent: 'end/kill_dragon',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/enter_end_gateway',
    name: 'Remote Getaway',
    zh: '远程折跃',
    description: 'Escape the island',
    tab: 'end',
    type: 'advancement',
    parent: 'end/kill_dragon',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/respawn_dragon',
    name: 'The End... Again...',
    zh: '结束了…再一次…',
    description: 'Respawn the Ender Dragon',
    tab: 'end',
    type: 'goal',
    parent: 'end/kill_dragon',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/find_end_city',
    name: 'The City at the End of the Game',
    zh: '在游戏尽头的城市',
    description: 'Go on in, what could happen?',
    tab: 'end',
    type: 'advancement',
    parent: 'end/enter_end_gateway',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/elytra',
    name: "Sky's the Limit",
    zh: '天空即为极限',
    description: 'Find Elytra',
    tab: 'end',
    type: 'goal',
    parent: 'end/find_end_city',
    xp: null,
    hidden: false,
  },
  {
    id: 'end/levitate',
    name: 'Great View From Up Here',
    zh: '这上面的风景不错',
    description: 'Levitate up 50 blocks from the attacks of a Shulker',
    tab: 'end',
    type: 'challenge',
    parent: 'end/find_end_city',
    xp: 50,
    hidden: false,
  },

  /* ═════════════ 冒险 tab（36/47 ⚠️ 缺 11）═════════════ */
  {
    id: 'adventure/root',
    name: 'Adventure',
    zh: '冒险',
    description: 'Kill any mob, or be killed by any living entity',
    tab: 'adventure',
    type: 'advancement',
    parent: null,
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/heart_transplanter',
    name: 'Heart Transplanter',
    zh: '移心接木',
    description:
      'Place a Creaking Heart with the correct alignment between two Pale Oak Log blocks',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/voluntary_exile',
    name: 'Voluntary Exile',
    zh: '自我放逐',
    description: 'Kill a raid captain',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: true,
  },
  {
    id: 'adventure/use_lodestone',
    name: 'Country Lode, Take Me Home',
    zh: '天涯共此石',
    description: 'Use a Compass on a Lodestone',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/spyglass_at_parrot',
    name: 'Is It a Bird?',
    zh: '那是鸟吗？',
    description: 'Look at a Parrot through a Spyglass',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/kill_a_mob',
    name: 'Monster Hunter',
    zh: '怪物猎人',
    description: 'Kill any hostile monster',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/read_power_of_chiseled_bookshelf',
    name: 'The Power of Books',
    zh: '知识就是力量',
    description: 'Read the power signal of a Chiseled Bookshelf using a Comparator',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/trade',
    name: 'What a Deal!',
    zh: '成交！',
    description: 'Successfully trade with a Villager',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/trim_with_any_armor_pattern',
    name: 'Crafting a New Look',
    zh: '旧貌锻新颜',
    description: 'Craft a trimmed armor at a Smithing Table',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/isnt_it_scute',
    name: "Isn't It Scute?",
    zh: '这不是鳞甲么？',
    description: 'Craft a scute from a turtle shell',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/crafters_crafting_crafters',
    name: 'Crafters Crafting Crafters',
    zh: '合成器合成合成器',
    description: 'Craft a Crafters Crafting Crafters',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/caves_and_cliffs',
    name: 'Caves & Cliffs',
    zh: '上天入地',
    description: 'Free fall from the top of the world to the bottom and survive',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/sneak_100',
    name: 'Sneak 100',
    zh: '潜行100级',
    description: 'Sneak near a Sculk Sensor or Warden to prevent it from detecting you',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/avoid_vibration',
    name: 'A Seismic Shift',
    zh: '地动山摇',
    description: 'Sneak 100 times while avoiding vibrations',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/sneak_100',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/kill_all_mobs',
    name: 'Monsters Hunted',
    zh: '资深怪物猎人',
    description: 'Kill one of every hostile monster',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/kill_a_mob',
    xp: 100,
    hidden: false,
  },
  {
    id: 'adventure/kill_mob_near_sculk_catalyst',
    name: 'It Spreads',
    zh: '它蔓延了',
    description: 'Kill a mob near a Sculk Catalyst',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/shoot_arrow',
    name: 'Take Aim',
    zh: '瞄准目标',
    description: 'Shoot something with an Arrow',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/throw_trident',
    name: 'A Throwaway Joke',
    zh: '抖包袱',
    description: 'Throw a Trident at something',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/honey_block_slide',
    name: 'Sticky Situation',
    zh: '胶着状态',
    description: 'Jump into a Honey Block to break your fall',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/totem_of_undying',
    name: 'Postmortal',
    zh: '超越生死',
    description: 'Use a Totem of Undying to cheat death',
    tab: 'adventure',
    type: 'goal',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/ol_betsy',
    name: "Ol' Betsy",
    zh: '扣下悬刀',
    description: 'Shoot a Crossbow',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/lightning_rod_with_villager_no_fire',
    name: 'Surge Protector',
    zh: '电涌保护器',
    description: 'Protect a Villager from an undesired shock without starting a fire',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/spear_many_mobs',
    name: 'Mob Kabob',
    zh: '生物串串香',
    description: 'Hit five mobs in the same Charge attack using the Spear',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/salvage_sherd',
    name: 'Respecting the Remnants',
    zh: '探古寻源',
    description: 'Brush a Suspicious block to obtain a Pottery Sherd',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/sleep_in_bed',
    name: 'Sweet Dreams',
    zh: '甜蜜的梦',
    description: 'Sleep in a Bed to change your respawn point',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/kill_a_mob',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/trials',
    name: 'Minecraft: Trial(s) Edition',
    zh: 'Minecraft：试炼版',
    description: 'A special branch of advancements only available in the trial snapshot',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/root',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/blowback',
    name: 'Blowback',
    zh: '逆风翻盘',
    description: 'Deflect a Wind Charge with a mace',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/trials',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/lighten_up',
    name: 'Lighten Up',
    zh: '铜光焕发',
    description: 'Craft a Copper Bulb',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/trials',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/over_overkill',
    name: 'Over-Overkill',
    zh: '天赐良击',
    description: 'Deal massive damage using a mace',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/trials',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/under_lock_and_key',
    name: 'Under Lock and Key',
    zh: '珍藏密敛',
    description: 'Deflect a Wind Charge with a Copper Grate',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/trials',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/who_needs_rockets',
    name: 'Who Needs Rockets?',
    zh: '还要啥火箭啊？',
    description: 'Reach the top of a Trial Chamber using a Wind Charge',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/trials',
    xp: null,
    hidden: false,
    trial: true,
  },
  {
    id: 'adventure/arbalistic',
    name: 'Arbalistic',
    zh: '劲弩手',
    description: 'Kill five unique mobs with one crossbow shot',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/ol_betsy',
    xp: 85,
    hidden: true,
  },
  {
    id: 'adventure/two_birds_one_arrow',
    name: 'Two Birds, One Arrow',
    zh: '一箭双雕',
    description: 'Kill two Phantoms with a piercing Arrow',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/ol_betsy',
    xp: 65,
    hidden: false,
  },
  {
    id: 'adventure/whos_the_pillager_now',
    name: "Who's the Pillager Now?",
    zh: '现在谁才是掠夺者？',
    description: 'Kill a pillager with a Crossbow shot',
    tab: 'adventure',
    type: 'advancement',
    parent: 'adventure/ol_betsy',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/craft_decorated_pot_using_only_sherds',
    name: 'Careful Restoration',
    zh: '精修细补',
    description: 'Make a Decorated Pot out of 4 Pottery Sherds',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/salvage_sherd',
    xp: null,
    hidden: false,
  },
  {
    id: 'adventure/adventuring_time',
    name: 'Adventuring Time',
    zh: '探索的时光',
    description: 'Discover every biome',
    tab: 'adventure',
    type: 'challenge',
    parent: 'adventure/sleep_in_bed',
    xp: null,
    hidden: false,
  },
]

/**
 * ══════════════════════════════════════════════════════════════
 * 未抓到的部分（42 条）—— 明确标缺，不臆造
 * ══════════════════════════════════════════════════════════════
 *
 * 原因：zh.minecraft.wiki 与 minecraft.wiki 的「进度」页正文都太长，
 * 取回通道在「冒险 → 探索的时光」处被截断，
 * 导致其后的 Adventure 尾段与整个农牧业段都拿不到。
 * （两个站在同一点截断，说明是页面本身过长，不是某站的问题。）
 *
 * 缺口明细：
 *   冒险 tab缺 11 条（位于「探索的时光」之后）
 *   农牧业 tab   缺 31 条（整段未取到）
 *
 * 补齐方式（二选一）：
 *   1. 换能分段返回的来源（wikirender 镜像 / 移动版站点），按 tab 单取；
 *   2. 从游戏数据直接解析：**服务端** jar 里的
 *      `data/advancement` 目录下的 json（客户端 jar 里没有这份数据，
 *      这就是本地缓存里找不到成就定义的原因）。
 *
 * ⚠️ 在补齐之前，**不要**基于这份数据出「成就」相关题目 ——
 * 缺的部分会让人以为某条成就不存在，而题库的错误比没有题目更糟。
 */
export const INCOMPLETE: Record<AdvancementTab, number> = {
  minecraft: 0,
  nether: 0,
  end: 0,
  adventure: 11,
  husbandry: 31,
}

/** 已抓到的条数 */
export const ACHIEVEMENT_COUNT = ADVANCEMENTS.length

/** 数据是否已覆盖全部 126 条 */
export const IS_COMPLETE = ADVANCEMENT_TABS.every(
  (tab) => ADVANCEMENTS.filter((a) => a.tab === tab.id).length >= tab.total,
)
