import { useMemo, useState } from 'react'
import type { City, Restaurant, TripPlan } from '../types'
import { MEAL_LABEL } from '../lib/format'
import { haversine } from '../lib/geo'
import { RestaurantCard } from './RestaurantCard'
import { Chip, SectionTitle } from './ui'

const QUICK_TAGS = ['老字号', '网红', '本地人推荐', '必吃榜', '性价比', '夜宵', '小吃', '咖啡', '甜品', '适合约会']

export function FoodTab({ city, plan }: { city: City; plan: TripPlan }) {
  const [tag, setTag] = useState<string | null>(null)
  const [cuisine, setCuisine] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<number>(0)

  const inPlan = useMemo(() => {
    const out: { r: Restaurant; label: string }[] = []
    plan.days.forEach((d) => {
      d.stops.forEach((s) => {
        if (s.kind !== 'meal') return
        const r = city.restaurants.find((x) => x.id === s.id)
        if (r) out.push({ r, label: `Day ${d.day} · ${MEAL_LABEL[s.mealType ?? 'lunch']}` })
      })
      if (d.breakfastId) {
        const r = city.restaurants.find((x) => x.id === d.breakfastId)
        if (r) out.push({ r, label: `Day ${d.day} · 早餐推荐` })
      }
    })
    return out
  }, [city, plan])
  const inPlanIds = useMemo(() => new Set(inPlan.map((x) => x.r.id)), [inPlan])

  const cuisines = useMemo(() => Array.from(new Set(city.restaurants.map((r) => r.cuisine.split(/\s*[·/]\s*/)[0]))).sort(), [city])
  const others = useMemo(() => {
    return city.restaurants
      .filter((r) => !inPlanIds.has(r.id))
      .filter((r) => !tag || r.tags.includes(tag))
      .filter((r) => !cuisine || r.cuisine.startsWith(cuisine))
      .filter((r) => !maxPrice || r.avgPrice <= maxPrice)
      .sort((a, b) => b.rating - a.rating)
  }, [city, inPlanIds, tag, cuisine, maxPrice])

  const nearestAttraction = (r: Restaurant) => {
    let best: { name: string; km: number } | null = null
    for (const a of city.attractions) {
      const km = haversine(a, r)
      if (!best || km < best.km) best = { name: a.name, km }
    }
    return best
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle title="行程里的美食" sub={`${inPlan.length} 顿，按天就近安排；点开可看综合评价与必点菜`} />
        <div className="mt-4 grid gap-3">
          {inPlan.map(({ r, label }, i) => (
            <RestaurantCard key={`${r.id}-${i}`} r={r} subtitle={label} defaultOpen={i === 0} />
          ))}
          {inPlan.length === 0 && <div className="text-sm text-muted">还没有安排用餐。</div>}
        </div>
      </section>

      <section>
        <SectionTitle title="美食地图" sub={`${city.name}另外 ${others.length} 家值得一试的店`} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip active={!tag} onClick={() => setTag(null)}>全部</Chip>
          {QUICK_TAGS.filter((t) => city.restaurants.some((r) => r.tags.includes(t))).map((t) => (
            <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</Chip>
          ))}
          <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-sm outline-none">
            <option value="">所有菜系</option>
            {cuisines.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="h-9 rounded-full border border-line bg-white px-3 text-sm outline-none">
            <option value={0}>不限人均</option>
            <option value={50}>人均 ≤ ¥50</option>
            <option value={100}>人均 ≤ ¥100</option>
            <option value={200}>人均 ≤ ¥200</option>
          </select>
        </div>
        <div className="mt-4 grid gap-3">
          {others.map((r) => {
            const near = nearestAttraction(r)
            return <RestaurantCard key={r.id} r={r} subtitle={near ? `离 ${near.name} ${near.km < 1 ? `${Math.round(near.km * 1000)} 米` : `${near.km.toFixed(1)} 公里`}` : undefined} />
          })}
          {others.length === 0 && <div className="text-sm text-muted">没有符合筛选条件的餐厅。</div>}
        </div>
      </section>
      <p className="text-[11px] text-muted">* 餐厅评价为根据公开评价综合整理的参考（非逐条引用），用于说明推荐理由与注意事项。价格、排队时间为编写时参考值。</p>
    </div>
  )
}
