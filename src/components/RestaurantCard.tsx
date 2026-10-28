import { ChevronDown, ChevronUp, Clock, MapPin, Wallet } from 'lucide-react'
import { useState } from 'react'
import type { Restaurant } from '../types'
import { Badge, Stars } from './ui'
import { ReviewPanel, xhsSearchUrl } from './ReviewPanel'

export { xhsSearchUrl }

export function cuisineEmoji(cuisine: string): string {
  const c = cuisine
  if (/烤鸭/.test(c)) return '🦆'
  if (/火锅|涮|串串|冒菜/.test(c)) return '🍲'
  if (/面|粉|抄手|饺|馄饨|云吞|汤圆/.test(c)) return '🍜'
  if (/小吃|早|包子|生煎|小笼|烧麦|点心|早茶/.test(c)) return '🥟'
  if (/咖啡|甜品|下午茶|烘焙|茶/.test(c)) return '☕'
  if (/海鲜|鱼|蟹|虾/.test(c)) return '🦐'
  if (/烤肉|烧烤|串/.test(c)) return '🍢'
  if (/川|湘|辣/.test(c)) return '🌶️'
  if (/西|法|意|日|韩|精致|法餐/.test(c)) return '🍷'
  if (/啤酒|酒/.test(c)) return '🍺'
  if (/粤|早茶|烧腊/.test(c)) return '🥢'
  return '🍽️'
}

const TAG_TONE = (t: string): 'brand' | 'teal' | 'muted' | 'xhs' | 'gold' | 'green' => {
  if (/必吃榜|黑珍珠|米其林/.test(t)) return 'gold'
  if (/老字号/.test(t)) return 'brand'
  if (/网红|适合拍照|氛围感|适合约会/.test(t)) return 'xhs'
  if (/本地人推荐|性价比/.test(t)) return 'green'
  if (/夜宵|夜景|夜生活/.test(t)) return 'teal'
  return 'muted'
}

export function RestaurantCard({
  r,
  subtitle,
  distanceKm,
  defaultOpen = false,
  actions,
  compact = false,
}: {
  r: Restaurant
  subtitle?: string
  distanceKm?: number
  defaultOpen?: boolean
  actions?: React.ReactNode
  compact?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const emoji = cuisineEmoji(r.cuisine)
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paper text-2xl">{emoji}</div>
        <div className="min-w-0 flex-1">
          {subtitle && <div className="text-[11px] font-medium text-brand">{subtitle}</div>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[15px] font-bold leading-tight text-ink">{r.name}</h4>
            <Stars rating={r.rating} size="xs" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{r.cuisine}</span>
            <span className="inline-flex items-center gap-0.5"><Wallet size={12} />人均 ¥{r.avgPrice}</span>
            <span className="inline-flex items-center gap-0.5"><Clock size={12} />{r.openHours}</span>
            {distanceKm !== undefined && (
              <span className="inline-flex items-center gap-0.5"><MapPin size={12} />{distanceKm < 1 ? `${Math.round(distanceKm * 1000)} 米` : `${distanceKm.toFixed(1)} 公里`}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {r.tags.slice(0, 5).map((t) => (
              <Badge key={t} tone={TAG_TONE(t)}>{t}</Badge>
            ))}
          </div>
          {!compact && (
            <div className="mt-2 text-[13px] text-ink/85">
              <span className="font-medium text-ink">必点：</span>
              {r.mustOrder.slice(0, 5).join(' · ')}
            </div>
          )}
          {r.waitTime && <div className="mt-1 text-xs text-amber-700">⏳ {r.waitTime}</div>}
          {r.warning && <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">⚠️ 避雷提示：{r.warning}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-xhs hover:underline"
      >
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-xhs text-[9px] font-bold text-white">评</span>
        {open ? '收起综合评价' : '查看综合评价'}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="mt-3">
          <ReviewPanel r={r} />
        </div>
      )}
    </div>
  )
}
