/**
 * 途迹 · 替代点与预案
 *
 * 出发前把「出状况了怎么办」算好：下雨、某个点去不了、排队太久、走不动了。
 * 触发条件一律由用户自己说（途迹不接天气和排队数据），这里只负责给出方案和各自的代价。
 *
 * 三条规矩：
 *  1. 必去的点不自动替换、不自动砍，优先给「换天」；
 *  2. 只动出状况的那一天（换天时动两天），其余原样；
 *  3. 新方案不能带来新的时间冲突（闭馆、赶不上闭园），否则不算可用。
 *
 * 出发以后（行程带了行中进度）：已经走完的站和已经过去的天不参与任何预案，方案只针对还没走的那一段。
 */
import type { Attraction, City, Exposure, Tier, TripPlan } from '../types'
import { TIER_LABEL, cutOptions, dayEnd, describeDiff, diffPlans, previewRemove, type DiffLine, type PlanDiff } from './change'
import { formatDuration, formatKm, minutesToHHMM, weekdayOf } from './format'
import { haversine } from './geo'
import { attractionIdsOfDay, formatPopularity, isPastDay, isSuburb, moveToDay, pinnedMealsOf, popularityBonus, rebuildDay, remainingIdsOfDay, replaceAttraction, swapDays, tierOf } from './planner'

/* ------------------------------------------------------------------ */
/* 淋雨程度                                                             */
/* ------------------------------------------------------------------ */

export const EXPOSURE_LABEL: Record<Exposure, string> = { indoor: '室内', mixed: '半室内', outdoor: '露天' }

/** 景点的淋雨程度；数据里没标的按分类推断，并标记为「推断」 */
export function exposureOf(a: Attraction): { value: Exposure; inferred: boolean } {
  if (a.exposure) return { value: a.exposure, inferred: false }
  if (a.category === '博物馆艺术' || a.tags.includes('室内')) return { value: 'indoor', inferred: true }
  if (a.category === '购物' || a.category === '美食探店') return { value: 'mixed', inferred: true }
  return { value: 'outdoor', inferred: true }
}

/* ------------------------------------------------------------------ */
/* C2 替代点检索                                                        */
/* ------------------------------------------------------------------ */

/** 市区的替代点离原来的点不超过这个距离（公里）；远郊放宽 */
const ALT_RADIUS_KM = 6
const ALT_SUBURB_RADIUS_KM = 35
/** 时长相近：原时长的 0.5–1.5 倍 */
const ALT_DURATION: [number, number] = [0.5, 1.5]
/** 评分最多比原来低这么多 */
const ALT_RATING_DROP = 0.4
/** 顺路：换上去之后，当天路上多花的时间不超过这么多（分钟） */
const ALT_EXTRA_TRAVEL = 30

export interface Alternative {
  a: Attraction
  distanceKm: number
  /** 来自数据里人工指定的 alternatives，而不是自动找的 */
  curated: boolean
  /** 为什么是它：同类 / 多远 / 评分 / 时长 / 室内 */
  reasons: string[]
  /** 原地换上去之后的行程与代价 */
  next: TripPlan
  diff: PlanDiff
}

function hasNewConflict(diff: PlanDiff | null): boolean {
  return !diff || diff.days.some((d) => d.newWarnings.length > 0)
}

/**
 * 给行程里的一个点找替代：没排进行程、没被排除、当天开门、换上去不产生新冲突。
 * 平时要求同类、距离近、时长相近、评分不低太多；rain=true 时改为「必须比原来少淋雨」，同类只是加分项。
 */
export function findAlternatives(city: City, plan: TripPlan, dayIdx: number, attractionId: string, opts: { rain?: boolean; limit?: number } = {}): Alternative[] {
  const day = plan.days[dayIdx]
  const o = city.attractions.find((a) => a.id === attractionId)
  if (!day || !o || !remainingIdsOfDay(plan, dayIdx).includes(attractionId)) return []
  const inPlan = new Set(plan.days.flatMap((d) => attractionIdsOfDay(d)))
  const weekday = day.date ? weekdayOf(day.date) : undefined
  const suburb = isSuburb(o, city)
  const radius = suburb ? ALT_SUBURB_RADIUS_KM : ALT_RADIUS_KM
  const curatedIds = o.alternatives ?? []
  const rank: Record<Exposure, number> = { indoor: 0, mixed: 1, outdoor: 2 }

  const scored: { alt: Alternative; score: number }[] = []
  for (const c of city.attractions) {
    if (c.id === o.id || inPlan.has(c.id) || plan.params.exclude.includes(c.id)) continue
    if (weekday !== undefined && c.closedOn?.includes(weekday)) continue
    const curated = curatedIds.includes(c.id)
    const distanceKm = haversine(o, c)
    const sameCategory = c.category === o.category
    // 同类的三种程度：主分类相同 > 对方的标签里有原来的分类 > 原来的标签里有对方的分类
    const relation = sameCategory ? `同为${o.category}` : c.tags.includes(o.category) ? `也算${o.category}` : o.tags.includes(c.category) ? `同属${c.category}` : ''
    const exposure = exposureOf(c).value
    if (opts.rain && rank[exposure] >= rank[exposureOf(o).value]) continue
    // 下雨时，经典景点只值得换成真正室内的；换成半室内的次一级景点不如带伞照常去
    if (opts.rain && o.mustSee && exposure !== 'indoor' && !curated) continue
    if (!curated) {
      if (isSuburb(c, city) !== suburb || distanceKm > radius) continue
      if (!opts.rain && !relation) continue
      if (c.duration > o.duration * ALT_DURATION[1] || c.duration < o.duration * (opts.rain ? 0.4 : ALT_DURATION[0])) continue
      if (c.rating < o.rating - (opts.rain ? ALT_RATING_DROP + 0.2 : ALT_RATING_DROP)) continue
    }
    const next = replaceAttraction(city, plan, dayIdx, o.id, c.id)
    const diff = diffPlans(city, plan, next)
    if (!diff || hasNewConflict(diff)) continue
    if (!curated && diff.days.some((d) => d.travelDelta > ALT_EXTRA_TRAVEL)) continue

    const reasons = [relation || c.category, `相距 ${formatKm(distanceKm)}`, `★${c.rating.toFixed(1)}`, `约 ${formatDuration(c.duration)}`]
    if (c.popularity) reasons.push(formatPopularity(c.popularity))
    if (opts.rain) reasons.push(EXPOSURE_LABEL[exposure])
    if (curated) reasons.unshift('人工指定')
    const score =
      (curated ? 100 - curatedIds.indexOf(c.id) : 0) +
      (sameCategory ? 3 : relation.startsWith('也算') ? 1.5 : relation ? 1 : 0) +
      (c.rating - o.rating) * 5 +
      // 人气：换成更多人去过的点加分，换成冷门点扣分；量级与评分差相当，不盖过同类与距离
      (popularityBonus(c) - popularityBonus(o)) * 0.5 -
      distanceKm * 0.4 -
      Math.abs(c.duration - o.duration) / 60 +
      (opts.rain && exposure === 'indoor' ? 4 : 0)
    scored.push({ alt: { a: c, distanceKm, curated, reasons, next, diff }, score })
  }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, opts.limit ?? 3)
    .map((x) => x.alt)
}

/* ------------------------------------------------------------------ */
/* C4 预案                                                              */
/* ------------------------------------------------------------------ */

export type TriggerKind = 'rain' | 'blocked' | 'queue' | 'tired'

export interface PlanOption {
  key: string
  title: string
  /** 一句话说明前提或理由 */
  why?: string
  lines: DiffLine[]
  /** 采用后的行程；为空表示「不改行程」（比如继续等） */
  next?: TripPlan
}

export interface Contingency {
  kind: TriggerKind
  dayIdx: number
  /** 针对哪一站；整天的预案为空 */
  stopId?: string
  title: string
  /** 触发条件：什么时候用这张卡 */
  when: string
  /** 现状：哪些点受影响、最晚几点得走 */
  facts: string[]
  /** 方案按推荐顺序排列，各带代价 */
  options: PlanOption[]
  /** 不用改，或没有可行方案时的说明 */
  note?: string
}

function option(city: City, base: TripPlan, key: string, title: string, next: TripPlan, why?: string): PlanOption | null {
  const diff = diffPlans(city, base, next)
  if (!diff || (diff.days.length === 0 && diff.swaps.length === 0)) return null
  return { key, title, why, lines: describeDiff(diff, next, city), next }
}

const nameOf = (city: City, id: string) => city.attractions.find((a) => a.id === id)?.name ?? id

/** 这一天没有可改的站时，说清楚是为什么 */
function nothingLeft(plan: TripPlan, dayIdx: number): string {
  if (isPastDay(plan, dayIdx)) return '这一天已经过去了。'
  return attractionIdsOfDay(plan.days[dayIdx]).length ? '这一天的景点都走完了。' : '这一天没排景点，不用改。'
}

/** 一天的游览时间里露天占多少（0–1） */
function outdoorShare(city: City, plan: TripPlan, dayIdx: number): number {
  let outdoor = 0
  let total = 0
  for (const id of attractionIdsOfDay(plan.days[dayIdx])) {
    const a = city.attractions.find((x) => x.id === id)
    if (!a) continue
    total += a.duration
    if (exposureOf(a).value === 'outdoor') outdoor += a.duration
  }
  return total ? outdoor / total : 0
}

/** 这天下雨：露天的点换成室内 / 半室内的；必去的不动，可以整天和别的天对调 */
export function rainPlan(city: City, plan: TripPlan, dayIdx: number): Contingency {
  const ids = remainingIdsOfDay(plan, dayIdx)
  const attraction = (id: string) => city.attractions.find((a) => a.id === id)!
  const outdoor = ids.filter((id) => exposureOf(attraction(id)).value === 'outdoor')
  const base: Contingency = { kind: 'rain', dayIdx, title: '这天下雨', when: '出门前看到下雨，或者玩到一半下起来了', facts: [], options: [] }
  if (!ids.length) return { ...base, note: nothingLeft(plan, dayIdx) }
  if (!outdoor.length) return { ...base, note: `${plan.progress?.dayIdx === dayIdx ? '剩下的站' : '这一天'}没有露天的点，带伞照原计划走就行。` }
  base.facts.push(`露天、会淋雨的：${outdoor.map((id) => nameOf(city, id)).join('、')}`)
  const inferred = outdoor.filter((id) => exposureOf(attraction(id)).inferred)
  if (inferred.length) base.facts.push(`其中 ${inferred.map((id) => nameOf(city, id)).join('、')} 是按分类推断的，出发前自己确认一下`)

  // 方案一：露天的点逐个换成少淋雨的；必去不动；没有替代的，可放弃就砍、可选就留着
  // 先处理淋雨最久的点，让它优先挑到最好的替代
  let working = plan
  const swapped: string[] = []
  const cut: string[] = []
  const kept: string[] = []
  for (const id of [...outdoor].sort((x, y) => attraction(y).duration - attraction(x).duration)) {
    const tier = tierOf(plan.params, id)
    if (tier === 'must') {
      kept.push(`${nameOf(city, id)}（必去）`)
      continue
    }
    const [alt] = findAlternatives(city, working, dayIdx, id, { rain: true, limit: 1 })
    if (alt) {
      working = alt.next
      swapped.push(`${nameOf(city, id)} → ${alt.a.name}`)
    } else if (tier === 'droppable') {
      const removed = previewRemove(city, working, dayIdx, id)
      if (removed) {
        working = removed.next
        cut.push(nameOf(city, id))
      }
    } else kept.push(nameOf(city, id))
  }
  const title = [swapped.length ? `换成少淋雨的：${swapped.join('，')}` : '', cut.length ? `砍掉 ${cut.join('、')}` : ''].filter(Boolean).join('；')
  const indoorOption = title ? option(city, plan, 'rain:indoor', title, working, kept.length ? `没有合适的室内替代、得带伞照常去的：${kept.join('、')}` : undefined) : null
  if (indoorOption) base.options.push(indoorOption)

  // 方案二：和露天占比最低的那天整天对调（前提是那天不下雨）
  const mine = outdoorShare(city, plan, dayIdx)
  const candidates = plan.days
    .map((_, j) => j)
    .filter((j) => j !== dayIdx && attractionIdsOfDay(plan.days[j]).length > 0 && outdoorShare(city, plan, j) < mine)
    .sort((x, y) => outdoorShare(city, plan, x) - outdoorShare(city, plan, y))
  for (const j of candidates) {
    const next = swapDays(city, plan, dayIdx, j)
    if (hasNewConflict(diffPlans(city, plan, next))) continue
    const o = option(city, plan, `rain:swap:${j}`, `和 Day ${plan.days[j].day} 整天对调`, next, `前提是 Day ${plan.days[j].day} 原来那天不下雨；那天的安排露天更少，放到雨天更合适`)
    if (o) {
      base.options.push(o)
      break
    }
  }
  if (!base.options.length) base.note = `没有合适的改法：${kept.join('、') || '露天的点'}附近没有室内替代，也没有更适合雨天的另一天可以对调。带伞照常去，或者到「走不动了」里把它砍掉。`
  return base
}

/** 走不动了：按三档给出先砍谁（必去不在其中） */
export function tiredPlan(city: City, plan: TripPlan, dayIdx: number): Contingency {
  const ids = remainingIdsOfDay(plan, dayIdx)
  const base: Contingency = { kind: 'tired', dayIdx, title: '走不动了', when: '同行的人累了，或者想早点回去', facts: [], options: [] }
  const options = cutOptions(city, plan, dayIdx)
  const must = ids.filter((id) => tierOf(plan.params, id) === 'must')
  if (must.length) base.facts.push(`必去的不会动：${must.map((id) => nameOf(city, id)).join('、')}`)
  if (!options.length) return { ...base, note: ids.length ? '剩下的都是必去，没有可砍的点。先把某个点改成「可选」或「可放弃」。' : nothingLeft(plan, dayIdx) }
  base.options = options.slice(0, 3).map((o) => ({
    key: `tired:${o.a.id}`,
    title: `砍掉 ${o.a.name}${o.savedMinutes > 0 ? `，腾出约 ${formatDuration(o.savedMinutes)}` : ''}`,
    why: o.tier === 'droppable' ? '你标了可放弃' : undefined,
    lines: describeDiff(o.diff, o.next, city),
    next: o.next,
  }))
  return base
}

/**
 * 换一天去，只保留不带来新冲突的：
 * 市区的点先试「只挪这一个点」；挪不进去（别的天排满了）或是远郊点，再试「两天整天对调」。
 */
function rescheduleOptions(city: City, plan: TripPlan, dayIdx: number, stopId: string, limit: number): PlanOption[] {
  const a = city.attractions.find((x) => x.id === stopId)
  if (!a) return []
  const openOn = (j: number) => !(plan.days[j].date && a.closedOn?.includes(weekdayOf(plan.days[j].date!)))
  const others = plan.days.map((_, j) => j).filter((j) => j !== dayIdx && !isPastDay(plan, j) && openOn(j))

  const moves: { o: PlanOption; end: number }[] = []
  if (!plan.days[dayIdx].isSuburb) {
    for (const j of others) {
      if (plan.days[j].isSuburb) continue
      const next = moveToDay(city, plan, dayIdx, j, stopId)
      if (hasNewConflict(diffPlans(city, plan, next))) continue
      const o = option(city, plan, `move:${stopId}:${j}`, `改到 Day ${plan.days[j].day} 去`, next)
      if (o) moves.push({ o, end: dayEnd(next.days[j]) })
    }
  }
  // 优先挪到收工早的那天，免得把另一天撑爆
  const out = moves.sort((x, y) => x.end - y.end).map((x) => x.o)

  for (const j of others) {
    if (out.length >= limit) break
    if (!attractionIdsOfDay(plan.days[j]).length) continue
    const next = swapDays(city, plan, dayIdx, j)
    if (hasNewConflict(diffPlans(city, plan, next))) continue
    const o = option(city, plan, `swap:${stopId}:${j}`, `改到 Day ${plan.days[j].day} 去（两天整天对调）`, next)
    if (o) out.push(o)
  }
  return out.slice(0, limit)
}

/** 某个点去不了（临时闭馆、限流、没抢到票） */
export function blockedPlan(city: City, plan: TripPlan, dayIdx: number, stopId: string): Contingency {
  const tier: Tier = tierOf(plan.params, stopId)
  const name = nameOf(city, stopId)
  const base: Contingency = { kind: 'blocked', dayIdx, stopId, title: `${name} 去不了`, when: '临时闭馆、限流、没约上票', facts: [], options: [] }
  if (tier !== 'optional') base.facts.push(`你标的${TIER_LABEL[tier].name}`)

  const alternatives = findAlternatives(city, plan, dayIdx, stopId, { limit: 2 }).map(
    (alt): PlanOption => ({ key: `alt:${stopId}:${alt.a.id}`, title: `换成 ${alt.a.name}`, why: alt.reasons.join(' · '), lines: describeDiff(alt.diff, alt.next, city), next: alt.next }),
  )
  const moves = rescheduleOptions(city, plan, dayIdx, stopId, tier === 'must' ? 2 : 1)
  const removed = previewRemove(city, plan, dayIdx, stopId)
  const cut: PlanOption[] = removed ? [{ key: `cut:${stopId}`, title: '不去了，直接砍掉', lines: describeDiff(removed.diff, removed.next, city), next: removed.next }] : []

  // 必去：先换天，实在不行再看替代；可放弃：先砍；其余：先找替代
  base.options = tier === 'must' ? [...moves, ...alternatives, ...cut] : tier === 'droppable' ? [...cut, ...alternatives, ...moves] : [...alternatives, ...moves, ...cut]
  if (!alternatives.length && !moves.length) base.note = '附近没有合适的替代，别的天也排不进去（会带来新的时间冲突），只能砍掉。'
  return base
}

/** 最多还能多等多久的搜索上限与步长（分钟） */
const WAIT_CAP = 180
const WAIT_STEP = 10
/** 路程是估算的，给「最晚几点走」留的余量（分钟） */
const DEADLINE_MARGIN = 10

/** 在某一站门口多排 minutes 分钟之后的行程（只用来算代价，不能直接采用） */
function delayed(city: City, plan: TripPlan, dayIdx: number, stopId: string, minutes: number): TripPlan {
  const day = plan.days[dayIdx]
  return rebuildDay(city, plan, dayIdx, attractionIdsOfDay(day), false, pinnedMealsOf(day), day.isSuburb, { [stopId]: minutes })
}

export interface Deadline {
  /** 在这一站最多还能多排多久而不带来新冲突（分钟，已扣余量）；capped 说明后面很宽松，这只是搜索上限 */
  slack: number
  capped: boolean
  /** 最晚进场 / 最晚离开（距 0:00 的分钟数） */
  latestEnter: number
  latestLeave: number
  /** 再晚会出问题的那一站（可能就是它自己），以及会出什么问题 */
  blocker?: { id: string; name: string; text: string }
}

/** 给约束不给预测：算出这一站最晚几点必须进场 / 离开，否则哪一站会出问题 */
export function deadlineOf(city: City, plan: TripPlan, dayIdx: number, stopId: string): Deadline | null {
  const stop = plan.days[dayIdx]?.stops.find((s) => s.kind === 'attraction' && s.id === stopId)
  if (!stop || !remainingIdsOfDay(plan, dayIdx).includes(stopId)) return null
  let ok = 0
  let blocker: Deadline['blocker']
  for (let d = WAIT_STEP; d <= WAIT_CAP; d += WAIT_STEP) {
    const later = delayed(city, plan, dayIdx, stopId, d)
    const hit = later.days[dayIdx].stops.find((s) => s.warning && !plan.days[dayIdx].stops.find((b) => b.kind === s.kind && b.id === s.id)?.warning)
    if (hit) {
      blocker = { id: hit.id, name: nameOf(city, hit.id), text: hit.warning! }
      break
    }
    ok = d
  }
  const slack = blocker ? Math.max(0, ok - DEADLINE_MARGIN) : ok
  return { slack, capped: !blocker, latestEnter: stop.start + slack, latestLeave: stop.end + slack, blocker }
}

/** 某个点排队太久 */
export function queuePlan(city: City, plan: TripPlan, dayIdx: number, stopId: string): Contingency {
  const tier = tierOf(plan.params, stopId)
  const name = nameOf(city, stopId)
  const base: Contingency = { kind: 'queue', dayIdx, stopId, title: `${name} 排队太久`, when: '到了发现要排很久', facts: [], options: [] }
  const deadline = deadlineOf(city, plan, dayIdx, stopId)
  if (!deadline) return { ...base, note: '这一站不在当天的行程里。' }

  const margin = `已留 ${DEADLINE_MARGIN} 分钟余量`
  if (deadline.capped) {
    base.facts.push(`后面很宽松：多排 ${formatDuration(WAIT_CAP)}也不会让后面的点进不去，只是收工会晚`)
  } else if (deadline.slack > 0) {
    const self = deadline.blocker!.id === stopId
    base.facts.push(
      self
        ? `最晚约 ${minutesToHHMM(deadline.latestEnter)} 进场（最多再排 ${formatDuration(deadline.slack)}，${margin}）`
        : `最晚约 ${minutesToHHMM(deadline.latestLeave)} 离开这里（最多再排 ${formatDuration(deadline.slack)}，${margin}）`,
    )
    base.facts.push(`再晚：${self ? '它自己' : deadline.blocker!.name} —— ${deadline.blocker!.text}`)
  } else {
    base.facts.push(`一点都拖不起：再排下去，${deadline.blocker!.id === stopId ? '它自己' : deadline.blocker!.name} —— ${deadline.blocker!.text}`)
  }

  // 继续排：不改行程，只把代价说清楚
  const wait = deadline.capped ? 30 : Math.min(30, deadline.slack)
  if (wait >= WAIT_STEP) {
    const later = delayed(city, plan, dayIdx, stopId, wait)
    const diff = diffPlans(city, plan, later)
    if (diff) {
      // 排队的时间在比较时会被算成「空档」，这里不需要这一条
      const lines = describeDiff(diff, later, city).filter((l) => !l.text.includes('空档'))
      base.options.push({ key: `wait:${stopId}`, title: `再排 ${formatDuration(wait)}`, why: '行程不用改，后面的站点顺延', lines })
    }
  }
  const removed = previewRemove(city, plan, dayIdx, stopId)
  const cut: PlanOption[] = removed ? [{ key: `cut:${stopId}`, title: `不排了，放弃 ${name}`, lines: describeDiff(removed.diff, removed.next, city), next: removed.next }] : []
  const [alt] = findAlternatives(city, plan, dayIdx, stopId, { limit: 1 })
  const swap: PlanOption[] = alt ? [{ key: `alt:${stopId}:${alt.a.id}`, title: `换成附近的 ${alt.a.name}`, why: alt.reasons.join(' · '), lines: describeDiff(alt.diff, alt.next, city), next: alt.next }] : []
  const moves = rescheduleOptions(city, plan, dayIdx, stopId, 1)
  // 必去：改天再来排在放弃前面
  base.options.push(...(tier === 'must' ? [...moves, ...swap, ...cut] : [...cut, ...swap, ...moves]))
  return base
}

/** 一天的全部预案 */
export function contingenciesOf(city: City, plan: TripPlan, dayIdx: number): { rain: Contingency; tired: Contingency; blocked: Contingency[]; queue: Contingency[] } {
  const ids = plan.days[dayIdx] ? remainingIdsOfDay(plan, dayIdx) : []
  return {
    rain: rainPlan(city, plan, dayIdx),
    tired: tiredPlan(city, plan, dayIdx),
    blocked: ids.map((id) => blockedPlan(city, plan, dayIdx, id)),
    queue: ids.map((id) => queuePlan(city, plan, dayIdx, id)),
  }
}
