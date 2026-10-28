/**
 * 途迹 · 路线规划核心
 *
 * 流程：
 *  1. 按兴趣 / 评分 / 必去给景点打分，剔除排除项
 *  2. 分离远郊景点（单独成天）
 *  3. 核心区景点取候选池 → k-means 按地理位置聚成 N 天
 *  4. 按每天时间预算平衡各天负荷（在邻近天之间挪动，实在放不下的跳过）
 *  5. 每天内部：按「上午 / 任意 / 傍晚 / 夜晚」分组，组内求最短开放路径（Held-Karp 精确解，点多时退化为最近邻 + 2-opt）
 *  6. 顺序确定后按时间排程，自动插入午餐 / 晚餐 /（美食探店时）下午茶，餐厅就近挑选
 *  7. 处理闭馆日 / 闭园时间冲突，生成建议
 */
import type {
  Attraction,
  City,
  DayPlan,
  FoodPrefs,
  Interest,
  Leg,
  MealType,
  Pace,
  PlanParams,
  PlanVariant,
  Restaurant,
  ScheduleStop,
  TransportPref,
  TripPlan,
} from '../types'
import { DEFAULT_FOOD_PREFS } from '../types'
import { centroid, estimateLeg, haversine, round1, type LatLng } from './geo'
import { INTEREST_EMOJI, addDays, hhmmToMinutes, parseOpenHours, weekdayOf } from './format'

/** 调试输出钩子（命令行脚本可以挂上 console.log） */
export const debug: { log: ((...args: unknown[]) => void) | null } = { log: null }

/** 每天「游览 + 交通」时间预算（分钟，不含用餐） */
export const PACE_BUDGET: Record<Pace, number> = {
  relaxed: 360,
  moderate: 480,
  intense: 590,
}

/** 预估每站之间的平均交通时间，用于容量估算 */
const AVG_HOP = 25
/** 每天允许超出预算的比例（稍微超一点比丢掉一个好景点划算） */
const TOLERANCE = 1.05
/** 距市中心超过此距离视为远郊 */
const SUBURB_KM = 22
const MEAL_DURATION: Record<MealType, number> = {
  breakfast: 40,
  lunch: 60,
  dinner: 75,
  snack: 40,
  night: 60,
}

interface Scored {
  a: Attraction
  score: number
}

/* ------------------------------------------------------------------ */
/* 打分与筛选                                                           */
/* ------------------------------------------------------------------ */

export function scoreAttraction(a: Attraction, interests: Interest[], isMust: boolean, variant: PlanVariant = 'balanced'): number {
  let s = a.rating * 10
  if (variant === 'cheap') s -= a.price * 0.15
  if (variant === 'max') s -= (a.duration - 90) * 0.06
  if (a.mustSee) s += 18
  if (interests.length) {
    if (interests.includes(a.category)) s += 22
    const tagHits = a.tags.filter((t) => (interests as string[]).includes(t)).length
    s += Math.min(16, tagHits * 8)
  }
  if (a.price > 150) s -= 4
  if (a.duration > 240) s -= 3
  if (isMust) s += 1000
  return s
}

export function isSuburb(a: Attraction, city: City): boolean {
  return Boolean(a.suburb) || haversine(a, city.center) > SUBURB_KM
}

/* ------------------------------------------------------------------ */
/* 聚类                                                                 */
/* ------------------------------------------------------------------ */

function toXY(p: LatLng, refLat: number): [number, number] {
  const k = Math.cos((refLat * Math.PI) / 180)
  return [p.lng * k * 111, p.lat * 111]
}

/** 确定性的 k-means：最远点初始化 + Lloyd 迭代 */
function kmeans(items: Scored[], k: number, refLat: number): Scored[][] {
  if (k <= 1 || items.length <= k) {
    if (k <= 1) return [items]
    return items.map((it) => [it]).concat(Array.from({ length: Math.max(0, k - items.length) }, () => []))
  }
  const pts = items.map((it) => toXY(it.a, refLat))
  const d2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

  // 初始化：评分最高的点作为第一个中心，然后依次选离现有中心最远的点
  const bestIdx = items.reduce((bi, it, i) => (it.score > items[bi].score ? i : bi), 0)
  const centers: [number, number][] = [pts[bestIdx]]
  while (centers.length < k) {
    let far = -1
    let farD = -1
    pts.forEach((p, i) => {
      const dmin = Math.min(...centers.map((c) => d2(p, c)))
      if (dmin > farD) {
        farD = dmin
        far = i
      }
    })
    centers.push(pts[far])
  }

  let assign = new Array<number>(items.length).fill(0)
  for (let iter = 0; iter < 60; iter++) {
    const next = pts.map((p) => {
      let best = 0
      let bd = Infinity
      centers.forEach((c, ci) => {
        const dd = d2(p, c)
        if (dd < bd) {
          bd = dd
          best = ci
        }
      })
      return best
    })
    const changed = next.some((v, i) => v !== assign[i])
    assign = next
    // 重新计算中心
    for (let ci = 0; ci < k; ci++) {
      const members = pts.filter((_, i) => assign[i] === ci)
      if (members.length === 0) {
        // 空簇：把最大簇中离其中心最远的点挪过来
        const counts = Array.from({ length: k }, (_, c) => assign.filter((v) => v === c).length)
        const big = counts.indexOf(Math.max(...counts))
        let far = -1
        let farD = -1
        pts.forEach((p, i) => {
          if (assign[i] !== big) return
          const dd = d2(p, centers[big])
          if (dd > farD) {
            farD = dd
            far = i
          }
        })
        if (far >= 0) {
          assign[far] = ci
          centers[ci] = pts[far]
        }
        continue
      }
      centers[ci] = [
        members.reduce((s, p) => s + p[0], 0) / members.length,
        members.reduce((s, p) => s + p[1], 0) / members.length,
      ]
    }
    if (!changed && iter > 0) break
  }
  return Array.from({ length: k }, (_, ci) => items.filter((_, i) => assign[i] === ci))
}

function loadOf(cluster: Scored[]): number {
  return cluster.reduce((s, it) => s + it.a.duration, 0) + AVG_HOP * Math.max(0, cluster.length - 1)
}

/** 按优先级贪心：必去优先、分数从高到低，放得下就留，放不下就跳过看下一个（小景点可以补空档） */
function greedyKeep(cluster: Scored[], limit: number, must: Set<string>): { keep: Scored[]; drop: Scored[] } {
  const tier = (s: Scored) => (must.has(s.a.id) ? 2 : s.a.mustSee ? 1 : 0)
  const ordered = [...cluster].sort((x, y) => tier(y) - tier(x) || y.score - x.score)
  const keep: Scored[] = []
  const drop: Scored[] = []
  for (const s of ordered) {
    if (must.has(s.a.id) || loadOf([...keep, s]) <= limit) keep.push(s)
    else drop.push(s)
  }
  return { keep, drop }
}

/** 在簇之间挪动景点，使每天负荷不超过预算；实在放不下的按优先级贪心保留，其余丢弃 */
function balance(
  clusters: Scored[][],
  budget: number,
  must: Set<string>,
  dropped: Scored[],
  reach: { move: number; moveEmpty: number } = { move: 9, moveEmpty: 15 },
): Scored[][] {
  const cl = clusters.map((c) => [...c])
  const limit = budget * TOLERANCE
  // 阶段一：把超载簇里的景点挪到附近有空位的簇
  for (let guard = 0; guard < 100; guard++) {
    const loads = cl.map(loadOf)
    let over = -1
    let overBy = 0
    loads.forEach((l, i) => {
      if (l - limit > overBy) {
        overBy = l - limit
        over = i
      }
    })
    if (over < 0) break
    const cents = cl.map((c) => (c.length ? centroid(c.map((it) => it.a)) : null))
    let best: { item: number; to: number; cost: number } | null = null
    cl[over].forEach((it, idx) => {
      if (must.has(it.a.id) && cl[over].filter((x) => must.has(x.a.id)).length === cl[over].length) return
      const need = it.a.duration + AVG_HOP
      cl.forEach((_t, ti) => {
        if (ti === over || loads[ti] + need > limit) return
        const c = cents[ti]
        // 目标天很空时允许稍远一点，否则按常规半径
        const maxD = loads[ti] < budget * 0.6 ? reach.moveEmpty : reach.move
        if (c && haversine(it.a, c) >= maxD) return
        const from = cents[over]
        const cost = (c ? haversine(it.a, c) : 0) - (from ? haversine(it.a, from) : 0)
        if (!best || cost < best.cost) best = { item: idx, to: ti, cost }
      })
    })
    const mv = best as { item: number; to: number; cost: number } | null
    if (!mv) break
    const [item] = cl[over].splice(mv.item, 1)
    cl[mv.to].push(item)
  }
  // 阶段二：仍然超载的簇按优先级贪心保留
  cl.forEach((c, i) => {
    if (loadOf(c) <= limit) return
    const { keep, drop } = greedyKeep(c, limit, must)
    cl[i] = keep
    dropped.push(...drop)
  })
  // 阶段二点五：夜景点太集中的天，把多出来的匀给附近夜景少的天
  for (let guard = 0; guard < 10; guard++) {
    const nights = cl.map((c) => c.filter((s) => s.a.bestTime === 'night'))
    const from = nights.findIndex((n) => n.length >= 3)
    if (from < 0) break
    let moved = false
    for (const item of nights[from]) {
      const need = item.a.duration + AVG_HOP
      let best = -1
      let bestD = Infinity
      cl.forEach((c, ti) => {
        if (ti === from || nights[ti].length >= 2 || loadOf(c) + need > limit) return
        const d = c.length ? haversine(item.a, centroid(c.map((it) => it.a))) : 0
        if (d <= 12 && d < bestD) {
          bestD = d
          best = ti
        }
      })
      if (best >= 0) {
        cl[from] = cl[from].filter((x) => x !== item)
        cl[best].push(item)
        moved = true
        break
      }
    }
    if (!moved) break
  }
  // 阶段三：被挤掉的必去景点，尝试挤掉别的天里分数更低的非必去景点
  const isMustSee = (s: Scored) => s.a.mustSee || must.has(s.a.id)
  for (const d of [...dropped].filter(isMustSee).sort((x, y) => y.score - x.score)) {
    const order = cl
      .map((c, i) => ({ i, dist: c.length ? haversine(d.a, centroid(c.map((it) => it.a))) : 0, load: loadOf(c) }))
      .filter((x) => x.dist <= (must.has(d.a.id) ? Infinity : x.load < budget * 0.6 ? reach.moveEmpty : reach.move))
      .sort((x, y) => x.dist - y.dist)
    for (const { i } of order) {
      const c = cl[i]
      const candidates = c.filter((x) => !isMustSee(x) && x.score < d.score).sort((x, y) => x.score - y.score)
      const removed: Scored[] = []
      let rest = [...c]
      while (loadOf([...rest, d]) > limit && candidates.length) {
        const r = candidates.shift()!
        removed.push(r)
        rest = rest.filter((x) => x !== r)
      }
      if (loadOf([...rest, d]) > limit || removed.length > 2) continue
      cl[i] = [...rest, d]
      dropped.splice(dropped.indexOf(d), 1)
      dropped.push(...removed)
      break
    }
  }
  return cl
}

/* ------------------------------------------------------------------ */
/* 路径排序（开放路径 TSP）                                             */
/* ------------------------------------------------------------------ */

type PositionPenalty = (index: number, position: number, n: number) => number

/** Held-Karp 精确解（n ≤ 13），起点固定、终点任意；可附加「第几站」的惩罚项（单位：公里） */
function heldKarp(points: LatLng[], start: LatLng, penalty?: PositionPenalty): number[] {
  const n = points.length
  const d = (i: number, j: number) => haversine(points[i], points[j])
  const full = 1 << n
  const dp = new Float64Array(full * n).fill(Infinity)
  const parent = new Int16Array(full * n).fill(-1)
  const popcount = new Uint8Array(full)
  for (let m = 1; m < full; m++) popcount[m] = popcount[m >> 1] + (m & 1)
  for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = haversine(start, points[i]) + (penalty ? penalty(i, 1, n) : 0)
  for (let mask = 1; mask < full; mask++) {
    const pos = popcount[mask] + 1
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue
      const cur = dp[mask * n + i]
      if (cur === Infinity) continue
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue
        const nm = mask | (1 << j)
        const v = cur + d(i, j) + (penalty ? penalty(j, pos, n) : 0)
        if (v < dp[nm * n + j]) {
          dp[nm * n + j] = v
          parent[nm * n + j] = i
        }
      }
    }
  }
  let end = 0
  for (let i = 1; i < n; i++) if (dp[(full - 1) * n + i] < dp[(full - 1) * n + end]) end = i
  const order: number[] = []
  let mask = full - 1
  let cur = end
  while (cur >= 0) {
    order.push(cur)
    const p = parent[mask * n + cur]
    mask &= ~(1 << cur)
    cur = p
  }
  return order.reverse()
}

/** 最近邻 + 2-opt（点较多时使用） */
function nnTwoOpt(points: LatLng[], start: LatLng): number[] {
  const n = points.length
  const remaining = points.map((_, i) => i)
  const path: number[] = []
  let cur: LatLng = start
  while (remaining.length) {
    let bi = 0
    let bd = Infinity
    remaining.forEach((idx, k) => {
      const dd = haversine(cur, points[idx])
      if (dd < bd) {
        bd = dd
        bi = k
      }
    })
    const [picked] = remaining.splice(bi, 1)
    path.push(picked)
    cur = points[picked]
  }
  const dist = (a: number, b: number) => haversine(points[a], points[b])
  let improved = true
  let guard = 0
  while (improved && guard++ < 100) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const prevD = i === 0 ? haversine(start, points[path[i]]) : dist(path[i - 1], path[i])
        const prevD2 = i === 0 ? haversine(start, points[path[j]]) : dist(path[i - 1], path[j])
        const nextD = j === n - 1 ? 0 : dist(path[j], path[j + 1])
        const nextD2 = j === n - 1 ? 0 : dist(path[i], path[j + 1])
        if (prevD2 + nextD2 < prevD + nextD - 1e-9) {
          let a = i
          let b = j
          while (a < b) {
            const t = path[a]
            path[a] = path[b]
            path[b] = t
            a++
            b--
          }
          improved = true
        }
      }
    }
  }
  return path
}

export function shortestOpenPath<T extends LatLng>(items: T[], start: LatLng): T[] {
  if (items.length <= 1) return [...items]
  const order = items.length <= 13 ? heldKarp(items, start) : nnTwoOpt(items, start)
  return order.map((i) => items[i])
}

/**
 * 时段偏好换算成「公里」惩罚：夜景必须压轴，日落景点靠后，上午景点靠前，下午景点别放第一站。
 */
function timePenalty(bt: Attraction['bestTime'], pos: number, n: number): number {
  switch (bt) {
    case 'night':
      // 最后一站免罚，倒数第二轻罚，再往前重罚（两个夜景点可以共享最后两站）
      return pos === n ? 0 : pos === n - 1 ? 6 : 25 + 5 * (n - 1 - pos)
    case 'evening':
      // 最后两站免罚，再往前按距离末尾递增
      return pos < n - 1 ? 4 + 3 * (n - 1 - pos) : 0
    case 'morning':
      return 1.2 * (pos - 1)
    case 'afternoon':
      return pos === 1 && n > 1 ? 4 : 0
    default:
      return 0
  }
}

/** 开门很晚（16:00 后）的景点，不管标什么时段都按夜景处理 */
function effectiveTime(a: Attraction): Attraction['bestTime'] {
  const [open] = parseOpenHours(a.openHours)
  if (open >= 16 * 60) return 'night'
  return a.bestTime
}

const TIME_RANK: Record<Attraction['bestTime'], number> = {
  morning: 0,
  any: 1,
  afternoon: 1,
  evening: 2,
  night: 3,
}

/** 一天内的游览顺序：最短路径 + 时段偏好惩罚一起求解；点太多时退化为分组求解 */
export function orderDay(items: Attraction[], start: LatLng): Attraction[] {
  if (items.length <= 1) return [...items]
  if (items.length <= 13) {
    const order = heldKarp(items, start, (i, pos, n) => timePenalty(effectiveTime(items[i]), pos, n))
    return order.map((i) => items[i])
  }
  const groups: Attraction[][] = [[], [], [], []]
  items.forEach((a) => groups[TIME_RANK[effectiveTime(a)] ?? 1].push(a))
  const result: Attraction[] = []
  let cur: LatLng = start
  for (const g of groups) {
    if (!g.length) continue
    const ordered = shortestOpenPath(g, cur)
    result.push(...ordered)
    cur = ordered[ordered.length - 1]
  }
  return result
}

/** 路径总长度（含起点出发） */
export function pathLength(points: LatLng[], start: LatLng): number {
  let d = 0
  let cur = start
  for (const p of points) {
    d += haversine(cur, p)
    cur = p
  }
  return d
}

/* ------------------------------------------------------------------ */
/* 餐厅挑选                                                             */
/* ------------------------------------------------------------------ */

const SPICY = /辣|川菜|川味|湘|火锅|串串|冒菜|小龙虾|麻小|江湖菜|烤鱼|毛血旺|重庆/
const MEAT_HEAVY = /烤鸭|涮|烤肉|烧烤|海鲜|卤煮|炒肝|火锅|串串|牛排|排档|烧腊|肥肠|烧鹅|羊肉|牛肉|鸡/
const VEG_FRIENDLY = /素|斋|蔬|面|粥|咖啡|甜品|茶|小吃|糕|点心|早茶|豆花|凉皮/
const HALAL = /清真|回民|牛街|兰州|新疆|泡馍|手抓|回坊|回民街/
const PORK_LIKELY = /猪|卤煮|炒肝|烤鸭|生煎|小笼|回锅肉|东坡肉|红烧肉|肉夹馍|叉烧|烧腊|烧鹅|煲仔饭|肠粉|包子|烧麦/
const AVOID_PATTERNS: Record<string, RegExp> = {
  海鲜: /海鲜|虾|蟹|鱼|蚝|蛎|贝|鳗|鱿|海蛎/,
  内脏: /肥肠|卤煮|炒肝|脑花|毛肚|鸭肠|羊杂|爆肚|肺头|牛杂|鹅肝|葫芦头|鸡杂|肠旺/,
  牛肉: /牛肉|牛杂|牛排|黄牛|肥牛|牛腩|牛腱|牛肋/,
  羊肉: /羊/,
  香菜: /香菜/,
}

/** 饮食偏好与方案变体对一家餐厅的加减分（两处挑选逻辑共用） */
export function foodPrefAdjust(r: Restaurant, prefs: FoodPrefs, variant: PlanVariant = 'balanced'): number {
  const text = `${r.name} ${r.cuisine} ${r.tags.join(' ')} ${r.mustOrder.join(' ')}`
  let s = 0
  if (prefs.noSpicy && SPICY.test(text)) s -= 30
  if (prefs.vegetarian) {
    if (VEG_FRIENDLY.test(text)) s += 12
    if (MEAT_HEAVY.test(text)) s -= 30
  }
  if (prefs.halal) {
    if (HALAL.test(text)) s += 25
    else if (PORK_LIKELY.test(text)) s -= 35
  }
  for (const k of prefs.avoid) if (AVOID_PATTERNS[k]?.test(text)) s -= 40
  if (prefs.maxPrice > 0 && r.avgPrice > prefs.maxPrice) s -= 20 + (r.avgPrice - prefs.maxPrice) * 0.2
  if (variant === 'cheap') s -= r.avgPrice * 0.1
  return s
}

export function pickRestaurant(
  city: City,
  from: LatLng,
  to: LatLng | null,
  type: MealType,
  used: Set<string>,
  triedCuisines: Set<string>,
  foodie: boolean,
  prefs: FoodPrefs = DEFAULT_FOOD_PREFS,
  variant: PlanVariant = 'balanced',
): Restaurant | null {
  const base = haversine(from, to ?? from)
  const detourWeight = variant === 'fast' ? 10 : 7
  const evaluate = (maxDetour: number) => {
    let best: Restaurant | null = null
    let bestScore = -Infinity
    for (const r of city.restaurants) {
      if (used.has(r.id)) continue
      if (!r.mealTypes.includes(type)) continue
      const detour = to ? haversine(from, r) + haversine(r, to) - base : haversine(from, r)
      if (detour > maxDetour) continue
      let s = r.rating * 10 - detour * detourWeight
      if (r.tags.some((t) => ['必吃榜', '老字号', '本地人推荐', '米其林', '黑珍珠'].includes(t))) s += 4
      if (!triedCuisines.has(r.cuisine)) s += 5
      if (type === 'dinner' && r.tags.some((t) => ['夜景', '适合约会', '氛围感'].includes(t))) s += 2
      if (type === 'snack' && r.tags.some((t) => ['小吃', '甜品', '咖啡', '下午茶'].includes(t))) s += 3
      if (r.avgPrice >= 500) s -= foodie ? 8 : 22
      else if (r.avgPrice > 300) s -= foodie ? 3 : 10
      if (r.warning) s -= 8
      s += foodPrefAdjust(r, prefs, variant)
      if (s > bestScore) {
        bestScore = s
        best = r
      }
    }
    return best
  }
  return evaluate(2.5) ?? evaluate(5) ?? evaluate(10)
}

export function nearbyRestaurants(city: City, p: LatLng, km = 1.5, exclude: Set<string> = new Set()): Restaurant[] {
  return city.restaurants
    .filter((r) => !exclude.has(r.id) && haversine(p, r) <= km)
    .sort((a, b) => haversine(p, a) - haversine(p, b))
}

/* ------------------------------------------------------------------ */
/* 排程                                                                 */
/* ------------------------------------------------------------------ */

export interface BuildDayOptions {
  day: number
  date?: string
  start: LatLng
  startMin: number
  used: Set<string>
  triedCuisines: Set<string>
  isSuburb?: boolean
  /** 是否重新求最短路径；手动调整顺序时为 false */
  optimize: boolean
  /** 固定某几餐的餐厅（手动换店 / 调整顺序时保留原餐厅） */
  pinned?: Partial<Record<MealType, string>>
  variant?: PlanVariant
}

interface DayBuildResult {
  plan: DayPlan
  usedRestaurants: string[]
  violations: number
}

function scheduleOrdered(
  city: City,
  params: PlanParams,
  ordered: Attraction[],
  opts: BuildDayOptions,
): DayBuildResult {
  const used = new Set(opts.used)
  const tried = new Set(opts.triedCuisines)
  const foodie = params.interests.includes('美食探店')
  const prefs = params.food ?? DEFAULT_FOOD_PREFS
  const transport: TransportPref = params.transport ?? 'balanced'
  const variant = opts.variant ?? 'balanced'
  const stops: ScheduleStop[] = []
  let t = opts.startMin
  let pos: LatLng = opts.start
  let hadLunch = false
  let hadDinner = false
  let hadSnack = false
  let violations = 0
  const usedNow: string[] = []
  let distance = 0
  let walk = 0
  let transportCost = 0
  let food = 0

  const applyLeg = (leg: Leg) => {
    distance += leg.distanceKm
    if (leg.mode === 'walk') walk += leg.distanceKm
    transportCost += leg.cost
  }

  const addMeal = (type: MealType, to: LatLng | null, notBefore?: number) => {
    const pinnedId = opts.pinned?.[type]
    const pinnedR = pinnedId ? city.restaurants.find((x) => x.id === pinnedId && !used.has(x.id)) : undefined
    const r = pinnedR ?? pickRestaurant(city, pos, to, type, used, tried, foodie, prefs, variant)
    if (!r) return false
    const leg = estimateLeg(pos, r, transport)
    let arrive = t + leg.minutes
    if (notBefore !== undefined && arrive < notBefore) arrive = notBefore
    const dur = MEAL_DURATION[type] + (r.waitTime && /排队/.test(r.waitTime) && type !== 'snack' ? 15 : 0)
    stops.push({ kind: 'meal', id: r.id, start: arrive, end: arrive + dur, leg, mealType: type })
    applyLeg(leg)
    food += r.avgPrice
    t = arrive + dur
    pos = r
    used.add(r.id)
    usedNow.push(r.id)
    tried.add(r.cuisine)
    return true
  }

  const LUNCH_FROM = 11 * 60 + 30
  const LUNCH_FORCE = 13 * 60
  const SNACK_FROM = 14 * 60 + 30
  const SNACK_TO = 16 * 60 + 45
  const DINNER_FROM = 17 * 60 + 30
  const DINNER_FORCE = 19 * 60 + 30

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]
    const probe = estimateLeg(pos, a, transport)
    const wouldEnd = t + probe.minutes + a.duration
    // 下一站还没开门、要干等很久：用一顿饭把空档填上
    const [nextOpen] = parseOpenHours(a.openHours)
    const gap = nextOpen - (t + probe.minutes)
    if (gap >= 40) {
      if (!hadDinner && nextOpen >= 17 * 60 && t >= 15 * 60) {
        hadDinner = addMeal('dinner', a, Math.max(t, DINNER_FROM - 30)) || true
      } else if (!hadLunch && nextOpen >= 11 * 60 + 30 && t >= 10 * 60 + 30 && t <= 14 * 60) {
        hadLunch = addMeal('lunch', a, Math.max(t, 11 * 60)) || true
      }
    }

    if (!hadLunch && ((t >= LUNCH_FROM && t <= 15 * 60) || (t >= 11 * 60 && wouldEnd > LUNCH_FORCE + 20))) {
      hadLunch = addMeal('lunch', a, LUNCH_FROM) || true
    }
    if (foodie && !hadSnack && hadLunch && t >= SNACK_FROM && t <= SNACK_TO && i < ordered.length) {
      hadSnack = true
      addMeal('snack', a)
    }
    if (!hadDinner && ((t >= DINNER_FROM && (a.bestTime === 'night' || t >= DINNER_FORCE)) || (t >= 17 * 60 && wouldEnd > 20 * 60 + 30))) {
      hadDinner = addMeal('dinner', a, DINNER_FROM) || true
    }

    const leg = estimateLeg(pos, a, transport)
    let arrive = t + leg.minutes
    const [open, close] = parseOpenHours(a.openHours)
    let note: string | undefined
    let warning: string | undefined
    if (arrive < open) {
      const wait = open - arrive
      if (wait >= 10) note = `比开门早到约 ${wait} 分钟，可先在周边逛逛`
      arrive = open
    }
    const end = arrive + a.duration
    if (close < 1440 && arrive >= close - 20) {
      warning = `预计到达时已接近闭园（${a.openHours}），建议把它挪到更早的时间`
      violations++
    } else if (close < 1440 && end > close) {
      const left = close - arrive
      if (left < a.duration * 0.6) {
        warning = `闭园前只剩约 ${left} 分钟，游玩时间会比较紧`
        violations++
      } else {
        note = (note ? note + '；' : '') + `注意 ${a.openHours} 闭园`
      }
    }
    if (opts.date && a.closedOn?.includes(weekdayOf(opts.date))) {
      warning = `当天闭馆（${a.closedOn.map((d) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d]).join('、')}闭馆）`
      violations += 2
    }
    stops.push({ kind: 'attraction', id: a.id, start: arrive, end, leg, note, warning })
    applyLeg(leg)
    t = end
    pos = a
  }

  // 收尾：补上没吃的午餐 / 晚餐
  if (!hadLunch && ordered.length && t >= 11 * 60) {
    addMeal('lunch', null, LUNCH_FROM)
    hadLunch = true
  }
  if (!hadDinner && ordered.length) {
    let added = addMeal('dinner', null, Math.max(t, DINNER_FROM + 15))
    if (!added && opts.isSuburb) {
      // 远郊附近没有合适的餐厅：先回市区再吃
      const back = estimateLeg(pos, opts.start, transport)
      pos = opts.start
      t += back.minutes
      applyLeg(back)
      added = addMeal('dinner', null, Math.max(t, DINNER_FROM + 15))
      if (added) {
        const last = stops[stops.length - 1]
        const leg = last.leg!
        last.leg = { distanceKm: round1(back.distanceKm + leg.distanceKm), minutes: back.minutes + leg.minutes, mode: back.mode, cost: back.cost + leg.cost }
        last.note = '先回市区再吃晚餐'
      }
    }
    hadDinner = true
  }

  const returnLeg = estimateLeg(pos, opts.start, transport)
  applyLeg(returnLeg)

  const tickets = ordered.reduce((s, a) => s + a.price, 0)
  const { title, theme } = describeDay(ordered, opts.isSuburb)
  const breakfast = ordered.length
    ? nearbyRestaurants(city, ordered[0], 2, used).find((r) => r.mealTypes.includes('breakfast'))
    : undefined

  const plan: DayPlan = {
    day: opts.day,
    date: opts.date,
    title,
    theme,
    stops,
    distanceKm: round1(distance),
    walkKm: round1(walk),
    startTime: opts.startMin,
    endTime: t,
    cost: { tickets, food, transport: transportCost },
    breakfastId: breakfast?.id,
    isSuburb: opts.isSuburb,
    returnLeg,
  }
  return { plan, usedRestaurants: usedNow, violations }
}

function describeDay(items: Attraction[], suburb?: boolean): { title: string; theme: string } {
  if (!items.length) return { title: '自由活动', theme: '🛋️ 休息、购物或补漏' }
  if (suburb) {
    const anchor = items.reduce((m, a) => (a.duration > m.duration ? a : m), items[0])
    return { title: `${anchor.name} 一日游`, theme: `${INTEREST_EMOJI[anchor.category]} ${anchor.category} · 远郊` }
  }
  const count = <T extends string>(xs: T[]) => {
    const m = new Map<T, number>()
    xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  const areas = count(items.map((a) => a.area))
  const cats = count(items.map((a) => a.category))
  const joinAreas = (x: string, y: string) => {
    const [px, rx] = x.split('·')
    const [py, ry] = y.split('·')
    return rx && ry && px === py ? `${px}·${rx} · ${ry}` : `${x} · ${y}`
  }
  const title = areas.length > 1 && (areas.length === items.length || areas.length > 2) ? joinAreas(areas[0], areas[1]) : areas[0]
  const theme = `${INTEREST_EMOJI[cats[0]]} ${cats.slice(0, 2).join(' · ')}`
  return { title, theme }
}

/**
 * 构建一天的行程。optimize=true 时会先求最短路径，并在出现闭园冲突时尝试微调顺序。
 */
export function buildDay(city: City, params: PlanParams, items: Attraction[], opts: BuildDayOptions): DayBuildResult {
  let ordered = opts.optimize ? orderDay(items, opts.start) : [...items]
  let result = scheduleOrdered(city, params, ordered, opts)
  if (!opts.optimize || result.violations === 0 || ordered.length < 2) return result

  // 修复：把有冲突的景点往前挪，接受不增加冲突且路程不膨胀太多的方案
  const baseLen = pathLength(ordered, opts.start)
  for (let attempt = 0; attempt < 3 && result.violations > 0; attempt++) {
    const badIdx = result.plan.stops.filter((s) => s.kind === 'attraction').findIndex((s) => s.warning)
    if (badIdx <= 0) break
    let best: { ordered: Attraction[]; res: DayBuildResult } | null = null
    for (let pos = 0; pos < badIdx; pos++) {
      const trial = [...ordered]
      const [item] = trial.splice(badIdx, 1)
      trial.splice(pos, 0, item)
      const res = scheduleOrdered(city, params, trial, opts)
      const len = pathLength(trial, opts.start)
      if (res.violations < result.violations && len <= baseLen * 2.2) {
        if (!best || res.violations < best.res.violations || (res.violations === best.res.violations && len < pathLength(best.ordered, opts.start))) {
          best = { ordered: trial, res }
        }
      }
    }
    if (!best) break
    ordered = best.ordered
    result = best.res
  }
  return result
}

/* ------------------------------------------------------------------ */
/* 总入口                                                               */
/* ------------------------------------------------------------------ */

export interface PlanOptions {
  variant?: PlanVariant
}

export const VARIANT_LABEL: Record<PlanVariant, { name: string; desc: string; emoji: string }> = {
  balanced: { name: '推荐', desc: '综合评分、位置与时间的平衡方案', emoji: '⭐' },
  fast: { name: '省时省力', desc: '路程更短、换乘更少，节奏更稳', emoji: '🚶' },
  cheap: { name: '省钱', desc: '优先免费 / 便宜的景点与人均更低的餐厅', emoji: '💰' },
  max: { name: '打卡多', desc: '塞进更多景点，适合特种兵', emoji: '📸' },
}

/** 各方案变体的调参 */
const VARIANT_CFG: Record<PlanVariant, { budgetScale: number; mustBonus: number; lambda: number; move: number; moveEmpty: number }> = {
  balanced: { budgetScale: 1, mustBonus: 100, lambda: 1.2, move: 9, moveEmpty: 15 },
  fast: { budgetScale: 0.92, mustBonus: 30, lambda: 3, move: 5, moveEmpty: 8 },
  cheap: { budgetScale: 1, mustBonus: 100, lambda: 1.2, move: 9, moveEmpty: 15 },
  max: { budgetScale: 1.2, mustBonus: 100, lambda: 1.0, move: 9, moveEmpty: 15 },
}

export function planTrip(city: City, rawParams: PlanParams, options: PlanOptions = {}): TripPlan {
  const variant: PlanVariant = options.variant ?? 'balanced'
  const cfg = VARIANT_CFG[variant]
  const params: PlanParams = { ...rawParams, days: Math.max(1, Math.min(7, Math.round(Number(rawParams.days)) || 1)) }
  const transport: TransportPref = params.transport ?? 'balanced'
  const baseBudget = PACE_BUDGET[params.pace] ?? PACE_BUDGET.moderate
  const budget = Math.round(baseBudget * cfg.budgetScale)
  const startMin = hhmmToMinutes(params.startTime)
  const start: LatLng = params.startPoint ?? city.center
  const skipped: { id: string; reason: string }[] = []
  const suggestions: string[] = []
  const must = new Set(params.mustInclude)
  const excluded = new Set(params.exclude)

  const scored: Scored[] = city.attractions
    .filter((a) => !excluded.has(a.id))
    .map((a) => ({ a, score: scoreAttraction(a, params.interests, must.has(a.id), variant) }))
    .sort((x, y) => y.score - x.score)

  const suburbPool = scored.filter((s) => isSuburb(s.a, city))
  const corePool = scored.filter((s) => !isSuburb(s.a, city))

  /* ---- 远郊天 ---- */
  const suburbDays: Scored[][] = []
  const wantSuburb = params.includeSuburb || suburbPool.some((s) => must.has(s.a.id))
  if (wantSuburb && params.days >= 2 && suburbPool.length) {
    const maxSuburbDays = params.days >= 5 ? 2 : 1
    const remaining = [...suburbPool]
    const chosenKinds = new Set<string>()
    const kindOf = (a: Attraction) => (a.area.includes('·') ? a.area.split('·').pop()! : a.area)
    while (suburbDays.length < maxSuburbDays && remaining.length) {
      const anchor = remaining.shift()!
      // 远郊天只有在景点足够值得（必去 / 评分高 / 用户点名）时才安排；第二个远郊日要求更高
      // 短行程（≤2 天）只为必去级别的远郊景点腾出一天
      const worthy = anchor.a.mustSee || must.has(anchor.a.id) || (params.days >= 3 && anchor.score >= 60)
      if (!worthy && (suburbDays.length > 0 || !params.includeSuburb || params.days <= 2)) {
        remaining.unshift(anchor)
        break
      }
      // 单程太久、或往返 + 游玩超过一天能承受的时间（如需住一晚的目的地）就不硬排
      const oneWay = estimateLeg(start, anchor.a, transport).minutes
      const maxOneWay = params.pace === 'relaxed' ? 150 : params.pace === 'moderate' ? 180 : 210
      const roundTrip = oneWay * 2 + anchor.a.duration
      if ((oneWay > maxOneWay || roundTrip > Math.max(budget * 1.3, 720)) && !must.has(anchor.a.id)) {
        skipped.push({ id: anchor.a.id, reason: '往返时间太长，建议住一晚单独安排' })
        continue
      }
      // 同类远郊（如两段长城）不重复安排
      if (chosenKinds.has(kindOf(anchor.a)) && !must.has(anchor.a.id)) {
        skipped.push({ id: anchor.a.id, reason: '与已安排的远郊景点同类，本次不重复安排' })
        continue
      }
      chosenKinds.add(kindOf(anchor.a))
      const group = [anchor]
      for (const s of [...remaining]) {
        if (haversine(s.a, anchor.a) <= 25) {
          group.push(s)
          remaining.splice(remaining.indexOf(s), 1)
        }
      }
      const travel = estimateLeg(start, anchor.a, transport).minutes
      // 远郊日：锚点景点必排（用户已选择安排远郊），其余看剩余时间
      const avail = Math.max(anchor.a.duration + AVG_HOP, budget * 1.1 - travel * 1.6)
      group.sort((x, y) => y.score - x.score)
      const kept: Scored[] = []
      let load = 0
      for (const s of group) {
        const need = s.a.duration + AVG_HOP
        if (s === anchor || must.has(s.a.id) || load + need <= avail * TOLERANCE) {
          kept.push(s)
          load += need
        } else skipped.push({ id: s.a.id, reason: '远郊当天时间不够' })
      }
      suburbDays.push(kept)
    }
    remaining.forEach((s) => skipped.push({ id: s.a.id, reason: '远郊景点，本次行程天数内放不下' }))
  } else {
    suburbPool.forEach((s) =>
      skipped.push({
        id: s.a.id,
        reason: params.days < 2 ? '远郊景点，一日游时间不够' : '远郊景点，未开启「安排远郊」',
      }),
    )
  }

  /* ---- 核心区 ---- */
  const coreDays = Math.max(0, params.days - suburbDays.length)
  const dropped: Scored[] = []
  let clusters: Scored[][] = []
  if (coreDays > 0) {
    const capacity = coreDays * budget * 1.25
    // 候选池：按分数贪心，但离已选景点太远的会被扣分（让单日 / 两日游更紧凑）
    const pool: Scored[] = []
    const remaining = [...corePool]
    let load = 0
    const adjusted = (s: Scored) => {
      if (must.has(s.a.id)) return s.score + 1000
      const base = s.a.mustSee ? s.score + cfg.mustBonus : s.score
      if (!pool.length) return base
      const dmin = Math.min(...pool.map((p) => haversine(p.a, s.a)))
      return base - Math.max(0, dmin - 3) * cfg.lambda
    }
    while (remaining.length) {
      let bi = 0
      let bs = -Infinity
      remaining.forEach((s, i) => {
        const v = adjusted(s)
        if (v > bs) {
          bs = v
          bi = i
        }
      })
      const [s] = remaining.splice(bi, 1)
      const need = s.a.duration + AVG_HOP
      if (must.has(s.a.id) || load + need <= capacity) {
        pool.push(s)
        load += need
      } else dropped.push(s)
    }
    clusters = kmeans(pool, coreDays, city.center.lat)
    debug.log?.('pool', pool.map((s) => `${s.a.name}:${s.score.toFixed(0)}`).join(' '))
    debug.log?.('kmeans', clusters.map((c) => c.map((s) => s.a.name).join('+') + `=${loadOf(c)}`).join(' | '))
    clusters = balance(clusters, budget, must, dropped, { move: cfg.move, moveEmpty: cfg.moveEmpty })
    debug.log?.('balanced', clusters.map((c) => c.map((s) => s.a.name).join('+') + `=${loadOf(c)}`).join(' | '), 'dropped', dropped.map((s) => s.a.name).join(','))

    // 回填：有空余的天尝试加入附近被挤掉的景点（这一天很空时允许稍远一点）
    dropped.sort((x, y) => y.score - x.score)
    for (const s of [...dropped]) {
      const need = s.a.duration + AVG_HOP
      let bestIdx = -1
      let bestD = Infinity
      clusters.forEach((c, i) => {
        if (!c.length) return
        const load = loadOf(c)
        if (load + need > budget * TOLERANCE) return
        const d = haversine(s.a, centroid(c.map((it) => it.a)))
        const maxD = load < budget * 0.65 ? 14 : 6
        if (d <= maxD && d < bestD) {
          bestD = d
          bestIdx = i
        }
      })
      if (bestIdx >= 0) {
        clusters[bestIdx].push(s)
        dropped.splice(dropped.indexOf(s), 1)
      }
    }
    dropped.forEach((s) => skipped.push({ id: s.a.id, reason: '时间有限，优先级较低' }))
  } else {
    corePool.forEach((s) => skipped.push({ id: s.a.id, reason: '天数都给了远郊，核心区没排上' }))
  }

  /* ---- 闭馆日调整 ---- */
  // 先决定天序，再处理闭馆日
  const nonEmpty = clusters.filter((c) => c.length)
  const emptyCount = clusters.length - nonEmpty.length
  const ordered: { items: Scored[]; suburb: boolean }[] = []
  if (nonEmpty.length) {
    const totalScore = (c: Scored[]) => c.reduce((s, it) => s + it.score, 0)
    const first = nonEmpty.reduce((m, c) => (totalScore(c) > totalScore(m) ? c : m), nonEmpty[0])
    const rest = nonEmpty.filter((c) => c !== first)
    const chain = [first]
    let cur = first
    while (rest.length) {
      const cc = centroid(cur.map((it) => it.a))
      let bi = 0
      let bd = Infinity
      rest.forEach((c, i) => {
        const d = haversine(cc, centroid(c.map((it) => it.a)))
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      cur = rest.splice(bi, 1)[0]
      chain.push(cur)
    }
    ordered.push({ items: chain[0], suburb: false })
    suburbDays.forEach((s) => ordered.push({ items: s, suburb: true }))
    chain.slice(1).forEach((c) => ordered.push({ items: c, suburb: false }))
  } else {
    suburbDays.forEach((s) => ordered.push({ items: s, suburb: true }))
  }
  for (let i = 0; i < emptyCount; i++) ordered.push({ items: [], suburb: false })

  if (params.startDate) {
    for (let di = 0; di < ordered.length; di++) {
      const date = addDays(params.startDate, di)
      const wd = weekdayOf(date)
      for (const s of [...ordered[di].items]) {
        if (!s.a.closedOn?.includes(wd)) continue
        // 找一个不闭馆、有空位、尽量近的天
        let target = -1
        let bestD = Infinity
        ordered.forEach((d, ti) => {
          if (ti === di || d.suburb !== ordered[di].suburb) return
          const twd = weekdayOf(addDays(params.startDate!, ti))
          if (s.a.closedOn!.includes(twd)) return
          if (loadOf(d.items) + s.a.duration + AVG_HOP > budget * 1.1) return
          const dist = d.items.length ? haversine(s.a, centroid(d.items.map((it) => it.a))) : 0
          if (dist < bestD) {
            bestD = dist
            target = ti
          }
        })
        ordered[di].items.splice(ordered[di].items.indexOf(s), 1)
        if (target >= 0) ordered[target].items.push(s)
        else skipped.push({ id: s.a.id, reason: `行程日期内恰逢闭馆（${s.a.closedOn!.map((d) => '日一二三四五六'[d]).join('、')}闭馆）` })
      }
    }
  }

  /* ---- 排程 ---- */
  const used = new Set<string>()
  const tried = new Set<string>()
  const days: DayPlan[] = []
  ordered.forEach((d, i) => {
    const date = params.startDate ? addDays(params.startDate, i) : undefined
    const res = buildDay(
      city,
      params,
      d.items.map((s) => s.a),
      { day: i + 1, date, start, startMin, used, triedCuisines: tried, isSuburb: d.suburb, optimize: true, variant },
    )
    res.usedRestaurants.forEach((id) => used.add(id))
    res.plan.stops.filter((s) => s.kind === 'meal').forEach((s) => {
      const r = city.restaurants.find((x) => x.id === s.id)
      if (r) tried.add(r.cuisine)
    })
    days.push(res.plan)
  })

  /* ---- 建议 ---- */
  const inPlan = new Set(days.flatMap((d) => d.stops.filter((s) => s.kind === 'attraction').map((s) => s.id)))
  if (emptyCount > 0) {
    suggestions.push(`💡 核心景点 ${params.days - emptyCount} 天就能逛完，多出的 ${emptyCount} 天可以留作自由活动、购物或补漏。`)
  }
  const missedSuburb = suburbPool.filter((s) => !inPlan.has(s.a.id) && s.a.mustSee)
  if (missedSuburb.length) {
    suggestions.push(
      `🏔 ${missedSuburb.map((s) => s.a.name).join('、')} 是远郊景点，值得预留一整天${params.includeSuburb ? '' : '（可在设置里开启「安排远郊」）'}。`,
    )
  }
  const late = days.filter((d) => d.endTime > 21 * 60 + 45)
  if (late.length) suggestions.push(`⏰ Day ${late.map((d) => d.day).join('、')} 结束较晚，如果想轻松点可以切换节奏或去掉一个景点。`)
  const booking = city.attractions.filter((a) => inPlan.has(a.id) && a.needBooking)
  if (booking.length) suggestions.push(`📱 需提前预约：${booking.map((a) => a.name).join('、')}，热门时段建议提前 3-7 天抢票。`)
  const rainy = city.attractions.filter((a) => !inPlan.has(a.id) && !excluded.has(a.id) && (a.category === '博物馆艺术' || a.tags.includes('室内')))
  if (rainy.length) suggestions.push(`☔️ 雨天备选：${rainy.slice(0, 3).map((a) => a.name).join('、')}。`)
  const warned = days.flatMap((d) => d.stops.filter((s) => s.warning))
  if (warned.length) suggestions.push(`⚠️ 有 ${warned.length} 个景点的到达时间接近闭园或恰逢闭馆，已在时间轴上标出，可手动调整顺序。`)

  return {
    id: `plan-${Date.now().toString(36)}`,
    variant,
    params,
    days,
    skipped,
    suggestions,
    createdAt: Date.now(),
  }
}

/* ------------------------------------------------------------------ */
/* 手动调整                                                             */
/* ------------------------------------------------------------------ */

function usedOutside(plan: TripPlan, dayIdx: number): { used: Set<string>; tried: Set<string> } {
  const used = new Set<string>()
  const tried = new Set<string>()
  plan.days.forEach((d, i) => {
    if (i === dayIdx) return
    d.stops.filter((s) => s.kind === 'meal').forEach((s) => used.add(s.id))
  })
  return { used, tried }
}

/** 用新的景点顺序重算某一天 */
export function rebuildDay(
  city: City,
  plan: TripPlan,
  dayIdx: number,
  attractionIds: string[],
  optimize: boolean,
  pinned?: Partial<Record<MealType, string>>,
): TripPlan {
  const day = plan.days[dayIdx]
  const items = attractionIds.map((id) => city.attractions.find((a) => a.id === id)!).filter(Boolean)
  const { used, tried } = usedOutside(plan, dayIdx)
  const start = plan.params.startPoint ?? city.center
  const res = buildDay(city, plan.params, items, {
    day: day.day,
    date: day.date,
    start,
    startMin: hhmmToMinutes(plan.params.startTime),
    used,
    triedCuisines: tried,
    isSuburb: day.isSuburb,
    optimize,
    pinned,
    variant: plan.variant,
  })
  const days = plan.days.map((d, i) => (i === dayIdx ? res.plan : d))
  return { ...plan, days }
}

/** 从分享链接还原行程：按给定的景点顺序与餐厅逐天重建 */
export function planFromShare(
  city: City,
  params: PlanParams,
  days: { attractionIds: string[]; meals: Partial<Record<MealType, string>>; isSuburb?: boolean }[],
  variant: PlanVariant = 'balanced',
): TripPlan {
  const start = params.startPoint ?? city.center
  const used = new Set<string>()
  const tried = new Set<string>()
  const built: DayPlan[] = days.map((d, i) => {
    const items = d.attractionIds.map((id) => city.attractions.find((a) => a.id === id)!).filter(Boolean)
    const res = buildDay(city, params, items, {
      day: i + 1,
      date: params.startDate ? addDays(params.startDate, i) : undefined,
      start,
      startMin: hhmmToMinutes(params.startTime),
      used,
      triedCuisines: tried,
      isSuburb: d.isSuburb,
      optimize: false,
      pinned: d.meals,
      variant,
    })
    res.usedRestaurants.forEach((id) => used.add(id))
    return res.plan
  })
  return { id: `plan-${Date.now().toString(36)}`, variant, params, days: built, skipped: [], suggestions: [], createdAt: Date.now() }
}

/** 当前这一天已经选好的餐厅，按餐别固定下来 */
export function pinnedMealsOf(day: DayPlan): Partial<Record<MealType, string>> {
  const out: Partial<Record<MealType, string>> = {}
  day.stops.forEach((s) => {
    if (s.kind === 'meal' && s.mealType) out[s.mealType] = s.id
  })
  return out
}

export function locateStop(city: City, stop: ScheduleStop): LatLng | null {
  if (stop.kind === 'attraction') return city.attractions.find((a) => a.id === stop.id) ?? null
  return city.restaurants.find((r) => r.id === stop.id) ?? null
}

/** 某一餐可以换的其他餐厅（按顺路程度与评分排序） */
export function mealAlternatives(city: City, plan: TripPlan, dayIdx: number, stopIdx: number, limit = 8): Restaurant[] {
  const day = plan.days[dayIdx]
  const stop = day.stops[stopIdx]
  if (!stop || stop.kind !== 'meal') return []
  const start = plan.params.startPoint ?? city.center
  const prev = stopIdx > 0 ? locateStop(city, day.stops[stopIdx - 1]) ?? start : start
  const next = stopIdx < day.stops.length - 1 ? locateStop(city, day.stops[stopIdx + 1]) : null
  const used = new Set(plan.days.flatMap((d) => d.stops.filter((s) => s.kind === 'meal').map((s) => s.id)))
  const base = next ? haversine(prev, next) : 0
  const prefs = plan.params.food ?? DEFAULT_FOOD_PREFS
  return city.restaurants
    .filter((r) => !used.has(r.id) && r.mealTypes.includes(stop.mealType ?? 'lunch'))
    .map((r) => {
      const detour = next ? haversine(prev, r) + haversine(r, next) - base : haversine(prev, r)
      const score = r.rating * 10 - detour * 7 + (r.tags.some((t) => ['必吃榜', '老字号', '本地人推荐'].includes(t)) ? 3 : 0) + foodPrefAdjust(r, prefs, plan.variant)
      return { r, score, detour }
    })
    .filter((x) => x.detour <= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r)
}

/** 把某一餐换成指定餐厅，并重算当天时间 */
export function replaceMeal(city: City, plan: TripPlan, dayIdx: number, stopIdx: number, restaurantId: string): TripPlan {
  const day = plan.days[dayIdx]
  const stop = day.stops[stopIdx]
  if (!stop || stop.kind !== 'meal' || !stop.mealType) return plan
  const pinned = { ...pinnedMealsOf(day), [stop.mealType]: restaurantId }
  return rebuildDay(city, plan, dayIdx, attractionIdsOfDay(day), false, pinned)
}

/** 手动调整景点顺序（保留当前餐厅） */
export function moveAttraction(city: City, plan: TripPlan, dayIdx: number, from: number, to: number): TripPlan {
  const ids = attractionIdsOfDay(plan.days[dayIdx])
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return plan
  const [item] = ids.splice(from, 1)
  ids.splice(to, 0, item)
  return rebuildDay(city, plan, dayIdx, ids, false, pinnedMealsOf(plan.days[dayIdx]))
}

export function removeAttraction(city: City, plan: TripPlan, dayIdx: number, attractionId: string): TripPlan {
  const ids = attractionIdsOfDay(plan.days[dayIdx]).filter((id) => id !== attractionId)
  const next = rebuildDay(city, plan, dayIdx, ids, false, pinnedMealsOf(plan.days[dayIdx]))
  const skipped = next.skipped.filter((s) => s.id !== attractionId).concat({ id: attractionId, reason: '手动移除' })
  return { ...next, skipped }
}

export function addAttraction(city: City, plan: TripPlan, dayIdx: number, attractionId: string): TripPlan {
  const ids = attractionIdsOfDay(plan.days[dayIdx])
  if (ids.includes(attractionId)) return plan
  const next = rebuildDay(city, plan, dayIdx, [...ids, attractionId], true, pinnedMealsOf(plan.days[dayIdx]))
  return { ...next, skipped: next.skipped.filter((s) => s.id !== attractionId) }
}

export function optimizeDay(city: City, plan: TripPlan, dayIdx: number): TripPlan {
  return rebuildDay(city, plan, dayIdx, attractionIdsOfDay(plan.days[dayIdx]), true)
}

/** 景点 id → 所在天（从 0 开始），不在行程中返回 -1 */
export function dayOfAttraction(plan: TripPlan, attractionId: string): number {
  return plan.days.findIndex((d) => d.stops.some((s) => s.kind === 'attraction' && s.id === attractionId))
}

export function attractionIdsOfDay(day: DayPlan): string[] {
  return day.stops.filter((s) => s.kind === 'attraction').map((s) => s.id)
}

export function planTotals(plan: TripPlan) {
  return plan.days.reduce(
    (acc, d) => ({
      tickets: acc.tickets + d.cost.tickets,
      food: acc.food + d.cost.food,
      transport: acc.transport + d.cost.transport,
      distanceKm: round1(acc.distanceKm + d.distanceKm),
      walkKm: round1(acc.walkKm + d.walkKm),
      attractions: acc.attractions + d.stops.filter((s) => s.kind === 'attraction').length,
      meals: acc.meals + d.stops.filter((s) => s.kind === 'meal').length,
    }),
    { tickets: 0, food: 0, transport: 0, distanceKm: 0, walkKm: 0, attractions: 0, meals: 0 },
  )
}
