import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Coffee, GripVertical, Home, Plus, RefreshCw, Repeat, Sparkles, X } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Attraction, City, DayPlan, Leg, Restaurant, ScheduleStop, TripPlan } from '../types'
import { INTEREST_EMOJI, MEAL_LABEL, TRANSPORT_LABEL, formatDateCN, formatDuration, formatKm, formatMoney, minutesToHHMM } from '../lib/format'
import { haversine } from '../lib/geo'
import { addAttraction, attractionIdsOfDay, mealAlternatives, moveAttraction, nearbyRestaurants, optimizeDay, pinnedMealsOf, rebuildDay, removeAttraction, replaceMeal } from '../lib/planner'
import { DAY_COLORS } from './MapView'
import { cuisineEmoji, xhsSearchUrl } from './RestaurantCard'
import { Badge, Button, Modal, Stars } from './ui'

interface Props {
  city: City
  plan: TripPlan
  dayIdx: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onPlanChange: (p: TripPlan) => void
  onOpenRestaurant: (r: Restaurant, subtitle?: string) => void
}

export function DayTimeline({ city, plan, dayIdx, selectedId, onSelect, onPlanChange, onOpenRestaurant }: Props) {
  const day = plan.days[dayIdx]
  const color = DAY_COLORS[dayIdx % DAY_COLORS.length]
  const [adding, setAdding] = useState(false)
  const attractionIds = attractionIdsOfDay(day)
  const inPlan = useMemo(() => new Set(plan.days.flatMap((d) => attractionIdsOfDay(d))), [plan])
  const addable = useMemo(
    () => city.attractions.filter((a) => !inPlan.has(a.id) && !plan.params.exclude.includes(a.id) && (day.isSuburb ? true : !a.suburb)),
    [city, inPlan, plan.params.exclude, day.isSuburb],
  )
  const breakfast = day.breakfastId ? city.restaurants.find((r) => r.id === day.breakfastId) : undefined
  const totalCost = day.cost.tickets + day.cost.food + day.cost.transport
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = attractionIds.indexOf(String(active.id))
    const to = attractionIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onPlanChange(rebuildDay(city, plan, dayIdx, arrayMove(attractionIds, from, to), false, pinnedMealsOf(day)))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 当天概览 */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 items-center rounded-lg px-2 text-xs font-bold text-white" style={{ background: color }}>
                Day {day.day}
              </span>
              {day.date && <span className="text-xs text-muted">{formatDateCN(day.date)}</span>}
              {day.isSuburb && <Badge tone="teal">远郊一日游</Badge>}
            </div>
            <h3 className="mt-2 text-xl font-extrabold tracking-tight text-ink">{day.title}</h3>
            <div className="mt-0.5 text-sm text-muted">{day.theme}</div>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-right text-xs text-muted sm:grid-cols-3">
            <div>
              <div>时间</div>
              <div className="font-semibold text-ink">{minutesToHHMM(day.startTime)}–{minutesToHHMM(day.endTime)}</div>
            </div>
            <div>
              <div>路程 / 步行</div>
              <div className="font-semibold text-ink">{formatKm(day.distanceKm)} / {formatKm(day.walkKm)}</div>
            </div>
            <div>
              <div>人均花费</div>
              <div className="font-semibold text-ink">{formatMoney(totalCost)}</div>
            </div>
          </div>
        </div>
        <div className="no-print mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onPlanChange(optimizeDay(city, plan, dayIdx))} title="重新按最短路径排序并重新挑选餐厅">
            <Sparkles size={14} /> 重新优化顺序
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={!addable.length}>
            <Plus size={14} /> 添加景点
          </Button>
        </div>
      </div>

      {/* 早餐 */}
      {breakfast && (
        <button
          type="button"
          onClick={() => onOpenRestaurant(breakfast, '早餐推荐')}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-white/70 px-4 py-3 text-left hover:border-brand"
        >
          <Coffee size={18} className="text-brand" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-ink">早餐推荐：{breakfast.name}</span>
            <span className="text-muted"> · {breakfast.cuisine} · 人均 ¥{breakfast.avgPrice}</span>
          </div>
          <span className="text-xs text-muted">在第一站附近</span>
        </button>
      )}

      {/* 时间轴 */}
      {day.stops.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 p-8 text-center text-sm text-muted">
          这一天是自由活动 🛋️ 可以点「添加景点」安排内容，或者留给购物与补漏。
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={attractionIds} strategy={verticalListSortingStrategy}>
            <ol className="relative flex flex-col">
              <StartRow label={plan.params.startPoint?.name ?? '市中心'} time={minutesToHHMM(day.startTime)} />
              {day.stops.map((s, i) => {
                const attrIndex = s.kind === 'attraction' ? attractionIds.indexOf(s.id) : -1
                if (s.kind === 'attraction') {
                  return (
                    <SortableStop key={`${s.id}-${i}`} id={s.id}>
                      {(handle) => (
                        <>
                          {s.leg && <LegRow leg={s.leg} />}
                          <AttractionStop
                            city={city}
                            stop={s}
                            index={attrIndex}
                            color={color}
                            selected={selectedId === s.id}
                            onSelect={() => onSelect(s.id)}
                            onMoveUp={attrIndex > 0 ? () => onPlanChange(moveAttraction(city, plan, dayIdx, attrIndex, attrIndex - 1)) : undefined}
                            onMoveDown={attrIndex < attractionIds.length - 1 ? () => onPlanChange(moveAttraction(city, plan, dayIdx, attrIndex, attrIndex + 1)) : undefined}
                            onRemove={() => onPlanChange(removeAttraction(city, plan, dayIdx, s.id))}
                            usedRestaurants={new Set(day.stops.filter((x) => x.kind === 'meal').map((x) => x.id))}
                            onOpenRestaurant={onOpenRestaurant}
                            dragHandle={attractionIds.length > 1 ? handle : undefined}
                          />
                        </>
                      )}
                    </SortableStop>
                  )
                }
                return (
                  <li key={`${s.id}-${i}`} className="relative">
                    {s.leg && <LegRow leg={s.leg} />}
                    <MealStop
                      city={city}
                      stop={s}
                      selected={selectedId === s.id}
                      onSelect={() => onSelect(s.id)}
                      alternatives={() => mealAlternatives(city, plan, dayIdx, i)}
                      onSwap={(rid) => onPlanChange(replaceMeal(city, plan, dayIdx, i, rid))}
                      onOpenRestaurant={onOpenRestaurant}
                    />
                  </li>
                )
              })}
              {day.returnLeg && day.returnLeg.distanceKm > 0.05 && <LegRow leg={day.returnLeg} />}
              <EndRow label={plan.params.startPoint?.name ?? '市中心'} time={minutesToHHMM(day.endTime + (day.returnLeg?.minutes ?? 0))} />
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {/* 添加景点 */}
      <Modal open={adding} onClose={() => setAdding(false)} title={`添加景点到 Day ${day.day}`} wide>
        {addable.length === 0 ? (
          <div className="text-sm text-muted">没有可添加的景点了。</div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {addable.map((a) => {
              const reason = plan.skipped.find((s) => s.id === a.id)?.reason
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onPlanChange(addAttraction(city, plan, dayIdx, a.id))
                    setAdding(false)
                  }}
                  className="flex items-start gap-3 rounded-xl border border-line bg-white p-3 text-left hover:border-brand"
                >
                  <div className="text-xl">{INTEREST_EMOJI[a.category]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-ink">{a.name}</span>
                      {a.mustSee && <Badge tone="brand">必去</Badge>}
                      {a.suburb && <Badge tone="teal">远郊</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {a.area} · {formatDuration(a.duration)} · {a.price ? `¥${a.price}` : '免费'}
                    </div>
                    {reason && <div className="mt-0.5 text-[11px] text-amber-700">未排入原因：{reason}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface DragHandle {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
}

function SortableStop({ id, children }: { id: string; children: (handle: DragHandle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.9 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} className="relative">
      {children({ attributes, listeners })}
    </li>
  )
}

function StartRow({ label, time }: { label: string; time: string }) {
  return (
    <li className="flex items-center gap-3 py-1 text-xs text-muted">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white"><Home size={13} /></span>
      <span>{time} 从 <span className="font-medium text-ink">{label}</span> 出发</span>
    </li>
  )
}

function EndRow({ label, time }: { label: string; time: string }) {
  return (
    <li className="flex items-center gap-3 py-1 text-xs text-muted">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-white"><Home size={13} /></span>
      <span>约 {time} 回到 <span className="font-medium text-ink">{label}</span>，结束今天的行程 🌙</span>
    </li>
  )
}

function LegRow({ leg }: { leg: Leg }) {
  const t = TRANSPORT_LABEL[leg.mode]
  return (
    <div className="ml-[13px] flex items-center gap-3 border-l-2 border-dashed border-line py-2 pl-5 text-xs text-muted">
      <span>{t.emoji}</span>
      <span>
        {t.name} · {formatKm(leg.distanceKm)} · 约 {leg.minutes} 分钟{leg.cost > 0 ? ` · 约 ¥${leg.cost}` : ''}
      </span>
    </div>
  )
}

function AttractionStop({
  city,
  stop,
  index,
  color,
  selected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  usedRestaurants,
  onOpenRestaurant,
  dragHandle,
}: {
  city: City
  stop: ScheduleStop
  index: number
  color: string
  selected: boolean
  onSelect: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  usedRestaurants: Set<string>
  onOpenRestaurant: (r: Restaurant, subtitle?: string) => void
  dragHandle?: DragHandle
}) {
  const a = city.attractions.find((x) => x.id === stop.id) as Attraction | undefined
  const [expanded, setExpanded] = useState(false)
  if (!a) return null
  const nearby = nearbyRestaurants(city, a, 1.2, usedRestaurants).slice(0, 4)
  return (
    <div
      id={`stop-${stop.id}`}
      onClick={onSelect}
      className={`relative rounded-2xl border bg-white p-4 shadow-card transition ${selected ? 'border-brand ring-2 ring-brand/20' : 'border-line'}`}
    >
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white shadow" style={{ background: color }}>
            {index + 1}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold tabular-nums text-brand">
                {minutesToHHMM(stop.start)} – {minutesToHHMM(stop.end)}
                <span className="ml-1.5 font-normal text-muted">· {formatDuration(a.duration)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="text-base font-bold leading-tight text-ink">
                  {INTEREST_EMOJI[a.category]} {a.name}
                </h4>
                {a.mustSee && <Badge tone="brand">必去</Badge>}
                {a.needBooking && <Badge tone="warn">需预约</Badge>}
                {a.closedOn && a.closedOn.length > 0 && <Badge tone="muted">{a.closedOn.map((d) => '日一二三四五六'[d]).map((d) => `周${d}`).join('、')}闭馆</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <Stars rating={a.rating} size="xs" />
                <span>· {a.area}</span>
                <span>· {a.price ? `门票 ¥${a.price}` : '免费'}</span>
                <span>· {a.openHours}</span>
              </div>
            </div>
            <div className="no-print flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              {dragHandle && (
                <button
                  type="button"
                  title="拖动调整顺序"
                  className="touch-none cursor-grab rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink active:cursor-grabbing"
                  {...dragHandle.attributes}
                  {...dragHandle.listeners}
                >
                  <GripVertical size={14} />
                </button>
              )}
              <IconBtn onClick={onMoveUp} title="上移"><ArrowUp size={14} /></IconBtn>
              <IconBtn onClick={onMoveDown} title="下移"><ArrowDown size={14} /></IconBtn>
              <IconBtn onClick={onRemove} title="从行程移除" danger><X size={14} /></IconBtn>
            </div>
          </div>

          {stop.warning && <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">⚠️ {stop.warning}</div>}
          {stop.note && <div className="mt-2 rounded-lg bg-teal-soft px-2.5 py-1.5 text-xs text-teal">ℹ️ {stop.note}</div>}

          <p className={`mt-2 text-[13px] leading-relaxed text-ink/80 ${expanded ? '' : 'line-clamp-2'}`}>{a.description}</p>
          <div className="mt-2 rounded-xl bg-paper px-3 py-2 text-[13px] text-ink/90">
            <span className="font-medium">💡 </span>
            {expanded ? (
              <ul className="list-disc space-y-1 pl-4">
                {a.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {a.photoSpots?.length ? <li>📸 机位：{a.photoSpots.join('、')}</li> : null}
              </ul>
            ) : (
              <span>{a.tips[0]}</span>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className="mt-1.5 inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink"
          >
            {expanded ? <>收起 <ChevronUp size={12} /></> : <>更多贴士 <ChevronDown size={12} /></>}
          </button>

          {nearby.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">附近美食：</span>
              {nearby.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenRestaurant(r, `${a.name} 附近 · ${formatKm(haversine(a, r))}`)
                  }}
                  className="rounded-full border border-line bg-white px-2 py-0.5 text-ink hover:border-xhs hover:text-xhs"
                >
                  {cuisineEmoji(r.cuisine)} {r.name.replace(/（.*?）/g, '')}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MealStop({
  city,
  stop,
  selected,
  onSelect,
  alternatives,
  onSwap,
  onOpenRestaurant,
}: {
  city: City
  stop: ScheduleStop
  selected: boolean
  onSelect: () => void
  alternatives: () => Restaurant[]
  onSwap: (restaurantId: string) => void
  onOpenRestaurant: (r: Restaurant, subtitle?: string) => void
}) {
  const r = city.restaurants.find((x) => x.id === stop.id)
  const [swapping, setSwapping] = useState(false)
  if (!r) return null
  const label = MEAL_LABEL[stop.mealType ?? 'lunch']
  const alts = swapping ? alternatives() : []
  return (
    <div
      id={`stop-${stop.id}`}
      onClick={onSelect}
      className={`rounded-2xl border border-dashed bg-[#fffaf7] p-4 transition ${selected ? 'border-xhs ring-2 ring-xhs/15' : 'border-brand/40'}`}
    >
      <div className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-white text-base">{cuisineEmoji(r.cuisine)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold tabular-nums text-brand">
                {minutesToHHMM(stop.start)} – {minutesToHHMM(stop.end)} <span className="ml-1 rounded bg-brand-soft px-1.5 py-0.5 text-[11px]">{label}</span>
              </div>
              <h4 className="mt-0.5 text-base font-bold leading-tight text-ink">{r.name}</h4>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <Stars rating={r.rating} size="xs" />
                <span>· {r.cuisine}</span>
                <span>· 人均 ¥{r.avgPrice}</span>
                {r.waitTime && <span className="text-amber-700">· ⏳ {r.waitTime}</span>}
              </div>
            </div>
            <div className="no-print flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => setSwapping((v) => !v)} title="换一家">
                <Repeat size={13} /> 换一家
              </Button>
            </div>
          </div>
          <div className="mt-1.5 text-[13px] text-ink/85">
            <span className="font-medium text-ink">必点：</span>
            {r.mustOrder.slice(0, 4).join(' · ')}
          </div>
          {r.warning && <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">⚠️ {r.warning}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {r.tags.slice(0, 4).map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenRestaurant(r, label)
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-xhs hover:underline"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-xhs text-[9px] font-bold text-white">评</span>
              查看综合评价
            </button>
            <a
              href={xhsSearchUrl(r.name)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-xhs hover:underline"
            >
              去小红书看真实笔记 ↗
            </a>
          </div>

          {swapping && (
            <div className="mt-3 rounded-xl border border-line bg-white p-2" onClick={(e) => e.stopPropagation()}>
              <div className="px-1 pb-1 text-[11px] text-muted">顺路且评分高的其他选择（{alts.length}）</div>
              {alts.length === 0 && <div className="px-1 py-2 text-xs text-muted">附近没有其他合适的餐厅了</div>}
              <div className="max-h-56 overflow-y-auto tj-scroll">
                {alts.map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => {
                      onSwap(alt.id)
                      setSwapping(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
                  >
                    <span>{cuisineEmoji(alt.cuisine)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{alt.name}</span>
                    <span className="shrink-0 text-xs text-muted">{alt.cuisine} · ¥{alt.avgPrice} · ★{alt.rating}</span>
                    <RefreshCw size={12} className="shrink-0 text-muted" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IconBtn({ onClick, title, children, danger }: { onClick?: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      className={`rounded-md p-1.5 transition disabled:opacity-25 ${danger ? 'text-muted hover:bg-red-50 hover:text-red-600' : 'text-muted hover:bg-ink/5 hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

export function dayLabel(day: DayPlan): string {
  return `Day ${day.day}`
}
