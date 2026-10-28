/**
 * 分享链接：把行程压缩编码进 URL hash（#s=...），打开即还原。
 * 内置城市只编码 id + 偏好 + 每天的景点 / 餐厅顺序（几百字节）；
 * AI 生成的城市还要带上完整城市数据（会长很多，但浏览器能承受）。
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { City, MealType, PlanParams, PlanVariant, TripPlan } from '../types'

interface SharePayloadV1 {
  v: 1
  c: string
  n?: string
  variant?: PlanVariant
  p: PlanParams
  d: { a: string[]; m: Partial<Record<MealType, string>>; s?: boolean }[]
  city?: City
}

export function encodeShare(city: City, plan: TripPlan, name?: string): string {
  const payload: SharePayloadV1 = {
    v: 1,
    c: city.id,
    n: name,
    variant: plan.variant,
    p: plan.params,
    d: plan.days.map((day) => ({
      a: day.stops.filter((s) => s.kind === 'attraction').map((s) => s.id),
      m: Object.fromEntries(day.stops.filter((s) => s.kind === 'meal' && s.mealType).map((s) => [s.mealType!, s.id])),
      s: day.isSuburb || undefined,
    })),
    city: city.source === 'ai' ? city : undefined,
  }
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function shareUrl(code: string): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#s=${code}`
}

export interface DecodedShare {
  cityId: string
  name?: string
  variant?: PlanVariant
  params: PlanParams
  days: { attractionIds: string[]; meals: Partial<Record<MealType, string>>; isSuburb?: boolean }[]
  city?: City
}

export function decodeShare(code: string): DecodedShare | null {
  try {
    const json = decompressFromEncodedURIComponent(code)
    if (!json) return null
    const p = JSON.parse(json) as SharePayloadV1
    if (p.v !== 1 || !p.c || !p.p || !Array.isArray(p.d)) return null
    return {
      cityId: p.c,
      name: p.n,
      variant: p.variant,
      params: p.p,
      days: p.d.map((d) => ({ attractionIds: d.a ?? [], meals: d.m ?? {}, isSuburb: d.s })),
      city: p.city,
    }
  } catch {
    return null
  }
}

/** 从当前地址栏读取分享码（#s=...） */
export function readShareFromHash(): string | null {
  const m = location.hash.match(/^#s=([A-Za-z0-9+\-$_.]+)/)
  return m ? m[1] : null
}
