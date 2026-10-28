import type { City, SavedPlan } from '../types'

export type TileSource = 'amap' | 'osm' | 'esri'
export const TILE_SOURCES: TileSource[] = ['amap', 'osm', 'esri']

export interface Settings {
  apiKey: string
  model: string
  /** 高德 Web 服务 Key（可选，用于酒店 / 地址搜索） */
  amapKey: string
  tileSource: TileSource
  /** 出行人数，用于预算 */
  people: number
  /** 每晚住宿预算（可选） */
  hotelPerNight: number
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  amapKey: '',
  tileSource: 'amap',
  people: 2,
  hotelPerNight: 0,
}

const KEYS = {
  settings: 'tuji:settings',
  plans: 'tuji:plans',
  aiCities: 'tuji:ai-cities',
} as const

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...(fallback as object), ...(JSON.parse(raw) as object) } as T
  } catch {
    return fallback
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

export const loadSettings = (): Settings => {
  const s = read<Settings>(KEYS.settings, DEFAULT_SETTINGS)
  if (!TILE_SOURCES.includes(s.tileSource)) s.tileSource = DEFAULT_SETTINGS.tileSource
  return s
}
export const saveSettings = (s: Settings) => write(KEYS.settings, s)

export const loadPlans = () => readArray<SavedPlan>(KEYS.plans)
export const savePlans = (p: SavedPlan[]) => write(KEYS.plans, p)

export const loadAiCities = () => readArray<City>(KEYS.aiCities).map((c) => ({ ...c, source: 'ai' as const }))
export const saveAiCities = (c: City[]) => write(KEYS.aiCities, c)
