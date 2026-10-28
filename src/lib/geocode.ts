/**
 * 地址 / 酒店搜索：
 *  - 默认用 OpenStreetMap Nominatim（免费、无需 Key，中文酒店覆盖一般）
 *  - 设置里填了高德 Web 服务 Key 时改用高德 POI 搜索（国内结果更全），坐标自动从 GCJ-02 转回 WGS-84
 */
import type { City } from '../types'
import { gcj02ToWgs84 } from './geo'

export interface GeoResult {
  name: string
  address: string
  lat: number
  lng: number
}

export async function searchPlace(query: string, city: City, amapKey?: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const q = query.trim()
  if (!q) return []
  if (amapKey?.trim()) return searchAmap(q, city, amapKey.trim(), signal)
  return searchNominatim(q, city, signal)
}

async function searchAmap(q: string, city: City, key: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(q)}&city=${encodeURIComponent(city.name)}&citylimit=true&offset=8&page=1&extensions=base`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`高德接口错误 ${res.status}`)
  const data = (await res.json()) as { status: string; info?: string; pois?: { name: string; address?: string | string[]; location?: string; cityname?: string; adname?: string }[] }
  if (data.status !== '1') throw new Error(`高德接口：${data.info ?? '请求失败'}`)
  return (data.pois ?? [])
    .filter((p) => typeof p.location === 'string' && p.location.includes(','))
    .map((p) => {
      const [lng, lat] = p.location!.split(',').map(Number)
      const w = gcj02ToWgs84({ lat, lng })
      const addr = Array.isArray(p.address) ? p.address.join('') : (p.address ?? '')
      return { name: p.name, address: [p.cityname, p.adname, addr].filter(Boolean).join(' '), lat: w.lat, lng: w.lng }
    })
}

async function searchNominatim(q: string, city: City, signal?: AbortSignal): Promise<GeoResult[]> {
  const b = city.bbox
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '8',
    'accept-language': 'zh-CN,zh',
    q: /中国|市|区|省/.test(q) || !/^[\u4e00-\u9fa5]/.test(q) ? q : `${city.name} ${q}`,
    viewbox: `${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}`,
    bounded: '1',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`地图服务错误 ${res.status}`)
  const data = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[]
  return data.map((d) => ({
    name: d.name || d.display_name.split(',')[0],
    address: d.display_name.split(',').slice(1, 4).map((x) => x.trim()).join(' '),
    lat: Number(d.lat),
    lng: Number(d.lon),
  }))
}
