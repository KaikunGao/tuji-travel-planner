/**
 * 途迹 · 数据类型定义
 * 所有坐标均为 WGS-84（即 GPS / OpenStreetMap 使用的坐标系）。
 */

/** 兴趣标签，用于匹配景点 category / tags */
export const INTERESTS = [
  '历史文化',
  '自然风光',
  '网红打卡',
  '博物馆艺术',
  '美食探店',
  '购物',
  '亲子',
  '夜生活',
  '建筑',
  '宗教',
] as const
export type Interest = (typeof INTERESTS)[number]

/** 游玩节奏 */
export type Pace = 'relaxed' | 'moderate' | 'intense'

/** 最适合的游览时段 */
export type BestTime = 'morning' | 'afternoon' | 'evening' | 'night' | 'any'

/** 交通方式 */
export type Transport = 'walk' | 'metro' | 'taxi'

/** 出行方式偏好 */
export type TransportPref = 'balanced' | 'walk' | 'transit' | 'taxi'

/** 饮食偏好 */
export interface FoodPrefs {
  noSpicy: boolean
  vegetarian: boolean
  halal: boolean
  /** 人均上限（元），0 = 不限 */
  maxPrice: number
  /** 忌口：海鲜 / 内脏 / 牛肉 / 羊肉 / 香菜 */
  avoid: string[]
}

export const FOOD_AVOID_OPTIONS = ['海鲜', '内脏', '牛肉', '羊肉', '香菜'] as const

/** 方案变体：推荐 / 省时省力 / 省钱 / 打卡多 */
export type PlanVariant = 'balanced' | 'fast' | 'cheap' | 'max'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'night'

export interface Attraction {
  /** 城市内唯一，建议使用英文小写加连字符，如 "forbidden-city" */
  id: string
  name: string
  /** 片区，如 "东城·中轴线"；用于生成每日主题 */
  area: string
  /** 主分类，必须是 Interest 之一 */
  category: Interest
  /** 更多标签，可包含 Interest 以及自由标签如 "世界遗产" */
  tags: string[]
  lat: number
  lng: number
  /** 建议游玩时长（分钟） */
  duration: number
  /** 评分 0-5 */
  rating: number
  /** 门票价格（人民币），0 表示免费 */
  price: number
  /** 开放时间 "08:30-17:00" 或 "全天" */
  openHours: string
  /** 每周闭馆日：0=周日 1=周一 ... 6=周六 */
  closedOn?: number[]
  /** 60-150 字的介绍 */
  description: string
  /** 2-4 条实用贴士 */
  tips: string[]
  /** 是否必去 */
  mustSee: boolean
  bestTime: BestTime
  /** 远郊景点（距市中心 > 20km），需要单独安排一天 */
  suburb?: boolean
  /** 需要提前预约 */
  needBooking?: boolean
  /** 拍照机位 */
  photoSpots?: string[]
}

/**
 * 综合评价：根据公开评价综合整理的中立陈述（不是逐条引用的帖子，不含虚构作者与数字）
 */
export interface RestaurantReview {
  /** 一句话总评，40-90 字，第三人称中立语气，不用 emoji / 话题标签 */
  summary: string
  /** 大家喜欢的点，2-4 条，每条 ≤ 25 字 */
  pros: string[]
  /** 注意与吐槽，1-3 条，每条 ≤ 25 字（排队、价格、口味偏好等） */
  cons: string[]
  /** 适合场景，如 "朋友聚餐、晚餐"，≤ 20 字 */
  bestFor?: string
}

/** @deprecated 旧的仿帖子数据，已改为 review；保留类型只为兼容未转换的数据 */
export interface XhsNote {
  author: string
  /** 头像用一个 emoji 表示 */
  avatar: string
  title: string
  /** 小红书风格正文，含 emoji，80-260 字 */
  content: string
  /** 1-5 */
  rating: number
  likes: number
  collects: number
  comments: number
  /** 如 "2026-05-12" */
  date: string
  /** 话题标签，如 "#北京美食" */
  tags: string[]
  imageCount: number
}

export interface Restaurant {
  id: string
  name: string
  /** 菜系，如 "北京菜 · 烤鸭" */
  cuisine: string
  area: string
  lat: number
  lng: number
  /** 人均（人民币） */
  avgPrice: number
  /** 评分 0-5 */
  rating: number
  /** 必点菜 */
  mustOrder: string[]
  openHours: string
  /** 排队情况，如 "周末晚餐排队 30-60 分钟" */
  waitTime?: string
  /** 标签：老字号 / 网红 / 本地人推荐 / 米其林 / 必吃榜 / 性价比 / 适合约会 / 夜宵 / 小吃 ... */
  tags: string[]
  mealTypes: MealType[]
  /** 综合评价 */
  review?: RestaurantReview
  /** @deprecated 旧的仿帖子数据，转换完成后删除 */
  notes?: XhsNote[]
  /** 避雷提示 */
  warning?: string
}

export interface City {
  /** 如 "beijing" */
  id: string
  name: string
  nameEn: string
  province?: string
  /** 一句话 slogan */
  tagline: string
  emoji: string
  /** 封面渐变的两个颜色 */
  gradient: [string, string]
  center: { lat: number; lng: number }
  /** 所有坐标必须落在这个范围内（含远郊） */
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  defaultZoom: number
  bestSeason: string
  /** 如 "3-4 天" */
  suggestedDays: string
  transportTips: string[]
  tips: string[]
  /** 避雷 */
  avoid: string[]
  attractions: Attraction[]
  restaurants: Restaurant[]
  source?: 'builtin' | 'ai'
}

/* ------------------------------------------------------------------ */
/* 规划相关                                                             */
/* ------------------------------------------------------------------ */

export interface PlanParams {
  cityId: string
  /** 1-7 */
  days: number
  pace: Pace
  interests: Interest[]
  /** "09:00" */
  startTime: string
  /** 出行首日日期 "2026-10-27"，可选；用于避开闭馆日 */
  startDate?: string
  /** 每天出发点（如酒店）；默认市中心 */
  startPoint?: { lat: number; lng: number; name: string }
  /** 必去景点 id */
  mustInclude: string[]
  /** 不去的景点 id */
  exclude: string[]
  /** 是否安排远郊景点 */
  includeSuburb: boolean
  /** 出行方式偏好（旧数据可能缺省） */
  transport?: TransportPref
  /** 饮食偏好（旧数据可能缺省） */
  food?: FoodPrefs
}

export const DEFAULT_FOOD_PREFS: FoodPrefs = { noSpicy: false, vegetarian: false, halal: false, maxPrice: 0, avoid: [] }

export interface Leg {
  distanceKm: number
  minutes: number
  mode: Transport
  cost: number
}

export interface ScheduleStop {
  kind: 'attraction' | 'meal'
  /** attraction id 或 restaurant id */
  id: string
  /** 距当天 0:00 的分钟数 */
  start: number
  end: number
  /** 从上一个点过来的交通 */
  leg?: Leg
  mealType?: MealType
  /** 提示，如 "比开门时间早到 20 分钟" */
  note?: string
  /** 是否被用户锁定顺序（手动调整后） */
  warning?: string
}

export interface DayPlan {
  day: number
  /** 日期 "2026-10-27"，若无 startDate 则为空 */
  date?: string
  title: string
  theme: string
  stops: ScheduleStop[]
  distanceKm: number
  walkKm: number
  startTime: number
  endTime: number
  cost: { tickets: number; food: number; transport: number }
  /** 早餐推荐（不计入时间轴） */
  breakfastId?: string
  isSuburb?: boolean
  /** 从最后一站返回出发点 */
  returnLeg?: Leg
}

export interface TripPlan {
  id: string
  /** 方案变体 */
  variant?: PlanVariant
  params: PlanParams
  days: DayPlan[]
  skipped: { id: string; reason: string }[]
  suggestions: string[]
  createdAt: number
}

export interface SavedPlan {
  id: string
  name: string
  cityId: string
  cityName: string
  createdAt: number
  plan: TripPlan
}
