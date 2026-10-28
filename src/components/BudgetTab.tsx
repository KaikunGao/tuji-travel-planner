import type { City, TripPlan } from '../types'
import { formatMoney } from '../lib/format'
import { planTotals } from '../lib/planner'
import type { Settings } from '../lib/storage'
import { SectionTitle } from './ui'

export function BudgetTab({ city, plan, settings, onSettingsChange }: { city: City; plan: TripPlan; settings: Settings; onSettingsChange: (s: Settings) => void }) {
  const totals = planTotals(plan)
  const perPerson = totals.tickets + totals.food + totals.transport
  const nights = Math.max(0, plan.days.length - 1)
  const hotel = settings.hotelPerNight * nights
  const grand = perPerson * settings.people + hotel
  void city

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="预算估算" sub="门票按成人票、餐饮按人均、交通按市内出行估算；不含往返大交通" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="每人门票" value={formatMoney(totals.tickets)} note={`${totals.attractions} 个景点`} />
        <Stat label="每人餐饮" value={formatMoney(totals.food)} note={`${totals.meals} 顿正餐 / 小吃`} />
        <Stat label="每人市内交通" value={formatMoney(totals.transport)} note={`约 ${totals.distanceKm} 公里`} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">天</th>
              <th className="px-4 py-2 font-medium text-right">门票</th>
              <th className="px-4 py-2 font-medium text-right">餐饮</th>
              <th className="px-4 py-2 font-medium text-right">交通</th>
              <th className="px-4 py-2 font-medium text-right">小计 / 人</th>
            </tr>
          </thead>
          <tbody>
            {plan.days.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink">Day {d.day}</div>
                  <div className="text-xs text-muted">{d.title}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(d.cost.tickets)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(d.cost.food)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(d.cost.transport)}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{formatMoney(d.cost.tickets + d.cost.food + d.cost.transport)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line bg-paper/60 font-semibold text-ink">
              <td className="px-4 py-2.5">合计 / 人</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(totals.tickets)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(totals.food)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(totals.transport)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-brand">{formatMoney(perPerson)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">出行人数</span>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.people}
              onChange={(e) => onSettingsChange({ ...settings, people: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">住宿 / 每晚（整间，可选）</span>
            <input
              type="number"
              min={0}
              step={50}
              value={settings.hotelPerNight}
              onChange={(e) => onSettingsChange({ ...settings, hotelPerNight: Math.max(0, Number(e.target.value) || 0) })}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="rounded-xl bg-brand-soft p-3">
            <div className="text-xs text-brand-dark">{settings.people} 人 · {plan.days.length} 天{nights ? ` · ${nights} 晚` : ''} 总预算</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-brand-dark">{formatMoney(grand)}</div>
            {hotel > 0 && <div className="text-[11px] text-brand-dark/80">含住宿 {formatMoney(hotel)}</div>}
          </div>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        <li>门票为旺季成人票价格参考，学生 / 老人 / 淡季通常有折扣；免费景点可能仍需预约。</li>
        <li>餐饮按每家餐厅人均估算，小吃与饮品另计；大吃大喝建议上浮 30%。</li>
        <li>交通按地铁 / 短途打车估算，远郊一日游若包车费用会更高。</li>
      </ul>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{note}</div>
    </div>
  )
}
