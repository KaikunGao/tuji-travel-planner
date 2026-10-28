import { ArrowLeft, CalendarPlus, Check, Copy, Download, GitCompare, Link2, Map as MapIcon, Printer, Save, Share2, X } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import type { City, PlanVariant, Restaurant, TripPlan } from '../types'
import { copyText, downloadText, planToMarkdown } from '../lib/export'
import { INTEREST_EMOJI, PACE_LABEL, formatKm, formatMoney, minutesToHHMM } from '../lib/format'
import { downloadIcs, planToIcs } from '../lib/ics'
import { VARIANT_LABEL, addAttraction, planTotals, planTrip } from '../lib/planner'
import { encodeShare, shareUrl } from '../lib/share'
import type { Settings } from '../lib/storage'
import { BudgetTab } from './BudgetTab'
import { DayTimeline } from './DayTimeline'
import { FoodTab } from './FoodTab'
import { DAY_COLORS, MapView } from './MapView'
import { RestaurantCard } from './RestaurantCard'
import { TipsTab } from './TipsTab'
import { Badge, Button, Modal } from './ui'
type Tab = 'itinerary' | 'food' | 'budget' | 'tips'
const TABS: { id: Tab; name: string; emoji: string }[] = [
  { id: 'itinerary', name: '行程', emoji: '🗺️' },
  { id: 'food', name: '美食', emoji: '🍜' },
  { id: 'budget', name: '预算', emoji: '💰' },
  { id: 'tips', name: '贴士', emoji: '💡' },
]

export function PlanPage({
  city,
  plan,
  settings,
  onPlanChange,
  onSettingsChange,
  onBack,
  onSave,
}: {
  city: City
  plan: TripPlan
  settings: Settings
  onPlanChange: (p: TripPlan) => void
  onSettingsChange: (s: Settings) => void
  onBack: () => void
  onSave: (name: string) => void
}) {
  const [tab, setTab] = useState<Tab>('itinerary')
  const [activeDay, setActiveDay] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restaurant, setRestaurant] = useState<{ r: Restaurant; subtitle?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [mobileMap, setMobileMap] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [compareOpen, setCompareOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const totals = useMemo(() => planTotals(plan), [plan])
  const variants = useMemo(
    () => (compareOpen ? (['balanced', 'fast', 'cheap', 'max'] as PlanVariant[]).map((v) => ({ v, plan: planTrip(city, plan.params, { variant: v }) })) : []),
    [compareOpen, city, plan.params],
  )

  useEffect(() => {
    if (!shareOpen) return
    const url = shareUrl(encodeShare(city, plan, title))
    setShareLink(url)
    setQr(null)
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen])

  useEffect(() => {
    if (activeDay >= plan.days.length) setActiveDay(0)
  }, [plan.days.length, activeDay])

  useEffect(() => {
    if (!mobileMap) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileMap(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileMap])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const title = `${city.name} ${plan.days.length} 日游`
  const md = () => planToMarkdown(city, plan, settings.people)
  const handleSelectFromMap = (id: string) => {
    setSelectedId(id)
    setTab('itinerary')
    setMobileMap(false)
    requestAnimationFrame(() => document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const skipped = plan.skipped.map((s) => ({ ...s, a: city.attractions.find((a) => a.id === s.id) })).filter((s) => s.a)

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6">
      {/* 顶部 */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> 返回修改偏好
        </button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setSaveName(title); setSaving(true) }}>
            <Save size={14} /> 保存
          </Button>
          <Button variant="secondary" size="sm" onClick={async () => setToast((await copyText(md())) ? '已复制 Markdown 行程' : '复制失败，请用下载')}>
            <Copy size={14} /> 复制
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadText(`${title}-途迹.md`, md())}>
            <Download size={14} /> 下载 .md
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> 打印
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const { ics, firstDate } = planToIcs(city, plan)
              downloadIcs(`${title}-途迹.ics`, ics)
              setToast(plan.params.startDate ? '已导出日历文件，导入手机日历即可' : `未设出发日期，按 ${firstDate} 作为第一天导出`)
            }}
          >
            <CalendarPlus size={14} /> 导出日历
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
            <Share2 size={14} /> 分享
          </Button>
          <Button variant="teal" size="sm" onClick={() => setCompareOpen(true)}>
            <GitCompare size={14} /> 方案对比
          </Button>
        </div>
      </div>

      {/* 标题 */}
      <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            {city.emoji} {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone="brand">{PACE_LABEL[plan.params.pace].emoji} {PACE_LABEL[plan.params.pace].name}节奏</Badge>
            {plan.variant && plan.variant !== 'balanced' && <Badge tone="teal">{VARIANT_LABEL[plan.variant].emoji} {VARIANT_LABEL[plan.variant].name}方案</Badge>}
            {plan.params.interests.map((i) => (
              <Badge key={i}>{INTEREST_EMOJI[i]} {i}</Badge>
            ))}
            {plan.params.startDate && <Badge tone="teal">{plan.params.startDate} 出发</Badge>}
          </div>
        </div>
        <div className="flex gap-5 text-sm text-muted">
          <Stat n={totals.attractions} label="个景点" />
          <Stat n={totals.meals} label="顿美食" />
          <Stat n={formatKm(totals.distanceKm)} label="总路程" />
          <Stat n={`¥${Math.round(totals.tickets + totals.food + totals.transport)}`} label="人均预算" />
        </div>
      </header>

      {/* 建议 */}
      {plan.suggestions.length > 0 && showSuggestions && (
        <div className="no-print mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <ul className="space-y-1">
              {plan.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setShowSuggestions(false)} className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-100" aria-label="收起">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
        {/* 左侧 */}
        <div className="min-w-0">
          {/* Tabs */}
          <div className="no-print flex gap-1 rounded-2xl border border-line bg-white p-1 shadow-card">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${tab === t.id ? 'bg-ink text-white' : 'text-muted hover:bg-paper hover:text-ink'}`}
              >
                <span className="mr-1">{t.emoji}</span>
                {t.name}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'itinerary' && (
              <div className="flex flex-col gap-4">
                {/* 天 */}
                <div className="no-print flex gap-2 overflow-x-auto pb-1 tj-scroll">
                  {plan.days.map((d, i) => (
                    <button
                      key={d.day}
                      type="button"
                      onClick={() => { setActiveDay(i); setSelectedId(null) }}
                      className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${i === activeDay ? 'border-transparent text-white shadow' : 'border-line bg-white text-ink hover:border-ink/30'}`}
                      style={i === activeDay ? { background: DAY_COLORS[i % DAY_COLORS.length] } : undefined}
                    >
                      <div className="text-xs font-bold">Day {d.day}</div>
                      <div className={`mt-0.5 max-w-[9rem] truncate text-[11px] ${i === activeDay ? 'text-white/85' : 'text-muted'}`}>{d.title}</div>
                    </button>
                  ))}
                </div>
                {/* 手机端地图 */}
                <div className="lg:hidden">
                  <Button variant="secondary" size="sm" onClick={() => setMobileMap(true)}>
                    <MapIcon size={14} /> 查看地图
                  </Button>
                </div>
                {plan.days[activeDay] && (
                  <DayTimeline
                    city={city}
                    plan={plan}
                    dayIdx={activeDay}
                    selectedId={selectedId}
                    onSelect={(id) => setSelectedId(id)}
                    onPlanChange={onPlanChange}
                    onOpenRestaurant={(r, subtitle) => setRestaurant({ r, subtitle })}
                  />
                )}
                {skipped.length > 0 && (
                  <div className="no-print rounded-2xl border border-line bg-white/70 p-4">
                    <div className="text-sm font-semibold text-ink">没排进去的景点（{skipped.length}）</div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {skipped.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium text-ink">{INTEREST_EMOJI[s.a!.category]} {s.a!.name}</span>
                            <span className="ml-2 text-xs text-muted">{s.reason}</span>
                          </div>
                          {plan.days[activeDay] && (
                            <button
                              type="button"
                              onClick={() => onPlanChange(addAttraction(city, plan, activeDay, s.id))}
                              className="text-xs font-medium text-brand hover:underline"
                            >
                              + 加到 Day {plan.days[activeDay].day}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === 'food' && <FoodTab city={city} plan={plan} />}
            {tab === 'budget' && <BudgetTab city={city} plan={plan} settings={settings} onSettingsChange={onSettingsChange} />}
            {tab === 'tips' && <TipsTab city={city} plan={plan} />}
          </div>
        </div>

        {/* 右侧地图 */}
        <aside className="no-print hidden lg:block">
          <div className="sticky top-20 overflow-hidden rounded-3xl border border-line bg-white shadow-card" style={{ height: 'calc(100vh - 6.5rem)' }}>
            <MapView city={city} tileSource={settings.tileSource} mode="plan" plan={plan} activeDay={activeDay} selectedId={selectedId} onSelect={handleSelectFromMap} />
            <MapLegend plan={plan} activeDay={activeDay} onPick={(i) => { setActiveDay(i); setTab('itinerary') }} />
          </div>
        </aside>
      </div>

      {/* 手机端全屏地图 */}
      {mobileMap && (
        <div className="fixed inset-0 z-[900] flex flex-col bg-paper lg:hidden">
          <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
            <div className="font-bold text-ink">Day {plan.days[activeDay]?.day} 路线</div>
            <button type="button" onClick={() => setMobileMap(false)} className="rounded-full p-1.5 hover:bg-ink/5" aria-label="关闭">
              <X size={18} />
            </button>
          </div>
          <div className="relative flex-1">
            <MapView city={city} tileSource={settings.tileSource} mode="plan" plan={plan} activeDay={activeDay} selectedId={selectedId} onSelect={handleSelectFromMap} />
            <MapLegend plan={plan} activeDay={activeDay} onPick={setActiveDay} />
          </div>
        </div>
      )}

      {/* 餐厅详情 */}
      <Modal open={!!restaurant} onClose={() => setRestaurant(null)} title={restaurant?.subtitle ?? '美食'} wide>
        {restaurant && <RestaurantCard r={restaurant.r} defaultOpen />}
      </Modal>

      {/* 保存 */}
      <Modal open={saving} onClose={() => setSaving(false)} title="保存行程">
        <label className="block">
          <span className="text-xs font-medium text-muted">给这份行程起个名字</span>
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-brand" />
        </label>
        <p className="mt-2 text-xs text-muted">保存在本机浏览器里，下次打开首页就能看到。</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSaving(false)}>取消</Button>
          <Button
            onClick={() => {
              onSave(saveName.trim() || title)
              setSaving(false)
              setToast('已保存到「我的行程」')
            }}
          >
            <Check size={16} /> 保存
          </Button>
        </div>
      </Modal>

      {/* 方案对比 */}
      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} title="方案对比" wide>
        <p className="mb-3 text-xs text-muted">同样的偏好，按不同目标重新规划。选用后会替换当前行程（手动调整会丢失）。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {variants.map(({ v, plan: vp }) => {
            const t = planTotals(vp)
            const latest = Math.max(...vp.days.map((d) => d.endTime))
            const current = (plan.variant ?? 'balanced') === v
            return (
              <div key={v} className={`rounded-2xl border bg-white p-4 ${current ? 'border-teal ring-2 ring-teal/20' : 'border-line'}`}>
                <div className="flex items-center justify-between">
                  <div className="text-base font-bold text-ink">{VARIANT_LABEL[v].emoji} {VARIANT_LABEL[v].name}</div>
                  {current && <Badge tone="teal">当前</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">{VARIANT_LABEL[v].desc}</div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <Metric label="景点" value={`${t.attractions} 个`} />
                  <Metric label="总路程" value={formatKm(t.distanceKm)} />
                  <Metric label="人均花费" value={formatMoney(t.tickets + t.food + t.transport)} />
                  <Metric label="最晚结束" value={minutesToHHMM(latest)} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {vp.days.map((d) => (
                    <span key={d.day} className="rounded-md bg-paper px-1.5 py-0.5 text-[11px] text-muted">D{d.day} {d.title}</span>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  variant={current ? 'secondary' : 'primary'}
                  disabled={current}
                  onClick={() => {
                    onPlanChange(vp)
                    setActiveDay(0)
                    setCompareOpen(false)
                    setToast(`已切换为「${VARIANT_LABEL[v].name}」方案`)
                  }}
                >
                  {current ? '正在使用' : '选用此方案'}
                </Button>
              </div>
            )
          })}
        </div>
      </Modal>

      {/* 分享 */}
      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="分享行程">
        <p className="text-sm text-muted">把链接发给同行的人，打开就能看到这份行程（含景点顺序和餐厅）。{city.source === 'ai' ? '这是 AI 生成的城市，链接会附带完整城市数据，所以比较长。' : ''}</p>
        <div className="mt-3 flex gap-2">
          <input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-xs text-muted outline-none" />
          <Button size="sm" onClick={async () => setToast((await copyText(shareLink)) ? '链接已复制' : '复制失败，请手动选择复制')}>
            <Link2 size={14} /> 复制
          </Button>
        </div>
        {qr && (
          <div className="mt-4 flex flex-col items-center gap-1">
            <img src={qr} alt="分享二维码" className="h-44 w-44 rounded-xl border border-line bg-white p-1" />
            <div className="text-[11px] text-muted">手机扫码打开（需要能访问这台电脑的地址）</div>
          </div>
        )}
      </Modal>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">
          <Share2 size={14} className="mr-1.5 inline -mt-0.5" />
          {toast}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  )
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="text-right">
      <div className="text-xl font-extrabold tabular-nums text-ink">{n}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  )
}

function MapLegend({ plan, activeDay, onPick }: { plan: TripPlan; activeDay: number; onPick: (i: number) => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] flex flex-wrap gap-1.5">
      {plan.days.map((d, i) => (
        <button
          key={d.day}
          type="button"
          onClick={() => onPick(i)}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-white/95 px-2.5 py-1 text-xs shadow backdrop-blur ${i === activeDay ? 'border-ink font-semibold text-ink' : 'border-line text-muted'}`}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: DAY_COLORS[i % DAY_COLORS.length] }} />
          Day {d.day}
        </button>
      ))}
    </div>
  )
}
