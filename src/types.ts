export type Kind = 'block' | 'item' | 'mob'
export type Difficulty = 'explorer' | 'survival' | 'hardcore'
export type GameMode = 'endless' | 'daily'
export type RoundStatus = 'playing' | 'correct' | 'revealed'

export interface BlockState {
  name: string
  type: string
  values: string[]
}

export interface CatalogEntry {
  id: string
  registryId: number
  kind: Kind
  name: string
  displayName: string
  zhName: string
  family: string
  variantCount: number
  states: BlockState[]
  specialStates: string[]
  facts: Record<string, string | number | boolean | null>
}

export interface CatalogMeta {
  edition: string
  version: string
  releaseType: string
  generatedFrom: string
  translationSource?: string
  counts: {
    blocks: number
    blockStates: number
    items: number
    itemSpecialStates: number
    entities: number
    entitySpecialStates: number
    totalEntries: number
    translatedNames?: number
  }
}

export interface CatalogData {
  meta: CatalogMeta
  catalog: CatalogEntry[]
}

export interface PlayerStats {
  score: number
  streak: number
  bestStreak: number
  solved: number
  skipped: number
  /**
   * 知识地图收集进度。
   *
   * 可选：老存档（localStorage 里的旧结构）没有这个字段，读出来是 undefined，
   * 由 readKnowledge() 兜底成空进度，不要直接解引用。
   */
  knowledge?: KnowledgeProgressSnapshot
}

/** 落进 localStorage 的收集进度快照（定义见 knowledge.ts） */
export interface KnowledgeProgressSnapshot {
  /** 知识点 key → 答对过的题数 */
  lit: Record<string, number>
  /** 已答对过的题目 id，用于同一题不重复计数 */
  solvedIds: string[]
  /**
   * 错题本：答错过的题目 id + 各自的错误次数。
   *
   * 同样只存 **id 和次数**，不存答案、不存玩家选了什么 ——
   * 错题本要展示的是「哪道题该复习」，不是「答案是什么」。
   * 次数用来排序：错 5 次的题比错 1 次的更该优先复习。
   *
   * 可选：老存档没有这个字段，由 readKnowledge() 兜底成空对象。
   */
  wrong?: Record<string, number>
}

/**
 * 题库分层。
 * - basic：MC 基础知识（硬度 / 发光 / 工具 / 堆叠 / 配方 / 生物分类 …）
 * - obscure：冷门机制与官方未修复 bug，只在极限难度出现
 */
export type QuizTier = 'basic' | 'obscure'

/** 题目来源类型 */
export type QuizSourceType = 'data' | 'recipe' | 'mojang-bug' | 'up'

export interface QuizSource {
  type: QuizSourceType
  label: string
  url?: string
  /**
   * 可信度如实标注，不含糊：
   * - data      官方客户端数据，最硬
   * - confirmed Mojang Jira 上官方已标 Confirmed / Community Consensus
   * - reported  社区实测（UP 主选题 + Wiki 交叉验证），未逐帧核实
   */
  confidence: 'data' | 'confirmed' | 'reported'
}

export interface QuizQuestionVersion {
  /** 这道题所述事实在哪个版本上成立 */
  verifiedIn: string
  /** 机制 / 配方从哪个版本开始有 */
  introduced: string | null
  /** 若是已修复的 bug，修复于哪个版本 */
  fixed: string | null
}

export interface QuizQuestion {
  id: string
  tier: QuizTier
  /** basic 内部分两级：1 一眼可答，2 需要查表对比；obscure 固定 3 */
  level: 1 | 2 | 3
  topic: string
  prompt: string
  options: string[]
  answerIndex: number
  /**
   * 与 options 一一对应的图鉴注册名，长度必须等于 options.length；没有对应条目的用 null。
   *
   * 用途是给【每个选项】渲染它自己的官方材质图标。
   * 刻意不设「题目主角」字段：那种设计在四选一里等于直接把答案摆在脸上
   * （实测 232/347 道题的主角就是正确答案），与项目「未揭晓零泄漏」原则冲突。
   */
  optionNames: (string | null)[]
  version: QuizQuestionVersion
  source: QuizSource
  explanation: string
}

export interface QuizData {
  meta: {
    edition: string
    /** 本项目图鉴与配方数据的提取版本 */
    dataVersion: string
    /** 撰写题库时的最新正式版 */
    latestRelease: string
    latestReleaseName: string
    latestReleaseDate: string
    bugTracker: string
    generatedFrom: string
    counts: {
      total: number
      basic: number
      basicLevel1: number
      basicLevel2: number
      obscure: number
      byTopic: number
    }
  }
  questions: QuizQuestion[]
}

export type TransformMethod =
  | 'craft_shaped'
  | 'craft_shapeless'
  | 'smelt'
  | 'blast'
  | 'smoke'
  | 'campfire'
  | 'stonecut'
  | 'wax'
  | 'scrape'
  | 'strip'
  | 'smith'

export type TransformLayout = 'grid-shaped' | 'grid-shapeless' | 'single' | 'dual' | 'furnace'

export interface TransformInput {
  /** 该材料位可接受的方块/物品名（含标签展开后的全部叶子）；燃料槽为空 */
  names: string[]
  /** 原始标签名（若有），用于提示「任意 X 均可」 */
  tag: string | null
  /**
   * 是否为燃料槽。烧制/冶炼/烟熏/篝火需要燃料，这里放「任意可燃物」都算对，
   * 因此候选名单独存在 meta.fuels（300+ 项），不塞进 names 里撑大每个转化。
   */
  fuelSlot?: boolean
}

export interface Transform {
  id: string
  method: TransformMethod
  result: string
  count: number
  layout: TransformLayout
  width: number
  height: number
  /** 有序合成时为 3×3 网格（每格是对应的材料名，空格为 null）；其余布局为 null */
  shape: string[][] | null
  inputs: TransformInput[]
  signature: string
}

export interface TransformData {
  meta: {
    edition: string
    version: string
    generatedFrom: string
    methodLabels: Record<string, string>
    /** 全局燃料表：取自原版 FuelValues，燃料槽放这里任意一项都算对 */
    fuels: string[]
    counts: {
      transforms: number
      results: number
      byMethod: Record<string, number>
      fuels: number
      skipped: number
    }
  }
  transforms: Transform[]
}
