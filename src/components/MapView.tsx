import L from 'leaflet'
import { useEffect, useRef } from 'react'
import type { City, TripPlan } from '../types'
import type { TileSource } from '../lib/storage'
import { gcj02ToWgs84, haversine, wgs84ToGcj02, type LatLng } from '../lib/geo'
import { minutesToHHMM } from '../lib/format'

export const DAY_COLORS = ['#e8553d', '#1f6f78', '#c98a1b', '#7c3aed', '#0e7490', '#15803d', '#be185d', '#4338ca']

const TILES: Record<TileSource, { url: string; options: L.TileLayerOptions }> = {
  amap: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    options: { subdomains: '1234', maxZoom: 18, attribution: '© 高德地图' },
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Tiles © Esri' },
  },
}

interface MapViewProps {
  city: City
  tileSource: TileSource
  mode: 'overview' | 'plan'
  plan?: TripPlan | null
  activeDay?: number
  selectedId?: string | null
  onSelect?: (id: string, kind: 'attraction' | 'meal') => void
  mustInclude?: Set<string>
  excluded?: Set<string>
  /** 总览模式下显示的出发点 */
  startPoint?: (LatLng & { name: string }) | null
  /** 点击地图空白处（返回 WGS-84 坐标） */
  onMapClick?: (p: LatLng) => void
  className?: string
}

function numberIcon(n: number | string, color: string, opts: { faded?: boolean; size?: number; meal?: boolean } = {}) {
  const size = opts.size ?? 28
  const cls = `tj-marker${opts.meal ? ' tj-marker-meal' : ''}${opts.faded ? ' tj-marker-faded' : ''}`
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="--c:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px">${n}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function dotIcon(color: string, opts: { ring?: boolean; faded?: boolean } = {}) {
  const cls = `tj-dot${opts.ring ? ' tj-dot-ring' : ''}${opts.faded ? ' tj-dot-faded' : ''}`
  return L.divIcon({ className: '', html: `<div class="${cls}" style="--c:${color}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })
}

const CATEGORY_COLOR: Record<string, string> = {
  历史文化: '#b45309',
  自然风光: '#15803d',
  网红打卡: '#db2777',
  博物馆艺术: '#7c3aed',
  美食探店: '#ea580c',
  购物: '#0891b2',
  亲子: '#f59e0b',
  夜生活: '#4338ca',
  建筑: '#475569',
  宗教: '#9f1239',
}

export function MapView({ city, tileSource, mode, plan, activeDay = 0, selectedId, onSelect, mustInclude, excluded, startPoint, onMapClick, className = '' }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick
  const tileRefForClick = useRef(tileSource)
  tileRefForClick.current = tileSource
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const lastFitKey = useRef<string>('')
  const conv = (p: LatLng): L.LatLngExpression => {
    const q = tileSource === 'amap' ? wgs84ToGcj02(p) : p
    return [q.lat, q.lng]
  }

  // 初始化
  useEffect(() => {
    if (!el.current || mapRef.current) return
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.5 })
    map.setView([city.center.lat, city.center.lng], city.defaultZoom)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!clickRef.current) return
      const p = { lat: e.latlng.lat, lng: e.latlng.lng }
      clickRef.current(tileRefForClick.current === 'amap' ? gcj02ToWgs84(p) : p)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      tileRef.current = null
      layerRef.current = null
      lastFitKey.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 底图
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) tileRef.current.remove()
    const t = TILES[tileSource]
    tileRef.current = L.tileLayer(t.url, t.options).addTo(map)
    lastFitKey.current = '' // 坐标系可能变了，重新定位
  }, [tileSource])

  // 内容
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markersRef.current.clear()
    const start: LatLng = plan?.params.startPoint ?? city.center
    const boundsPts: L.LatLngExpression[] = []

    if (mode === 'overview') {
      city.attractions.forEach((a) => {
        const must = mustInclude?.has(a.id)
        const ex = excluded?.has(a.id)
        const m = L.marker(conv(a), { icon: dotIcon(CATEGORY_COLOR[a.category] ?? '#64748b', { ring: must, faded: ex }), riseOnHover: true, bubblingMouseEvents: false })
        m.bindTooltip(`${a.name}${must ? ' · 必去' : ex ? ' · 不去' : ''}`, { direction: 'top', offset: [0, -8] })
        m.on('click', () => onSelect?.(a.id, 'attraction'))
        m.addTo(layer)
        markersRef.current.set(a.id, m)
        if (!a.suburb && haversine(a, city.center) <= 15) boundsPts.push(conv(a))
      })
      if (startPoint) {
        const home = L.marker(conv(startPoint), { icon: numberIcon('🏠', '#1f2328', { size: 26 }), zIndexOffset: 600, bubblingMouseEvents: false })
        home.bindTooltip(`出发点：${startPoint.name}`, { direction: 'top', offset: [0, -14] })
        home.addTo(layer)
      }
      const key = `overview-${city.id}-${tileSource}`
      if (lastFitKey.current !== key && boundsPts.length) {
        map.fitBounds(L.latLngBounds(boundsPts), { padding: [30, 30], maxZoom: 14 })
        lastFitKey.current = key
      }
      return
    }

    if (!plan) return
    plan.days.forEach((day, di) => {
      const color = DAY_COLORS[di % DAY_COLORS.length]
      const active = di === activeDay
      const pts: L.LatLngExpression[] = [conv(start)]
      let n = 0
      day.stops.forEach((s) => {
        const p = s.kind === 'attraction' ? city.attractions.find((a) => a.id === s.id) : city.restaurants.find((r) => r.id === s.id)
        if (!p) return
        pts.push(conv(p))
        if (active) boundsPts.push(conv(p))
        let marker: L.Marker
        if (s.kind === 'attraction') {
          n++
          marker = L.marker(conv(p), { icon: numberIcon(n, color, { faded: !active, size: active ? 28 : 20 }), zIndexOffset: active ? 500 : 0, riseOnHover: true, bubblingMouseEvents: false })
          marker.bindTooltip(`${minutesToHHMM(s.start)} · ${p.name}`, { direction: 'top', offset: [0, -14] })
        } else {
          marker = L.marker(conv(p), { icon: numberIcon('🍴', color, { faded: !active, meal: true, size: active ? 24 : 16 }), zIndexOffset: active ? 400 : 0, riseOnHover: true, bubblingMouseEvents: false })
          marker.bindTooltip(`${minutesToHHMM(s.start)} · ${p.name}`, { direction: 'top', offset: [0, -12] })
        }
        marker.on('click', () => onSelect?.(s.id, s.kind))
        marker.addTo(layer)
        if (active) markersRef.current.set(s.id, marker)
      })
      pts.push(conv(start))
      L.polyline(pts, {
        color,
        weight: active ? 5 : 3,
        opacity: active ? 0.9 : 0.25,
        dashArray: active ? undefined : '6 8',
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(layer)
    })
    const home = L.marker(conv(start), { icon: numberIcon('🏠', '#1f2328', { size: 26 }), zIndexOffset: 600 })
    home.bindTooltip(plan.params.startPoint?.name ?? '市中心（出发点）', { direction: 'top', offset: [0, -14] })
    home.addTo(layer)
    boundsPts.push(conv(start))

    const key = `plan-${plan.id}-${activeDay}-${tileSource}-${plan.days[activeDay]?.stops.length ?? 0}`
    if (lastFitKey.current !== key && boundsPts.length) {
      map.fitBounds(L.latLngBounds(boundsPts), { padding: [40, 40], maxZoom: 15 })
      lastFitKey.current = key
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, mode, plan, activeDay, tileSource, mustInclude, excluded, startPoint])

  // 选中 → 平移
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const m = markersRef.current.get(selectedId)
    if (m) {
      map.panTo(m.getLatLng(), { animate: true })
      m.openTooltip()
      const t = setTimeout(() => m.closeTooltip(), 1800)
      return () => clearTimeout(t)
    }
  }, [selectedId])

  return <div ref={el} className={`tj-map ${className}`} />
}
