import { AlertTriangle, Backpack, CalendarCheck, Lightbulb, Sun, TrainFront } from 'lucide-react'
import type { City, TripPlan } from '../types'
import { attractionIdsOfDay } from '../lib/planner'
import { Card } from './ui'

function packingList(city: City, plan: TripPlan): string[] {
  const items = ['身份证 / 护照', '手机 + 充电宝 + 充电线', '舒服的步行鞋（每天 1-2 万步）', '保温杯或水壶', '纸巾、湿巾、创可贴', '常用药（肠胃药、感冒药）']
  const days = plan.days.length
  if (days >= 2) items.push(`换洗衣物 ${days - 1} 套、洗漱包`)
  const season = city.bestSeason
  if (/冬|雪|冷|12|1 月|一月/.test(season)) items.push('保暖外套、帽子手套、暖宝宝')
  if (/夏|热|雨|7|8/.test(season)) items.push('防晒霜、遮阳帽、折叠雨伞、驱蚊液')
  if (/春|秋/.test(season)) items.push('一件薄外套（早晚温差大）')
  if (plan.days.some((d) => d.isSuburb)) items.push('远郊日：零食干粮、登山鞋、防晒')
  const ids = new Set(plan.days.flatMap(attractionIdsOfDay))
  const inPlan = city.attractions.filter((a) => ids.has(a.id))
  if (inPlan.some((a) => a.category === '宗教')) items.push('进寺庙 / 教堂：遮肩膀的衣物')
  if (inPlan.some((a) => a.category === '博物馆艺术')) items.push('博物馆：提前预约截图、学生证')
  if (inPlan.some((a) => a.bestTime === 'night')) items.push('夜景日：三脚架或稳定器（可选）')
  items.push('充足的手机流量 / 离线地图')
  return items
}

export function TipsTab({ city, plan }: { city: City; plan: TripPlan }) {
  const ids = new Set(plan.days.flatMap(attractionIdsOfDay))
  const bookings = plan.days.flatMap((d) =>
    d.stops
      .filter((s) => s.kind === 'attraction')
      .map((s) => ({ day: d.day, a: city.attractions.find((a) => a.id === s.id)! }))
      .filter((x) => x.a?.needBooking),
  )
  void ids
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TipCard icon={<Sun className="text-amber-500" />} title="最佳季节">
        <p>{city.bestSeason}</p>
      </TipCard>
      <TipCard icon={<CalendarCheck className="text-brand" />} title="预约清单">
        {bookings.length ? (
          <ul className="space-y-1">
            {bookings.map(({ day, a }) => (
              <li key={a.id} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-brand" />
                <span>
                  <span className="font-medium text-ink">Day {day} · {a.name}</span>
                  <span className="text-muted"> — {a.tips.find((t) => /预约|预订|购票|小程序|公众号/.test(t)) ?? '需提前预约'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">这次行程里的景点都不需要提前预约 🎉</p>
        )}
      </TipCard>
      <TipCard icon={<TrainFront className="text-teal" />} title="交通">
        <ul className="list-disc space-y-1 pl-4">
          {city.transportTips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </TipCard>
      <TipCard icon={<Lightbulb className="text-yellow-500" />} title="实用贴士">
        <ul className="list-disc space-y-1 pl-4">
          {city.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </TipCard>
      <TipCard icon={<AlertTriangle className="text-red-500" />} title="避雷">
        <ul className="list-disc space-y-1 pl-4">
          {city.avoid.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </TipCard>
      <TipCard icon={<Backpack className="text-emerald-600" />} title="打包清单">
        <ul className="grid gap-1 sm:grid-cols-2">
          {packingList(city, plan).map((t) => (
            <li key={t} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-brand" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </TipCard>
    </div>
  )
}

function TipCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper">{icon}</span>
        <h3 className="font-bold text-ink">{title}</h3>
      </div>
      <div className="mt-3 text-[13px] leading-relaxed text-ink/85">{children}</div>
    </Card>
  )
}
