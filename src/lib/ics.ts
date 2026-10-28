/**
 * 导出 iCalendar（.ics）：每个景点 / 用餐一个事件，用本地时间（不带时区），导入手机日历即可。
 */
import type { City, TripPlan } from '../types'
import { MEAL_LABEL, addDays, minutesToHHMM, todayStr } from './format'

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;')
}

function dt(date: string, minutes: number): string {
  // 跨到次日的时间顺延日期
  const dayOffset = Math.floor(minutes / 1440)
  const d = addDays(date, dayOffset).replace(/-/g, '')
  return `${d}T${minutesToHHMM(minutes % 1440).replace(':', '')}00`
}

/** 把一行按 RFC 5545 折成不超过 75 字节的多行 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length
    if (curLen + l > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      curLen = 0
    }
    cur += ch
    curLen += l
  }
  if (cur) out.push(cur)
  return out.join('\r\n ')
}

export function planToIcs(city: City, plan: TripPlan): { ics: string; firstDate: string } {
  const firstDate = plan.params.startDate ?? todayStr()
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//途迹//旅行规划//CN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(`${city.name} ${plan.days.length} 日游 · 途迹`)}`]
  plan.days.forEach((day, i) => {
    const date = day.date ?? addDays(firstDate, i)
    day.stops.forEach((s, j) => {
      const isAttr = s.kind === 'attraction'
      const a = isAttr ? city.attractions.find((x) => x.id === s.id) : undefined
      const r = !isAttr ? city.restaurants.find((x) => x.id === s.id) : undefined
      const name = a?.name ?? r?.name
      if (!name) return
      const summary = isAttr ? `📍 ${name}` : `🍴 ${MEAL_LABEL[s.mealType ?? 'lunch']} · ${name}`
      const descParts: string[] = []
      if (a) {
        descParts.push(a.description)
        a.tips.forEach((t) => descParts.push(`💡 ${t}`))
        if (a.price) descParts.push(`门票 ¥${a.price}`)
        descParts.push(`开放 ${a.openHours}`)
      }
      if (r) {
        descParts.push(`${r.cuisine} · 人均 ¥${r.avgPrice}`)
        descParts.push(`必点：${r.mustOrder.join('、')}`)
        if (r.waitTime) descParts.push(`⏳ ${r.waitTime}`)
      }
      if (s.leg && s.leg.distanceKm > 0.05) descParts.push(`前往：${s.leg.mode === 'walk' ? '步行' : s.leg.mode === 'metro' ? '地铁/公交' : '打车'} ${s.leg.distanceKm} 公里，约 ${s.leg.minutes} 分钟`)
      if (s.note) descParts.push(`ℹ️ ${s.note}`)
      if (s.warning) descParts.push(`⚠️ ${s.warning}`)
      const p = a ?? r!
      lines.push(
        'BEGIN:VEVENT',
        `UID:tuji-${plan.id}-${i}-${j}@tuji.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${dt(date, s.start)}`,
        `DTEND:${dt(date, s.end)}`,
        fold(`SUMMARY:${esc(summary)}`),
        fold(`LOCATION:${esc(`${name}（${a?.area ?? r?.area ?? city.name}）`)}`),
        `GEO:${p.lat.toFixed(5)};${p.lng.toFixed(5)}`,
        fold(`DESCRIPTION:${esc(descParts.join('\n'))}`),
        'END:VEVENT',
      )
    })
  })
  lines.push('END:VCALENDAR')
  return { ics: lines.join('\r\n') + '\r\n', firstDate }
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
