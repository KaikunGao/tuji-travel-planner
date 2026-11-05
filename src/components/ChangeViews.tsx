import { Scissors, Undo2, X } from 'lucide-react'
import type { Tier } from '../types'
import { TIER_LABEL, type CutOption, type DiffLine, type DiffTone } from '../lib/change'
import { formatDuration } from '../lib/format'
import { Badge, Button } from './ui'

const TIERS: Tier[] = ['must', 'optional', 'droppable']

const TONE_STYLE: Record<DiffTone, { mark: string; cls: string }> = {
  loss: { mark: '−', cls: 'text-red-700' },
  gain: { mark: '+', cls: 'text-emerald-700' },
  warn: { mark: '!', cls: 'text-amber-800' },
  neutral: { mark: '·', cls: 'text-ink/75' },
}

/** 三档意愿：必去 / 可选 / 可放弃 */
export function TierPicker({ value, onChange }: { value: Tier; onChange: (t: Tier) => void }) {
  return (
    <div className="no-print inline-flex overflow-hidden rounded-lg border border-line bg-white text-[11px]" onClick={(e) => e.stopPropagation()}>
      {TIERS.map((t) => (
        <button
          key={t}
          type="button"
          title={TIER_LABEL[t].desc}
          aria-pressed={value === t}
          onClick={() => value !== t && onChange(t)}
          className={`px-2 py-1 font-medium transition ${
            value !== t ? 'text-muted hover:bg-paper hover:text-ink' : t === 'must' ? 'bg-brand text-white' : t === 'droppable' ? 'bg-ink/75 text-white' : 'bg-ink/10 text-ink'
          }`}
        >
          {TIER_LABEL[t].name}
        </button>
      ))}
    </div>
  )
}

export function TierBadge({ tier }: { tier: Tier }) {
  if (tier === 'optional') return null
  return <Badge tone={tier === 'must' ? 'brand' : 'muted'}>{tier === 'must' ? '★ ' : ''}{TIER_LABEL[tier].name}</Badge>
}

/** 逐条列出一次改动的代价与收益 */
export function DiffLines({ lines }: { lines: DiffLine[] }) {
  return (
    <ul className="space-y-0.5 text-[13px] leading-relaxed">
      {lines.map((l) => (
        <li key={l.text} className={`flex gap-1.5 ${TONE_STYLE[l.tone].cls}`}>
          <span className="w-3 shrink-0 text-center font-bold">{TONE_STYLE[l.tone].mark}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** 改动之后的回执：动了什么、代价是什么，可以一键撤销 */
export function ChangeBanner({ summary, lines, onUndo, onDismiss }: { summary: string; lines: DiffLine[]; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div className="no-print rounded-2xl border border-teal/30 bg-teal-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-teal">刚才的改动</div>
          <div className="text-sm font-bold text-ink">{summary}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="secondary" onClick={onUndo}>
            <Undo2 size={13} /> 撤销
          </Button>
          <button type="button" onClick={onDismiss} className="rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="知道了">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <DiffLines lines={lines} />
      </div>
    </div>
  )
}

/** 砍掉某个点之前先看代价 */
export function CutPreview({ option, lines, onConfirm, onCancel }: { option: CutOption; lines: DiffLine[]; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="no-print mt-3 rounded-xl border border-line bg-paper p-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-sm font-semibold text-ink">砍掉「{option.a.name}」会怎样</div>
      {option.tier === 'must' && <div className="mt-1 text-xs text-red-700">这是你标的必去。砍掉它等于改了硬约束，确定吗？</div>}
      <div className="mt-2">
        <DiffLines lines={lines} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="danger" onClick={onConfirm}>
          <Scissors size={13} /> 确认砍掉
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          先不砍
        </Button>
      </div>
    </div>
  )
}

/** 这一天想轻松点：按「先砍谁」列出每个可砍的点和各自的代价 */
export function CutOptionsPanel({
  options,
  linesOf,
  onCut,
  onClose,
}: {
  options: CutOption[]
  linesOf: (o: CutOption) => DiffLine[]
  onCut: (o: CutOption) => void
  onClose: () => void
}) {
  return (
    <div className="no-print rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink">想轻松点，先砍谁</div>
          <div className="mt-0.5 text-xs text-muted">必去不会出现在这里；你标了「可放弃」的排最前，其余按损失从小到大。时间按直线距离估算，只看量级。</div>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="收起">
          <X size={14} />
        </button>
      </div>
      {options.length === 0 ? (
        <div className="mt-3 text-sm text-muted">这一天没有可砍的点（都是必去，或者还没排景点）。先把某个点改成「可选」或「可放弃」再来。</div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((o) => (
            <div key={o.a.id} className="rounded-xl border border-line bg-paper/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-ink">{o.a.name}</span>
                  <TierBadge tier={o.tier} />
                  {o.savedMinutes > 0 && <span className="text-xs text-emerald-700">腾出约 {formatDuration(o.savedMinutes)}</span>}
                </div>
                <Button size="sm" variant="secondary" onClick={() => onCut(o)}>
                  <Scissors size={13} /> 砍掉它
                </Button>
              </div>
              <div className="mt-2">
                <DiffLines lines={linesOf(o)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
