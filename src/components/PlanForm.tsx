import { CalendarDays, Clock, Flag, Loader2, Minus, Mountain, Plus, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { City, FoodPrefs, Interest, Pace, PlanParams, TransportPref } from '../types'
import { DEFAULT_FOOD_PREFS, FOOD_AVOID_OPTIONS, INTERESTS } from '../types'
import { INTEREST_EMOJI, PACE_LABEL } from '../lib/format'
import { searchPlace, type GeoResult } from '../lib/geocode'
import { isSuburb } from '../lib/planner'
import { Button, Chip } from './ui'

const TRANSPORT_OPTIONS: { id: TransportPref; name: string; desc: string; emoji: string }[] = [
  { id: 'balanced', name: '均衡', desc: '近走远坐', emoji: '🧭' },
  { id: 'walk', name: '多步行', desc: '2.5km 内都走', emoji: '🚶' },
  { id: 'transit', name: '公共交通', desc: '地铁公交为主', emoji: '🚇' },
  { id: 'taxi', name: '打车优先', desc: '省时间花点钱', emoji: '🚕' },
]

const START_TIMES = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00']

export function PlanForm({
  city,
  value,
  onChange,
  onSubmit,
  amapKey,
}: {
  city: City
  value: PlanParams
  onChange: (v: PlanParams) => void
  onSubmit: () => void
  amapKey?: string
}) {
  const set = <K extends keyof PlanParams>(k: K, v: PlanParams[K]) => onChange({ ...value, [k]: v })
  const food: FoodPrefs = value.food ?? DEFAULT_FOOD_PREFS
  const setFood = (patch: Partial<FoodPrefs>) => set('food', { ...food, ...patch })
  const transport = value.transport ?? 'balanced'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const customStart = value.startPoint && !city.attractions.some((a) => `${a.name}附近` === value.startPoint!.name)

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const r = await searchPlace(query, city, amapKey)
      setResults(r)
      if (!r.length) setSearchError('没找到，换个关键词试试，或直接在地图上点选')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }
  const toggleInterest = (i: Interest) =>
    set('interests', value.interests.includes(i) ? value.interests.filter((x) => x !== i) : [...value.interests, i])
  const suburbs = city.attractions.filter((a) => isSuburb(a, city))

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {/* 天数 */}
      <Field label="玩几天" hint={`建议 ${city.suggestedDays}`}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => set('days', Math.max(1, value.days - 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white hover:bg-paper" aria-label="减少">
            <Minus size={16} />
          </button>
          <div className="w-16 text-center text-2xl font-extrabold tabular-nums text-ink">
            {value.days}
            <span className="ml-1 text-sm font-medium text-muted">天</span>
          </div>
          <button type="button" onClick={() => set('days', Math.min(7, value.days + 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white hover:bg-paper" aria-label="增加">
            <Plus size={16} />
          </button>
        </div>
      </Field>

      {/* 节奏 */}
      <Field label="节奏">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PACE_LABEL) as Pace[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set('pace', p)}
              className={`rounded-xl border px-2 py-2.5 text-left transition ${value.pace === p ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-ink/30'}`}
            >
              <div className="text-base">{PACE_LABEL[p].emoji} <span className="text-sm font-bold text-ink">{PACE_LABEL[p].name}</span></div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{PACE_LABEL[p].desc}</div>
            </button>
          ))}
        </div>
      </Field>

      {/* 兴趣 */}
      <Field label="兴趣偏好" hint="不选则按综合热度">
        <div className="flex flex-wrap gap-1.5">
          {INTERESTS.map((i) => (
            <Chip key={i} active={value.interests.includes(i)} onClick={() => toggleInterest(i)}>
              <span>{INTEREST_EMOJI[i]}</span>
              {i}
            </Chip>
          ))}
        </div>
      </Field>

      {/* 时间 */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={<><Clock size={14} className="inline -mt-0.5 mr-1" />每天出发</>}>
          <select value={value.startTime} onChange={(e) => set('startTime', e.target.value)} className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand">
            {START_TIMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label={<><CalendarDays size={14} className="inline -mt-0.5 mr-1" />出发日期</>} hint="可选，用于避开闭馆日">
          <input
            type="date"
            value={value.startDate ?? ''}
            onChange={(e) => set('startDate', e.target.value || undefined)}
            className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
          />
        </Field>
      </div>

      {/* 出行方式 */}
      <Field label="出行方式" hint="影响时间估算和交通预算">
        <div className="grid grid-cols-4 gap-1.5">
          {TRANSPORT_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('transport', t.id)}
              className={`rounded-xl border px-1 py-2 text-center transition ${transport === t.id ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-ink/30'}`}
            >
              <div className="text-base">{t.emoji}</div>
              <div className="text-xs font-semibold text-ink">{t.name}</div>
              <div className="text-[10px] leading-tight text-muted">{t.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      {/* 饮食偏好 */}
      <details className="rounded-xl border border-line bg-white p-3" open={food.noSpicy || food.vegetarian || food.halal || food.maxPrice > 0 || food.avoid.length > 0}>
        <summary className="cursor-pointer select-none text-sm font-semibold text-ink">
          🍽️ 饮食偏好 <span className="ml-1 text-[11px] font-normal text-muted">可选，影响午餐 / 晚餐的挑选</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={food.noSpicy} onClick={() => setFood({ noSpicy: !food.noSpicy })}>🌶️ 不吃辣</Chip>
            <Chip active={food.vegetarian} onClick={() => setFood({ vegetarian: !food.vegetarian })}>🥬 素食优先</Chip>
            <Chip active={food.halal} onClick={() => setFood({ halal: !food.halal })}>☪️ 清真优先</Chip>
          </div>
          <div>
            <div className="mb-1.5 text-xs text-muted">忌口</div>
            <div className="flex flex-wrap gap-1.5">
              {FOOD_AVOID_OPTIONS.map((k) => (
                <Chip key={k} active={food.avoid.includes(k)} onClick={() => setFood({ avoid: food.avoid.includes(k) ? food.avoid.filter((x) => x !== k) : [...food.avoid, k] })}>
                  {k}
                </Chip>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-xs text-muted">人均上限</span>
            <select value={food.maxPrice} onChange={(e) => setFood({ maxPrice: Number(e.target.value) })} className="h-9 rounded-lg border border-line bg-white px-2 text-sm outline-none">
              <option value={0}>不限</option>
              <option value={50}>≤ ¥50</option>
              <option value={100}>≤ ¥100</option>
              <option value={150}>≤ ¥150</option>
              <option value={200}>≤ ¥200</option>
            </select>
          </label>
          <p className="text-[11px] text-muted">按菜系、招牌菜和标签判断，是尽量避开而不是绝对排除；餐厅卡片上可以随时「换一家」。</p>
        </div>
      </details>

      {/* 出发点 */}
      <Field label={<><Flag size={14} className="inline -mt-0.5 mr-1" />每天从哪出发</>} hint="酒店或住处">
        <select
          value={customStart ? 'custom' : (city.attractions.find((a) => value.startPoint && value.startPoint.name === `${a.name}附近`)?.id ?? '')}
          onChange={(e) => {
            if (e.target.value === 'custom') return
            const a = city.attractions.find((x) => x.id === e.target.value)
            set('startPoint', a ? { lat: a.lat, lng: a.lng, name: `${a.name}附近` } : undefined)
          }}
          className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
        >
          <option value="">市中心（默认）</option>
          {customStart && <option value="custom">📍 {value.startPoint!.name}</option>}
          {city.attractions
            .filter((a) => !isSuburb(a, city))
            .map((a) => (
              <option key={a.id} value={a.id}>{a.name}附近</option>
            ))}
        </select>
        <div className="mt-2 flex gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void runSearch()
              }
            }}
            placeholder="搜索酒店 / 地址，如「王府井希尔顿」"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand"
          />
          <Button type="button" size="sm" variant="secondary" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </Button>
        </div>
        {searchError && <div className="mt-1 text-[11px] text-amber-700">{searchError}</div>}
        {results.length > 0 && (
          <ul className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-line bg-white tj-scroll">
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lng}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    set('startPoint', { lat: r.lat, lng: r.lng, name: r.name })
                    setResults([])
                    setQuery('')
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                >
                  <span className="text-sm font-medium text-ink">{r.name}</span>
                  <span className="text-[11px] text-muted">{r.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {customStart && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-soft px-3 py-1.5 text-xs text-brand-dark">
            <span>🏠 出发点：{value.startPoint!.name}</span>
            <button type="button" onClick={() => set('startPoint', undefined)} className="inline-flex items-center gap-0.5 hover:underline"><X size={12} /> 清除</button>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-muted">也可以直接在右侧地图上点一下，把那个位置设为出发点。</p>
      </Field>

      {/* 远郊 */}
      {suburbs.length > 0 && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3">
          <input type="checkbox" checked={value.includeSuburb} onChange={(e) => set('includeSuburb', e.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
          <div className="text-sm">
            <div className="font-medium text-ink"><Mountain size={14} className="inline -mt-0.5 mr-1" />安排远郊一日游</div>
            <div className="mt-0.5 text-xs text-muted">
              {suburbs.slice(0, 3).map((a) => a.name).join('、')}{suburbs.length > 3 ? ' 等' : ''}距市区较远，会单独占一天（需 2 天以上）
            </div>
          </div>
        </label>
      )}

      <Button type="submit" size="lg" className="w-full">
        生成不走回头路的路线 →
      </Button>
    </form>
  )
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
