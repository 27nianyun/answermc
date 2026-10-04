/**
 * 冷门题库（tier: obscure）—— 极限难度专用。
 *
 * 简单 / 中等难度不会抽到这里，只有 hardcore 才会。
 * 这批题的共同点是「反直觉」：读起来像是 bug，或者是官方 Jira 上挂着编号的未修复问题。
 *
 * 来源分三档，用 confidence 如实标注，不含糊：
 *   - data       来自 Minecraft 官方数据（client.jar / minecraft-data），最硬
 *   - confirmed  来自 bugs.mojang.com（Atlassian Jira），官方已标 Confirmed / Community Consensus
 *   - reported   社区实测（中文 UP 主选题 + Minecraft Wiki 交叉验证），未逐帧核实
 *
 * version 字段是硬性要求，每题都要能回答「这事在哪个版本成立」。
 */

export const QUIZ_SOURCE = {
  /**
   * 撰写题库时 Minecraft Java 版的最新正式版。
   * 与 dataVersion 区分：项目图鉴数据是 26.1 提取的，但版本知识以最新正式版为准。
   */
  latestRelease: '26.3',
  latestReleaseName: 'Wilderness Bound',
  latestReleaseDate: '2026-09-15',
  /** bugs.mojang.com 是 Atlassian Jira，不是 YouTrack，2025-02-07 从 Jira Server 迁到 Jira Cloud */
  bugTracker: 'Atlassian Jira',
}

export const OBSCURE_QUESTIONS = [
  // ============ 一、官方已确认的未修复 Bug（bugs.mojang.com）============
  {
    id: 'bug-312095-villager-stair-shelf',
    topic: '村民 / 寻路',
    prompt: '把村民困在「往上一格楼梯 + 书架 + 往下一格楼梯」这个组合里，会发生什么？',
    options: [
      '村民会自己把书架打掉再出来',
      '村民彻底卡死，完全无法移动',
      '村民会拆掉楼梯并重新寻路',
      '村民会跳上书架逃走',
    ],
    answerIndex: 1,
    version: { since: '26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-312095（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-312095',
      confidence: 'confirmed',
    },
    explanation:
      '这是寻路算法在窄缝里判断失误：村民认为这个位置有可通行的路径，结果被自己的碰撞箱卡住，既进不去也退不出来。楼梯 + 书架的组合是社区里最稳定的复现方式。',
  },
  {
    id: 'bug-301047-calibrated-sculk-dirt',
    topic: '幽匿 / 红石',
    prompt: '校频幽匿传感器侦测「泥土被转化并放置成泥」时，读数是多少？',
    options: ['11', '12', '13', '15'],
    answerIndex: 2,
    version: { since: '1.21.8 / 25w34a', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-301047（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-301047',
      confidence: 'confirmed',
    },
    explanation:
      '泥不是「新放置的方块」，理论上不该被侦测到。但校频幽匿传感器把泥土→泥当成了一次放置，给出 13 —— 超过方块状态变化应有的 11。所以它可以拿来当方块存在检测器用。',
  },
  {
    id: 'bug-301047-sculk-spread',
    topic: '幽匿 / 蔓延',
    prompt: '校频幽匿传感器对苔藓、苍白苔藓、幽匿蔓延这三种生长，究竟算不算信号？',
    options: [
      '三种都算，强度 15',
      '一种都不算，两种蔓延强度都检测不到',
      '只有苔藓算',
      '算，但强度统一是 3',
    ],
    answerIndex: 1,
    version: { since: '1.21.8 / 25w34a', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-301047（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-301047',
      confidence: 'confirmed',
    },
    explanation:
      '蔓延类生长既不算「新放置方块」也不算「方块状态变化」，两种蔓延信号强度都测不到。想用幽匿监测生长，得靠方块被破坏时的音信号。',
  },
  {
    id: 'bug-306671-unemployed-villager-job-steal',
    topic: '村民 / 职业',
    prompt: '一个无业村民和一个已在工作站上班的村民待在同一个工作站范围内，会发生什么？',
    options: [
      '无业村民会等待，永远抢不到',
      '无业村民会随机占用那个已被锁定的工作站，自己转职',
      '两者共享同一个职业栏位',
      '已上班的村民会被踢出工作站',
    ],
    answerIndex: 1,
    version: { since: '1.21.11', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-306671（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-306671',
      confidence: 'confirmed',
    },
    explanation:
      '工作站「已被锁定」这个状态对无业村民不生效，所以他会随机占用并转职。想造纯村民农场，得让竞争者进不来工作站的触及范围。',
  },
  {
    id: 'bug-300056-observer-bookshelf',
    topic: '红石 / 侦测器',
    prompt: '侦测器（Observer）能不能侦测到书架上被放入或取下物品？',
    options: [
      '能，放和取都会发出红石信号',
      '不能，侦测器完全无视书架上的物品变化',
      '只能侦测取下，放置不行',
      '只有 1.21.9 之前能，之后被移除',
    ],
    answerIndex: 1,
    version: { since: '25w31a / 1.21.9', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-300056（Community Consensus，5 票）',
      url: 'https://bugs.mojang.com/browse/MC-300056',
      confidence: 'confirmed',
    },
    explanation:
      '侦测器判定方块状态变化，而书架容器里的物品不算方块状态。在 1.21.9 到 26.3 都能稳定复现，用书架当物品检测器是行不通的。',
  },
  {
    id: 'bug-298579-tnt-weight-signal',
    topic: '红石 / 砝秤',
    prompt: '多个 TNT 实体在同一个 tick 内先后经过轻质砝秤或重质砝秤，输出信号强度是多少？',
    options: ['1', '按 TNT 数量累加', '按 TNT 数量取最大值', '15'],
    answerIndex: 0,
    version: { since: '1.21.5 / 25w32a', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-298579（Reopened + Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-298579',
      confidence: 'confirmed',
    },
    explanation:
      '同一个 tick 里只有第一个经过的 TNT 会触发强度计算，后面的直接被忽略。所以 TNT 连环殉爆时砝秤读数会「漏算」，这是个已重新打开的老问题。',
  },
  {
    id: 'bug-312042-shulker-crawl',
    topic: '潜影贝',
    prompt: '潜影贝在什么情况下会突然开始匍匐前进（朝玩家方向缓慢爬）？',
    options: [
      '永远不会匍匐，只有被攻击时才动',
      '离地只有一格高的特定坐标上可以开始匍匐前进',
      '只要天黑就会匍匐',
      '在水面以下会匍匐',
    ],
    answerIndex: 1,
    version: { since: '26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-312042（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-312042',
      confidence: 'confirmed',
    },
    explanation:
      '潜影贝的匍匐移动本该要求脚下有足够空间，但在离地一格高的特定坐标上判定会失效，它会朝玩家方向挪动。搭防御时要留意这类缝隙。',
  },
  {
    id: 'bug-311944-loyalty-trident-pressure-plate',
    topic: '三叉戟 / 绊线',
    prompt: '带忠诚（Loyalty）附魔的三叉戟自动飞回玩家手中时，会不会触发地面上的压力板和绊线？',
    options: [
      '会，和普通箭一样触发',
      '不会，忠诚返回的三叉戟被判定为「无来源投射物」',
      '只有重掷附魔时才会触发',
      '只在鞘翅滑翔时触发',
    ],
    answerIndex: 1,
    version: { since: '26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311944（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-311944',
      confidence: 'confirmed',
    },
    explanation:
      '压力板与绊线依赖投射物有「投掷者」信息。忠诚三叉戟是沿原路飞回的程序性回程，没有投掷者，所以完全不触发。同理，忠诚返回的武器也穿不过自己的陷阱。',
  },
  {
    id: 'bug-305640-phantom-deep-dark',
    topic: '幻翼 / 世界生成',
    prompt: '幻翼（Phantom）能不能在深暗之域（deep dark）里生成？',
    options: [
      '不能，深暗之域天空太暗，幻翼只在海平面上方生成',
      '能，深暗之域的生成条件同样满足幻翼的生成判定',
      '能，但只生成不攻击玩家',
      '只有在雷暴天才会生成',
    ],
    answerIndex: 1,
    version: { since: '1.21.11 / 26.1-Snapshot 2', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305640（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-305640',
      confidence: 'confirmed',
    },
    explanation:
      '幻翼的生成判定是「玩家在 24 格内 + 离海平面高度 + 随机数判定」，深暗之域并不在排除列表里。所以用深暗之域当「绝对安全的刷怪塔」是不成立的。',
  },
  {
    id: 'bug-310401-phantom-wall-attack',
    topic: '幻翼 / 寻路',
    prompt: '幻翼能不能隔着一堵墙或墙角打到玩家？',
    options: [
      '能，幻翼的攻击判定会穿透墙角',
      '不能，幻翼必须要有直视路线',
      '只有在鞘翅状态下可以',
      '只在夜晚可以',
    ],
    answerIndex: 0,
    version: { since: '26.2', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-310401（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-310401',
      confidence: 'confirmed',
    },
    explanation:
      '幻翼的攻击是范围判定而非射线判定，中间有方块也照样吃到伤害。26.2 就能复现，1 格厚的墙挡不住幻翼的俯冲。',
  },
  {
    id: 'bug-305630-skeleton-horse-spawn',
    topic: '生物生成 / 骷髅马',
    prompt: '骷髅马能在蘑菇岛和深暗之域生成吗？',
    options: [
      '不能，骷髅马只生成在平原、沼泽等有草的生物群系',
      '能，判定只看天上会不会下雨，不看地表',
      '能，但只会生成被闪电劈中的变种个体',
      '能，但每批生成的数量上限会减半',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305630（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-305630',
      confidence: 'confirmed',
    },
    explanation:
      '骷髅马的生成条件是「生物群系湿度 + 天空可见度（会不会下雨）」，并不检查地表方块。所以蘑菇岛、深暗之域这些一根草都没有的地方照样刷。',
  },
  {
    id: 'bug-263712-minecart-through-block',
    topic: '矿车 / 机制',
    prompt: '矿车刚放上铁轨就立刻下车，会发生什么？',
    options: [
      '正常下车，站在铁轨旁',
      '会被直接卡进方块里穿过去',
      '矿车会消失',
      '下车时会被弹飞',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-263712（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-263712',
      confidence: 'confirmed',
    },
    explanation:
      '在红石块加动力铁轨这类特定结构下，矿车的载客同步与方块位置更新不同步，玩家会被塞进方块内部穿过去。老问题，至今仍在。',
  },
  {
    id: 'bug-299937-minecart-nether-portal',
    topic: '矿车 / 下界传送门',
    prompt: '乘矿车穿过下界传送门，为什么有时会被卡住窒息？',
    options: [
      '因为矿车穿过门框时会被判定为掉落物',
      '因为骑乘坐标在传送时错位一格，短暂卡进石头',
      '因为下界传送门会直接销毁这辆矿车',
      '因为穿过去会直接掉进下界岩浆里',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-299937（Reopened + Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-299937',
      confidence: 'confirmed',
    },
    explanation:
      '传送时玩家的位置被传送门方块替换，矿车乘客的坐标同步慢一 tick，那一 tick 里玩家可能被判定为在实心方块内，掉血直到被挤出来。',
  },
  {
    id: 'bug-276104-minecart-push-portal',
    topic: '矿车 / 下界传送门',
    prompt: '把矿车群推离下界传送门，会发生什么？',
    options: [
      '只有矿车被传送，玩家不受影响',
      '连玩家一起被传送',
      '矿车被卡在传送门里无法移动',
      '传送门会失效',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-276104（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-276104',
      confidence: 'confirmed',
    },
    explanation:
      '推矿车时玩家被判定为「正在骑乘」，于是被一起传送。做自动化矿车系统时要注意，别在传送门旁边推车。',
  },
  {
    id: 'bug-275928-minecart-slope-clip',
    topic: '矿车 / 机制',
    prompt: '矿车在斜坡轨道上高速移动时会出现什么穿模问题？',
    options: [
      '会穿过轨道下方的方块',
      '矿车会脱轨飞出去',
      '矿车速度会突然变成 0',
      '不会有问题，斜坡已被修复',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-275928（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-275928',
      confidence: 'confirmed',
    },
    explanation:
      '矿车的碰撞箱在斜坡上与轨道方块的判定不同步，高速时会短暂穿过下方方块。老 bug，一直没修。',
  },
  {
    id: 'bug-273271-boat-through-ceiling',
    topic: '船 / 下界',
    prompt: '在下界顶部用船载着玩家穿行，会发生什么？',
    options: [
      '什么都不会发生，照常前进',
      '玩家会被塞进方块，穿过下界天花板',
      '船在下界会完全无法移动',
      '船会立刻燃烧起来',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-273271（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-273271',
      confidence: 'confirmed',
    },
    explanation:
      '船的载客位置在世界边界附近不再被完整校验，可以借此穿出下界顶部或底部建筑。这是卡在基岩版 / 逃逸玩法里的老把戏。',
  },
  {
    id: 'bug-279328-ice-sneak-jitter',
    topic: '冰 / 移动',
    prompt: '站在冰块边缘潜行时会出现什么现象？',
    options: [
      '会卡在冰块里',
      '位置会轻微抖动、反复闪烁',
      '潜行速度变快',
      '冰块会碎',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.2 仍存在' },
    source: {
      type: 'mojang-bug',
      label: 'MC-279328（26.2 仍存在）',
      url: 'https://bugs.mojang.com/browse/MC-279328',
      confidence: 'confirmed',
    },
    explanation:
      '冰面摩擦力把玩家往边缘推，潜行又要贴住方块边界，两者每 tick 互相拉扯，表现为位置抖动。到 26.2 还没修。',
  },
  {
    id: 'bug-309814-redstone-ore-stuck-lit',
    topic: '红石 / 网络',
    prompt: '踩碎红石矿石后，在网络不稳定的情况下可能出现什么后果？',
    options: [
      '红石矿石永久保持点亮状态',
      '红石矿石掉落不了',
      '红石矿石会变成普通石头',
      '踩上去不会有任何效果',
    ],
    answerIndex: 0,
    version: { since: '26.2 / 26.3 Snapshot 3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-309814（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-309814',
      confidence: 'confirmed',
    },
    explanation:
      '红石矿石是唯一一个「客户端能触发方块状态更新、却不通知服务端」的方块。网络丢包时客户端点亮后一直没收到服务端的熄灭包，就永久亮了。',
  },
  {
    id: 'bug-305940-looping-command-block',
    topic: '命令方块',
    prompt: '把一个循环命令方块从「始终激活」改成「需要红石」时，会发生什么？',
    options: [
      '立即停止执行',
      '会多执行一次',
      '命令方块会损坏',
      '条件变成取反',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305940（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-305940',
      confidence: 'confirmed',
    },
    explanation:
      '切换激活方式的那一 tick，旧状态与新状态各触发一次，于是命令多跑一遍。做一次性逻辑时容易踩。',
  },
  {
    id: 'bug-278984-piston-world-edge-fluid',
    topic: '活塞 / 世界边界',
    prompt: '活塞为什么无法摧毁位于世界最顶部或最底部的流体？',
    options: [
      '活塞碰到世界边界会直接损坏',
      '边界处的流体不在活塞的可摧毁范围内',
      '活塞只能推动方块，不能推动流体',
      '流体在边界处会变成固体',
    ],
    answerIndex: 1,
    version: { since: '1.21.4', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-278984（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-278984',
      confidence: 'confirmed',
    },
    explanation:
      '活塞摧毁方块时会做一次坐标合法性校验，世界顶部 / 底部之外的位置被判定为无效，于是流体积水层就清不掉。',
  },
  {
    id: 'bug-307134-piston-rail-ghost-block',
    topic: '活塞 / 幽灵方块',
    prompt: '活塞推动铁轨或珊瑚时，会连带造出什么？',
    options: [
      '什么都不会发生',
      '连同支撑方块一起造出来，形成幽灵方块',
      '铁轨会被弹成掉落物',
      '旁边的珊瑚会变成海藻',
    ],
    answerIndex: 1,
    version: { since: '26.1', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-307134（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-307134',
      confidence: 'confirmed',
    },
    explanation:
      '铁轨、珊瑚这类方块的放置会同时更新支撑方块。活塞推动时这一步被算进了移动逻辑，于是支撑方块也「跟着搬」，凭空出现不正常的方块结构。26.1 就能复现。',
  },
  {
    id: 'bug-304562-rabbit-bookshelf',
    topic: '兔子 / 机制',
    prompt: '兔子会卡进书架的缝隙里吗？',
    options: ['不会，兔子太小钻不进去', '会', '只有白色的兔子会', '只有跳起来的兔子会'],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-304562（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-304562',
      confidence: 'confirmed',
    },
    explanation:
      '兔子的寻路偶尔会钻进书架中缝然后出不来，做兔子农场时要留意栅栏和书架的组合。',
  },
  {
    id: 'bug-311945-wind-charge-dupe',
    topic: '风弹 / 机制',
    prompt: '风弹（Wind Charge）可以被复制或重置位置吗？',
    options: [
      '不能，风弹是唯一不可复制的投射物',
      '可以，通过特定的操作能复制或把它的位置重置',
      '只能在鞘翅状态下复制',
      '只能在潜影盒旁边复制',
    ],
    answerIndex: 1,
    version: { since: '26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311945（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-311945',
      confidence: 'confirmed',
    },
    explanation:
      '风弹是 26.x 新增的投射物，位置同步逻辑存在漏洞，特定操作下能复制或重置坐标。官方已确认，到 26.3 仍在。',
  },
  {
    id: 'bug-310398-world-border-chunk-pop',
    topic: '世界边界',
    prompt: '世界边界收缩时，边界是怎么出现的？',
    options: [
      '整面淡入淡出，一格一格平滑推',
      '逐区块「弹出」，一整块一整块地跳出来',
      '从天空往下扫描式出现',
      '边界只在夜间可见',
    ],
    answerIndex: 1,
    version: { since: '26.2 / 26.3 Snapshot 5', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-310398（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-310398',
      confidence: 'confirmed',
    },
    explanation:
      '边界的渲染是按区块推送的，所以看起来是「弹」出来的而不是连续淡入。高速移动时能清楚看到一格一格地跳。',
  },
  {
    id: 'bug-312177-village-floating-house',
    topic: '村庄 / 世界生成',
    prompt: '村庄里的房屋会不会生成成悬空一格？',
    options: [
      '不会，村庄结构生成时会做地面整平',
      '会，偶尔出现整体悬空一格的房屋',
      '只会生成在沼泽里',
      '只有超平坦世界才会',
    ],
    answerIndex: 1,
    version: { since: '26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-312177（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-312177',
      confidence: 'confirmed',
    },
    explanation:
      '村庄结构在放置时会因为地形整平判定漏掉某些地形而出现悬空。这是偶发问题，26.3 仍能遇到。',
  },
  {
    id: 'bug-309063-village-path-lava-lake',
    topic: '村庄 / 世界生成',
    prompt: '村庄小径有可能直接生成在熔岩湖上吗？',
    options: [
      '不会，小径只铺在草方块和土上',
      '会，在特定种子下会',
      '会，但会替换成石头',
      '只在下界可能',
    ],
    answerIndex: 1,
    version: { since: '26.2 / 26.3 Snapshot 1', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-309063（Confirmed，种子 -2862297161333106401）',
      url: 'https://bugs.mojang.com/browse/MC-309063',
      confidence: 'confirmed',
    },
    explanation:
      '结构放置时不会重新校验地表是否被岩浆覆盖，官方报告里直接给出了可复现的种子。遇到这种地形村庄会泡在岩浆里。',
  },
  {
    id: 'bug-310673-flatworld-village-missing',
    topic: '村庄 / 世界生成',
    prompt: '在超平坦世界里，沙漠村庄的鞣制坊之类结构为什么经常生成不出来？',
    options: [
      '超平坦世界不允许生成村庄',
      '结构放置时找不到可用的地表高度，判定失败直接跳过',
      '沙漠村庄只能生成在丛林里',
      '需要玩家放置工作台才会生成',
    ],
    answerIndex: 1,
    version: { since: '26.2 / 26.3', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-310673 / MC-309531 / MC-309529（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-310673',
      confidence: 'confirmed',
    },
    explanation:
      '超平坦世界的地表高度全一样，结构的「找一块平地放下模板」判定会失败，于是鞣制坊、大型农场这类需要地形的部分整段被跳过。26.2 起多次被报告。',
  },
  {
    id: 'bug-209547-llama-suffocation',
    topic: '羊驼 / 骑乘',
    prompt: '羊驼为什么有时会「骑着」玩家把玩家挤到墙里窒息？',
    options: [
      '羊驼的骑乘位置偏移，靠近墙时把玩家卡进方块',
      '羊驼会主动把玩家推进水里',
      '羊驼的碰撞箱会周期性膨胀',
      '这是羊驼的攻击方式',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-209547（Confirmed）',
      url: 'https://bugs.mojang.com/browse/MC-209547',
      confidence: 'confirmed',
    },
    explanation:
      '骑乘时坐骑会把乘客推到自己的骑乘坐标，靠近墙壁时那个坐标正好在实心方块里，于是玩家被判卡住掉血。',
  },
  // ============ 二、已修复 Bug —— 反向用作「哪个说法已经过时」============
  {
    id: 'fixed-295756-piston-desync',
    topic: '活塞 / 同步',
    prompt: '在现在的正式版里，活塞在客户端和服务端之间还会出现不同步吗？',
    options: [
      '还会，26.3 依旧不同步',
      '不会了，这个活塞不同步问题已被修复',
      '只有单向活塞会不同步',
      '只在鞘翅滑翔时不同步',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '已修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-295756（已修复）',
      url: 'https://bugs.mojang.com/browse/MC-295756',
      confidence: 'confirmed',
    },
    explanation:
      '「活塞推方块时客户端与服务端状态不同步」曾经是老视频常客，但现在已经被修掉了。这类说法放到今天的版本上就是过时信息。',
  },
  {
    id: 'fixed-305535-lava-elytra',
    topic: '鞘翅 / 熔岩',
    prompt: '在熔岩里轻点跳跃键，能激活鞘翅起飞吗？',
    options: [
      '能，老技巧还在',
      '不能，这个技巧已经被修掉了',
      '只能在岩浆湖最底层才行',
      '需要同时按 Shift',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.3 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305535（26.3 修复）',
      url: 'https://bugs.mojang.com/browse/MC-305535',
      confidence: 'confirmed',
    },
    explanation:
      '在熔岩中跳跃会触发鞘翅飞行的老技巧已经被修掉。26.3 正式版不再能用。',
  },
  {
    id: 'fixed-265423-villager-multiple-levels',
    topic: '村民 / 经验',
    prompt: '村民一次获得足够的经验值时，会连升几级？',
    options: ['只升一级', '会连升多级', '不会升级', '随机决定'],
    answerIndex: 0,
    version: { since: null, fixedIn: '26.3 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-265423（26.3 修复）',
      url: 'https://bugs.mojang.com/browse/MC-265423',
      confidence: 'confirmed',
    },
    explanation:
      '村民升级逻辑每次只处理一级，一次补满经验也只升一级。26.3 修复了这个问题。',
  },
  {
    id: 'bug-254547-villager-xp-leave',
    topic: '村民 / 经验',
    prompt: '把村民的经验条填满后立刻离开世界，会发生什么？',
    options: [
      '村民正常升级，因为经验已结算',
      '村民不会升级，经验也没了',
      '村民会掉一级',
      '经验会转给旁边的村民',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '已修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-254547（已修复）',
      url: 'https://bugs.mojang.com/browse/MC-254547',
      confidence: 'confirmed',
    },
    explanation:
      '村民升级依赖在线时的经验结算，区块卸载时那份经验直接丢失。刷等级的老办法，早就被修掉了。',
  },
  {
    id: 'bug-256096-pvp-team-damage',
    topic: 'PVP / 友伤',
    prompt: '在关闭「友伤」（PVP）的服务器上，部分实体还会伤害队友吗？',
    options: [
      '不会，关闭友伤是完全彻底的',
      '会，仍有一部分实体的伤害判定没被屏蔽',
      '只有烟花火箭才会造成伤害',
      '只有鞘翅飞行时才会造成伤害',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '已修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-256096（已修复）',
      url: 'https://bugs.mojang.com/browse/MC-256096',
      confidence: 'confirmed',
    },
    explanation:
      '友伤关闭时确实有一批实体的伤害路径漏掉了屏蔽判断。这条已修复，但「关掉就一定安全」的印象是那时候留下的。',
  },
  // ============ 三、中文 UP 主选题 + Wiki 交叉验证（社区实测）============
  {
    id: 'up-fatigue-level-3-bug',
    topic: '效率 / 挖掘疲劳',
    prompt: '挖掘疲劳 III 级对挖掘速度的影响，正确说法是哪一个？',
    options: [
      '每个等级直接把挖掘速度乘以 0.3',
      '26.3 快照前有个数值 bug，把系数按 0.3 连乘三次',
      '挖掘疲劳不影响速度，只影响耐力上限',
      '疲劳 III 级会让挖掘速度变成负数',
    ],
    answerIndex: 1,
    version: { since: '26.3 Snapshot 3 修复', fixedIn: '26.3 Snapshot 3', verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《以防你不知道！MC 的挖掘疲劳数值其实是一个离谱 BUG?!》BV1LEhU6VEEC',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '疲劳系数本该线性叠加，但实现里写成了逐级连乘，导致 III 级实际是 0.3³ 而非 0.3。这个数值 bug 直到 26.3 快照 3 才修。',
  },
  {
    id: 'up-iron-golem-summon-conditions',
    topic: '铁傀儡 / 机制',
    prompt: '在 26.x 版本里，铁傀儡的召唤条件是什么？',
    options: [
      '沿用「10 个村民 + 20 张床」',
      '看村民的社交状态：交头接耳要 5 人，恐慌要 3 人',
      '需要 4 个村民和 3 张床',
      '需要 3 个村民且都不能睡觉',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 最强大的友好生物 铁傀儡究竟有多离谱?!》BV17shn6vETy',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '「10 人 20 床」是 1.20 之前的老规则。改版后召唤看的是村民的社交状态：gossiping 需要 5 个，panicking 只需要 3 个，所以现在反而要小心别让村民一直恐慌。',
  },
  {
    id: 'up-iron-golem-reach-limit',
    topic: '铁傀儡 / 战斗',
    prompt: '铁傀儡的攻击够不到多高的目标？',
    options: [
      '高出它两格以内都打得到',
      '高出它约 2.75 格就完全打不到',
      '必须比它矮才打得到',
      '打它完全没有高度限制',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 最强大的友好生物 铁傀儡究竟有多离谱?!》BV17shn6vETy',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '铁傀儡的攻击判定是方块形状的射线检测，目标高出它约 2.75 格以上就够不着了。站在高台边缘可以安全输出。',
  },
  {
    id: 'up-skeleton-instant-health',
    topic: '骷髅 / 状态效果',
    prompt: '给骷髅使用「生命恢复」或「伤害」药水，结果会怎样？',
    options: [
      '和普通生物一样，生效方向相同',
      '骷髅是亡灵：恢复会伤害它，伤害会治疗它',
      '两种药水对骷髅都无效',
      '只对被削颅的骷髅有效',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的骷髅究竟有多离谱？堪称一生之敌!!》BV1mjaW6hEmL',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '亡灵生物对生命类效果免疫，但「伤害」被实现成反向治疗。所以拿伤害药水喂骷髅，反而是在救它 —— 一手毒奶。',
  },
  {
    id: 'up-skeleton-no-drowning',
    topic: '骷髅 / 水',
    prompt: '骷髅会溺水吗？',
    options: ['会，和普通生物一样会溺水', '不会，骷髅不会溺水', '只有普通骷髅会，尸壳会', '只有戴着头盔时不会'],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的骷髅究竟有多离谱？堪称一生之敌!!》BV1mjaW6hEmL',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '骷髅可以在水下自由行动不会憋死，是水下刷怪塔的常客。凋灵骷髅同样不会溺水。',
  },
  {
    id: 'up-ghast-phantom-blocks',
    topic: '恼鬼 / 虚空',
    prompt: '恼鬼能穿过方块移动，那它会被虚空杀死吗？',
    options: [
      '能穿方块就等于无敌，不会被虚空杀死',
      '会，穿透只对实体方块有效，虚空照样杀死它',
      '只有火系方块能杀死它',
      '它在虚空里会不断重生',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的恼鬼究竟有多恶心?!》BV1q1tG6ME5n',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '恼鬼的移动是「逐格判定碰撞」而不是物理碰撞，所以能钻进方块里；但虚空判定依然生效，掉出世界就没了。',
  },
  {
    id: 'up-ghast-lifetime',
    topic: '恼鬼 / 召唤',
    prompt: '唤魔者召唤出来的恼鬼，和用刷怪蛋 / 自然生成出来的恼鬼，寿命有什么区别？',
    options: [
      '没区别，都不受寿命限制',
      '唤魔者召唤的寿命 30～119 秒，其他无限制',
      '刷怪蛋生成的恼鬼寿命更短',
      '自然生成的恼鬼寿命是 60 秒',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的恼鬼究竟有多恶心?!》BV1q1tG6ME5n',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '唤魔者的召唤逻辑会额外给恼鬼挂上随机寿命（30–119 秒），一到时间就自己消散；而刷怪蛋和自然生成的不走这条逻辑，可以一直留着。',
  },
  {
    id: 'up-raid-bossbar-expired',
    topic: '袭击 / 机制',
    prompt: '袭击进度条显示「Expired」之后，袭击者会消失吗？',
    options: [
      '会，进度条过期就等于袭击结束',
      '不会，判过期后袭击者不消失，仍会继续攻击',
      '只有队长会消失，小怪留着',
      '进度条过期后会重新刷新',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的恼鬼究竟有多恶心?!》BV1q1tG6ME5n',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '袭击在 48000 tick（约 40 分钟）后把进度条判为过期，但那只是 UI 状态，场上那波袭击者并不会因此消失，威胁还在。',
  },
  {
    id: 'up-raid-wave-count',
    topic: '袭击 / 机制',
    prompt: '袭击波数由什么决定？「袭击之兆」（Raid Omen）每升一级会加几波？',
    options: [
      '波数固定为 5，袭击之兆每级加 1 波',
      '波数由游戏难度决定，袭击之兆每级加 1 波',
      '波数由参与村民人数决定',
      '波数固定为 7，不受任何条件影响',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '恒某人《MC 的恼鬼究竟有多恶心?!》BV1q1tG6ME5n',
      url: 'https://space.bilibili.com/3537121608468624',
      confidence: 'reported',
    },
    explanation:
      '波数是难度直接决定的，Raid Omen 等级只在基础波数上每级加 1 波。想刷高波 raid 只能靠难度。',
  },
  {
    id: 'up-ender-dragon-knockback-bug',
    topic: '末影龙 / Bug',
    prompt: '末影龙的击飞（knockback）机制在正式版里的状态是？',
    options: [
      '早就修好了，现在不会被击飞',
      '这是长期未修的老 bug，能靠它跳过打龙',
      '只有鞘翅状态下会被击飞',
      '只有站在基岩上会被击飞',
    ],
    answerIndex: 1,
    version: { since: ' longstanding', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '这里是莱里《我还能找到更神秘的我的世界小知识吗?!》BV1VYGA6hEHL（335 万播放）',
      url: 'https://space.bilibili.com/37093763',
      confidence: 'reported',
    },
    explanation:
      '末影龙的击飞判定从很久以前就是异常的，社区已经用这个机制发展出一整套「不攻击就跳」的通关打法，至今官方没修。',
  },
  {
    id: 'up-end-island-rings',
    topic: '末地外岛 / 世界生成',
    prompt: '末地外岛在极远处会以什么形态生成？',
    options: [
      '随机散布，大小不一',
      '以同心环状生成，每环面积相同',
      '沿主岛连成一条线',
      '按 64 的倍数均匀网格排布',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '这里是莱里《我还能找到更神秘的我的世界小知识吗?!》BV1VYGA6hEHL',
      url: 'https://space.bilibili.com/37093763',
      confidence: 'reported',
    },
    explanation:
      '末地外岛是同心环：第一环被 ±370,720 截断，第二环从 ±524,288 重新开始。成因是距离平方的算术溢出，所以每一环的面积看起来都一样大。',
  },
  {
    id: 'up-end-island-arith-overflow',
    topic: '末地外岛 / 机制',
    prompt: '末地外岛的同心环是怎么产生的？世界边界最远能延伸到第几环？',
    options: [
      '按距离线性均匀生成，最多第 1024 环',
      '距离平方发生算术溢出导致截断，最多第 6548 环',
      '按区块数随机生成，最多第 256 环',
      '按生物群系生成，最多第 4096 环',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '这里是莱里《我还能找到更神秘的我的世界小知识吗?!》BV1VYGA6hEHL',
      url: 'https://space.bilibili.com/37093763',
      confidence: 'reported',
    },
    explanation:
      '生成判定用的是「距离的平方」，超出整型范围就溢出成负数，于是判定又成立了 —— 这就是环状重复出现的原因。世界边界最远能到第 6548 环。',
  },
  {
    id: 'up-end-platform-block-destroy',
    topic: '末地 / 机制',
    prompt: '刚进末地时，主岛中央黑曜石平台上玩家自己放的方块会怎样？',
    options: [
      '正常保留',
      '每次都会被摧毁重建',
      '会变成屏障方块',
      '会掉落成物品',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '这里是莱里《我还能找到更神秘的我的世界小知识吗?!》BV1VYGA6hEHL',
      url: 'https://space.bilibili.com/37093763',
      confidence: 'reported',
    },
    explanation:
      '进入末地时 5×5×4 空间内、玩家放置的方块会被反复摧毁重建。所以别在出生平台上垫方块。',
  },
  {
    id: 'up-spider-eye-to-end-island',
    topic: '末地 / 冷知识',
    prompt: '「吃蜘蛛眼就可以飞去末地外岛」这个说法，在哪个版本上被实测成功过？',
    options: [
      'Java 版 26.1.2 实测可以做到',
      '只在基岩版成立，Java 版从来不行',
      '1.20 前的 Java 版成立，现已修复',
      '这是谣言，从来没成功过',
    ],
    answerIndex: 0,
    version: { since: '26.1.2 实测', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '这里是莱里《吃蜘蛛眼就可以飞去末地外岛?!这个 bug 简直是艺术品!》BV1jM8P6EEDy',
      url: 'https://space.bilibili.com/37093763',
      confidence: 'reported',
    },
    explanation:
      '这个在 Java 版 26.1.2 上被实测复现过 —— 吃蜘蛛眼的黏液球传送在特定落点下能把你送到末地外岛，属于典型的「Bug 变艺术品」。',
  },
  {
    id: 'up-copper-golem-crafting',
    topic: '铜傀儡 / 合成',
    prompt: '铜傀儡能直接用铜锭合成出来吗？',
    options: [
      '可以，4 个铜锭围一圈就行',
      '不行，要用任意氧化阶段的铜块，再放雕刻南瓜',
      '可以，铜锭加一桶熔岩就行',
      '可以，8 个铜锭围一圈就行',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '铜傀儡不能用铜锭直接合成。配方要用任意氧化阶段的铜块（氧化铜、暴露铜等）打底，最后放雕刻南瓜或南瓜灯，而且普通南瓜不行。生成后铜块会变成铜箱。',
  },
  {
    id: 'up-copper-golem-statue-rate',
    topic: '铜傀儡 / 机制',
    prompt: '铜傀儡的石雕像化概率大约是多少？平均多久会变一次？',
    options: [
      '每 tick 0.58%，平均约 8.6 秒',
      '每 tick 5%，平均约 1 秒',
      '每 tick 0.1%，平均约 100 秒',
      '每 tick 50%，平均约 2 秒',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '每个 tick 有 0.58% 的概率雕像化，换算下来平均大约 8.62 秒就变一次。想让它保持可用形态，得赶紧找到它要干的活。',
  },
  {
    id: 'up-copper-golem-search-range',
    topic: '铜傀儡 / 机制',
    prompt: '铜傀儡找箱子的搜索范围和记忆机制是怎样的？',
    options: [
      '范围 65×17×65，每箱停 3 秒记 9 个',
      '范围 16×16×16，每箱停 1 秒记 4 个',
      '范围 128×64×128，数量不设上限',
      '范围 32×8×32，记忆不会被清空',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '搜索立方是 65×17×65。每查一个箱子停 3 秒，最多记住 9 个位置；连续 10 次找不到就游荡 7 秒并把记忆清空 —— 所以把箱子摆得散一点反而更容易让它重新搜索。',
  },
  {
    id: 'up-java-potion-distinguish',
    topic: '药水 / 版本差异',
    prompt: '在 Java 版上，玩家能不能通过外观或交互分辨两个内容不同的药水？',
    options: [
      '不能，Java 版分不出药水内容、药箭类型和可疑汤',
      '只有 1.20 之前能区分',
      '能，Java 版能像基岩版一样区分',
      '只有投掷型的药箭可以区分',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      'Java 版没给药水内容做区分，同一瓶水样药水里装什么完全看不出来，药箭类型与 suspicion stew 也一样。基岩版有区分。',
  },
  {
    id: 'up-java-wax-no-enchant-progress',
    topic: '涂蜡 / 版本差异',
    prompt: '在 Java 版里给铜块、陶瓦等上蜡，会获得「涂层（Coat Waxing）」进度吗？',
    options: [
      '会，涂蜡和去蜡都会给进度',
      '只有涂蜡的铜块给进度',
      '不会，Java 版上蜡和去蜡都不给任何进度',
      '只有涂蜡给进度，去蜡不给',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      'Java 版实现里上蜡 / 去蜡不会推进「涂层」这条附魔进度，基岩版才有。所以「刷出涂层」的刷法在 Java 版上是行不通的。',
  },
  {
    id: 'up-dripstone-lava-vs-water',
    topic: '滴水石锥 / 机制',
    prompt: '滴水石锥用熔岩和水灌满一格，概率分别是多少？',
    options: [
      '两者都是 100%，一次就能灌满',
      '熔岩一次灌满，水每次 +1 格、空锅要灌 3 次',
      '两者都是 1/16，都要灌很多次',
      '熔岩 45/256，水 15/256，都要灌多次',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '熔岩灌锅是 15/256 的一次性判定；水灌锅是 45/256 每次加一格，所以空锅要灌三次才满。这也是农民能廉价量产水的原因。',
  },
  {
    id: 'up-dripstone-natural-growth',
    topic: '滴水石锥 / 世界生成',
    prompt: '带尖端和支架的滴水石锥自然生长成多高的概率是多少？生物能爬过多高的滴水石锥？',
    options: [
      '生长 64/5625 ≈ 1.1%；生物能爬 ≤4 格高的锥体',
      '生长 1/16 ≈ 6.25%；生物能爬任意高度',
      '生长 1/64 ≈ 1.56%；生物完全不能爬',
      '生长 1/32；生物只能爬 ≤2 格高的锥体',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '自然生长概率是 64/5625，约 1.138%。关键是生物能爬 ≤4 格高的滴水石锥，所以拿它做防刷怪层不可靠，得叠高。',
  },
  {
    id: 'bug-230746-dripstone-water-no-growth',
    topic: '滴水石锥 / Bug',
    prompt: '上方两格有水时，滴水石锥能不能一边被灌锅一边自然生长？',
    options: [
      '不能，只灌锅不生长，26.1-pre1 已修复',
      '能，灌锅和生长互不干扰',
      '两者会互相加速生长',
      '不能，只生长不灌锅',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.1-pre1 修复', verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: 'MC-230746（26.1-pre1 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-230746',
      confidence: 'reported',
    },
    explanation:
      'MC-230746 报的就是这个：上方有水时滴水石锥只灌锅不生长。这个问题在 26.1-pre1 已经被修掉。',
  },
  {
    id: 'up-fox-gem-drop-rate',
    topic: '狐狸 / 概率',
    prompt: '野生狐狸身上带着物品的概率是多少？其中带绿宝石的概率是多少？',
    options: [
      '20% 概率带物，其中绿宝石 5%（约 1%）',
      '50% 概率带物，其中绿宝石 50%',
      '5% 概率带物，其中绿宝石 1%',
      '100% 概率带物，其中绿宝石 10%',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '野生狐狸 20% 概率携带物品，绿宝石本身占其中 5%，合起来大约 1%。这 1% 是靠刷狐狸刷出绿宝石的经典路线。',
  },
  {
    id: 'up-fox-trust-not-tame',
    topic: '狐狸 / 机制',
    prompt: '关于狐狸的「驯服」，正确说法是哪一个？',
    options: [
      '潜行右键就能驯服野狐狸',
      '喂金苹果就能驯服',
      '用拴绳可以驯服',
      '没有驯服，只有「信任」，且必须先繁殖过',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'up',
      label: '盖宝gaiber《铜傀儡的8个冷知识》BV1Wu3h6oE1k',
      url: 'https://space.bilibili.com/224373031',
      confidence: 'reported',
    },
    explanation:
      '狐狸没有驯服机制，只有「信任」：拿 breeding 食物喂两次、和它一起出生过、还要同队没死过。野狐狸和自然生成的幼崽永远无法获得信任，只能靠繁殖出来的。',
  },

  // ============ 四、第二批：逐条联网核实过的机制细节与官方 Bug ============
  //
  // 这一批每条都对着bugs.mojang.com 与 Minecraft Wiki 核实过状态与修复版本，
  // 凡是「无法确认」的一律没有写进来 —— 宁可少几条，也不要在题库里留错信息。
  // 特别标注了「Confirmed 且至今未修复」的条目（时效性最强，也最不容易随版本失效）。

  {
    // ★ 截至 26.3 仍未修复，是当前最值得一考的条目
    id: 'bug-311022-soul-speed-attribute-leak',
    topic: '灵魂沙 / 状态效果',
    prompt: '在灵魂沙上疾跑时，趁「疾行附魔靴」恰好损坏的瞬间换上它，会发生什么？',
    options: [
      '靴子坏了就掉，移动速度立刻恢复正常',
      '永久保留疾行的移动速度加成，直到死亡、断线或换另一双鞋',
      '只有换成盾牌才能清掉这个加成',
      '疾行效果会立刻消失，且无法再获得',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311022（Confirmed，Affects 26.3-Snapshot 8，仍未修复）',
      url: 'https://bugs.mojang.com/browse/MC-311022',
      confidence: 'confirmed',
    },
    explanation:
      '靴子损坏的瞬间服务端还没把属性修饰符收回去，这时候把新靴子穿上，modifier 就一直挂着。死亡、断线重连或者换任意一双别的鞋都能清掉。护甲值那条路径据说也有同样问题。',
  },
  {
    id: 'bug-305691-villager-insomnia',
    topic: '村民 / 机制',
    prompt: '「村民失眠」是什么现象？',
    options: [
      '村民到了晚上躺在床上却不睡，一直站着发呆',
      '村民睡不着时会跑出家门在村里乱走',
      '村民的睡眠时间被随机缩短',
      '村民睡着之后会被立刻唤醒',
    ],
    answerIndex: 0,
    version: { since: '26.1-Snapshot 3', fixedIn: '26.1-Snapshot 4 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305691（Confirmed，26.1-Snapshot 4 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-305691',
      confidence: 'confirmed',
    },
    explanation:
      '这个 bug 在 26.1-Snapshot 3 出现：村民明明躺在床上，却不进入睡眠状态，一直站着，导致整个村庄的「床铺已占用」判定失效。26.1-Snapshot 4 就修掉了，所以现在正式版里复现不了。',
  },
  {
    id: 'bug-102774-two-crystals-respawn-dragon',
    topic: '末影龙 / 机制',
    /*
      题干曾把「设计需要 4 颗」和「bug 让 2 颗就够」混在一句里问「最少几颗」，
      选项再把 1 颗 / 2 颗 / 4 颗 / 7 颗平铺开，结果 answerIndex 指到「1 颗」，
      而 explanation 写的是「正确答案是 4 颗」—— 自相矛盾，玩家无论选哪个都像错的。

      现在按官方 bug 页（MC-102774）的口径重写：
      设计值就是 4 颗，2 颗能唤醒是这个 bug 造成的，26.1-Snapshot 5 已修。
      题干锁定「26.1-Snapshot 5 修复之后」，避免「最少」歧义；
      「1 颗」作为干扰项保留但明确标注是另一个机制（活塞推水晶 + 亲手放置检测），
      这样玩家选到它时知道自己在踩哪个坑，而不是以为自己算错了。
    */
    prompt: '通关之后想再次唤醒末影龙，按设计需要放几颗末影水晶？（26.1-Snapshot 5 修复之后）',
    options: [
      '要 4 颗，这是设计的答案',
      '2 颗就够，这是个老 bug',
      '只要 1 颗就够了',
      '得集齐 7 颗水晶才行',
    ],
    answerIndex: 0,
    version: { since: null, fixedIn: '26.1-Snapshot 5 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-102774（Confirmed，26.1-Snapshot 5 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-102774',
      confidence: 'confirmed',
    },
    explanation:
      '设计答案是 4 颗：末影基座上有 4 个水晶判定区，每区放 1 颗才会触发唤醒。MC-102774 让**2 颗**就够 —— 末影水晶的判定箱偏大，对角摆 2 颗时每颗同时压到 2 个判定区。这个 bug 从 1.9.4 一路存在（2016 年报告），直到 26.1-Snapshot 5 才修掉。至于「1 颗」：确实存在这种玩法，用活塞把黑曜石柱上的水晶推到基座代替玩家放置，但游戏只在「玩家亲手放置」时检测，所以仍要留 1 颗真水晶 —— 这跟本题问的设计值是两回事。',
  },
  {
    id: 'bug-305388-bees-never-calm',
    topic: '蜜蜂 / 机制',
    prompt: '1.21.11 起，收蜂蜜时蜜蜂的愤怒状态会怎样？',
    options: [
      '立刻就消气',
      '只有蜂巢被破坏时才会消气',
      '永远消不了气，除非用烟熏或收进蜂巢',
      '和以前一样，约 30 秒后消气回巢',
    ],
    answerIndex: 1,
    version: { since: '1.21.11', fixedIn: '26.1-Snapshot 5 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305388（Confirmed，重复报告 MC-306755，26.1-Snapshot 5 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-305388',
      confidence: 'confirmed',
    },
    explanation:
      '1.21.11 改了蜜蜂的愤怒计时逻辑，结果收完蜂蜜蜜蜂就永远消不了气。26.1-Snapshot 5 修复了。',
  },
  {
    id: 'bug-163978-mobs-spawn-on-moving-blocks',
    topic: '生物生成 / 机制',
    prompt: '生物会自然生成在「正在移动的方块」上吗？',
    options: [
      '不会，移动的方块上永远刷不出生物',
      '会，方块下落或被活塞推动过程中，照样能自然生成生物',
      '只有活塞推动时不会生成',
      '只有下落的方块不会生成',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.1-Snapshot 5 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-163978（Confirmed，26.1-Snapshot 5 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-163978',
      confidence: 'confirmed',
    },
    explanation:
      '方块的生成判定没有排除「正在移动」这个状态，所以下落的砂砾、被活塞推着的方块上都能刷出生物。26.1-Snapshot 5 加了排除条件。',
  },
  {
    id: 'bug-305846-iron-golem-autocreation',
    topic: '铁傀儡 / 机制',
    prompt: '「铁傀儡自动生成失控」是什么问题？',
    options: [
      '铁傀儡生成数量会超出村庄应有的数量',
      '铁傀儡生成后立刻消失',
      '铁傀儡不会攻击敌对生物',
      '铁傀儡会在白天熔化',
    ],
    answerIndex: 0,
    version: { since: '26.1-Snapshot 3', fixedIn: '26.1-Snapshot 4 修复', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305846（Confirmed，26.1-Snapshot 4 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-305846',
      confidence: 'confirmed',
    },
    explanation:
      '铁傀儡的生成判定在特定村庄布局下会反复触发，导致数量堆积。26.1-Snapshot 4 修复。',
  },
  {
    id: 'bug-305888-turtle-eggs-in-dimensions',
    topic: '乌龟 / 版本差异',
    prompt: '海龟蛋在下界或末地能孵化吗？',
    options: [
      '不能，26.1 快照 5 起只在海洋与陆地上孵化',
      '只能在下界的岩浆里孵化',
      '海龟蛋必须放在海龟上才能孵化',
      '能，海龟蛋在任何维度都能孵化',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.1-Snapshot 5', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-305888（Confirmed，26.1-Snapshot 5 已修复）',
      url: 'https://bugs.mojang.com/browse/MC-305888',
      confidence: 'confirmed',
    },
    explanation:
      '26.1-Snapshot 5 给海龟蛋加了维度判定，现在只有中立维度能孵化。',
  },
  {
    id: 'bug-311094-villager-discount-delay',
    topic: '村民 / 交易',
    prompt: '村民交易出现折扣（村民好感度带来的降价）后，折扣什么时候才生效？',
    options: [
      '立刻生效，当场就能看到便宜的价格',
      '要关掉交易界面再重新打开才生效',
      '必须等到下一个游戏日',
      '必须重新绑定工作站点',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.3-Snapshot 10', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311094（26.3-Snapshot 10 修复）',
      url: 'https://bugs.mojang.com/browse/MC-311094',
      confidence: 'confirmed',
    },
    explanation:
      '折扣加成在开界面那一刻就算好了，但没有立刻刷新价格显示，得关掉再打开才看得到。26.3-Snapshot 10 修掉了。',
  },
  {
    id: 'bug-311178-drowned-daytime-hostility',
    topic: '溺尸 / 机制',
    prompt: '溺尸在白天（能被天空照亮的地方）是什么行为？',
    options: [
      '一直都是敌对的，会主动攻击玩家',
      '只有下雨天它才会消失',
      '白天它完全不会生成',
      '不再主动攻击，被打后才敌对，离水仍敌对',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.3-Snapshot 10', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311178（26.3-Snapshot 10 修复）',
      url: 'https://bugs.mojang.com/browse/MC-311178',
      confidence: 'confirmed',
    },
    explanation:
      '26.3-Snapshot 10 之前溺尸没有区分白天黑夜。修复后白天不主动攻击，但被打过就会一直追着你 —— 即使你已经离开水。',
  },
  {
    id: 'bug-311705-axes-disable-shields',
    topic: '盾牌 / 版本差异',
    prompt: '斧头现在还能像以前那样一右键就把玩家的盾牌禁掉吗？',
    options: [
      '不能，26.3 之后斧头不再能禁用盾牌',
      '只有下界里才可以',
      '只有木斧能禁用盾牌',
      '能，一直都可以禁用盾牌',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: '26.3-rc1', verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-311705（26.3-rc1 修复）',
      url: 'https://bugs.mojang.com/browse/MC-311705',
      confidence: 'confirmed',
    },
    explanation:
      '早期版本里同时按斧和盾会先触发刮铜 / 剥木而不是格挡，这带来不少「来不及举盾」的场面。1.21 起改成格挡优先，26.3-rc1 进一步把斧头禁用盾牌这条路也彻底关了。',
  },
  {
    id: 'mechanic-sculk-probability',
    topic: '幽匿 / 蔓延',
    prompt: '幽匿催化者的绽放转化时，概率分别是多少？（方块变成幽匿 / 刷出幽匿尖啸器）',
    options: [
      '9% 变成幽匿块，1% 刷出尖啸器',
      '1% 变成幽匿块，9% 刷出尖啸器',
      '两者都是 5%',
      '两者都是 100%',
    ],
    answerIndex: 0,
    version: { since: '1.19', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft 官方数据 + Wiki 交叉验证（minecraft.wiki Sculk Catalyst）',
      url: 'https://minecraft.wiki/w/Sculk_Catalyst',
      confidence: 'data',
    },
    explanation:
      '这个 9% / 1% 在中文社区资料里经常被写反（写成 9% 出尖啸器）。以Wiki 为准：绝大多数是变成幽匿块，极小概率才刷出尖啸器。蔓延距离 Java 版是 8 格（基岩版 10 格）。',
  },
  {
    id: 'mechanic-piston-block-entities',
    topic: '活塞 / 机制',
    prompt: '下面哪个方块是活塞**可以**推动的？',
    options: [
      '箱子',
      '潜影盒',
      '冰块（packed ice）',
      '幽匿传感器',
    ],
    answerIndex: 2,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft 官方方块数据（client.jar）',
      url: 'https://minecraft.wiki/w/Piston',
      confidence: 'data',
    },
    explanation:
      '凡带「方块实体」的方块（箱子、桶、熔炉、潜影盒…）和全部幽匿方块都推不动。冰块（packed ice）是普通可移动方块，能推也能被黏性活塞拉 —— 常被误记成推不动的是别的方块。一次活塞最多推动 12 个方块（是数量上限，不是距离），活塞本身永远只伸一格。',
  },
  {
    id: 'mechanic-phantom-spawn-timer',
    topic: '幻翼 / 世界生成',
    prompt: '幻翼生成条件里的「时间」是怎么算的？玩家刚死过会怎样？',
    options: [
      '距上次睡觉满 72000 刻，死亡会清零计时',
      '死亡后 7 天内完全不生成幻翼',
      '连续 7 天不睡就会必定生成幻翼',
      '幻翼生成随机，和睡觉无关',
    ],
    answerIndex: 0,
    version: { since: '1.4', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft Wiki Phantom 生成机制（Time Since Last Rest）',
      url: 'https://minecraft.wiki/w/Phantom',
      confidence: 'data',
    },
    explanation:
      '常见误解是「死一次能清一段时间」，方向反了：死亡同样会重置计时器，所以刚死过反而要重新攒。生成概率是 x − 72000 / x（x 为距上次睡觉或死亡的 tick 数），第 4 天约 25%、第 7 天约 57%。另外要求夜晚或雷暴、玩家在 y>64 且正上方能看见天空。',
  },
  {
    id: 'mechanic-world-border-coordinates',
    topic: '世界边界',
    prompt: '主世界默认的世界边界在哪几个坐标？',
    options: [
      '边界在 ±3,000 处，是基岩墙',
      '默认边界约 ±2,999 万，硬墙 ±3,000 万',
      '边界固定在 ±1,000,000 处',
      '没有边界，可以一直往外走',
    ],
    answerIndex: 1,
    version: { since: '1.8', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft 世界边界机制（World border / Spawn radius）',
      url: 'https://minecraft.wiki/w/World_border',
      confidence: 'data',
    },
    explanation:
      '世界边界不是一堵基岩墙。默认边界在 ±29,999,984，硬墙在 ±30,000,000（/tp 也不接受更远的坐标），而绝对生成边缘大约在 ±30,000,256~±30,000,544。下界和末地没有对应的边界限制。',
  },
  {
    id: 'mechanic-efficiency-vs-fatigue',
    topic: '效率 / 挖掘疲劳',
    prompt: '效率与挖掘疲劳是互相抵消，还是相乘叠加？',
    options: [
      '两者互相抵消，谁高听谁的',
      '相乘叠加，疲劳永远压过效率',
      '效率只在熔岩里才生效',
      '挖掘疲劳只减速 10%，很弱',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft Wiki 效率与挖掘疲劳（效率 / Mining Fatigue）',
      url: 'https://minecraft.wiki/w/Efficiency',
      confidence: 'data',
    },
    explanation:
      '两者是相乘的。效率 V 把破坏速度除以 26；挖掘疲劳在 Java 版对速度乘 0.3^min(等级,4)，IV 级已是 0.00081，V 级不再更慢。所以效率 V + 疲劳 IV 的净效果是 ÷26 × 0.00081 —— 疲劳稳赢。基岩版的算法不一样（对伤害乘 0.7^等级）。',
  },
  {
    id: 'mechanic-skeleton-no-drown',
    topic: '骷髅 / 水',
    prompt: '骷髅掉进水里会怎样？',
    options: [
      '会下沉，但永远不会溺水、也不会变溺尸',
      '会溺水，并转换成溺尸',
      '会一直浮在水面上',
      '会被水流冲走并刷新位置',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft Wiki Skeleton（不会溺水）',
      url: 'https://minecraft.wiki/w/Skeleton',
      confidence: 'data',
    },
    explanation:
      '骨架在 1.9 合并后就没有溺水机制了，入水只会下沉。溺尸只能由自然生成或僵尸的转化链产生。骷髅唯一的转化路径是被粉雪覆盖约 7 秒、并在 15 秒内化为流浪者（Stray）。',
  },
  {
    id: 'mechanic-elytra-lava',
    topic: '鞘翅 / 熔岩',
    prompt: '玩家穿着鞘翅飞进岩浆里，会发生什么？',
    options: [
      '滑翔立刻中断，安全停在岸边',
      '鞘翅会完全免受岩浆伤害',
      '滑翔不中断，但玩家照样被烧死，鞘翅也会烧毁',
      '玩家会被岩浆弹回空中',
    ],
    answerIndex: 1,
    version: { since: null, fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'mojang-bug',
      label: 'MC-97190（Works As Intended，已关闭）',
      url: 'https://bugs.mojang.com/browse/MC-97190',
      confidence: 'confirmed',
    },
    explanation:
      '这个 bug 单被判定为 Works As Intended：滑翔进水里或岩浆都不会解除，可以继续用烟花加速，浮出水面后模型也要碰到方块才恢复站立。但该受的伤害一点不少 —— 玩家会烧死，鞘翅也会被岩浆毁掉。',
  },
  {
    id: 'mechanic-piston-move-limit',
    topic: '活塞 / 机制',
    prompt: '活塞推动方块的数量上限是多少？活塞本体最长伸出几格？',
    options: [
      '最多推动 12 个方块，活塞永远只伸 1 格',
      '最多推动 6 个方块，最多伸 2 格',
      '没有数量上限，可以推动一整面墙',
      '最多推动 64 个方块',
    ],
    answerIndex: 0,
    version: { since: '1.2', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft Wiki Piston（推动上限）',
      url: 'https://minecraft.wiki/w/Piston',
      confidence: 'data',
    },
    explanation:
      '上限是「一次最多 12 个方块」，属于数量上限而不是距离上限 —— 活塞无论怎么算都只伸出去 1 格。很多人误以为活塞能推动几格远的方块链。',
  },
  {
    id: 'mechanic-weighted-pressure-plate',
    topic: '红石 / 砝秤',
    prompt: '一个砝秤上放着 1 组（64 个）掉落物，它输出多强的信号？',
    options: [
      '砝秤对掉落物完全没反应',
      '只要有掉落物就是满信号',
      '按实体数量算，64 个掉落物只算 1 个，信号很弱',
      '按物品数量算，64 个就是满信号',
    ],
    answerIndex: 1,
    version: { since: '1.3 / 13w36a', fixedIn: null, verifiedIn: '26.3' },
    source: {
      type: 'data',
      label: 'Minecraft Wiki Weighted Pressure Plate（按实体计数）',
      url: 'https://minecraft.wiki/w/Weighted_Pressure_Plate',
      confidence: 'data',
    },
    explanation:
      '从 1.3（13w36a）起砝秤改成按实体数量计信号，而不是按物品个数。所以一整组 64 个物品挤在一格掉落物里只贡献 1 个实体的信号 —— 想用砝秤测「有多少东西」是行不通的，得先打散。',
  },
]
