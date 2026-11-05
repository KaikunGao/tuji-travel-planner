/**
 * 途迹 · 改动代价
 *
 * 任何一次改动（砍点、加点、换顺序、换餐厅）都用同一套口径讲清楚：
 * 少看 / 多看了什么、当天提前还是推后多久收工、路程和花费怎么变、后面哪几站的时间跟着动、有没有新的冲突。
 * 这里只比较改动前后的两份行程，不关心改动是怎么做出来的。
 *
 * 口径与规划器一致：路程是直线 × 1.3 的估算，所以对外只说「约」，不报到分钟级的到达时间。
 */
import type { Attraction, City, DayPlan, MealType, Restaurant, ScheduleStop, Tier, TripPlan } from '../types'
import { MEAL_LABEL, formatDuration, formatKm, minutesToHHMM } from './format'
import { round1 } from './geo'
import { attractionIdsOfDay, removeAttraction, scoreAttraction, tierOf } from './planner'

export const TIER_LABEL: Record<Tier, { name: string; desc: string }> = {
  must: { name: '必去', desc: '硬约束，任何改动都不会动它' },
  optional: { name: '可选', desc: '排得下就去' },
  droppable: { name: '可放弃', desc: '时间不够先砍它' },
}

/** 时间变化小于这个值（分钟）就当没变：估算本身的误差比它大 */
const SHIFT_MIN = 5

export interface StopShift {
  kind: ScheduleStop['kind']
  id: string
  name: string
  /** 改动前 / 后的开始时间（距当天 0:00 的分钟数） */
  from: number
  to: number
}

export interface DayDiff {
  dayIdx: number
  day: number
  /** 这一天少了 / 多了的景点（含挪到别的天的） */
  removed: Attraction[]
  added: Attraction[]
  /** 景点没变，只是顺序变了 */
  reordered: boolean
  /** 餐厅变化：from 为空 = 新增一餐，to 为空 = 这一餐不排了 */
  meals: { mealType: MealType; from?: Restaurant; to?: Restaurant }[]
  /** 游览时长变化（分钟，负数 = 少逛） */
  visitDelta: number
  /** 路上时间变化（分钟，含回程，负数 = 路上更省） */
  travelDelta: number
  /** 收工时间（回到出发点），改动前 / 后 */
  endFrom: number
  endTo: number
  /** 干等的空档（等开门 / 等饭点）变化，正数 = 多出来的空档 */
  idleDelta: number
  distanceDelta: number
  walkDelta: number
  /** 人均花费变化（门票 + 餐 + 交通） */
  costDelta: number
  /** 留在这一天、但开始时间变了的站点（按改动后的顺序） */
  shifted: StopShift[]
  /** 新出现的冲突 / 改动前就有、现在还在的冲突 / 解决掉的冲突 */
  newWarnings: { name: string; text: string }[]
  stillWarnings: { name: string; text: string }[]
  clearedWarnings: string[]
  /** 改动后这一天没有景点了 */
  emptied: boolean
}

export interface PlanDiff {
  /** 只包含有变化的天 */
  days: DayDiff[]
  untouchedDays: number
  /** 整天对调的两天（Day 序号）；对调的天按「同一批景点」前后比较，而不是按日期位置 */
  swaps: [number, number][]
  /** 整份行程层面：彻底不去了 / 新加进来 / 换了一天 */
  removed: Attraction[]
  added: Attraction[]
  moved: { a: Attraction; fromDay: number; toDay: number }[]
}

/** 收工时间：最后一站结束 + 回到出发点 */
export function dayEnd(day: DayPlan): number {
  return day.stops.length ? day.endTime + (day.returnLeg?.minutes ?? 0) : day.startTime
}

/** 一天里干等的时间：到了但还没开门 / 没到饭点 */
function idleMinutes(day: DayPlan): number {
  let prevEnd = day.startTime
  let idle = 0
  for (const s of day.stops) {
    idle += Math.max(0, s.start - (prevEnd + (s.leg?.minutes ?? 0)))
    prevEnd = s.end
  }
  return idle
}

function visitMinutes(day: DayPlan): number {
  return day.stops.reduce((s, x) => s + (x.kind === 'attraction' ? x.end - x.start : 0), 0)
}

function travelMinutes(day: DayPlan): number {
  if (!day.stops.length) return 0
  return day.stops.reduce((s, x) => s + (x.leg?.minutes ?? 0), 0) + (day.returnLeg?.minutes ?? 0)
}

function dayCost(day: DayPlan): number {
  return day.cost.tickets + day.cost.food + day.cost.transport
}

function stopName(city: City, s: ScheduleStop): string {
  if (s.kind === 'attraction') return city.attractions.find((a) => a.id === s.id)?.name ?? s.id
  const r = city.restaurants.find((x) => x.id === s.id)
  return `${MEAL_LABEL[s.mealType ?? 'lunch']} · ${r?.name ?? s.id}`
}

function mealsOf(day: DayPlan): Map<MealType, string> {
  const m = new Map<MealType, string>()
  day.stops.forEach((s) => s.kind === 'meal' && s.mealType && m.set(s.mealType, s.id))
  return m
}

function sameSchedule(a: DayPlan, b: DayPlan): boolean {
  return a.stops.length === b.stops.length && a.stops.every((s, i) => s.kind === b.stops[i].kind && s.id === b.stops[i].id && s.start === b.stops[i].start && s.end === b.stops[i].end)
}

function diffDay(city: City, dayIdx: number, before: DayPlan, after: DayPlan): DayDiff {
  const attraction = (id: string) => city.attractions.find((a) => a.id === id)
  const restaurant = (id?: string) => (id ? city.restaurants.find((r) => r.id === id) : undefined)
  const idsBefore = attractionIdsOfDay(before)
  const idsAfter = attractionIdsOfDay(after)
  const removed = idsBefore.filter((id) => !idsAfter.includes(id)).map(attraction).filter((a): a is Attraction => !!a)
  const added = idsAfter.filter((id) => !idsBefore.includes(id)).map(attraction).filter((a): a is Attraction => !!a)
  const keptBefore = idsBefore.filter((id) => idsAfter.includes(id))
  const keptAfter = idsAfter.filter((id) => idsBefore.includes(id))
  const reordered = keptBefore.some((id, i) => id !== keptAfter[i])

  const mb = mealsOf(before)
  const ma = mealsOf(after)
  const meals: DayDiff['meals'] = []
  for (const type of new Set([...mb.keys(), ...ma.keys()])) {
    if (mb.get(type) !== ma.get(type)) meals.push({ mealType: type, from: restaurant(mb.get(type)), to: restaurant(ma.get(type)) })
  }

  const key = (s: ScheduleStop) => `${s.kind}:${s.id}`
  const beforeByKey = new Map(before.stops.map((s) => [key(s), s]))
  const shifted: StopShift[] = []
  const newWarnings: DayDiff['newWarnings'] = []
  const stillWarnings: DayDiff['stillWarnings'] = []
  const clearedWarnings: string[] = []
  for (const s of after.stops) {
    const prev = beforeByKey.get(key(s))
    if (prev && Math.abs(s.start - prev.start) >= SHIFT_MIN) shifted.push({ kind: s.kind, id: s.id, name: stopName(city, s), from: prev.start, to: s.start })
    if (s.warning && !prev?.warning) newWarnings.push({ name: stopName(city, s), text: s.warning })
    if (s.warning && prev?.warning) stillWarnings.push({ name: stopName(city, s), text: s.warning })
    if (prev?.warning && !s.warning) clearedWarnings.push(stopName(city, s))
  }

  return {
    dayIdx,
    day: after.day,
    removed,
    added,
    reordered,
    meals,
    visitDelta: visitMinutes(after) - visitMinutes(before),
    travelDelta: travelMinutes(after) - travelMinutes(before),
    endFrom: dayEnd(before),
    endTo: dayEnd(after),
    idleDelta: idleMinutes(after) - idleMinutes(before),
    distanceDelta: round1(after.distanceKm - before.distanceKm),
    walkDelta: round1(after.walkKm - before.walkKm),
    costDelta: Math.round(dayCost(after) - dayCost(before)),
    shifted,
    newWarnings,
    stillWarnings,
    clearedWarnings,
    emptied: idsBefore.length > 0 && idsAfter.length === 0,
  }
}

/** 比较改动前后的两份行程（天数须一致，否则视为整份替换，返回 null） */
export function diffPlans(city: City, before: TripPlan, after: TripPlan): PlanDiff | null {
  if (before.days.length !== after.days.length) return null
  // 整天对调：改动后第 i 天的景点和顺序，与改动前另一天完全一样
  const signature = (d: DayPlan) => attractionIdsOfDay(d).join('|')
  const source = after.days.map((d, i) => {
    const sig = signature(d)
    if (!sig || sig === signature(before.days[i])) return i
    const j = before.days.findIndex((b, k) => k !== i && signature(b) === sig)
    return j >= 0 ? j : i
  })
  const permuted = new Set(source).size === source.length
  const from = (i: number) => (permuted ? source[i] : i)
  const swaps: [number, number][] = []
  const days: DayDiff[] = []
  after.days.forEach((d, i) => {
    const j = from(i)
    if (j !== i && j > i && from(j) === i) swaps.push([d.day, after.days[j].day])
    if (!sameSchedule(before.days[j], d)) days.push(diffDay(city, i, before.days[j], d))
  })
  const swapped = new Set(swaps.flat())
  const dayOf = (plan: TripPlan) => {
    const m = new Map<string, number>()
    plan.days.forEach((d) => attractionIdsOfDay(d).forEach((id) => m.set(id, d.day)))
    return m
  }
  const wasOn = dayOf(before)
  const nowOn = dayOf(after)
  const attraction = (id: string) => city.attractions.find((a) => a.id === id)
  const pick = (ids: string[]) => ids.map(attraction).filter((a): a is Attraction => !!a)
  const moved: PlanDiff['moved'] = []
  for (const [id, toDay] of nowOn) {
    const fromDay = wasOn.get(id)
    const a = attraction(id)
    // 跟着整天对调走的不算「挪了一天」
    if (a && fromDay !== undefined && fromDay !== toDay && !(swapped.has(fromDay) && swapped.has(toDay))) moved.push({ a, fromDay, toDay })
  }
  return {
    days,
    untouchedDays: after.days.filter((d, i) => from(i) === i && sameSchedule(before.days[i], d)).length,
    swaps,
    removed: pick([...wasOn.keys()].filter((id) => !nowOn.has(id))),
    added: pick([...nowOn.keys()].filter((id) => !wasOn.has(id))),
    moved,
  }
}

export function isEmptyDiff(diff: PlanDiff | null): boolean {
  return !diff || (diff.days.length === 0 && diff.swaps.length === 0)
}

/* ------------------------------------------------------------------ */
/* 把代价讲成人话                                                       */
/* ------------------------------------------------------------------ */

export type DiffTone = 'loss' | 'gain' | 'neutral' | 'warn'
export interface DiffLine {
  tone: DiffTone
  text: string
}

/** 一句话说这次改了什么 */
export function summarizeDiff(diff: PlanDiff): string {
  const names = (xs: Attraction[]) => xs.map((a) => a.name).join('、')
  const parts: string[] = []
  diff.swaps.forEach(([a, b]) => parts.push(`Day ${a} 和 Day ${b} 整天对调`))
  if (diff.removed.length && diff.added.length === diff.removed.length && !diff.moved.length && !diff.swaps.length) {
    return diff.removed.map((a, i) => `${a.name} 换成 ${diff.added[i].name}`).join('，')
  }
  if (diff.removed.length) parts.push(`砍掉 ${names(diff.removed)}`)
  if (diff.added.length) parts.push(`加入 ${names(diff.added)}`)
  diff.moved.forEach((m) => parts.push(`${m.a.name} 从 Day ${m.fromDay} 挪到 Day ${m.toDay}`))
  if (parts.length) return parts.join('，')
  const d = diff.days[0]
  if (!d) return '行程没有变化'
  if (d.reordered) return `调整了 Day ${d.day} 的顺序`
  if (d.meals.length) return `Day ${d.day} 换了${d.meals.map((m) => MEAL_LABEL[m.mealType]).join('、')}`
  return `Day ${d.day} 的时间有变化`
}

/** 逐条列出代价与收益；params 取改动后的行程偏好，用来标注档位 */
export function describeDiff(diff: PlanDiff, after: TripPlan, city: City): DiffLine[] {
  const lines: DiffLine[] = []
  const params = after.params
  const remaining = new Set(after.days.flatMap((d) => attractionIdsOfDay(d)))
  const stillHas = (category: string) => city.attractions.some((a) => remaining.has(a.id) && a.category === category)

  diff.swaps.forEach(([a, b]) => lines.push({ tone: 'neutral', text: `Day ${a} 和 Day ${b} 整天对调，两天各自的景点、顺序和餐厅都不变` }))
  diff.moved.forEach((m) => lines.push({ tone: 'neutral', text: `${m.a.name} 从 Day ${m.fromDay} 挪到 Day ${m.toDay}，没有少看` }))
  for (const a of diff.removed) {
    const tier = tierOf(params, a.id)
    const notes = [`★${a.rating.toFixed(1)}`]
    if (tier !== 'optional') notes.push(`你标的${TIER_LABEL[tier].name}`)
    else if (a.mustSee) notes.push('经典景点')
    if (!stillHas(a.category)) notes.push(`行程里唯一的「${a.category}」`)
    if (a.needBooking) notes.push(a.price ? '订了票记得退' : '预约了记得取消')
    lines.push({ tone: tier === 'droppable' ? 'neutral' : 'loss', text: `少看 ${a.name}（${notes.join(' · ')}）` })
  }
  for (const a of diff.added) {
    lines.push({ tone: 'gain', text: `多看 ${a.name}（★${a.rating.toFixed(1)} · 约 ${formatDuration(a.duration)} · ${a.price ? `门票 ¥${a.price}` : '免费'}${a.needBooking ? ' · 需提前预约' : ''}）` })
  }

  const multi = diff.days.length > 1
  const swappedDays = new Set(diff.swaps.flat())
  for (const d of diff.days) {
    const pre = multi ? `Day ${d.day}：` : ''
    // 对调的天内容没变，只报真正变了的（多半是闭馆日冲突），不逐条说「不变」
    const quiet = swappedDays.has(d.day)
    const endDelta = d.endTo - d.endFrom
    // 省出 / 多占的时间 = 游览 + 路上；它要么让收工提前，要么变成中间的空档
    const freed = -(d.visitDelta + d.travelDelta)
    const split = (visit: number, travel: number) => {
      const parts: string[] = []
      if (Math.abs(visit) >= SHIFT_MIN) parts.push(`${visit < 0 ? '少逛' : '多逛'} ${formatDuration(Math.abs(visit))}`)
      if (Math.abs(travel) >= SHIFT_MIN) parts.push(`路上${travel < 0 ? '少' : '多'} ${formatDuration(Math.abs(travel))}`)
      return parts.length ? `（${parts.join('，')}）` : ''
    }
    if (freed >= SHIFT_MIN) lines.push({ tone: 'gain', text: `${pre}腾出约 ${formatDuration(freed)}${split(d.visitDelta, d.travelDelta)}` })
    else if (freed <= -SHIFT_MIN) lines.push({ tone: 'loss', text: `${pre}多占约 ${formatDuration(-freed)}${split(d.visitDelta, d.travelDelta)}` })
    if (d.emptied) {
      lines.push({ tone: 'neutral', text: `${pre}这一天空出来了，可以休息或补别的点` })
    } else if (endDelta <= -SHIFT_MIN) {
      lines.push({ tone: 'gain', text: `${pre}约 ${minutesToHHMM(d.endTo)} 收工，比原来早 ${formatDuration(-endDelta)}` })
    } else if (endDelta >= SHIFT_MIN) {
      // 明明腾出了时间却更晚收工：通常是因为时间够了，多排上了一顿饭
      const newMeals = d.meals.filter((m) => !m.from && m.to).map((m) => MEAL_LABEL[m.mealType])
      const why = freed >= SHIFT_MIN && newMeals.length ? `（因为多排了${newMeals.join('、')}）` : ''
      lines.push({ tone: why ? 'neutral' : 'loss', text: `${pre}约 ${minutesToHHMM(d.endTo)} 收工，比原来晚 ${formatDuration(endDelta)}${why}` })
    } else if (!quiet) {
      lines.push({ tone: 'neutral', text: `${pre}收工时间不变（约 ${minutesToHHMM(d.endTo)}）` })
    }
    if (!d.emptied && d.idleDelta >= 15) {
      lines.push({ tone: 'neutral', text: `${pre}中间多出约 ${formatDuration(d.idleDelta)}空档（后面的站点要等开门或饭点，提前不了）` })
    }
    if (Math.abs(d.distanceDelta) >= 0.3) {
      const walk = Math.abs(d.walkDelta) >= 0.3 ? `，其中步行${d.walkDelta < 0 ? '少' : '多'} ${formatKm(Math.abs(d.walkDelta))}` : ''
      lines.push({ tone: d.distanceDelta < 0 ? 'gain' : 'loss', text: `${pre}${d.distanceDelta < 0 ? '少走' : '多走'}约 ${formatKm(Math.abs(d.distanceDelta))}${walk}` })
    }
    if (Math.abs(d.costDelta) >= 1) {
      lines.push({ tone: d.costDelta < 0 ? 'gain' : 'loss', text: `${pre}人均${d.costDelta < 0 ? '省' : '多花'} ¥${Math.abs(d.costDelta)}` })
    }
    for (const m of d.meals) {
      const label = MEAL_LABEL[m.mealType]
      if (m.from && m.to) lines.push({ tone: 'neutral', text: `${pre}${label}从 ${m.from.name} 换成 ${m.to.name}` })
      else if (m.to) lines.push({ tone: 'neutral', text: `${pre}新排了${label}：${m.to.name}` })
      else if (m.from && !d.emptied) lines.push({ tone: 'neutral', text: `${pre}不再安排${label}（原来是 ${m.from.name}）` })
    }
    if (d.shifted.length) {
      const earlier = d.shifted.every((s) => s.to < s.from)
      const later = d.shifted.every((s) => s.to > s.from)
      const show = d.shifted.slice(0, 3).map((s) => `${s.name} ${minutesToHHMM(s.from)} → ${minutesToHHMM(s.to)}`)
      lines.push({
        tone: 'neutral',
        text: `${pre}影响 ${d.shifted.length} 站的时间${earlier ? '（都提前）' : later ? '（都推后）' : ''}：${show.join('，')}${d.shifted.length > 3 ? ' 等' : ''}`,
      })
    } else if (!d.emptied && !quiet) {
      lines.push({ tone: 'neutral', text: `${pre}其余站点的时间不变` })
    }
    d.newWarnings.forEach((w) => lines.push({ tone: 'warn', text: `${pre}新冲突：${w.name} —— ${w.text}` }))
    d.stillWarnings.forEach((w) => lines.push({ tone: 'warn', text: `${pre}原有的冲突还在：${w.name} —— ${w.text}` }))
    d.clearedWarnings.forEach((name) => lines.push({ tone: 'gain', text: `${pre}${name} 的时间冲突解决了` }))
  }
  if (diff.untouchedDays > 0) lines.push({ tone: 'neutral', text: `其他 ${diff.untouchedDays} 天没动` })
  return lines
}

/* ------------------------------------------------------------------ */
/* 砍点                                                                 */
/* ------------------------------------------------------------------ */

export interface CutOption {
  a: Attraction
  tier: Tier
  /** 砍掉之后的行程（确认后直接采用，不用再算一遍） */
  next: TripPlan
  diff: PlanDiff
  /** 当天能腾出多少时间（游览 + 路上，分钟） */
  savedMinutes: number
}

/** 预览：把某个景点从这一天砍掉会怎样（不改原行程） */
export function previewRemove(city: City, plan: TripPlan, dayIdx: number, attractionId: string): CutOption | null {
  const a = city.attractions.find((x) => x.id === attractionId)
  if (!a || !plan.days[dayIdx]) return null
  const next = removeAttraction(city, plan, dayIdx, attractionId)
  const diff = diffPlans(city, plan, next)
  if (!diff) return null
  const d = diff.days.find((x) => x.dayIdx === dayIdx)
  return { a, tier: tierOf(plan.params, attractionId), next, diff, savedMinutes: d ? Math.max(0, -(d.visitDelta + d.travelDelta)) : 0 }
}

/**
 * 这一天想轻松点，先砍谁：必去不在候选里；可放弃排最前，其余按「损失小的在前」（打分低的先砍）。
 */
export function cutOptions(city: City, plan: TripPlan, dayIdx: number): CutOption[] {
  const day = plan.days[dayIdx]
  if (!day) return []
  const rank: Record<Tier, number> = { droppable: 0, optional: 1, must: 2 }
  const value = (a: Attraction) => scoreAttraction(a, plan.params.interests, false, plan.variant)
  return attractionIdsOfDay(day)
    .filter((id) => tierOf(plan.params, id) !== 'must')
    .map((id) => previewRemove(city, plan, dayIdx, id))
    .filter((o): o is CutOption => !!o)
    .sort((x, y) => rank[x.tier] - rank[y.tier] || value(x.a) - value(y.a))
}
