/**
 * 重算九城 2 / 3 / 4 日默认行程，和一份快照逐份对比，并检查每个景点位次「去不了」时是否仍有替代或换天方案。
 * 用法: npx tsx scripts/compare-default-plans.ts <before.json> [after.json]
 *   before.json：{ plans: [{ city, days, stops: [{ day, id, name }] }] }（data/ctrip/tuji-pois.json 就是这个格式）
 *   after.json：可选，把本次结果写出去，下次当 before 用
 */
import fs from 'node:fs'
import { BUILTIN_CITIES } from '../src/data'
import { DEFAULT_FOOD_PREFS, type Pace } from '../src/types'
import { planTrip, attractionIdsOfDay } from '../src/lib/planner'
import { blockedPlan } from '../src/lib/contingency'

const [beforeFile, afterFile] = process.argv.slice(2)
if (!beforeFile) { console.error('用法: npx tsx scripts/compare-default-plans.ts <before.json> [after.json]'); process.exit(1) }
type Snap = { plans: { city: string; days: number; stops: { day: number; id: string; name: string }[] }[] }
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')) as Snap
const after: Snap['plans'] = []
let changedPlans = 0, swaps = 0, totalVisits = 0, covered = 0
const uncovered: string[] = []
for (const c of BUILTIN_CITIES) {
  for (const days of [2, 3, 4]) {
    const plan = planTrip(c, { cityId: c.id, days, pace: 'moderate' as Pace, interests: [], startTime: '09:00', mustInclude: [], exclude: [], includeSuburb: days >= 2, transport: 'balanced', food: { ...DEFAULT_FOOD_PREFS } })
    const stops: Snap['plans'][number]['stops'] = []
    plan.days.forEach((d, di) => {
      for (const id of attractionIdsOfDay(d)) {
        stops.push({ day: d.day, id, name: c.attractions.find((a) => a.id === id)?.name ?? id })
        totalVisits++
        if (blockedPlan(c, plan, di, id).options.length) covered++
        else uncovered.push(`${c.id}/${days}d/${id}`)
      }
    })
    after.push({ city: c.id, days, stops })
    const old = before.plans.find((p) => p.city === c.id && p.days === days)
    if (!old) continue
    const oldIds = old.stops.map((s) => s.id), newIds = stops.map((s) => s.id)
    if (JSON.stringify(oldIds) === JSON.stringify(newIds)) continue
    changedPlans++
    const oldSet = new Set(oldIds), newSet = new Set(newIds)
    const added = stops.filter((s) => !oldSet.has(s.id)).map((s) => s.name)
    const removed = old.stops.filter((s) => !newSet.has(s.id)).map((s) => s.name)
    swaps += added.length + removed.length
    console.log(`${c.id.padEnd(10)} ${days}日  ${added.length || removed.length ? `换点 +[${added.join('、')}] -[${removed.join('、')}]` : '仅顺序 / 分天变化'}`)
  }
}
if (afterFile) fs.writeFileSync(afterFile, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), plans: after }, null, 1))
console.log(`\n变化的行程 ${changedPlans}/27，换进换出的位次 ${swaps}；位次总数 ${totalVisits}（快照 ${before.plans.reduce((n, p) => n + p.stops.length, 0)}）`)
console.log(`「去不了」有替代或换天方案：${covered}/${totalVisits}${uncovered.length ? '  未覆盖: ' + uncovered.join(' ') : ''}`)
