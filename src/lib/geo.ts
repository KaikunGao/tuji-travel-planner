import type { Leg, TransportPref } from '../types'

export interface LatLng {
  lat: number
  lng: number
}

const R = 6371 // km

/** 两点间球面距离（公里） */
export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 城市内出行估算：步行 / 地铁公交 / 打车，受出行方式偏好影响。
 * 直线距离会乘一个 1.3 的绕行系数再估时间。
 */
export function estimateLeg(a: LatLng, b: LatLng, pref: TransportPref = 'balanced'): Leg {
  const straight = haversine(a, b)
  const d = straight * 1.3
  const t = THRESHOLDS[pref]
  const walk = (): Leg => ({ distanceKm: round1(d), minutes: Math.max(3, Math.round((d / 4.5) * 60) + 2), mode: 'walk', cost: 0 })
  const taxi = (): Leg => ({
    distanceKm: round1(d),
    minutes: d <= 5 ? Math.round(8 + d * 3) : Math.round(12 + d * 2),
    mode: 'taxi',
    cost: Math.round(13 + Math.max(0, d - 3) * 2.5),
  })
  const metro = (): Leg => ({ distanceKm: round1(d), minutes: Math.round(12 + d * 2.8), mode: 'metro', cost: Math.min(9, 3 + Math.floor(d / 6)) })
  const farTaxi = (): Leg => ({ distanceKm: round1(d), minutes: Math.round(15 + d * 1.5), mode: 'taxi', cost: Math.round(15 + d * 2.3) })
  if (straight <= t.walk) return walk()
  if (straight <= t.shortTaxi) return taxi()
  if (straight <= t.metro) return metro()
  return farTaxi()
}

/** 各偏好下的分段阈值（直线公里）：≤walk 步行，≤shortTaxi 短途打车，≤metro 地铁，否则远途打车 */
const THRESHOLDS: Record<TransportPref, { walk: number; shortTaxi: number; metro: number }> = {
  balanced: { walk: 1.4, shortTaxi: 3.5, metro: 16 },
  walk: { walk: 2.6, shortTaxi: 3.5, metro: 16 },
  transit: { walk: 1.0, shortTaxi: 1.0, metro: 28 },
  taxi: { walk: 0.6, shortTaxi: 30, metro: 30 },
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 }
  const s = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 })
  return { lat: s.lat / points.length, lng: s.lng / points.length }
}

/* ------------------------------------------------------------------ */
/* WGS-84 → GCJ-02（高德 / 腾讯地图瓦片使用的火星坐标）                 */
/* ------------------------------------------------------------------ */

const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

export function wgs84ToGcj02(p: LatLng): LatLng {
  if (outOfChina(p.lat, p.lng)) return p
  let dLat = transformLat(p.lng - 105.0, p.lat - 35.0)
  let dLng = transformLng(p.lng - 105.0, p.lat - 35.0)
  const radLat = (p.lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: p.lat + dLat, lng: p.lng + dLng }
}

/** GCJ-02 → WGS-84（迭代逼近，误差 < 1 米） */
export function gcj02ToWgs84(p: LatLng): LatLng {
  if (outOfChina(p.lat, p.lng)) return p
  let guess = { ...p }
  for (let i = 0; i < 4; i++) {
    const g = wgs84ToGcj02(guess)
    guess = { lat: guess.lat - (g.lat - p.lat), lng: guess.lng - (g.lng - p.lng) }
  }
  return guess
}
