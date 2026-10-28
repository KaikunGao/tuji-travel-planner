/**
 * 途迹 · AI 代理（Cloudflare Worker）
 *
 * 网页不再需要访客自己的 Key：请求发到这里，由 Worker 用站长的 Key 转发给 Anthropic。
 * 防刷措施：
 *  - 只接受来自 ALLOWED_ORIGINS 的请求
 *  - 每个访客（按 IP 哈希）每天最多 DAILY_IP_LIMIT 次生成，全站每天最多 DAILY_GLOBAL_LIMIT 次
 *  - 只允许 ALLOWED_MODELS 里的模型，max_tokens 封顶
 *  - 可选邀请码 ACCESS_CODE（设了之后请求头必须带对）
 *
 * 一次「生成」= 两个请求（景点 + 餐厅），网页在第一个请求上带 x-tuji-generation: start，只有它计入额度。
 */
export interface Env {
  ANTHROPIC_API_KEY: string
  ACCESS_CODE?: string
  QUOTA: KVNamespace
  ALLOWED_ORIGINS: string
  DAILY_IP_LIMIT: string
  DAILY_GLOBAL_LIMIT: string
  ALLOWED_MODELS: string
  MAX_TOKENS_CAP: string
}

const UPSTREAM = 'https://api.anthropic.com/v1/messages'

function corsHeaders(origin: string | null, env: Env, request?: Request): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  const ok = origin && allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0] ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': request?.headers.get('Access-Control-Request-Headers') ?? '*',
    'Access-Control-Expose-Headers': 'request-id, x-tuji-remaining',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function apiError(status: number, type: string, message: string, headers: Record<string, string>): Response {
  // 与 Anthropic 的错误格式一致，这样网页端的 SDK 能正常解析
  return json(status, { type: 'error', error: { type, message } }, headers)
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`tuji:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function bump(env: Env, key: string): Promise<number> {
  const cur = Number((await env.QUOTA.get(key)) ?? '0') + 1
  await env.QUOTA.put(key, String(cur), { expirationTtl: 60 * 60 * 48 })
  return cur
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env, request)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return json(200, { ok: true, service: 'tuji-ai-proxy', dailyIpLimit: Number(env.DAILY_IP_LIMIT), models: env.ALLOWED_MODELS.split(',') }, cors)
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') {
      return apiError(404, 'not_found_error', '只支持 POST /v1/messages', cors)
    }

    // 来源校验（基础防护，配合限流使用）
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    if (!origin || !allowed.includes(origin)) {
      return apiError(403, 'permission_error', '这个代理只服务途迹网页本身', cors)
    }
    // 可选邀请码
    if (env.ACCESS_CODE && request.headers.get('x-access-code') !== env.ACCESS_CODE) {
      return apiError(401, 'authentication_error', '邀请码不正确，请在设置里填写', cors)
    }
    if (!env.ANTHROPIC_API_KEY) {
      return apiError(500, 'api_error', '站长还没有配置 API Key', cors)
    }

    // 限流：只在一次生成的第一个请求上计数
    const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0'
    const ipKey = `ip:${await hashIp(ip)}:${today()}`
    const globalKey = `global:${today()}`
    const ipLimit = Number(env.DAILY_IP_LIMIT) || 3
    const globalLimit = Number(env.DAILY_GLOBAL_LIMIT) || 40
    const isStart = request.headers.get('x-tuji-generation') === 'start'
    if (isStart) {
      const g = Number((await env.QUOTA.get(globalKey)) ?? '0')
      if (g >= globalLimit) return apiError(429, 'rate_limit_error', '今天全站的 AI 生成额度已用完，明天再来，或在设置里填自己的 API Key', cors)
      const used = Number((await env.QUOTA.get(ipKey)) ?? '0')
      if (used >= ipLimit) return apiError(429, 'rate_limit_error', `每位访客每天最多生成 ${ipLimit} 座城市，今天的额度已用完；可在设置里填自己的 API Key 继续`, cors)
      await Promise.all([bump(env, ipKey), bump(env, globalKey)])
    } else {
      // 第二步请求：必须是今天已经开始过生成的访客
      const used = Number((await env.QUOTA.get(ipKey)) ?? '0')
      if (used === 0) return apiError(429, 'rate_limit_error', '请求顺序不对，请重新开始生成', cors)
    }

    // 收紧请求参数
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return apiError(400, 'invalid_request_error', '请求体不是合法 JSON', cors)
    }
    const models = env.ALLOWED_MODELS.split(',').map((s) => s.trim()).filter(Boolean)
    if (typeof body.model !== 'string' || !models.includes(body.model)) body.model = models[0]
    const cap = Number(env.MAX_TOKENS_CAP) || 48000
    if (typeof body.max_tokens !== 'number' || body.max_tokens > cap) body.max_tokens = cap
    delete body.fallbacks // 站长 Key 下不启用回退，避免额外计费

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') ?? '2023-06-01',
    }
    const beta = request.headers.get('anthropic-beta')
    if (beta) headers['anthropic-beta'] = beta.split(',').filter((b) => !b.includes('fallback')).join(',')

    const upstream = await fetch(UPSTREAM, { method: 'POST', headers, body: JSON.stringify(body) })
    // 上游没成功（Key 失效、服务故障、被限流等）就把这次额度退回去
    if (!upstream.ok && isStart) {
      const refund = async (key: string) => {
        const cur = Number((await env.QUOTA.get(key)) ?? '0')
        if (cur > 0) await env.QUOTA.put(key, String(cur - 1), { expirationTtl: 60 * 60 * 48 })
      }
      await Promise.all([refund(ipKey), refund(globalKey)])
    }
    const remaining = Math.max(0, ipLimit - Number((await env.QUOTA.get(ipKey)) ?? '0'))
    const out = new Headers(cors)
    out.set('content-type', upstream.headers.get('content-type') ?? 'application/json')
    out.set('x-tuji-remaining', String(remaining))
    const reqId = upstream.headers.get('request-id')
    if (reqId) out.set('request-id', reqId)
    return new Response(upstream.body, { status: upstream.status, headers: out })
  },
} satisfies ExportedHandler<Env>
