import type { City, TripPlan } from '../types'
import { INTEREST_EMOJI, MEAL_LABEL, PACE_LABEL, TRANSPORT_LABEL, formatDateCN, formatKm, formatMoney, minutesToHHMM } from './format'
import { planTotals } from './planner'

/** 把行程导出为 Markdown 文本 */
export function planToMarkdown(city: City, plan: TripPlan, people = 1): string {
  const lines: string[] = []
  const totals = planTotals(plan)
  const p = plan.params
  lines.push(`# ${city.name} ${plan.days.length} 日游 · 途迹规划`)
  lines.push('')
  lines.push(
    `> ${PACE_LABEL[p.pace].emoji} ${PACE_LABEL[p.pace].name}节奏 · 每天 ${p.startTime} 出发` +
      (p.interests.length ? ` · 兴趣：${p.interests.join('、')}` : '') +
      (p.startPoint ? ` · 出发点：${p.startPoint.name}` : ''),
  )
  lines.push(`> ${totals.attractions} 个景点 · ${totals.meals} 顿美食 · 总路程约 ${formatKm(totals.distanceKm)}（步行 ${formatKm(totals.walkKm)}）`)
  lines.push('')

  for (const day of plan.days) {
    lines.push(`## Day ${day.day}${day.date ? ` · ${formatDateCN(day.date)}` : ''} · ${day.title}`)
    lines.push(`_${day.theme} · ${minutesToHHMM(day.startTime)} - ${minutesToHHMM(day.endTime)} · ${formatKm(day.distanceKm)}_`)
    lines.push('')
    if (day.breakfastId) {
      const r = city.restaurants.find((x) => x.id === day.breakfastId)
      if (r) lines.push(`- ☕ 早餐推荐：**${r.name}**（${r.cuisine}，人均 ${formatMoney(r.avgPrice)}）`)
    }
    for (const s of day.stops) {
      if (s.leg && s.leg.distanceKm > 0.05) {
        lines.push(`- ${TRANSPORT_LABEL[s.leg.mode].emoji} ${TRANSPORT_LABEL[s.leg.mode].name} ${formatKm(s.leg.distanceKm)} · 约 ${s.leg.minutes} 分钟`)
      }
      if (s.kind === 'attraction') {
        const a = city.attractions.find((x) => x.id === s.id)
        if (!a) continue
        lines.push(
          `- **${minutesToHHMM(s.start)}-${minutesToHHMM(s.end)}** ${INTEREST_EMOJI[a.category]} **${a.name}**` +
            (a.price ? `（门票 ${formatMoney(a.price)}）` : '（免费）') +
            (a.needBooking ? ' 🔖需预约' : ''),
        )
        if (a.tips[0]) lines.push(`  - 💡 ${a.tips[0]}`)
        if (s.note) lines.push(`  - ℹ️ ${s.note}`)
        if (s.warning) lines.push(`  - ⚠️ ${s.warning}`)
      } else {
        const r = city.restaurants.find((x) => x.id === s.id)
        if (!r) continue
        lines.push(
          `- **${minutesToHHMM(s.start)}-${minutesToHHMM(s.end)}** 🍴 ${MEAL_LABEL[s.mealType ?? 'lunch']} · **${r.name}**（${r.cuisine}，人均 ${formatMoney(r.avgPrice)}）`,
        )
        lines.push(`  - 必点：${r.mustOrder.slice(0, 4).join('、')}`)
        if (r.waitTime) lines.push(`  - ⏳ ${r.waitTime}`)
      }
    }
    if (day.returnLeg) {
      lines.push(`- 🏠 返回出发点：${TRANSPORT_LABEL[day.returnLeg.mode].name} ${formatKm(day.returnLeg.distanceKm)} · 约 ${day.returnLeg.minutes} 分钟`)
    }
    lines.push('')
  }

  lines.push('## 预算（每人）')
  lines.push('')
  lines.push('| 项目 | 金额 |')
  lines.push('| --- | --- |')
  lines.push(`| 门票 | ${formatMoney(totals.tickets)} |`)
  lines.push(`| 餐饮 | ${formatMoney(totals.food)} |`)
  lines.push(`| 市内交通 | ${formatMoney(totals.transport)} |`)
  lines.push(`| **合计** | **${formatMoney(totals.tickets + totals.food + totals.transport)}** |`)
  if (people > 1) lines.push(`\n${people} 人合计约 ${formatMoney((totals.tickets + totals.food + totals.transport) * people)}`)
  lines.push('')

  if (plan.suggestions.length) {
    lines.push('## 建议')
    lines.push('')
    plan.suggestions.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  if (city.tips.length) {
    lines.push('## 出行贴士')
    lines.push('')
    city.tips.forEach((t) => lines.push(`- ${t}`))
    lines.push('')
  }
  if (city.avoid.length) {
    lines.push('## 避雷')
    lines.push('')
    city.avoid.forEach((t) => lines.push(`- ${t}`))
    lines.push('')
  }
  lines.push('---')
  lines.push('_由「途迹」生成 · 餐厅评价为根据公开资料综合整理的参考，出行前请以官方最新信息为准_')
  return lines.join('\n')
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
