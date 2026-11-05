/**
 * 行程审计：给任意一份行程（携程 / 小红书 / 通用 agent / 手工攻略）按途迹的规则算指标，
 * 并和「同样分天但途迹排序」「途迹整体规划」做对照。
 *
 * 用法：npx tsx scripts/audit-plan.ts <plan.txt | plan.json>
 *
 * 文本格式（可直接把别家的行程整理成这样贴进来）：
 *   city: src/data/cities/beijing.ts
 *   label: 携程 AI 行程助手 · 不绕路
 *   date: 2026-11-09          # 首日日期，可选；用于判断闭馆日
 *   start: 09:00              # 每天出发时间，可选，默认 09:00
 *   transport: balanced       # balanced / walk / transit / taxi，可选
 *   Day 1: 天安门广场 → 故宫 → 景山公园 → 什刹海 → 四季民福烤鸭店
 *   Day 2: 颐和园 → 圆明园 → 鸟巢
 *   第三天：天坛 → 前门 → 国博 → 王府井
 *   extra: 钟鼓楼 | 39.9405,116.3886 | 60 | 09:00-17:00 | 20     # 库里没有的点：名称 | 坐标 | 时长分钟 | 开放时间 | 门票
 *
 * 指标口径与规划器一致：直线距离 × 1.3 估路程，开放时间 / 闭馆日 / 游玩时长来自城市数据，
 * 最优路径用同一个 Held-Karp（≤13 个点精确求解）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Attraction, City, MealType, PlanVariant, Restaurant, TransportPref } from '../src/types'
import { DEFAULT_FOOD_PREFS } from '../src/types'
import { estimateLeg, haversine, type LatLng } from '../src/lib/geo'
import { isSuburb, orderDay, pathLength, planTrip, shortestOpenPath } from '../src/lib/planner'
import { hhmmToMinutes, minutesToHHMM, parseOpenHours, weekdayOf, WEEKDAY, addDays } from '../src/lib/format'

/* ------------------------------------------------------------------ */
/* 输入解析                                                             */
/* ------------------------------------------------------------------ */

interface ExtraPoint {
  name: string
  lat: number
  lng: number
  duration: number
  openHours: string
  price: number
  closedOn?: number[]
}

interface InputPlan {
  city: string
  label: string
  date?: string
  start: string
  transport: TransportPref
  days: { stops: string[]; times?: (string | undefined)[] }[]
  extra: ExtraPoint[]
}

function parseInput(file: string): InputPlan {
  const raw = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.json')) {
    const j = JSON.parse(raw)
    return { label: '对照行程', start: '09:00', transport: 'balanced', extra: [], ...j }
  }
  const plan: InputPlan = { city: '', label: '对照行程', start: '09:00', transport: 'balanced', days: [], extra: [] }
  const DAY_RE = /^\s*(?:day\s*(\d+)|d(\d+)|第\s*([一二三四五六七八九十\d]+)\s*天)\s*[:：]?\s*(.*)$/i
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.replace(/#.*$/, '').trim()
    if (!line) continue
    const kv = line.match(/^(city|label|date|start|transport|extra)\s*[:：]\s*(.+)$/i)
    if (kv) {
      const key = kv[1].toLowerCase()
      const val = kv[2].trim()
      if (key === 'extra') {
        const [name, coord, dur = '60', open = '全天', price = '0', closed = ''] = val.split('|').map((s) => s.trim())
        const [lat, lng] = coord.split(/[,，]/).map(Number)
        plan.extra.push({
          name,
          lat,
          lng,
          duration: Number(dur) || 60,
          openHours: open,
          price: Number(price) || 0,
          closedOn: closed ? closed.split(/[,，]/).map(Number) : undefined,
        })
      } else if (key === 'transport') plan.transport = val as TransportPref
      else (plan as unknown as Record<string, string>)[key] = val
      continue
    }
    const m = line.match(DAY_RE)
    if (!m) continue
    const body = m[4]
    const stops: string[] = []
    const times: (string | undefined)[] = []
    for (const tok0 of body.split(/→|->|—>|=>|>|、|，|,|\/|\||;|；/)) {
      let tok = tok0.replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, '').trim()
      if (!tok) continue
      const t = tok.match(/(\d{1,2}[:：]\d{2})/)
      times.push(t ? t[1].replace('：', ':') : undefined)
      tok = tok.replace(/\d{1,2}[:：]\d{2}\s*[-–~至]?\s*(\d{1,2}[:：]\d{2})?/g, '').trim()
      tok = tok.replace(/^(上午|下午|中午|晚上|傍晚|早上|清晨|夜晚)\s*/, '').trim()
      if (tok) stops.push(tok)
    }
    if (stops.length) plan.days.push({ stops, times })
  }
  if (!plan.city) throw new Error('缺少 city: 行，例如 city: src/data/cities/beijing.ts')
  return plan
}

/* ------------------------------------------------------------------ */
/* 名称匹配                                                             */
/* ------------------------------------------------------------------ */

type Point = (LatLng & { kind: 'attraction'; a: Attraction }) | (LatLng & { kind: 'meal'; r: Restaurant }) | (LatLng & { kind: 'extra'; e: ExtraPoint })

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s·•．.\-—–_()（）【】\[\]「」'"“”]/g, '')
    .replace(/(公园|景区|风景区|博物院|博物馆|艺术区|步行街|大街|胡同|广场|公园)$/g, (x) => x)
}

const STRIP_SUFFIX = /(公园|景区|风景区|博物院|博物馆|艺术区|步行街|大街|太古里|度假区)$/

function nameParts(name: string): string[] {
  const parts = name.split(/·|与|和|、/).map((p) => norm(p)).filter(Boolean)
  const full = norm(name)
  const extras = parts.map((p) => p.replace(STRIP_SUFFIX, '')).filter((p) => p.length >= 2)
  return [...new Set([full, ...parts, ...extras])]
}

function matchScore(query: string, name: string): number {
  const q = norm(query)
  const qs = q.replace(STRIP_SUFFIX, '')
  const parts = nameParts(name)
  if (parts.includes(q)) return 100
  if (qs.length >= 2 && parts.includes(qs)) return 95
  for (const p of parts) {
    if (p.length >= 2 && (p.includes(q) || q.includes(p))) return 60 + Math.min(30, Math.min(p.length, q.length) * 5)
    if (qs.length >= 2 && (p.includes(qs) || qs.includes(p))) return 55 + Math.min(30, Math.min(p.length, qs.length) * 5)
  }
  // 缩写：查询的字按顺序出现在名称里（国博 → 中国国家博物馆、十三陵 → 明十三陵）
  if (q.length >= 2 && q.length <= 4) {
    for (const p of parts) if (p.length > q.length && isSubsequence(q, p)) return 62
  }
  return 0
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) if (ch === q[i]) i++
  return i === q.length
}

function resolve(city: City, extra: ExtraPoint[], name: string): { point: Point | null; via: string } {
  let best: { score: number; point: Point; via: string } | null = null
  const consider = (score: number, point: Point, via: string) => {
    if (score > 0 && (!best || score > best.score)) best = { score, point, via }
  }
  const bump = (s: number, by: number) => (s > 0 ? s + by : 0)
  for (const e of extra) consider(bump(matchScore(name, e.name), 1), { kind: 'extra', e, lat: e.lat, lng: e.lng }, `补充点 ${e.name}`)
  for (const a of city.attractions) consider(matchScore(name, a.name), { kind: 'attraction', a, lat: a.lat, lng: a.lng }, a.name)
  for (const r of city.restaurants) consider(bump(matchScore(name, r.name), -1), { kind: 'meal', r, lat: r.lat, lng: r.lng }, `餐厅 ${r.name}`)
  if (!best) return { point: null, via: '' }
  const b = best as { score: number; point: Point; via: string }
  return b.score >= 60 ? { point: b.point, via: b.via } : { point: null, via: `疑似 ${b.via}（相似度不足）` }
}

/* ------------------------------------------------------------------ */
/* 指标                                                                 */
/* ------------------------------------------------------------------ */

const MEAL_DURATION: Record<MealType, number> = { breakfast: 40, lunch: 60, dinner: 75, snack: 40, night: 60 }

interface DayMetrics {
  label: string
  stops: string[]
  attractions: number
  meals: number
  legKm: number
  walkKm: number
  straightKm: number
  optimalStraightKm: number
  uturns: number
  returns: number
  closedDay: number
  arriveClosed: number
  tooShort: number
  idleMin: number
  needBooking: string[]
  lunchOk: boolean | null
  dinnerOk: boolean | null
  lunchAt?: string
  tickets: number
  food: number
  transport: number
  endMin: number
  warnings: string[]
}

function toXY(p: LatLng, origin: LatLng): { x: number; y: number } {
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180)
  return { x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * 110.57 }
}

function countTurns(points: LatLng[], start: LatLng): { uturns: number; returns: number } {
  const seq = [start, ...points]
  let uturns = 0
  let returns = 0
  for (let i = 1; i < seq.length - 1; i++) {
    const a = toXY(seq[i - 1], start)
    const b = toXY(seq[i], start)
    const c = toXY(seq[i + 1], start)
    const v1 = { x: b.x - a.x, y: b.y - a.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (l1 < 0.5 || l2 < 0.5) continue
    const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)
    if (cos < -0.5) uturns++
  }
  // 折返：离开一个片区超过 1.5km 后又回到之前去过的点 0.8km 以内
  for (let i = 2; i < points.length; i++) {
    const leg = haversine(points[i - 1], points[i])
    if (leg < 1.5) continue
    for (let k = 0; k < i - 1; k++) {
      if (haversine(points[i], points[k]) < 0.8) {
        returns++
        break
      }
    }
  }
  return { uturns, returns }
}

function auditDay(label: string, points: Point[], start: LatLng, startMin: number, date: string | undefined, transport: TransportPref): DayMetrics {
  const m: DayMetrics = {
    label,
    stops: points.map((p) => (p.kind === 'attraction' ? p.a.name : p.kind === 'meal' ? p.r.name : p.e.name)),
    attractions: points.filter((p) => p.kind !== 'meal').length,
    meals: points.filter((p) => p.kind === 'meal').length,
    legKm: 0,
    walkKm: 0,
    straightKm: 0,
    optimalStraightKm: 0,
    uturns: 0,
    returns: 0,
    closedDay: 0,
    arriveClosed: 0,
    tooShort: 0,
    idleMin: 0,
    needBooking: [],
    lunchOk: null,
    dinnerOk: null,
    tickets: 0,
    food: 0,
    transport: 0,
    endMin: startMin,
    warnings: [],
  }
  if (!points.length) return m
  m.straightKm = pathLength(points, start)
  m.optimalStraightKm = pathLength(shortestOpenPath(points, start), start)
  Object.assign(m, countTurns(points, start))

  let t = startMin
  let pos: LatLng = start
  let hadLunch = false
  let hadDinner = false
  const weekday = date ? weekdayOf(date) : undefined
  for (const p of points) {
    const leg = estimateLeg(pos, p, transport)
    m.legKm += leg.distanceKm
    if (leg.mode === 'walk') m.walkKm += leg.distanceKm
    m.transport += leg.cost
    let arrive = t + leg.minutes
    if (p.kind === 'meal') {
      const type: MealType = arrive < 15 * 60 ? 'lunch' : arrive < 17 * 60 ? 'snack' : 'dinner'
      if (type === 'lunch') {
        hadLunch = true
        m.lunchOk = arrive >= 11 * 60 && arrive <= 14 * 60
        m.lunchAt = minutesToHHMM(arrive)
      }
      if (type === 'dinner') {
        hadDinner = true
        m.dinnerOk = arrive >= 17 * 60 && arrive <= 20 * 60 + 30
      }
      m.food += p.r.avgPrice
      t = arrive + MEAL_DURATION[type]
      pos = p
      continue
    }
    const name = p.kind === 'attraction' ? p.a.name : p.e.name
    const openHours = p.kind === 'attraction' ? p.a.openHours : p.e.openHours
    const duration = p.kind === 'attraction' ? p.a.duration : p.e.duration
    const closedOn = p.kind === 'attraction' ? p.a.closedOn : p.e.closedOn
    const price = p.kind === 'attraction' ? p.a.price : p.e.price
    if (p.kind === 'attraction' && p.a.needBooking) m.needBooking.push(p.a.name)
    const [open, close] = parseOpenHours(openHours)
    if (arrive < open) {
      const wait = open - arrive
      if (wait >= 40) {
        m.idleMin += wait
        m.warnings.push(`${name}：比开门早到 ${wait} 分钟干等`)
      }
      arrive = open
    }
    // 午饭点落在哪里（没有安排餐厅时）
    if (!hadLunch && arrive >= 12 * 60 + 30 && arrive <= 15 * 60 && m.lunchAt === undefined) m.lunchAt = `${minutesToHHMM(arrive)} 到 ${name} 时仍未吃午饭`
    const end = arrive + duration
    if (weekday !== undefined && closedOn?.includes(weekday)) {
      m.closedDay++
      m.warnings.push(`${name}：${date} 是${WEEKDAY[weekday]}，当天闭馆`)
    } else if (close < 1440 && arrive >= close - 20) {
      m.arriveClosed++
      m.warnings.push(`${name}：预计 ${minutesToHHMM(arrive)} 到达，已接近 / 超过闭园（${openHours}）`)
    } else if (close < 1440 && end > close) {
      const left = close - arrive
      if (left < duration * 0.6) {
        m.tooShort++
        m.warnings.push(`${name}：${minutesToHHMM(arrive)} 到达，闭园前只剩 ${left} 分钟（建议 ${duration} 分钟）`)
      }
    }
    m.tickets += price
    t = end
    pos = p
  }
  if (!hadLunch) m.lunchOk = null
  if (!hadDinner) m.dinnerOk = null
  m.endMin = t
  return m
}

interface Summary {
  label: string
  days: DayMetrics[]
}

function sum(days: DayMetrics[], f: (d: DayMetrics) => number): number {
  return days.reduce((s, d) => s + f(d), 0)
}

function r1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

function pct(a: number, b: number): string {
  if (b <= 0) return '-'
  return `${Math.round(((a - b) / b) * 100)}%`
}

function printSummary(rows: Summary[]) {
  console.log('\n## 对照表\n')
  console.log('| 方案 | 景点 | 餐 | 估算路程 km | 直线 km | 比最优多 | 掉头 | 折返 | 闭馆日 | 到达已闭园 | 时间不足 | 干等 min | 门票 ¥ | 交通 ¥ | 餐 ¥ | 最晚结束 |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const row of rows) {
    const d = row.days
    const straight = sum(d, (x) => x.straightKm)
    const optimal = sum(d, (x) => x.optimalStraightKm)
    const latest = Math.max(...d.map((x) => x.endMin))
    console.log(
      `| ${row.label} | ${sum(d, (x) => x.attractions)} | ${sum(d, (x) => x.meals)} | ${r1(sum(d, (x) => x.legKm))} | ${r1(straight)} | ${pct(straight, optimal)} | ${sum(d, (x) => x.uturns)} | ${sum(d, (x) => x.returns)} | ${sum(d, (x) => x.closedDay)} | ${sum(d, (x) => x.arriveClosed)} | ${sum(d, (x) => x.tooShort)} | ${sum(d, (x) => x.idleMin)} | ${Math.round(sum(d, (x) => x.tickets))} | ${Math.round(sum(d, (x) => x.transport))} | ${Math.round(sum(d, (x) => x.food))} | ${minutesToHHMM(latest)} |`,
    )
  }
  console.log('\n说明：路程为直线 × 1.3 的估算（与途迹一致）；「比最优多」= 同一天同一批点的直线路程相对 Held-Karp 最短开放路径的超出比例；')
  console.log('掉头 = 相邻两段转向角 > 120°（两段均 ≥ 0.5km）；折返 = 离开 1.5km 以上后又回到之前去过的点 0.8km 内；')
  console.log('「同样分天 · 途迹排序」只在原分天内重排景点，改不了闭馆日冲突，也不插餐；餐费只在行程本身含餐厅时可比。')
}

function printDays(s: Summary) {
  console.log(`\n### ${s.label}`)
  for (let i = 0; i < s.days.length; i++) {
    const d = s.days[i]
    console.log(`\nDay ${i + 1} · ${d.stops.join(' → ')}`)
    console.log(`  估算路程 ${r1(d.legKm)}km（步行 ${r1(d.walkKm)}km）· 直线 ${r1(d.straightKm)}km，最优 ${r1(d.optimalStraightKm)}km（多 ${pct(d.straightKm, d.optimalStraightKm)}）· 掉头 ${d.uturns} 折返 ${d.returns} · 结束 ${minutesToHHMM(d.endMin)} · 门票 ¥${d.tickets} 餐 ¥${d.food} 交通 ¥${d.transport}`)
    if (d.needBooking.length) console.log(`  需提前预约：${d.needBooking.join('、')}`)
    if (d.lunchOk === null) console.log(`  未安排午餐${d.lunchAt ? `（${d.lunchAt}）` : ''}`)
    else console.log(`  午餐 ${d.lunchAt}${d.lunchOk ? '' : '（不在 11:00-14:00）'}`)
    if (d.dinnerOk === null) console.log('  未安排晚餐')
    for (const w of d.warnings) console.log(`  ⚠️ ${w}`)
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

const [file] = process.argv.slice(2)
if (!file) {
  console.error('用法: npx tsx scripts/audit-plan.ts <plan.txt | plan.json>')
  process.exit(1)
}
const input = parseInput(file)
const mod = await import(pathToFileURL(path.resolve(input.city)).href)
const city = Object.values(mod).find((v) => v && typeof v === 'object' && 'attractions' in (v as object)) as City
const start = city.center
const startMin = hhmmToMinutes(input.start)

console.log(`# 行程审计 · ${input.label}`)
console.log(`城市 ${city.name} · 首日 ${input.date ? `${input.date}（${WEEKDAY[weekdayOf(input.date)]}）` : '未指定'} · 出发 ${input.start} · 出行 ${input.transport}`)

// 1. 匹配
const dayPoints: Point[][] = []
const unmatched: string[] = []
console.log('\n## 名称匹配')
input.days.forEach((d, i) => {
  const pts: Point[] = []
  const lines: string[] = []
  for (const name of d.stops) {
    const { point, via } = resolve(city, input.extra, name)
    if (point) {
      pts.push(point)
      lines.push(norm(name) === norm(via.replace(/^餐厅 |^补充点 /, '')) ? name : `${name}⇒${via}`)
    } else {
      unmatched.push(name)
      lines.push(`${name}❌${via ? `（${via}）` : ''}`)
    }
  }
  dayPoints.push(pts)
  console.log(`Day ${i + 1}: ${lines.join(' · ')}`)
})
if (unmatched.length) {
  console.log(`\n未匹配 ${unmatched.length} 个：${unmatched.join('、')}。可用 extra: 名称 | lat,lng | 时长 | 开放时间 | 门票 补充；未匹配的点不计入路程与冲突。`)
}

// 2. 原顺序审计
const original: Summary = {
  label: `${input.label}（原顺序）`,
  days: dayPoints.map((pts, i) => auditDay(`Day ${i + 1}`, pts, start, startMin, input.date ? addDays(input.date, i) : undefined, input.transport)),
}

// 3. 同样分天，途迹排序（只对景点重排；餐厅由途迹按饭点另插，这里不计餐）
const reordered: Summary = {
  label: '同样分天 · 途迹排序',
  days: dayPoints.map((pts, i) => {
    const attractions = pts.filter((p): p is Extract<Point, { kind: 'attraction' }> => p.kind === 'attraction').map((p) => p.a)
    const extras = pts.filter((p): p is Extract<Point, { kind: 'extra' }> => p.kind === 'extra')
    const ordered = orderDay(attractions, start)
    const points: Point[] = [...ordered.map((a) => ({ kind: 'attraction' as const, a, lat: a.lat, lng: a.lng })), ...extras]
    return auditDay(`Day ${i + 1}`, points, start, startMin, input.date ? addDays(input.date, i) : undefined, input.transport)
  }),
}

// 4. 途迹整体规划：只给途迹同一批景点当候选（其余全部排除），让它自己分天、排序、配餐
//    a) 推荐 · 不强制：按节奏预算取舍，放不下的会报「跳过」——这是途迹对「排太满」的回答
//    b) 省钱 · 不强制
//    c) 强制全部 · 紧凑节奏：把每个点都设为必去，看硬塞的代价
const allAttr = dayPoints.flat().filter((p): p is Extract<Point, { kind: 'attraction' }> => p.kind === 'attraction').map((p) => p.a)
const uniqueIds = [...new Set(allAttr.map((a) => a.id))]
const runs: { label: string; variant: PlanVariant; pace: 'moderate' | 'intense'; force: boolean }[] = [
  { label: '途迹 · 推荐（同一批候选，不强制）', variant: 'balanced', pace: 'moderate', force: false },
  { label: '途迹 · 省钱（同一批候选，不强制）', variant: 'cheap', pace: 'moderate', force: false },
  { label: '途迹 · 强制全部 · 紧凑节奏', variant: 'balanced', pace: 'intense', force: true },
]
const tujiRows: Summary[] = []
for (const run of runs) {
  const plan = planTrip(
    city,
    {
      cityId: city.id,
      days: input.days.length,
      pace: run.pace,
      interests: [],
      startTime: input.start,
      startDate: input.date,
      mustInclude: run.force ? uniqueIds : [],
      exclude: city.attractions.filter((a) => !uniqueIds.includes(a.id)).map((a) => a.id),
      includeSuburb: allAttr.some((a) => isSuburb(a, city)),
      transport: input.transport,
      food: DEFAULT_FOOD_PREFS,
    },
    { variant: run.variant },
  )
  const days = plan.days.map((d, i) => {
    const points: Point[] = d.stops.map((s) => {
      if (s.kind === 'attraction') {
        const a = city.attractions.find((x) => x.id === s.id)!
        return { kind: 'attraction' as const, a, lat: a.lat, lng: a.lng }
      }
      const r = city.restaurants.find((x) => x.id === s.id)!
      return { kind: 'meal' as const, r, lat: r.lat, lng: r.lng }
    })
    return auditDay(`Day ${i + 1}`, points, start, startMin, d.date, input.transport)
  })
  const skipped = plan.skipped.map((s) => `${city.attractions.find((a) => a.id === s.id)?.name}（${s.reason}）`)
  tujiRows.push({ label: `${run.label}${skipped.length ? `，跳过 ${skipped.length} 个：${skipped.join('、')}` : ''}`, days })
}

printDays(original)
printDays(reordered)
for (const row of tujiRows) printDays(row)
printSummary([original, reordered, ...tujiRows])
