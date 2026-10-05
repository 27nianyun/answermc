/**
 * 题目作答统计（全球正确率）。
 *
 * ── 设计原则：这是增强项，不是核心链路 ──────────────────────
 * 统计服务挂了、网络不通、本地开发没有后端 —— 这些情况下答题本身
 * 必须照常工作，只是不显示正确率。所以这里**没有任何抛错路径**：
 * 请求失败一律返回空，调用方拿到空就不渲染那一小块 UI。
 *
 * ── 为什么用相对路径 ────────────────────────────────────────
 * `/api/*` 是 Pages Functions，和前端同域名。
 * 同域名的好处不只是免跨域：独立 Worker 只能用 *.workers.dev，
 * 而那个域名在部分网络下不可达，会出现「网站能开、正确率永远加载不出来」。
 *
 * ── 上报什么 ────────────────────────────────────────────────
 * 只有「题 id + 对/错」，不含 IP、UA、用户标识。正确率是聚合值，
 * 收集身份信息对个人隐私是负担，对功能也没帮助。
 */

export interface QuestionStat {
  attempts: number
  correct: number
}

const ENDPOINT = '/api'

/** 进程内缓存：同一道题在一局里被反复查询时不该重复打网络 */
const cache = new Map<string, QuestionStat>()

/** 正确率；样本太少时返回 null（「2 人里 1 人答对」没有参考价值） */
export const accuracyOf = (stat: QuestionStat | undefined): number | null => {
  if (!stat || stat.attempts < 5) return null
  return stat.correct / stat.attempts
}

/** 正确率的展示文案；样本不足或没数据时返回 null，调用方据此决定要不要渲染 */
export const accuracyLabel = (stat: QuestionStat | undefined): string | null => {
  const ratio = accuracyOf(stat)
  if (ratio === null || !stat) return null
  const percent = Math.round(ratio * 100)
  return `全球 ${percent}% 的人答对了这题（${stat.attempts} 次作答）`
}

const isSafeId = (id: string): boolean => /^[A-Za-z0-9_.:-]{1,80}$/.test(id)

/**
 * 查询若干题的统计。失败返回空 Map，不抛错。
 *
 * 单次最多 50 个 id（后端也这么限），超了只取前 50 ——
 * 实际上一次只会查 1 道题，这个上限是防御性的。
 */
export const fetchStats = async (ids: string[]): Promise<Map<string, QuestionStat>> => {
  const wanted = [...new Set(ids)].filter(isSafeId).slice(0, 50)
  const out = new Map<string, QuestionStat>()
  if (wanted.length === 0) return out

  // 先给缓存里的，剩下的才去问网络
  const missing = wanted.filter((id) => {
    const hit = cache.get(id)
    if (hit) out.set(id, hit)
    return !hit
  })
  if (missing.length === 0) return out

  try {
    const response = await fetch(
      `${ENDPOINT}/stats?ids=${encodeURIComponent(missing.join(','))}`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return out
    const data = (await response.json()) as { stats?: Array<{ question_id: string; attempts: number; correct: number }> }
    for (const row of data.stats ?? []) {
      const stat = { attempts: row.attempts, correct: row.correct }
      cache.set(row.question_id, stat)
      out.set(row.question_id, stat)
    }
  } catch {
    // 统计拿不到就算了，答题不受影响
  }
  return out
}

/**
 * 上报一次作答。
 *
 * 刻意不 await：玩家不该等一个统计请求。失败也静默 ——
 * 少记一次不影响正确率的意义。
 *
 * 同时在本地缓存里乐观累加：这样玩家答完立刻能看到包含自己这一票的正确率，
 * 不用等下一轮查询返回。
 */
export const reportAnswer = (id: string, ok: boolean): QuestionStat | null => {
  if (!isSafeId(id)) return null
  const previous = cache.get(id) ?? { attempts: 0, correct: 0 }
  const next = { attempts: previous.attempts + 1, correct: previous.correct + (ok ? 1 : 0) }
  cache.set(id, next)

  try {
    void fetch(`${ENDPOINT}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok }),
      // 页面关闭时的上报不该拖住导航
      keepalive: true,
    }).catch(() => { /* 统计丢失无所谓 */ })
  } catch {
    // 同步异常也静默（比如某些浏览器不允许 keepalive + POST 组合）
  }

  // 回传乐观累加后的值：调用方可以直接 setState，
  // 玩家答完立刻看到包含自己这一票的正确率，不必等下一轮查询
  return next
}
