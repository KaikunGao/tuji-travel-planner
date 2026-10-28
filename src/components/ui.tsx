import { X } from 'lucide-react'
import { useEffect, type ReactNode, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm shadow-brand/30',
  teal: 'bg-teal text-white hover:bg-teal/90 shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:border-ink/30 hover:bg-paper',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-ink/5',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
}
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1',
  md: 'h-10 px-4 text-sm rounded-xl gap-1.5',
  lg: 'h-12 px-6 text-base rounded-2xl gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Chip({
  active,
  onClick,
  children,
  className = '',
  title,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors select-none ${
        active ? 'border-brand bg-brand-soft text-brand-dark font-medium' : 'border-line bg-white text-ink hover:border-ink/30'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'} ${className}`}
    >
      {children}
    </button>
  )
}

type Tone = 'brand' | 'teal' | 'muted' | 'xhs' | 'warn' | 'green' | 'gold'
const TONE: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-dark',
  teal: 'bg-teal-soft text-teal',
  muted: 'bg-ink/5 text-muted',
  xhs: 'bg-xhs/10 text-xhs',
  warn: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  gold: 'bg-yellow-100 text-yellow-800',
}

export function Badge({ children, tone = 'muted', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONE[tone]} ${className}`}>{children}</span>
}

export function Card({ children, className = '', id, onClick }: { children: ReactNode; className?: string; id?: string; onClick?: () => void }) {
  return (
    <div id={id} onClick={onClick} className={`rounded-2xl border border-line bg-white shadow-card ${className}`}>
      {children}
    </div>
  )
}

export function Stars({ rating, size = 'sm', showNumber = true }: { rating: number; size?: 'sm' | 'xs'; showNumber?: boolean }) {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <span className={`inline-flex items-center gap-0.5 text-amber-500 ${size === 'xs' ? 'text-[11px]' : 'text-xs'}`} title={`${rating} 分`}>
      <span className="tracking-tight" aria-hidden>
        {'★'.repeat(full)}
        {half ? '☆' : ''}
        <span className="text-line">{'★'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}</span>
      </span>
      {showNumber && <span className="ml-0.5 font-semibold text-ink">{rating.toFixed(1)}</span>}
    </span>
  )
}

export function SectionTitle({ title, sub, right, className = '' }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div>
        <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-paper shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
          <div className="text-base font-bold text-ink">{title}</div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ emoji, title, desc, action }: { emoji: string; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      <div className="text-4xl">{emoji}</div>
      <div className="mt-3 font-semibold text-ink">{title}</div>
      {desc && <div className="mt-1 max-w-sm text-sm text-muted">{desc}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
