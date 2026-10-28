/**
 * 命令行试跑规划算法，方便调试
 * 用法: npx tsx scripts/try-plan.ts <cityFile> [days] [pace] [interests,逗号分隔] [startDate]
 * 例:   npx tsx scripts/try-plan.ts src/data/cities/beijing.ts 3 moderate 历史文化,美食探店 2026-11-02
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { City, Interest, Pace, PlanVariant, TransportPref } from '../src/types'
import { DEFAULT_FOOD_PREFS } from '../src/types'
import { debug, planTrip, planTotals } from '../src/lib/planner'
import { minutesToHHMM, MEAL_LABEL, TRANSPORT_LABEL } from '../src/lib/format'

const [file, daysArg = '3', paceArg = 'moderate', interestsArg = '', startDate] = process.argv.slice(2)
if (!file) {
  console.error('用法: npx tsx scripts/try-plan.ts src/data/cities/beijing.ts [days] [pace] [interests] [startDate]')
  process.exit(1)
}
const mod = await import(pathToFileURL(path.resolve(file)).href)
const city = Object.values(mod).find((v) => v && typeof v === 'object' && 'attractions' in (v as object)) as City

if (process.env.TJ_DEBUG) debug.log = (...a) => console.log('[debug]', ...a)
const t0 = performance.now()
const plan = planTrip(city, {
  cityId: city.id,
  days: Number(daysArg),
  pace: paceArg as Pace,
  interests: interestsArg ? (interestsArg.split(',') as Interest[]) : [],
  startTime: '09:00',
  startDate: startDate || undefined,
  mustInclude: [],
  exclude: [],
  includeSuburb: Number(daysArg) >= 2,
  transport: (process.env.TJ_TRANSPORT as TransportPref) || 'balanced',
  food: {
    ...DEFAULT_FOOD_PREFS,
    noSpicy: process.env.TJ_NOSPICY === '1',
    vegetarian: process.env.TJ_VEG === '1',
    halal: process.env.TJ_HALAL === '1',
    maxPrice: Number(process.env.TJ_MAXPRICE || 0),
    avoid: process.env.TJ_AVOID ? process.env.TJ_AVOID.split(',') : [],
  },
}, { variant: (process.env.TJ_VARIANT as PlanVariant) || 'balanced' })
const ms = performance.now() - t0

console.log(`\n🧭 ${city.name} ${plan.days.length} 日游 · ${paceArg} · 兴趣[${interestsArg}] · 方案 ${plan.variant} · 出行 ${plan.params.transport} · 耗时 ${ms.toFixed(0)}ms`)
for (const d of plan.days) {
  console.log(`\n━━ Day ${d.day}${d.date ? ' ' + d.date : ''} · ${d.title} · ${d.theme} · ${minutesToHHMM(d.startTime)}-${minutesToHHMM(d.endTime)} · ${d.distanceKm}km (步行 ${d.walkKm}km) · ¥${d.cost.tickets + d.cost.food + d.cost.transport}`)
  for (const s of d.stops) {
    const leg = s.leg ? `  ${TRANSPORT_LABEL[s.leg.mode].emoji} ${s.leg.distanceKm}km ${s.leg.minutes}min` : ''
    if (leg) console.log(leg)
    if (s.kind === 'attraction') {
      const a = city.attractions.find((x) => x.id === s.id)!
      console.log(`  ${minutesToHHMM(s.start)}-${minutesToHHMM(s.end)} 📍 ${a.name} [${a.bestTime}${a.mustSee ? ' 必去' : ''}]${s.note ? ' ℹ️ ' + s.note : ''}${s.warning ? ' ⚠️ ' + s.warning : ''}`)
    } else {
      const r = city.restaurants.find((x) => x.id === s.id)!
      console.log(`  ${minutesToHHMM(s.start)}-${minutesToHHMM(s.end)} 🍴 ${MEAL_LABEL[s.mealType ?? 'lunch']} · ${r.name} (¥${r.avgPrice})`)
    }
  }
}
const totals = planTotals(plan)
console.log(`\n合计：${totals.attractions} 景点 · ${totals.meals} 餐 · ${totals.distanceKm}km · 人均 ¥${totals.tickets + totals.food + totals.transport}`)
console.log(`跳过 ${plan.skipped.length}：${plan.skipped.map((s) => `${city.attractions.find((a) => a.id === s.id)?.name}(${s.reason})`).join('、')}`)
plan.suggestions.forEach((s) => console.log('建议：' + s))
