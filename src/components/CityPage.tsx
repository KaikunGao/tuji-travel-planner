import { ArrowLeft, Ban, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { City, PlanParams } from '../types'
import type { TileSource } from '../lib/storage'
import { INTEREST_EMOJI, formatDuration } from '../lib/format'
import { isSuburb } from '../lib/planner'
import { MapView } from './MapView'
import { PlanForm } from './PlanForm'
import { Badge, Button, Card, SectionTitle, Stars } from './ui'

export function CityPage({
  city,
  params,
  onChangeParams,
  onGenerate,
  onBack,
  tileSource,
  amapKey,
}: {
  city: City
  params: PlanParams
  onChangeParams: (p: PlanParams) => void
  onGenerate: () => void
  onBack: () => void
  tileSource: TileSource
  amapKey?: string
}) {
  const must = useMemo(() => new Set(params.mustInclude), [params.mustInclude])
  const excluded = useMemo(() => new Set(params.exclude), [params.exclude])
  const [focus, setFocus] = useState<string | null>(null)

  const toggleMust = (id: string) =>
    onChangeParams({
      ...params,
      mustInclude: must.has(id) ? params.mustInclude.filter((x) => x !== id) : [...params.mustInclude, id],
      exclude: params.exclude.filter((x) => x !== id),
    })
  const toggleExclude = (id: string) =>
    onChangeParams({
      ...params,
      exclude: excluded.has(id) ? params.exclude.filter((x) => x !== id) : [...params.exclude, id],
      mustInclude: params.mustInclude.filter((x) => x !== id),
    })

  const sorted = useMemo(
    () => [...city.attractions].sort((a, b) => Number(isSuburb(a, city)) - Number(isSuburb(b, city)) || Number(b.mustSee) - Number(a.mustSee) || b.rating - a.rating),
    [city],
  )

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> 换个城市
      </button>

      {/* 头图 */}
      <section className="mt-3 overflow-hidden rounded-3xl text-white" style={{ background: `linear-gradient(120deg, ${city.gradient[0]}, ${city.gradient[1]})` }}>
        <div className="flex flex-col gap-4 px-6 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-10">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/70">{city.nameEn}</div>
            <h1 className="mt-1 text-4xl font-extrabold tracking-tight">
              {city.emoji} {city.name}
            </h1>
            <p className="mt-2 text-white/85">{city.tagline}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:text-right">
            <div>
              <div className="text-white/60">建议天数</div>
              <div className="font-bold">{city.suggestedDays}</div>
            </div>
            <div>
              <div className="text-white/60">最佳季节</div>
              <div className="font-bold leading-snug">{city.bestSeason.split(/[；;，,]/)[0]}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* 表单 */}
        <Card className="h-fit p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto tj-scroll">
          <SectionTitle title="行程偏好" sub="都可以之后再调" className="mb-5" />
          <PlanForm city={city} value={params} onChange={onChangeParams} onSubmit={onGenerate} amapKey={amapKey} />
        </Card>

        {/* 景点 */}
        <div className="flex flex-col gap-4">
          <Card className="relative h-64 overflow-hidden sm:h-80">
            <MapView
              city={city}
              tileSource={tileSource}
              mode="overview"
              mustInclude={must}
              excluded={excluded}
              selectedId={focus}
              onSelect={(id) => setFocus(id)}
              startPoint={params.startPoint ?? null}
              onMapClick={(p) => onChangeParams({ ...params, startPoint: { lat: p.lat, lng: p.lng, name: `地图选点（${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}）` } })}
            />
            <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-muted shadow backdrop-blur">
              {params.startPoint ? `🏠 出发点：${params.startPoint.name}` : '点击地图任意位置可设为每天的出发点'}
            </div>
          </Card>
          <SectionTitle
            title={`${city.attractions.length} 个景点`}
            sub="点 ★ 设为必去、点 ⊘ 排除；不点就由算法按兴趣和评分挑选"
            right={
              (params.mustInclude.length > 0 || params.exclude.length > 0) && (
                <Button variant="ghost" size="sm" onClick={() => onChangeParams({ ...params, mustInclude: [], exclude: [] })}>
                  重置选择
                </Button>
              )
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.map((a) => {
              const isMust = must.has(a.id)
              const isEx = excluded.has(a.id)
              const sub = isSuburb(a, city)
              return (
                <div
                  key={a.id}
                  id={`spot-${a.id}`}
                  onMouseEnter={() => setFocus(a.id)}
                  className={`relative rounded-2xl border bg-white p-4 shadow-card transition ${isMust ? 'border-brand ring-2 ring-brand/20' : isEx ? 'border-line opacity-55' : 'border-line'} ${focus === a.id ? 'ring-2 ring-teal/30' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-xl">{INTEREST_EMOJI[a.category]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="font-bold leading-tight text-ink">{a.name}</h3>
                        {a.mustSee && <Badge tone="brand">必去</Badge>}
                        {sub && <Badge tone="teal">远郊</Badge>}
                        {a.needBooking && <Badge tone="warn">需预约</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <Stars rating={a.rating} size="xs" />
                        <span>· {a.area}</span>
                        <span>· {formatDuration(a.duration)}</span>
                        <span>· {a.price ? `¥${a.price}` : '免费'}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink/80">{a.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleMust(a.id)}
                      className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium ${isMust ? 'border-brand bg-brand text-white' : 'border-line text-ink hover:border-brand hover:text-brand'}`}
                    >
                      <Star size={13} fill={isMust ? 'currentColor' : 'none'} /> {isMust ? '已设必去' : '必去'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExclude(a.id)}
                      className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium ${isEx ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:border-ink hover:text-ink'}`}
                    >
                      <Ban size={13} /> {isEx ? '已排除' : '不去'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
