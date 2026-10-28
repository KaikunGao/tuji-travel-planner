import { ArrowRight, Clock3, MapPinned, Route, Search, Sparkles, Trash2, Utensils } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { City, SavedPlan } from '../types'
import { Badge, Button, Card, SectionTitle } from './ui'

interface HomeProps {
  cities: City[]
  savedPlans: SavedPlan[]
  hasApiKey: boolean
  onSelectCity: (city: City) => void
  onOpenPlan: (p: SavedPlan) => void
  onDeletePlan: (id: string) => void
  onAiCity: (name: string) => void
  onDeleteAiCity: (id: string) => void
}

export function Home({ cities, savedPlans, hasApiKey, onSelectCity, onOpenPlan, onDeletePlan, onAiCity, onDeleteAiCity }: HomeProps) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return cities
    return cities.filter((c) => c.name.includes(k) || c.nameEn.toLowerCase().includes(k) || (c.province ?? '').includes(k))
  }, [cities, q])
  const exact = cities.find((c) => c.name === q.trim())

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-ink px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-teal/40 blur-3xl" />
        <div className="relative max-w-2xl">
          <Badge tone="brand" className="bg-white/10 text-white">不走回头路的城市漫游规划</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
            说一个城市，<br className="sm:hidden" />
            剩下的交给<span className="text-brand">途迹</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-white/75 sm:text-base">
            按地理位置把景点聚成每一天，再用最短路径算法排出顺序；沿途自动安排午餐晚餐，附上网上综合整理的美食评价、预算和避雷提示。
          </p>
          <form
            className="mt-6 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (exact) onSelectCity(exact)
              else if (filtered.length === 1) onSelectCity(filtered[0])
              else if (q.trim()) onAiCity(q.trim())
            }}
          >
            <label className="flex flex-1 items-center gap-2 rounded-2xl bg-white px-4 text-ink shadow-lg">
              <Search size={18} className="text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="想去哪儿？试试 北京 / 成都 / 西安…"
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted/70"
              />
            </label>
            <Button type="submit" size="lg" className="shrink-0">
              开始规划 <ArrowRight size={18} />
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-white/60">
            <span className="mr-1">热门：</span>
            {cities.slice(0, 6).map((c) => (
              <button key={c.id} type="button" onClick={() => onSelectCity(c)} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 没匹配到 → AI 生成 */}
      {q.trim() && filtered.length === 0 && (
        <Card className="mt-6 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-2xl">
            <Sparkles className="text-brand" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-ink">还没有「{q.trim()}」的内置数据</div>
            <div className="mt-0.5 text-sm text-muted">
              {hasApiKey ? '可以用 Claude 即时生成这座城市的景点与美食数据（约 1-3 分钟），之后就能像内置城市一样规划。' : '填入 Anthropic API Key 后，可以用 Claude 为任意城市生成数据。点击下方按钮开始。'}
            </div>
          </div>
          <Button onClick={() => onAiCity(q.trim())}>
            <Sparkles size={16} /> 用 AI 生成「{q.trim()}」
          </Button>
        </Card>
      )}

      {/* 城市列表 */}
      <section className="mt-10">
        <SectionTitle title="选择目的地" sub={`${cities.length} 座城市，内置数据开箱即用，其他城市可用 AI 生成`} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CityCard key={c.id} city={c} onClick={() => onSelectCity(c)} onDelete={c.source === 'ai' ? () => onDeleteAiCity(c.id) : undefined} />
          ))}
          {q.trim() && filtered.length > 0 && !exact && (
            <button
              type="button"
              onClick={() => onAiCity(q.trim())}
              className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-white/60 p-5 text-center text-muted transition hover:border-brand hover:text-brand"
            >
              <Sparkles />
              <div className="text-sm font-medium">用 AI 生成「{q.trim()}」</div>
            </button>
          )}
        </div>
      </section>

      {/* 我的行程 */}
      {savedPlans.length > 0 && (
        <section className="mt-10">
          <SectionTitle title="我的行程" sub="保存在本机浏览器里" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {savedPlans
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((p) => (
                <Card key={p.id} className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => onOpenPlan(p)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-bold text-ink">{p.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {p.cityName} · {p.plan.days.length} 天 · {new Date(p.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </button>
                  <button type="button" onClick={() => onDeletePlan(p.id)} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="删除">
                    <Trash2 size={16} />
                  </button>
                </Card>
              ))}
          </div>
        </section>
      )}

      {/* 怎么用 */}
      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { icon: <MapPinned className="text-brand" />, t: '1. 选城市，勾必去', d: '内置城市有真实景点与餐厅数据；点名几个必去的，其他交给算法。' },
          { icon: <Route className="text-teal" />, t: '2. 设天数和节奏', d: '按位置聚类分天，Held-Karp 精确求最短路径，上午景点在前、夜景在后。' },
          { icon: <Utensils className="text-xhs" />, t: '3. 沿途吃好喝好', d: '午餐晚餐就近安排，附综合评价、必点菜、排队提示和避雷。' },
        ].map((s) => (
          <Card key={s.t} className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper">{s.icon}</div>
            <div className="mt-3 font-bold text-ink">{s.t}</div>
            <div className="mt-1 text-sm text-muted">{s.d}</div>
          </Card>
        ))}
      </section>
      <p className="mt-8 text-center text-xs text-muted">
        <Clock3 size={12} className="mr-1 inline" />
        门票、营业时间和价格为编写时的参考值，出行前请以官方最新信息为准；美食评价为根据公开资料综合整理的参考。
      </p>
    </div>
  )
}

function CityCard({ city, onClick, onDelete }: { city: City; onClick: () => void; onDelete?: () => void }) {
  const must = city.attractions.filter((a) => a.mustSee).length
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className="w-full overflow-hidden rounded-2xl border border-line bg-white text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="relative h-28 p-4 text-white" style={{ background: `linear-gradient(135deg, ${city.gradient[0]}, ${city.gradient[1]})` }}>
          <div className="absolute right-4 top-3 text-4xl drop-shadow">{city.emoji}</div>
          <div className="text-xs uppercase tracking-widest text-white/70">{city.nameEn}</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">{city.name}</div>
          <div className="mt-1 text-xs text-white/85">{city.tagline}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs text-muted">
          <span>📍 {city.attractions.length} 个景点</span>
          <span>🍜 {city.restaurants.length} 家美食</span>
          <span>⭐ {must} 个必去</span>
          <span className="ml-auto font-medium text-ink">{city.suggestedDays}</span>
        </div>
      </button>
      {city.source === 'ai' && (
        <div className="absolute left-3 top-3 flex items-center gap-1">
          <Badge tone="brand" className="bg-white/90">
            <Sparkles size={10} /> AI 生成
          </Badge>
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute right-3 bottom-3 hidden rounded-lg bg-white p-1.5 text-muted shadow hover:text-red-600 group-hover:block"
          aria-label="删除 AI 城市"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}
