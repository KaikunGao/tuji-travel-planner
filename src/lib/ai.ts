/**
 * 用 Claude 为任意城市生成景点 / 美食数据（可选功能，需要用户自己的 API Key）。
 * 直接在浏览器里调用官方 SDK，Key 只保存在本机 localStorage。
 */
import Anthropic from '@anthropic-ai/sdk'
import type { Attraction, City, Restaurant, RestaurantReview } from '../types'
import { INTERESTS } from '../types'
import { haversine } from './geo'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5（推荐，质量最好）' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5（更快）' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5（最便宜）' },
] as const

export interface GenerateProgress {
  phase: 'attractions' | 'restaurants' | 'parsing'
  chars: number
  elapsedMs: number
}

const BEST_TIMES = ['morning', 'afternoon', 'evening', 'night', 'any']
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'night']

/** 精简的 JSON Schema：只描述结构，不放 description / enum（枚举值在清洗时校验），避免 API 编译语法超限 */
const str = { type: 'string' }
const numS = { type: 'number' }
const int = { type: 'integer' }
const bool = { type: 'boolean' }
const strList = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })

const reviewSchema = obj({ summary: str, pros: strList, cons: strList, bestFor: str })

const attractionSchema = obj({
  id: str, name: str, area: str, category: str, tags: strList, lat: numS, lng: numS, duration: int, rating: numS, price: numS,
  openHours: str, closedOn: { type: 'array', items: int }, description: str, tips: strList, mustSee: bool, bestTime: str,
  suburb: bool, needBooking: bool, photoSpots: strList,
})

const restaurantSchema = obj({
  id: str, name: str, cuisine: str, area: str, lat: numS, lng: numS, avgPrice: numS, rating: numS, mustOrder: strList,
  openHours: str, waitTime: str, tags: strList, mealTypes: strList, review: reviewSchema, warning: str,
})

/** 第一步：城市信息 + 景点 */
const cityStepSchema = obj({
  id: str, name: str, nameEn: str, province: str, tagline: str, emoji: str, gradient: strList,
  center: obj({ lat: numS, lng: numS }), defaultZoom: int, bestSeason: str, suggestedDays: str,
  transportTips: strList, tips: strList, avoid: strList,
  attractions: { type: 'array', items: attractionSchema },
})

/** 第二步：餐厅 + 笔记 */
const restaurantStepSchema = obj({ restaurants: { type: 'array', items: restaurantSchema } })

const SYSTEM_PROMPT = `你是一位资深的中文旅行编辑，熟悉全球城市的景点、交通和餐厅，也非常了解小红书上的旅行与美食笔记风格。
你在为「途迹」旅行规划应用生成一座城市的结构化数据，用于自动规划「不走回头路」的游览路线并推荐周边美食。内容全部用简体中文（nameEn 和 id 除外），严格按要求的 JSON 结构输出。

字段说明：
- id：小写英文/数字/连字符、字母开头、城市内唯一
- area：「区·片区」格式，如「东城·中轴线」，同一片区名字保持一致
- category 只能是：历史文化 / 自然风光 / 网红打卡 / 博物馆艺术 / 美食探店 / 购物 / 亲子 / 夜生活 / 建筑 / 宗教
- bestTime 只能是：morning / afternoon / evening / night / any
- openHours："HH:MM-HH:MM" 或 "全天"；closedOn 为每周闭馆日数组（0=周日…6=周一是 1），没有则 []
- 坐标必须是 WGS-84（GPS / OpenStreetMap 坐标系，不是高德或百度坐标），尽量准确
- 价格用人民币（境外城市换算成人民币）；没有的字符串字段填 ""，没有的数组填 []
- mealTypes 只能包含：breakfast / lunch / dinner / snack / night
- review（综合评价）：根据你对这家店公开评价的了解，用第三人称中立语气综合陈述。summary 40-90 字一句话总评；pros 2-4 条「大家喜欢的点」，每条 ≤25 字；cons 1-3 条「注意与吐槽」（排队、价格、口味偏好、服务等），每条 ≤25 字，必须至少 1 条；bestFor ≤20 字的适合场景。不要 emoji、不要话题标签、不要网络用语（如姐妹们/绝绝子）、不要编造具体的点赞数或用户。`

const ATTRACTIONS_PROMPT = (cityName: string, today: string) =>
  `请为城市「${cityName}」生成城市信息和 14-18 个景点。今天是 ${today}。
要求：全部真实、知名；覆盖至少 5 种 category；4-6 个 mustSee；至少 2 个 bestTime 为 evening/night 的夜景或商圈；远郊景点（距市中心 >20km）标 suburb=true 且最多 2 个；博物馆周一闭馆写 closedOn=[1]；需预约的写 needBooking=true；description 60-140 字；tips 2-3 条；gradient 为两个 #RRGGBB 颜色；transportTips 3 条、tips 4-5 条、avoid 3 条（具体避雷）。`

const RESTAURANTS_PROMPT = (cityName: string, attractions: { name: string; area: string; lat: number; lng: number }[]) =>
  `请为城市「${cityName}」生成 12-15 家真实、有名的餐厅（老字号 / 本地人推荐 / 必吃榜 / 网红店等），写出具体分店，坐标放在该分店附近。
这座城市的景点如下（名称｜片区｜纬度｜经度），请保证每个非远郊景点 2km 内至少有 1 家餐厅：
${attractions.map((a) => `${a.name}｜${a.area}｜${a.lat}｜${a.lng}`).join('\n')}
要求：菜系多样；mealTypes 准确，至少 2 家提供 breakfast、3 家提供 snack、7 家提供 lunch、7 家提供 dinner；1 家带 warning 的避雷店（rating 3.8-4.0）；每家一段综合评价（review）。`

function slug(s: string, fallback: string): string {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z]/.test(v) ? v : fallback
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
}

/** 把模型输出清洗成严格符合 City 类型的数据 */
export function normalizeCity(raw: Record<string, unknown>, requestedName: string): City {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : requestedName
  const id = `ai-${slug(String(raw.id ?? raw.nameEn ?? ''), 'city')}-${Date.now().toString(36).slice(-4)}`
  const center = raw.center as { lat?: number; lng?: number } | undefined
  const attractionsRaw = Array.isArray(raw.attractions) ? (raw.attractions as Record<string, unknown>[]) : []
  const restaurantsRaw = Array.isArray(raw.restaurants) ? (raw.restaurants as Record<string, unknown>[]) : []

  const usedIds = new Set<string>()
  const uniqueId = (base: string, prefix: string) => {
    let v = slug(base, prefix)
    if (!v) v = prefix
    let candidate = v
    let i = 2
    while (usedIds.has(candidate)) candidate = `${v}-${i++}`
    usedIds.add(candidate)
    return candidate
  }

  const attractions: Attraction[] = attractionsRaw
    .filter((a) => typeof a.name === 'string' && typeof a.lat === 'number' && typeof a.lng === 'number')
    .map((a, i) => {
      const category = (INTERESTS as readonly string[]).includes(String(a.category)) ? (a.category as Attraction['category']) : '历史文化'
      const bestTime = BEST_TIMES.includes(String(a.bestTime)) ? (a.bestTime as Attraction['bestTime']) : 'any'
      const closedOn = Array.isArray(a.closedOn) ? (a.closedOn as unknown[]).filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6) : []
      const photoSpots = strArr(a.photoSpots)
      return {
        id: uniqueId(String(a.id ?? `spot-${i}`), `spot-${i}`),
        name: String(a.name),
        area: typeof a.area === 'string' && a.area ? a.area : name,
        category,
        tags: strArr(a.tags),
        lat: a.lat as number,
        lng: a.lng as number,
        duration: Math.min(600, Math.max(20, Math.round(num(a.duration, 90)))),
        rating: Math.min(5, Math.max(3.5, num(a.rating, 4.3))),
        price: Math.max(0, num(a.price, 0)),
        openHours: typeof a.openHours === 'string' && a.openHours ? a.openHours : '全天',
        closedOn: closedOn.length ? closedOn : undefined,
        description: String(a.description ?? ''),
        tips: strArr(a.tips).slice(0, 4),
        mustSee: Boolean(a.mustSee),
        bestTime,
        suburb: Boolean(a.suburb) || undefined,
        needBooking: Boolean(a.needBooking) || undefined,
        photoSpots: photoSpots.length ? photoSpots : undefined,
      }
    })

  const restaurants: Restaurant[] = restaurantsRaw
    .filter((r) => typeof r.name === 'string' && typeof r.lat === 'number' && typeof r.lng === 'number')
    .map((r, i) => {
      const rv = (r.review && typeof r.review === 'object' ? r.review : {}) as Record<string, unknown>
      const review: RestaurantReview = {
        summary: String(rv.summary ?? '').trim() || `${String(r.name)}是当地有口碑的${String(r.cuisine ?? '餐厅')}，人均约 ${Math.round(num(r.avgPrice, 80))} 元。`,
        pros: strArr(rv.pros).slice(0, 4),
        cons: strArr(rv.cons).slice(0, 3),
        bestFor: typeof rv.bestFor === 'string' && rv.bestFor.trim() ? rv.bestFor.trim() : undefined,
      }
      const mealTypes = strArr(r.mealTypes).filter((m) => MEAL_TYPES.includes(m)) as Restaurant['mealTypes']
      return {
        id: uniqueId(String(r.id ?? `food-${i}`), `food-${i}`),
        name: String(r.name),
        cuisine: String(r.cuisine ?? '当地菜'),
        area: typeof r.area === 'string' && r.area ? r.area : name,
        lat: r.lat as number,
        lng: r.lng as number,
        avgPrice: Math.max(5, num(r.avgPrice, 80)),
        rating: Math.min(5, Math.max(3.5, num(r.rating, 4.3))),
        mustOrder: strArr(r.mustOrder),
        openHours: typeof r.openHours === 'string' && r.openHours ? r.openHours : '10:00-21:00',
        waitTime: typeof r.waitTime === 'string' && r.waitTime.trim() ? r.waitTime : undefined,
        tags: strArr(r.tags),
        mealTypes: mealTypes.length ? mealTypes : ['lunch', 'dinner'],
        review,
        warning: typeof r.warning === 'string' && r.warning.trim() ? r.warning : undefined,
      }
    })

  const all = [...attractions, ...restaurants]
  const lats = all.map((p) => p.lat)
  const lngs = all.map((p) => p.lng)
  const c = {
    lat: num(center?.lat, lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 0),
    lng: num(center?.lng, lngs.length ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : 0),
  }
  // 丢掉离中心 300km 以上的离谱坐标
  const sane = <T extends { lat: number; lng: number }>(xs: T[]) => xs.filter((p) => haversine(p, c) < 300)
  const attractionsOk = sane(attractions)
  const restaurantsOk = sane(restaurants)
  const pts = [...attractionsOk, ...restaurantsOk, c]
  const pad = 0.05
  const gradient = strArr(raw.gradient).filter((g) => /^#[0-9a-fA-F]{6}$/.test(g))

  return {
    id,
    name,
    nameEn: String(raw.nameEn ?? name),
    province: typeof raw.province === 'string' ? raw.province : undefined,
    tagline: String(raw.tagline ?? `${name}，值得慢慢走`),
    emoji: String(raw.emoji ?? '🧭'),
    gradient: gradient.length === 2 ? [gradient[0], gradient[1]] : ['#1f6f78', '#e8553d'],
    center: c,
    bbox: {
      minLat: Math.min(...pts.map((p) => p.lat)) - pad,
      maxLat: Math.max(...pts.map((p) => p.lat)) + pad,
      minLng: Math.min(...pts.map((p) => p.lng)) - pad,
      maxLng: Math.max(...pts.map((p) => p.lng)) + pad,
    },
    defaultZoom: Math.min(14, Math.max(9, Math.round(num(raw.defaultZoom, 12)))),
    bestSeason: String(raw.bestSeason ?? ''),
    suggestedDays: String(raw.suggestedDays ?? '2-3 天'),
    transportTips: strArr(raw.transportTips),
    tips: strArr(raw.tips),
    avoid: strArr(raw.avoid),
    attractions: attractionsOk,
    restaurants: restaurantsOk,
    source: 'ai',
  }
}

export class AiGenerateError extends Error {}

function parseJsonLenient(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const a = cleaned.indexOf('{')
    const b = cleaned.lastIndexOf('}')
    if (a < 0 || b <= a) throw new AiGenerateError('模型没有返回有效的 JSON，请重试')
    try {
      return JSON.parse(cleaned.slice(a, b + 1)) as Record<string, unknown>
    } catch {
      throw new AiGenerateError('模型返回的 JSON 不完整，请重试（可换用更强的模型）')
    }
  }
}

interface JsonCallOptions {
  client: Anthropic
  model: string
  schema: Record<string, unknown>
  user: string
  signal?: AbortSignal
  onChars: (chars: number) => void
}

/**
 * 请求一段 JSON：优先用结构化输出保证格式；若 API 报 schema 语法过大，自动退回纯文本 JSON 模式。
 */
async function requestJson(o: JsonCallOptions): Promise<Record<string, unknown>> {
  const supportsFallback = /opus-5-5|sonnet-5-5|fable-5/.test(o.model)
  const run = async (structured: boolean) => {
    const stream = o.client.beta.messages.stream(
      {
        model: o.model,
        max_tokens: 48000,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: 'medium',
          ...(structured ? { format: { type: 'json_schema' as const, schema: o.schema } } : {}),
        },
        messages: [
          {
            role: 'user',
            content: structured
              ? o.user
              : `${o.user}\n\n输出要求：只输出一个 JSON 对象，不要任何解释，不要 Markdown 代码块。JSON 结构必须严格符合这个 JSON Schema：\n${JSON.stringify(o.schema)}`,
          },
        ],
        ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: o.signal },
    )
    stream.on('text', (_delta, snapshot) => o.onChars(snapshot.length))
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new AiGenerateError('模型拒绝了这次请求，请换个城市名再试')
    if (message.stop_reason === 'max_tokens') throw new AiGenerateError('输出被截断了，请换用更强的模型或稍后再试')
    return message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
  let text: string
  try {
    text = await run(true)
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /grammar|schema/i.test(e.message)) {
      text = await run(false)
    } else throw e
  }
  return parseJsonLenient(text)
}

/**
 * 生成城市数据：第一步城市信息 + 景点，第二步餐厅 + 笔记（按景点位置就近安排）。
 */
export async function generateCity(
  cityName: string,
  opts: { apiKey: string; model: string; signal?: AbortSignal; onProgress?: (p: GenerateProgress) => void },
): Promise<City> {
  if (!opts.apiKey.trim()) throw new AiGenerateError('请先在设置里填写 Anthropic API Key')
  const started = Date.now()
  const report = (phase: GenerateProgress['phase'], chars: number) =>
    opts.onProgress?.({ phase, chars, elapsedMs: Date.now() - started })

  const client = new Anthropic({
    apiKey: opts.apiKey.trim(),
    dangerouslyAllowBrowser: true, // 个人工具：Key 只存在用户自己的浏览器里
    maxRetries: 1,
  })
  const today = new Date().toISOString().slice(0, 10)

  report('attractions', 0)
  const step1 = await requestJson({
    client,
    model: opts.model,
    schema: cityStepSchema,
    user: ATTRACTIONS_PROMPT(cityName, today),
    signal: opts.signal,
    onChars: (c) => report('attractions', c),
  })
  const attractionsRaw = (Array.isArray(step1.attractions) ? (step1.attractions as Record<string, unknown>[]) : [])
    .filter((a) => typeof a.name === 'string' && typeof a.lat === 'number' && typeof a.lng === 'number')
  if (attractionsRaw.length < 5) throw new AiGenerateError('生成的景点太少，请重试')

  report('restaurants', 0)
  const step2 = await requestJson({
    client,
    model: opts.model,
    schema: restaurantStepSchema,
    user: RESTAURANTS_PROMPT(
      cityName,
      attractionsRaw
        .filter((a) => !a.suburb)
        .map((a) => ({ name: String(a.name), area: String(a.area ?? ''), lat: a.lat as number, lng: a.lng as number })),
    ),
    signal: opts.signal,
    onChars: (c) => report('restaurants', c),
  })

  report('parsing', 0)
  const city = normalizeCity({ ...step1, restaurants: step2.restaurants }, cityName)
  if (city.attractions.length < 5) throw new AiGenerateError('生成的景点太少，请重试')
  return city
}

/** 把 SDK 的错误翻译成用户能看懂的提示 */
export function describeAiError(err: unknown): string {
  if (err instanceof AiGenerateError) return err.message
  if (err instanceof Anthropic.AuthenticationError) return 'API Key 无效，请检查设置'
  if (err instanceof Anthropic.PermissionDeniedError) return '这个 Key 没有权限使用所选模型'
  if (err instanceof Anthropic.RateLimitError) return '请求太频繁，稍等一下再试'
  if (err instanceof Anthropic.BadRequestError) return `请求参数有误：${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return '连不上 Anthropic API，请检查网络'
  if (err instanceof Anthropic.APIError) return `API 错误 ${err.status ?? ''}：${err.message}`
  if (err instanceof Error && err.name === 'AbortError') return '已取消'
  return err instanceof Error ? err.message : '未知错误'
}
