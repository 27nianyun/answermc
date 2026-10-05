/**
 * 上报一次作答：POST /api/report  { id, ok }
 *
 * 只存「题 id + 次数」，不存 IP、UA 或任何用户标识 ——
 * 正确率是聚合值，收集身份信息对个人隐私是负担，对功能也没有帮助。
 *
 * ── 安全 ──────────────────────────────────────────────────
 * · SQL 一律用 ? 占位符 + bind，绝不字符串拼接用户输入。
 * · id 过白名单（字母数字与 _ - . :，长度 ≤ 80）；ok 强制 0/1。
 * · 只写匿名聚合计数，不存任何用户态数据，也就没有「越权读写他人数据」一说。
 * · 不返回 CORS 头：前端与 /api 同域（Pages Functions），同源请求不需要
 *   预检；缺省即拒绝跨域写入，避免任意第三方网站替用户给计数器灌水。
 */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/

export async function onRequestPost(context: {
  request: Request
  env: { answermc_stats?: D1Database }
  waitUntil: (promise: Promise<unknown>) => void
}): Promise<Response> {
  const db = context.env.answermc_stats
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }

  let body: { id?: unknown; ok?: unknown }
  try {
    body = (await context.request.json()) as { id?: unknown; ok?: unknown }
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!SAFE_ID.test(id)) {
    return new Response(JSON.stringify({ error: 'invalid id' }), { status: 400, headers })
  }
  if (!db) {
    return new Response(JSON.stringify({ ok: false, skipped: true }), { headers })
  }

  const ok = body.ok === true ? 1 : 0
  const now = new Date().toISOString()

  /*
  写入放进 waitUntil：不阻塞响应，玩家不用等数据库写完。
  Cloudflare 保证 waitUntil 里的任务会执行完成，不会丢。
  */
  context.waitUntil(
    db
      .prepare(
        `INSERT INTO answer_stats (question_id, attempts, correct, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET
           attempts   = attempts + 1,
           correct    = correct + excluded.correct,
           updated_at = excluded.updated_at`,
      )
      .bind(id, ok, now)
      .run(),
  )

  return new Response(JSON.stringify({ ok: true }), { headers })
}
