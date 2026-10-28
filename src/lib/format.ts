import type { Pace, Transport, Interest, MealType } from '../types'

export function minutesToHHMM(m: number): string {
  const total = ((Math.round(m) % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const mm = total % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** "08:30-17:00" → [510, 1020]；"全天" → [0, 1440] */
export function parseOpenHours(s: string): [number, number] {
  if (!s || /全天|24/.test(s)) return [0, 1440]
  const m = s.match(/(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})/)
  if (!m) return [0, 1440]
  const start = Number(m[1]) * 60 + Number(m[2])
  let end = Number(m[3]) * 60 + Number(m[4])
  if (end <= start) end += 1440 // 跨夜
  return [start, end]
}

export function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} 分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} 米`
  return `${km.toFixed(1)} 公里`
}

export function formatMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`
}

export const PACE_LABEL: Record<Pace, { name: string; desc: string; emoji: string }> = {
  relaxed: { name: '轻松', desc: '每天 5-6 小时，留白多', emoji: '🌿' },
  moderate: { name: '适中', desc: '每天 7-8 小时，经典节奏', emoji: '🚶' },
  intense: { name: '特种兵', desc: '每天 10 小时+，一天顶三天', emoji: '⚡️' },
}

export const TRANSPORT_LABEL: Record<Transport, { name: string; emoji: string }> = {
  walk: { name: '步行', emoji: '🚶' },
  metro: { name: '地铁 / 公交', emoji: '🚇' },
  taxi: { name: '打车', emoji: '🚕' },
}

export const INTEREST_EMOJI: Record<Interest, string> = {
  历史文化: '🏯',
  自然风光: '🏞️',
  网红打卡: '📸',
  博物馆艺术: '🖼️',
  美食探店: '🍜',
  购物: '🛍️',
  亲子: '🎠',
  夜生活: '🌃',
  建筑: '🏛️',
  宗教: '🛕',
}

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '下午茶 / 小吃',
  night: '夜宵',
}

export const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekdayOf(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay()
}

export function formatDateCN(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}`
}

export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function compactNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}
