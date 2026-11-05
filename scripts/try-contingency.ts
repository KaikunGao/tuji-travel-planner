/**
 * 命令行试跑「预案」：生成一份行程，列出每天的四类预案（下雨 / 走不动了 / 某个点去不了 / 排队太久），
 * 最后给出闸门检查：每个点「去不了」时有没有砍掉以外的方案（替代或换天），每个雨天有没有改法。
 *
 * 用法: npx tsx scripts/try-contingency.ts <cityFile> [days] [pace] [startDate] [可放弃 id,逗号分隔] [必去 id,逗号分隔]
 * 例:   npx tsx scripts/try-contingency.ts src/data/cities/beijing.ts 3 moderate 2026-11-10 beihai-park forbidden-city
 * 只看闸门: TJ_BRIEF=1 npx tsx scripts/try-contingency.ts src/data/cities/beijing.ts 3
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { City, Pace } from '../src/types'
import { DEFAULT_FOOD_PREFS } from '../src/types'
import { TIER_LABEL, dayEnd } from '../src/lib/change'
import { EXPOSURE_LABEL, contingenciesOf, exposureOf, type Contingency } from '../src/lib/contingency'
import { minutesToHHMM } from '../src/lib/format'
import { attractionIdsOfDay, planTrip, tierOf } from '../src/lib/planner'

const [file, daysArg = '3', paceArg = 'moderate', startDate, droppableArg = '', mustArg = ''] = process.argv.slice(2)
if (!file) {
  console.error('用法: npx tsx scripts/try-contingency.ts src/data/cities/beijing.ts [days] [pace] [startDate] [droppable] [must]')
  process.exit(1)
}
const brief = Boolean(process.env.TJ_BRIEF)
const mod = await import(pathToFileURL(path.resolve(file)).href)
const city = Object.values(mod).find((v) => v && typeof v === 'object' && 'attractions' in (v as object)) as City

const plan = planTrip(city, {
  cityId: city.id,
  days: Number(daysArg),
  pace: paceArg as Pace,
  interests: [],
  startTime: '09:00',
  startDate: startDate || undefined,
  mustInclude: mustArg ? mustArg.split(',') : [],
  droppable: droppableArg ? droppableArg.split(',') : [],
  exclude: [],
  includeSuburb: Number(daysArg) >= 2,
  transport: 'balanced',
  food: DEFAULT_FOOD_PREFS,
})

const attraction = (id: string) => city.attractions.find((a) => a.id === id)!
const MARK = { loss: '−', gain: '+', neutral: '·', warn: '!' }
function print(c: Contingency) {
  if (brief) return
  console.log(`\n   ▸ ${c.title}（${c.when}）`)
  c.facts.forEach((f) => console.log(`     ${f}`))
  if (c.note) console.log(`     ${c.note}`)
  c.options.forEach((o, k) => {
    console.log(`     ${k + 1}. ${o.title}${o.next ? '' : '〔不改行程〕'}${o.why ? `　— ${o.why}` : ''}`)
    o.lines.forEach((l) => console.log(`          ${MARK[l.tone]} ${l.text}`))
  })
}

console.log(`\n🧭 ${city.name} ${plan.days.length} 日游 · ${paceArg}${startDate ? ` · ${startDate} 出发` : ''}`)
const gaps: string[] = []
let stops = 0
let covered = 0
let classic = 0
let classicCovered = 0
let rainDays = 0
let rainCovered = 0
const t0 = performance.now()
plan.days.forEach((d, i) => {
  const ids = attractionIdsOfDay(d)
  console.log(`\n━━ Day ${d.day}${d.date ? ` ${d.date}` : ''} · ${minutesToHHMM(d.startTime)} 出发，约 ${minutesToHHMM(dayEnd(d))} 收工`)
  console.log('   ' + ids.map((id) => `${attraction(id).name}[${TIER_LABEL[tierOf(plan.params, id)].name}·${EXPOSURE_LABEL[exposureOf(attraction(id)).value]}]`).join(' → '))
  const c = contingenciesOf(city, plan, i)
  print(c.rain)
  print(c.tired)
  c.blocked.forEach(print)
  c.queue.forEach(print)

  if (ids.some((id) => exposureOf(attraction(id)).value === 'outdoor')) {
    rainDays++
    if (c.rain.options.length) rainCovered++
    else gaps.push(`Day ${d.day} 下雨没有改法`)
  }
  c.blocked.forEach((b) => {
    const a = attraction(b.stopId!)
    const usable = b.options.filter((o) => !o.key.startsWith('cut:'))
    stops++
    if (a.mustSee) classic++
    if (usable.length) {
      covered++
      if (a.mustSee) classicCovered++
    } else gaps.push(`${a.name}${a.mustSee ? '（经典）' : ''} 去不了时只能砍掉`)
  })
})
const ms = performance.now() - t0

console.log(`\n== 闸门检查（${city.name} ${plan.days.length} 日游）`)
console.log(`某个点去不了时，有替代或换天方案：${covered}/${stops}（其中经典景点 ${classicCovered}/${classic}）`)
console.log(`有露天景点的天，下雨有改法：${rainCovered}/${rainDays}`)
console.log(gaps.length ? `缺口：${gaps.join('；')}` : '没有缺口')
console.log(`全部预案计算耗时 ${ms.toFixed(0)}ms`)
