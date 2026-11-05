/**
 * 命令行试跑「改动代价」：生成一份行程，然后逐个预览「砍掉这个点会怎样」
 * 用法: npx tsx scripts/try-change.ts <cityFile> [days] [pace] [startDate] [可放弃的景点 id，逗号分隔] [必去的景点 id，逗号分隔]
 * 例:   npx tsx scripts/try-change.ts src/data/cities/beijing.ts 3 moderate 2026-11-10 gongwangfu,beihai forbidden-city
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { City, Pace } from '../src/types'
import { DEFAULT_FOOD_PREFS } from '../src/types'
import { TIER_LABEL, cutOptions, dayEnd, describeDiff, summarizeDiff } from '../src/lib/change'
import { minutesToHHMM } from '../src/lib/format'
import { attractionIdsOfDay, planTrip, tierOf } from '../src/lib/planner'

const [file, daysArg = '3', paceArg = 'moderate', startDate, droppableArg = '', mustArg = ''] = process.argv.slice(2)
if (!file) {
  console.error('用法: npx tsx scripts/try-change.ts src/data/cities/beijing.ts [days] [pace] [startDate] [droppable] [must]')
  process.exit(1)
}
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

const name = (id: string) => city.attractions.find((a) => a.id === id)?.name ?? id
console.log(`\n🧭 ${city.name} ${plan.days.length} 日游 · ${paceArg}`)
plan.days.forEach((d, i) => {
  const ids = attractionIdsOfDay(d)
  console.log(`\n━━ Day ${d.day} · ${minutesToHHMM(d.startTime)} 出发，约 ${minutesToHHMM(dayEnd(d))} 收工`)
  console.log('   ' + ids.map((id) => `${name(id)}[${TIER_LABEL[tierOf(plan.params, id)].name}]`).join(' → '))
  const options = cutOptions(city, plan, i)
  if (!options.length) console.log('   （没有可砍的点：都是必去，或这一天是空的）')
  options.forEach((o, k) => {
    console.log(`\n   ${k + 1}. ${summarizeDiff(o.diff)}`)
    describeDiff(o.diff, o.next, city).forEach((l) => console.log(`      ${{ loss: '−', gain: '+', neutral: '·', warn: '!' }[l.tone]} ${l.text}`))
  })
})
const skipped = plan.skipped.filter((s) => tierOf(plan.params, s.id) !== 'optional')
if (skipped.length) console.log(`\n没排进去的已标记景点：${skipped.map((s) => `${name(s.id)}（${s.reason}）`).join('、')}`)
