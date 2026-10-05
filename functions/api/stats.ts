/**
 * 查询题目作答统计：GET /api/stats?ids=a,b,c
 *
 * 放在 Pages Functions 而不是独立 Worker，是为了**和前端同域名**。
 * 独立 Worker 只能用 *.workers.dev 域名，而这个域名在部分网络下不可达
 * （实测三个公共 DNS 都解析到 168.143.171.189，但当前网络连不上），
 * 结果就是「网站能打开、正确率却永远加载不出来」。
 * 同域名还有个附带好处：根本不存在跨域问题。
 *
 * ── 安全 ──────────────────────────────────────────────────
 * SQL 一律用 ? 占位符 + bind；题 id 过白名单；单次最多查 50 个。
 */
interface StatRow {
  question_id: string
  attempts: number
  correct: number
}

/** 题 id 白名单：只认字母数字与 _ - . : ，长度 ≤ 80 */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/

export async function onRequestGet(context: {
  request: Request
  env: { answermc_stats?: D1Database }
}): Promise<Response> {
  const db = context.env.answermc_stats
  const url = new URL(context.request.url)
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => SAFE_ID.test(id))
    .slice(0, 50)

  // 没绑定 D1 时返回空而不是报错 —— 统计是增强项，不能因为它把答题界面搞崩
  if (!db || ids.length === 0) {
    return new Response(JSON.stringify({ stats: [] }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const placeholders = ids.map(() => '?').join(',')
  const result = await db
    .prepare(
      `SELECT question_id, attempts, correct
       FROM answer_stats
       WHERE question_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<StatRow>()

  return new Response(JSON.stringify({ stats: result.results ?? [] }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
