import { Ban, BatteryLow, Check, ChevronDown, CloudRain, Hourglass } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { City, TripPlan } from '../types'
import { contingenciesOf, type Contingency, type PlanOption } from '../lib/contingency'
import { tierOf } from '../lib/planner'
import { track } from '../lib/track'
import { DiffLines, TierBadge } from './ChangeViews'
import { DAY_COLORS } from './MapView'
import { Button } from './ui'

/** 一个方案：标题、前提、代价，以及「采用」 */
function OptionCard({ option, recommended, onApply }: { option: PlanOption; recommended: boolean; onApply: (next: TripPlan) => void }) {
  const next = option.next
  return (
    <div className={`rounded-xl border bg-paper/60 p-3 ${recommended ? 'border-teal/40' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">
            {recommended && <span className="mr-1.5 rounded bg-teal-soft px-1.5 py-0.5 text-[11px] font-medium text-teal">首选</span>}
            {option.title}
          </div>
          {option.why && <div className="mt-0.5 text-xs text-muted">{option.why}</div>}
        </div>
        {next ? (
          <Button size="sm" variant={recommended ? 'teal' : 'secondary'} className="no-print shrink-0" onClick={() => onApply(next)}>
            <Check size={13} /> 采用
          </Button>
        ) : (
          <span className="shrink-0 rounded-md bg-ink/5 px-2 py-1 text-[11px] text-muted">不用改行程</span>
        )}
      </div>
      <div className="mt-2">
        <DiffLines lines={option.lines} />
      </div>
    </div>
  )
}

/** 一种状况：触发条件、现状、按推荐顺序排列的方案 */
export function ContingencyBody({ c, onApply }: { c: Contingency; onApply: (next: TripPlan) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {c.facts.length > 0 && (
        <ul className="space-y-0.5 text-[13px] text-ink/85">
          {c.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {c.note && <div className="rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">{c.note}</div>}
      {c.options.map((o, i) => (
        <OptionCard key={o.key} option={o} recommended={i === 0 && c.options.length > 1} onApply={onApply} />
      ))}
    </div>
  )
}

function Card({ icon, title, when, children }: { icon: ReactNode; title: string; when: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper text-ink">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          <div className="text-xs text-muted">什么时候用：{when}</div>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 针对某一站的预案：折叠成一行，展开看方案 */
function StopRow({ c, plan, hint, onApply }: { c: Contingency; plan: TripPlan; hint: string; onApply: (next: TripPlan) => void }) {
  return (
    <details className="group rounded-xl border border-line bg-white" onToggle={(e) => e.currentTarget.open && track('intent', 'backup-row')}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-ink">{c.title.replace(/ (去不了|排队太久)$/, '')}</span>
          {c.stopId && <TierBadge tier={tierOf(plan.params, c.stopId)} />}
          <span className="text-xs text-muted">{hint}</span>
        </div>
        <ChevronDown size={15} className="shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-line p-3">
        <ContingencyBody c={c} onApply={onApply} />
      </div>
    </details>
  )
}

function blockedHint(c: Contingency): string {
  const alts = c.options.filter((o) => o.key.startsWith('alt:')).length
  const moves = c.options.filter((o) => o.key.startsWith('move:') || o.key.startsWith('swap:')).length
  const parts = [alts ? `${alts} 个替代` : '', moves ? '可以换天' : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : '只能砍掉'
}

export function ContingencyTab({
  city,
  plan,
  dayIdx,
  onDayChange,
  onApply,
}: {
  city: City
  plan: TripPlan
  dayIdx: number
  onDayChange: (i: number) => void
  onApply: (next: TripPlan) => void
}) {
  const all = useMemo(() => contingenciesOf(city, plan, dayIdx), [city, plan, dayIdx])
  const day = plan.days[dayIdx]
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-white/70 p-4 text-sm text-ink/85">
        出发前先看一眼：出状况时怎么改、要付出什么代价。<span className="text-muted">下不下雨、排不排队由你说了算，途迹不接天气和排队数据；时间按直线距离估算，只看量级。必去的点不会被自动换掉或砍掉。</span>
      </div>

      <div className="no-print flex gap-2 overflow-x-auto pb-1 tj-scroll">
        {plan.days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onClick={() => onDayChange(i)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${i === dayIdx ? 'border-transparent text-white shadow' : 'border-line bg-white text-ink hover:border-ink/30'}`}
            style={i === dayIdx ? { background: DAY_COLORS[i % DAY_COLORS.length] } : undefined}
          >
            <div className="text-xs font-bold">Day {d.day}</div>
            <div className={`mt-0.5 max-w-[9rem] truncate text-[11px] ${i === dayIdx ? 'text-white/85' : 'text-muted'}`}>{d.title}</div>
          </button>
        ))}
      </div>

      {day && (
        <>
          <Card icon={<CloudRain size={18} />} title={`Day ${day.day} 下雨`} when={all.rain.when}>
            <ContingencyBody c={all.rain} onApply={onApply} />
          </Card>

          <Card icon={<BatteryLow size={18} />} title={`Day ${day.day} 走不动了`} when={all.tired.when}>
            <ContingencyBody c={all.tired} onApply={onApply} />
          </Card>

          <Card icon={<Ban size={18} />} title="某个点去不了" when="临时闭馆、限流、没约上票">
            {all.blocked.length === 0 ? (
              <div className="text-sm text-muted">这一天没排景点。</div>
            ) : (
              <div className="flex flex-col gap-2">
                {all.blocked.map((c) => (
                  <StopRow key={c.stopId} c={c} plan={plan} hint={blockedHint(c)} onApply={onApply} />
                ))}
              </div>
            )}
          </Card>

          <Card icon={<Hourglass size={18} />} title="某个点排队太久" when="到了发现要排很久">
            {all.queue.length === 0 ? (
              <div className="text-sm text-muted">这一天没排景点。</div>
            ) : (
              <div className="flex flex-col gap-2">
                {all.queue.map((c) => (
                  <StopRow key={c.stopId} c={c} plan={plan} hint={(c.facts[0] ?? '').replace(/（.*）$/, '').replace(/：.*$/, '')} onApply={onApply} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
