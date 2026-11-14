/**
 * 另外四类预案的合理率：到晚了 / 下雨 / 走不动 / 排队太久。
 * 「去不了」那一类在 scripts/eval-blocked-sanity.ts，这里用同一批对象（九城 27 份默认行程）和同一套外部数据，
 * 只看每张预案卡给出的**第一个**方案。
 *
 * 外部判据（引擎没有拿来当过滤条件的数据）沿用「去不了」那份的 v2 口径：
 *   - 携程评分：替代点不低于原点 0.2 以上（两边都有携程评分才比）
 *   - 点评数：替代点 ≥ min(原点/3, 九城对齐景点中位数 3222)；未收录记中性
 *   - 攻略档位：替代点最多比原点低一档（核心 ≥30% / 次核心 15–30% / 低频 <15%；只有北京 / 成都 / 西安有）
 * 另加一条「硬约束复核」：不看引擎自己的 warning，拿新行程里每一站的到达 / 离开时刻和数据里的开放时间重新对一遍，
 *   到达时离闭园不足 20 分钟，或闭园前逛不到建议时长的六成，算冲突；原行程里就有的不算新增。
 *
 * 「更值得去」的外部口径（砍点时用）：x 比 y 更值得去 = x 是必去级而 y 不是（y 的点评数是 x 的 3 倍以上除外），
 *   或两者同级且 x 的点评数是 y 的 3 倍以上。只用数据里的必去级标记和携程点评数，不用引擎自己的打分。
 *
 * 各类的单位和「合理」定义：
 *   走不动（单位 = 行程日）：第一个方案是砍一个点。合理 = 没把这天砍空、砍的不比留下的任何一个更值得去、
 *     攻略档位是当天最低（并列算过）、腾出至少 30 分钟（少逛 + 少走路）、收工没有变晚、无新冲突。
 *   下雨（单位 = 含露天景点的行程日）：第一个方案是「换成少淋雨的」或「两天对调」。
 *     换点：每一对替换都过上面三条外部判据、这一天的露天时长确实减少、无新冲突。
 *     对调：无新冲突、换来的那天露天占比更低。没有任何方案 = 不合理。
 *   到晚了（单位 = 行程日 × 候选时刻）：每个候选时刻取它的第一个方案。
 *     合理 = 有自动方案（「基本排不下」不算）、硬约束复核通过（含收工不晚于 23:00、没有早于迟到时刻的站）、
 *     如果砍了点：没有「砍了更值得去的、留了不如它的，而且换过来也排得下」的情况
 *     （把留下的那个换成砍掉的那个重排一遍，用开放时间复核；排得下才算引擎砍错了）。
 *   排队太久（单位 = 景点位次）：这张卡的承诺是「最晚几点得走」。
 *     合理 = 约束复核通过（按引擎说的「最多再排 N 分钟」重排一遍，用开放时间核对确实不出冲突；再多排 20 分钟确实出冲突）
 *       且有不放弃的出路（还等得起 ≥10 分钟，或者有一个按「去不了」口径合理的替代 / 改天方案）。
 *
 * 阈值（30 分钟、六成、三分之一、一档）是自己定的，没有和真人判断对过；报告里逐条列出没过的判据，方便复核。
 *
 * 用法: npx tsx scripts/eval-contingency-sanity.ts [out_dir]   （默认 data/eval）
 */
import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_CITIES } from '../src/data'
import { DEFAULT_FOOD_PREFS, type Attraction, type City, type DayPlan, type Pace, type TripPlan } from '../src/types'
import { attractionIdsOfDay, isSuburb, pinnedMealsOf, planTrip, rebuildDay, setProgress, swapDays } from '../src/lib/planner'
import { EXPOSURE_LABEL, deadlineOf, exposureOf, latePlan, queuePlan, rainPlan, tiredPlan, type PlanOption } from '../src/lib/contingency'
import { dayEnd, diffPlans } from '../src/lib/change'
import { hhmmToMinutes, minutesToHHMM, parseOpenHours } from '../src/lib/format'
import { haversine } from '../src/lib/geo'

const outDir = process.argv[2] ?? 'data/eval'
fs.mkdirSync(outDir, { recursive: true })

/* ---------- 外部数据 ---------- */
const ctripRating = new Map<string, number>()
for (const line of fs.readFileSync('data/ctrip/tuji_pois_with_ctrip.tsv', 'utf8').split('\n').slice(1)) {
  const f = line.split('\t')
  if (f.length < 17) continue
  const r = parseFloat(f[16])
  if (f[10] !== 'none' && Number.isFinite(r) && r > 0) ctripRating.set(`${f[0]}/${f[1]}`, r)
}
const RATING_TOL = 0.2
const POP_RATIO = 1 / 3
const POP_MEDIAN = 3222
const MOVE_EXTRA_TRAVEL = 30
const RADIUS = { city: 6, suburb: 35 }
const LATE_END = 23 * 60

type Check = { name: string; pass: boolean | null; detail: string }
type Trigger = 'late' | 'rain' | 'tired' | 'queue'
type Row = { trigger: Trigger; city: string; days: number; day: number; unit: string; kind: string; title: string; reasonable: boolean; checks: Check[]; extra?: Record<string, number | string | boolean>; ctx?: Ctx }
/** 给人（或独立评审）看的上下文：出了什么状况、原来这天怎么排、第一个方案是什么、采用后变成什么样 */
type Ctx = { situation: string; before: string; option: string; after: string; otherDays: string }

const guideTier = (s: number | undefined): number | null => (s === undefined ? null : s >= 0.3 ? 2 : s >= 0.15 ? 1 : 0)
const tierName = ['低频', '次核心', '核心']
const ok = (checks: Check[]) => checks.every((c) => c.pass !== false)
const att = (city: City, id: string) => city.attractions.find((a) => a.id === id)!

/** 替代点的三条外部判据（「去不了」v2 口径） */
function altChecks(city: City, o: Attraction, c: Attraction): Check[] {
  const ro = ctripRating.get(`${city.id}/${o.id}`), rc = ctripRating.get(`${city.id}/${c.id}`)
  const po = o.popularity, pc = c.popularity
  const to = guideTier(o.guideShare), tc = guideTier(c.guideShare)
  return [
    { name: '携程评分', pass: ro !== undefined && rc !== undefined ? rc >= ro - RATING_TOL : null, detail: `${o.name}→${c.name} ${rc ?? '—'} vs ${ro ?? '—'}` },
    { name: '点评数', pass: po && pc ? pc >= Math.min(po * POP_RATIO, POP_MEDIAN) : null, detail: `${o.name}→${c.name} ${pc ?? '未收录'} vs ${po ?? '未收录'}` },
    { name: '攻略档位', pass: to === null ? null : (tc ?? 0) >= to - 1, detail: to === null ? '该城无攻略数据' : `${o.name}→${c.name} ${tierName[tc ?? 0]} vs ${tierName[to ?? 0]}` },
  ]
}

/** 硬约束复核：拿时间轴上的到达 / 离开时刻和数据里的开放时间重新对一遍 */
function hardViolations(city: City, day: DayPlan): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of day.stops) {
    if (s.kind !== 'attraction') continue
    const a = att(city, s.id)
    const [, close] = parseOpenHours(a.openHours)
    if (close >= 1440) continue
    if (a.lastEntry && s.start > hhmmToMinutes(a.lastEntry)) out.set(s.id, `${a.name} ${minutesToHHMM(s.start)} 到，${a.lastEntry} 已停止入场`)
    else if (s.start >= close - 20) out.set(s.id, `${a.name} ${minutesToHHMM(s.start)} 到，${a.openHours} 已近闭园`)
    else if (s.end > close && close - s.start < a.duration * 0.6) out.set(s.id, `${a.name} ${minutesToHHMM(s.start)} 到，闭园前只剩 ${close - s.start} 分钟（建议 ${a.duration}）`)
  }
  return out
}
/** 新行程里比原行程多出来的冲突（整份行程所有天） */
function newHard(city: City, base: TripPlan, next: TripPlan): string[] {
  const out: string[] = []
  const before = new Set(base.days.flatMap((d) => [...hardViolations(city, d).keys()]))
  for (const d of next.days) for (const [id, text] of hardViolations(city, d)) if (!before.has(id)) out.push(text)
  return out
}
function conflictCheck(city: City, base: TripPlan, next: TripPlan | undefined): Check {
  if (!next) return { name: '无新冲突', pass: false, detail: '没有可采用的行程' }
  const diff = diffPlans(city, base, next)
  const engine = diff ? diff.days.flatMap((d) => d.newWarnings.map((w) => `${w.name}：${w.text}`)) : []
  const hard = newHard(city, base, next)
  return { name: '无新冲突', pass: engine.length === 0 && hard.length === 0, detail: [...engine, ...hard.map((h) => `复核：${h}`)].join('；') || '无' }
}

/** x 比 y 更值得去（外部口径：必去级标记 + 携程点评数 3 倍差） */
const worthier = (x: Attraction, y: Attraction) => {
  const big = (a: Attraction, b: Attraction) => !!a.popularity && !!b.popularity && a.popularity >= 3 * b.popularity
  return (x.mustSee && !y.mustSee && !big(y, x)) || (x.mustSee === y.mustSee && big(x, y))
}
const TIRED_MIN_FREED = 30

function defaultPlan(c: City, days: number): TripPlan {
  return planTrip(c, { cityId: c.id, days, pace: 'moderate' as Pace, interests: [], startTime: '09:00', mustInclude: [], exclude: [], includeSuburb: days >= 2, transport: 'balanced', food: { ...DEFAULT_FOOD_PREFS } })
}
const outdoorMinutes = (city: City, day: DayPlan) => attractionIdsOfDay(day).map((id) => att(city, id)).filter((a) => exposureOf(a).value === 'outdoor').reduce((s, a) => s + a.duration, 0)
const visitMinutes = (city: City, day: DayPlan) => attractionIdsOfDay(day).map((id) => att(city, id)).reduce((s, a) => s + a.duration, 0)

/** 「去不了」口径下，一个替代 / 改天方案算不算合理（排队卡里的非放弃出路用） */
function altOrMoveOk(city: City, plan: TripPlan, o: Attraction, opt: PlanOption): boolean {
  const kind = opt.key.split(':')[0]
  if (!opt.next) return false
  const conflict = conflictCheck(city, plan, opt.next)
  if (kind === 'alt') {
    const c = att(city, opt.key.split(':')[2])
    const km = haversine(o, c), radius = isSuburb(o, city) ? RADIUS.suburb : RADIUS.city
    const curated = (o.alternatives ?? []).includes(c.id)
    return ok([...altChecks(city, o, c), conflict, { name: '半径内', pass: curated ? null : km <= radius, detail: '' }])
  }
  if (kind === 'move') {
    const j = Number(opt.key.split(':')[2])
    const d = diffPlans(city, plan, opt.next)?.days.find((x) => x.day === plan.days[j].day)
    return conflict.pass === true && (d ? d.travelDelta <= MOVE_EXTRA_TRAVEL : true)
  }
  if (kind === 'swap') return conflict.pass === true
  return false
}

const describeDay = (city: City, d: DayPlan) =>
  d.stops
    .map((s) => {
      if (s.kind === 'meal') return `${minutesToHHMM(s.start)}–${minutesToHHMM(s.end)} 用餐`
      const a = att(city, s.id)
      return `${minutesToHHMM(s.start)}–${minutesToHHMM(s.end)} ${a.name}（${a.mustSee ? '必去级' : '非必去级'}，携程点评 ${a.popularity ?? '未收录'} 条，${EXPOSURE_LABEL[exposureOf(a).value]}，开放 ${a.openHours}，建议游玩 ${a.duration} 分钟${isSuburb(a, city) ? '，远郊' : ''}）`
    })
    .join('\n') + `\n收工（回到出发点）约 ${minutesToHHMM(dayEnd(d))}`
function ctxOf(city: City, plan: TripPlan, di: number, situation: string, opt: PlanOption | undefined, note?: string): Ctx {
  const changed = opt?.next ? opt.next.days.filter((nd, k) => JSON.stringify(nd.stops.map((x) => [x.id, x.start])) !== JSON.stringify(plan.days[k].stops.map((x) => [x.id, x.start]))) : []
  return {
    situation,
    before: `Day ${plan.days[di].day}（共 ${plan.days.length} 天）原来的安排：\n${describeDay(city, plan.days[di])}`,
    option: opt ? `${opt.title}${opt.why ? `\n说明：${opt.why}` : ''}${opt.lines.length ? `\n代价：${opt.lines.map((l) => l.text).join('；')}` : ''}` : `没有给出方案。${note ?? ''}`,
    after: opt?.next ? changed.map((nd) => `Day ${nd.day} 变成：\n${describeDay(city, nd)}`).join('\n\n') || '行程不变' : '行程不变',
    otherDays: plan.days.filter((_, k) => k !== di).map((od) => `Day ${od.day}：${attractionIdsOfDay(od).map((id) => att(city, id).name).join('、') || '（空）'}`).join('\n'),
  }
}

const rows: Row[] = []
const exposureInferred: string[] = []

for (const c of BUILTIN_CITIES) {
  for (const a of c.attractions) if (exposureOf(a).inferred) exposureInferred.push(`${c.name}·${a.name}`)
  for (const days of [2, 3, 4]) {
    const plan = defaultPlan(c, days)
    plan.days.forEach((d, di) => {
      const ids = attractionIdsOfDay(d)
      if (!ids.length) return
      const baseRow = { city: c.id, days, day: d.day }

      /* ---------- 走不动 ---------- */
      {
        const r = tiredPlan(c, plan, di)
        const top = r.options[0]
        if (!top || !top.next) rows.push({ ...baseRow, trigger: 'tired', unit: `D${d.day}`, kind: 'none', title: r.note ?? '—', reasonable: false, checks: [{ name: '有方案', pass: false, detail: r.note ?? '没有任何方案' }] })
        else {
          const cutId = top.key.split(':')[1]
          const x = att(c, cutId)
          const diff = diffPlans(c, plan, top.next)?.days.find((y) => y.dayIdx === di)
          const freed = diff ? -(diff.visitDelta + diff.travelDelta) : 0
          const endDelta = diff ? diff.endTo - diff.endFrom : 0
          const tiers = ids.map((id) => guideTier(att(c, id).guideShare))
          const tx = guideTier(x.guideShare)
          const kept = ids.filter((id) => id !== cutId).map((id) => att(c, id))
          const others = kept.map((a) => guideTier(a.guideShare)).filter((t): t is number => t !== null)
          const worse = kept.filter((y) => worthier(x, y))
          const checks: Check[] = [
            { name: '没把这天砍空', pass: ids.length > 1, detail: ids.length > 1 ? `当天 ${ids.length} 站` : '当天只有这一站' },
            { name: '砍的不比留下的更值得去', pass: worse.length === 0, detail: worse.length ? `砍了 ${x.name}（${x.mustSee ? '必去级' : '非必去级'}，点评 ${x.popularity ?? '未收录'}），留下了 ${worse.map((y) => `${y.name}（${y.mustSee ? '必去级' : '非必去级'}，${y.popularity ?? '未收录'}）`).join('、')}` : '无' },
            { name: '攻略档位是当天最低', pass: tx === null || !others.length ? null : tx <= Math.min(...others), detail: tx === null ? '该城无攻略数据' : `${x.name} ${tierName[tx]}；当天 ${tiers.map((t) => tierName[t ?? 0]).join('/')}` },
            { name: `腾出至少 ${TIRED_MIN_FREED} 分钟`, pass: freed >= TIRED_MIN_FREED, detail: `少逛 + 少走路共 ${freed} 分钟` },
            { name: '收工没有变晚', pass: endDelta <= 0, detail: endDelta > 0 ? `晚 ${endDelta} 分钟` : endDelta < 0 ? `早 ${-endDelta} 分钟` : '不变' },
            conflictCheck(c, plan, top.next),
          ]
          rows.push({ ...baseRow, trigger: 'tired', unit: `D${d.day}`, kind: ids.length > 1 ? 'cut' : 'single', title: top.title, reasonable: ok(checks), checks, extra: { freed, endDelta, stops: ids.length }, ctx: ctxOf(c, plan, di, '出门前同行的人说今天累了，想少逛一点、早点回去（这一天还没开始走）。', top) })
        }
      }

      /* ---------- 下雨 ---------- */
      const outdoorIds = ids.filter((id) => exposureOf(att(c, id)).value === 'outdoor')
      if (outdoorIds.length) {
        const r = rainPlan(c, plan, di)
        const top = r.options[0]
        const before = outdoorMinutes(c, d), total = visitMinutes(c, d)
        if (!top || !top.next) rows.push({ ...baseRow, trigger: 'rain', unit: `D${d.day}`, kind: 'none', title: r.note ?? '—', reasonable: false, checks: [{ name: '有雨天改法', pass: false, detail: '只能带伞照常去或砍点' }], extra: { outdoorBefore: before, outdoorAfter: before, total, totalAfter: total }, ctx: ctxOf(c, plan, di, '这一天出门前看到下雨，要下一整天。', undefined, r.note) })
        else {
          const nd = top.next.days[di]
          const after = outdoorMinutes(c, nd), totalAfter = visitMinutes(c, nd)
          const checks: Check[] = []
          let kind = 'swap'
          if (top.key === 'rain:indoor') {
            kind = 'indoor'
            const nextIds = attractionIdsOfDay(nd)
            // 标题里是「A → B」的替换对；砍掉的只会是用户标了可放弃的，默认行程里没有
            const pairs = [...top.title.matchAll(/([^：，；]+) → ([^，；]+)/g)].map((m) => ({ o: c.attractions.find((a) => a.name === m[1].trim()), n: c.attractions.find((a) => a.name === m[2].trim()) }))
            const removed = ids.filter((id) => !nextIds.includes(id)), added = nextIds.filter((id) => !ids.includes(id))
            const parsedOk = pairs.every((p) => p.o && p.n) && pairs.length === added.length
            checks.push({ name: '替换对解析', pass: parsedOk ? null : false, detail: parsedOk ? `${pairs.length} 对` : `标题解析出 ${pairs.length} 对，实际换进 ${added.length} 个、换出 ${removed.length} 个` })
            const per = pairs.filter((p) => p.o && p.n).flatMap((p) => altChecks(c, p.o!, p.n!))
            for (const name of ['携程评分', '点评数', '攻略档位']) {
              const cs = per.filter((x) => x.name === name)
              const fail = cs.filter((x) => x.pass === false)
              checks.push({ name, pass: fail.length ? false : cs.some((x) => x.pass === true) ? true : null, detail: (fail.length ? fail : cs).map((x) => x.detail).join('；') })
            }
            checks.push({ name: '露天时长减少', pass: after < before, detail: `${before} → ${after} 分钟` })
            const stillOutdoor = attractionIdsOfDay(nd).filter((id) => exposureOf(att(c, id)).value === 'outdoor').map((id) => att(c, id).name)
            checks.push({ name: '（参考）改完仍露天的点', pass: null, detail: stillOutdoor.join('、') || '无' })
          } else {
            checks.push({ name: '换来的这天露天占比更低', pass: totalAfter > 0 && after / totalAfter < before / total, detail: `${Math.round((before / total) * 100)}% → ${totalAfter ? Math.round((after / totalAfter) * 100) : 0}%` })
          }
          checks.push(conflictCheck(c, plan, top.next))
          rows.push({ ...baseRow, trigger: 'rain', unit: `D${d.day}`, kind, title: top.title, reasonable: ok(checks), checks, extra: { outdoorBefore: before, outdoorAfter: after, total, totalAfter, options: r.options.length }, ctx: ctxOf(c, plan, di, '这一天出门前看到下雨，要下一整天。', top) })
        }
      }

      /* ---------- 到晚了 ---------- */
      {
        const r = latePlan(c, plan, di)
        const from = hhmmToMinutes(plan.params.startTime)
        if (!r.options.length) rows.push({ ...baseRow, trigger: 'late', unit: `D${d.day}`, kind: 'none', title: r.note ?? '—', reasonable: false, checks: [{ name: '有方案', pass: false, detail: r.note ?? '没有任何方案' }] })
        const seen = new Set<number>()
        for (const opt of r.options) {
          const parts = opt.key.split(':')
          const t = Number(parts[1])
          if (seen.has(t)) continue
          seen.add(t)
          const unit = `D${d.day} ${minutesToHHMM(t)}`
          if (parts[2] === 'manual' || !opt.next) {
            rows.push({ ...baseRow, trigger: 'late', unit, kind: 'manual', title: opt.title, reasonable: false, checks: [{ name: '有自动方案', pass: false, detail: opt.why ?? '' }], extra: { late: t - from, stops: ids.length }, ctx: ctxOf(c, plan, di, `原计划 ${minutesToHHMM(from)} 出发，因为航班 / 火车晚点或起晚了，${minutesToHHMM(t)} 才能开始这一天。`, opt) })
            continue
          }
          const nd = opt.next.days[di]
          const nextIds = attractionIdsOfDay(nd)
          // 砍点是在哪份行程上砍的：一般是「从 t 接着排」的原行程；先和别的天对调再砍的，是对调后的行程
          const shifted = setProgress(c, plan, di, 0, t)
          const swapWith = parts[2] === 'swapcut' ? Number(parts[3]) : -1
          const ground = swapWith >= 0 ? swapDays(c, shifted, di, swapWith) : shifted
          const groundIds = attractionIdsOfDay(ground.days[di])
          const cutIds = ['cut', 'cuts', 'swapcut'].includes(parts[2]) ? groundIds.filter((id) => !nextIds.includes(id)) : []
          const kind = parts[2] === 'cut' || parts[2] === 'cuts' ? (cutIds.length > 1 ? 'cuts' : 'cut') : parts[2] === 'swapcut' ? (cutIds.length ? 'swapcut' : 'swapday') : (parts[2] ?? 'keep')
          const firstStart = nd.stops.find((s) => s.kind === 'attraction')?.start
          const checks: Check[] = [
            conflictCheck(c, plan, opt.next),
            { name: '收工不晚于 23:00', pass: dayEnd(nd) <= LATE_END, detail: minutesToHHMM(dayEnd(nd)) },
            { name: '没有早于迟到时刻的站', pass: firstStart === undefined ? false : firstStart >= t, detail: firstStart === undefined ? '当天没有站了' : `第一站 ${minutesToHHMM(firstStart)}` },
          ]
          if (cutIds.length) {
            // 把留下的 y 换成砍掉的 x 重排一遍：如果 x 比 y 更值得去、换过来又排得下，说明引擎砍错了
            const wrong: string[] = []
            for (const xid of cutIds) for (const yid of nextIds) {
              const x = att(c, xid), y = att(c, yid)
              if (!worthier(x, y)) continue
              const rest = groundIds.filter((id) => (nextIds.includes(id) && id !== yid) || id === xid)
              const fitsSwap = [false, true].some((optimize) => {
                const built = rebuildDay(c, ground, di, rest, optimize, pinnedMealsOf(ground.days[di]))
                return newHard(c, plan, built).length === 0 && dayEnd(built.days[di]) <= LATE_END
              })
              if (fitsSwap) wrong.push(`砍了 ${x.name}、留了 ${y.name}，换过来也排得下`)
            }
            checks.push({ name: '没砍错（更值得去的还排得下）', pass: wrong.length === 0, detail: wrong.join('；') || '无' })
          }
          const lost = cutIds.reduce((s, id) => s + att(c, id).duration, 0)
          rows.push({ ...baseRow, trigger: 'late', unit, kind, title: opt.title, reasonable: ok(checks), checks, extra: { late: t - from, lost, stops: ids.length, cut: cutIds.length }, ctx: ctxOf(c, plan, di, `原计划 ${minutesToHHMM(from)} 出发，因为航班 / 火车晚点或起晚了，${minutesToHHMM(t)} 才能开始这一天。`, opt) })
        }
      }

      /* ---------- 排队太久 ---------- */
      for (const id of ids) {
        const o = att(c, id)
        const r = queuePlan(c, plan, di, id)
        const dl = deadlineOf(c, plan, di, id)
        const top = r.options[0]
        if (!dl || !top) { rows.push({ ...baseRow, trigger: 'queue', unit: `D${d.day} ${o.name}`, kind: 'none', title: r.note ?? '—', reasonable: false, checks: [{ name: '有方案', pass: false, detail: r.note ?? '没有任何方案' }] }); continue }
        const delayed = (m: number) => rebuildDay(c, plan, di, ids, false, pinnedMealsOf(d), d.isSuburb, { [id]: m })
        const atSlack = dl.slack > 0 ? newHard(c, plan, delayed(dl.slack)) : []
        const beyond = dl.capped ? null : newHard(c, plan, delayed(dl.slack + 20))
        const exit = r.options.filter((x) => ['alt', 'move', 'swap'].includes(x.key.split(':')[0])).find((x) => altOrMoveOk(c, plan, o, x))
        const canWait = dl.slack >= 10
        const checks: Check[] = [
          { name: '最多再排 N 分钟：复核不出冲突', pass: atSlack.length === 0, detail: dl.slack > 0 ? `再排 ${dl.slack} 分钟：${atSlack.join('；') || '无冲突'}` : '一点都拖不起' },
          { name: '再多排 20 分钟确实出冲突', pass: beyond === null ? null : beyond.length > 0, detail: beyond === null ? `后面很宽松（多排 180 分钟也不出冲突）` : beyond.join('；') || `再排 ${dl.slack + 20} 分钟复核仍无冲突` },
          { name: '有不放弃的出路', pass: canWait || !!exit, detail: canWait ? `还等得起 ${dl.slack} 分钟` : exit ? exit.title : '等不起，也没有合理的替代或改天' },
        ]
        rows.push({ ...baseRow, trigger: 'queue', unit: `D${d.day} ${o.name}`, kind: top.key.split(':')[0], title: top.title, reasonable: ok(checks), checks, extra: { slack: dl.slack, capped: dl.capped, canWait, hasExit: !!exit }, ctx: { ...ctxOf(c, plan, di, `按计划时间到了「${o.name}」，发现要排很久的队。产品在卡片上给的提示：${r.facts.join('；')}`, top), option: r.options.map((x, k) => `方案 ${k + 1}：${x.title}${x.why ? `（${x.why}）` : ''}`).join('\n') } })
      }
    })
  }
}

/* ---------- 汇总 ---------- */
const TR: { key: Trigger; label: string; unit: string }[] = [
  { key: 'late', label: '到晚了 / 起晚了', unit: '行程日 × 候选时刻' },
  { key: 'rain', label: '下雨', unit: '含露天景点的行程日' },
  { key: 'tired', label: '走不动了', unit: '行程日' },
  { key: 'queue', label: '排队太久', unit: '景点位次' },
]
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')
const cityName = (id: string) => BUILTIN_CITIES.find((c) => c.id === id)!.name
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const kindLabel: Record<string, string> = { keep: '全保留', reorder: '调顺序后全保留', cut: '砍一个点', cuts: '连砍几个点', move: '把赶不上的点换天', swapcut: '和别的天对调后再砍', swapday: '和别的天整天对调', single: '单站日（砍掉 = 这天不去了）', manual: '基本排不下（无自动方案）', none: '无方案', indoor: '换成少淋雨的', swap: '两天对调', wait: '再排一会儿', alt: '换附近的', }

const md: string[] = []
md.push(`# 另外四类预案的合理率（默认行程，${new Date().toLocaleDateString('sv-SE')}）\n`)
md.push(`判法见 \`scripts/eval-contingency-sanity.ts\` 文件头。对象：九城 27 份默认行程（2 / 3 / 4 日，适中节奏，9:00 出发）。每张预案卡只看**第一个**方案。「去不了」那一类见 \`blocked-sanity.md\`。\n`)
md.push(`## 结果\n`)
md.push(`| 预案 | 单位 | 数量 | 第一个方案合理 | 合理率 |\n|---|---|---|---|---|`)
for (const t of TR) { const s = rows.filter((r) => r.trigger === t.key); md.push(`| ${t.label} | ${t.unit} | ${s.length} | ${s.filter((r) => r.reasonable).length} | ${pct(s.filter((r) => r.reasonable).length, s.length)} |`) }
md.push('')
for (const t of TR) {
  const s = rows.filter((r) => r.trigger === t.key)
  const kinds = [...new Set(s.map((r) => r.kind))]
  const fail = new Map<string, number>()
  for (const r of s) for (const c of r.checks) if (c.pass === false) fail.set(c.name, (fail.get(c.name) ?? 0) + 1)
  md.push(`### ${t.label}\n`)
  md.push(`- 按方案类型：` + kinds.map((k) => { const x = s.filter((r) => r.kind === k); return `${kindLabel[k] ?? k} ${x.filter((r) => r.reasonable).length}/${x.length}` }).join('，') + '。')
  md.push(`- 没过的判据（一个单位可能多条）：` + ([...fail.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，') || '无') + '。')
  if (t.key === 'rain') {
    const w = s.filter((r) => r.extra && r.kind !== 'none')
    const shareB = w.map((r) => Number(r.extra!.outdoorBefore) / Number(r.extra!.total)), shareA = w.map((r) => (Number(r.extra!.totalAfter) ? Number(r.extra!.outdoorAfter) / Number(r.extra!.totalAfter) : 0))
    md.push(`- 有方案的 ${w.length} 天里，采用第一个方案后当天露天时长占比的中位数从 ${Math.round(median(shareB) * 100)}% 降到 ${Math.round(median(shareA) * 100)}%；改完露天仍占一半以上的 ${shareA.filter((x) => x >= 0.5).length} 天；降到零的 ${shareA.filter((x) => x === 0).length} 天。`)
    md.push(`- 淋雨程度标签：198 个景点里按分类推断（数据没标）的 ${exposureInferred.length} 个${exposureInferred.length ? '：' + exposureInferred.join('、') : ''}。标签本身没有拿外部数据核对过。`)
  }
  if (t.key === 'late') {
    for (const off of [60, 120, 210, 360]) {
      const x = s.filter((r) => r.extra && Number(r.extra.late) === off)
      if (x.length) md.push(`- 晚 ${off} 分钟（${minutesToHHMM(9 * 60 + off)} 才开始）：${x.filter((r) => r.reasonable).length}/${x.length} 合理；` + [...new Set(x.map((r) => r.kind))].map((k) => `${kindLabel[k] ?? k} ${x.filter((r) => r.kind === k).length}`).join('，') + '。')
    }
    const cutRows = s.filter((r) => r.kind === 'cut' || r.kind === 'cuts' || r.kind === 'swapcut')
    md.push(`- 砍点的 ${cutRows.length} 个方案里，砍掉的游览时长中位数 ${median(cutRows.map((r) => Number(r.extra!.lost)))} 分钟；砍掉的时长超过迟到时长 60 分钟以上的 ${cutRows.filter((r) => Number(r.extra!.lost) > Number(r.extra!.late) + 60).length} 个（参考，不计入合理率）。`)
  }
  if (t.key === 'tired') {
    const multi = s.filter((r) => r.kind === 'cut')
    md.push(`- 当天只有一站的行程日 ${s.filter((r) => r.kind === 'single').length} 个（都是远郊日，砍掉等于这天不去了，算不合理）；不止一站的 ${multi.length} 个里合理 ${multi.filter((r) => r.reasonable).length} 个（${pct(multi.filter((r) => r.reasonable).length, multi.length)}）。`)
    md.push(`- 不止一站的行程日里：腾出时间的中位数 ${median(multi.map((r) => Number(r.extra!.freed)))} 分钟；收工真的提早的 ${multi.filter((r) => Number(r.extra!.endDelta) < 0).length} 个，收工时间不变、只是中间多出空档的 ${multi.filter((r) => Number(r.extra!.endDelta) === 0).length} 个（晚饭和夜景的时间是钉住的），变晚的 ${multi.filter((r) => Number(r.extra!.endDelta) > 0).length} 个。`)
  }
  if (t.key === 'queue') {
    const x = s.filter((r) => r.extra)
    md.push(`- ${x.length} 个位次里：后面很宽松（多排 3 小时也不出冲突）${x.filter((r) => r.extra!.capped).length} 个，有明确的最晚时刻 ${x.filter((r) => !r.extra!.capped && Number(r.extra!.slack) > 0).length} 个，一点都拖不起 ${x.filter((r) => !r.extra!.capped && Number(r.extra!.slack) === 0).length} 个；等不起（<10 分钟）的 ${x.filter((r) => !r.extra!.canWait).length} 个里有合理替代或改天的 ${x.filter((r) => !r.extra!.canWait && r.extra!.hasExit).length} 个。`)
  }
  md.push('')
  md.push(`| 城市 | 单位数 | 合理 | 合理率 |\n|---|---|---|---|`)
  for (const c of BUILTIN_CITIES) { const x = s.filter((r) => r.city === c.id); md.push(`| ${c.name} | ${x.length} | ${x.filter((r) => r.reasonable).length} | ${pct(x.filter((r) => r.reasonable).length, x.length)} |`) }
  md.push('')
  const bad = s.filter((r) => !r.reasonable)
  md.push(`不合理的 ${bad.length} 个：\n`)
  if (bad.length) {
    md.push(`| 城市 | 行程 | 单位 | 第一个方案 | 没过的判据 |\n|---|---|---|---|---|`)
    for (const r of bad) md.push(`| ${cityName(r.city)} | ${r.days} 日 | ${r.unit} | ${r.title.replace(/\|/g, '/')} | ${r.checks.filter((c) => c.pass === false).map((c) => `${c.name}（${c.detail}）`).join('；').replace(/\|/g, '/')} |`)
  }
  md.push('')
}
fs.writeFileSync(path.join(outDir, 'contingency-sanity.md'), md.join('\n') + '\n')

const tsv = ['trigger\tcity\tdays\tday\tunit\tkind\ttop_option\treasonable\tfailed\tchecks\textra']
for (const r of rows) tsv.push([r.trigger, r.city, r.days, r.day, r.unit, r.kind, r.title, r.reasonable ? 1 : 0, r.checks.filter((c) => c.pass === false).map((c) => c.name).join(','), r.checks.map((c) => `${c.name}:${c.pass === null ? 'na' : c.pass ? 'ok' : 'FAIL'}(${c.detail})`).join(' | '), JSON.stringify(r.extra ?? {})].join('\t'))
fs.writeFileSync(path.join(outDir, 'contingency-sanity.tsv'), tsv.join('\n') + '\n')
// 抽样给独立评审看（--sample）：每类 15 个，合理 / 不合理各取一半左右，等距取，不挑
if (process.argv.includes('--sample')) {
  const sample: Record<string, unknown>[] = []
  for (const t of TR) {
    const s = rows.filter((r) => r.trigger === t.key && r.ctx)
    const pick = (xs: Row[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]))
    const bad = pick(s.filter((r) => !r.reasonable), 7)
    const good = pick(s.filter((r) => r.reasonable), 15 - bad.length)
    for (const r of [...bad, ...good]) sample.push({ id: `${r.trigger}-${r.city}-${r.days}d-${r.unit.replace(/\s+/g, '_')}`, trigger: t.label, city: cityName(r.city), tripDays: r.days, ...r.ctx, ruleVerdict: r.reasonable, ruleFailed: r.checks.filter((c) => c.pass === false).map((c) => `${c.name}（${c.detail}）`) })
  }
  fs.writeFileSync(path.join(outDir, 'contingency-sample.json'), JSON.stringify(sample, null, 1))
  console.log(`抽样 ${sample.length} 个写到 ${outDir}/contingency-sample.json`)
}
console.log(md.join('\n').split('\n不合理的')[0])
console.log(`\n写出 ${outDir}/contingency-sanity.md 与 .tsv（${rows.length} 行）`)
