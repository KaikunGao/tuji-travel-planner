import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../lib/export'
import { SOURCE_LABEL, clearEvents, loadEvents, summarize, summaryText, toEpisodes } from '../lib/track'
import { Badge, Button } from './ui'

/** 改动轮次统计：北极星指标（改成一次平均几轮）和护栏指标（放弃率、撤销次数） */
export function TrackPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [events, setEvents] = useState(loadEvents)
  const s = summarize(events)
  const episodes = toEpisodes(events)
    .filter((e) => e.kind !== '进度')
    .slice(-12)
    .reverse()
  const abandonRate = s.total ? Math.round((s.abandoned / s.total) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted">
        一轮 = 一次和改动有关的操作（打开入口、确认、取消、撤销）；一次变更 = 从第一个入口操作到改动落定。行中打卡不算改行程。数据只存在这台设备的浏览器里。
      </p>

      {s.total === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white/60 p-6 text-center text-sm text-muted">还没有记录。去行程页砍一个点、换一个点试试。</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="改成一次平均" value={`${s.avgRounds.toFixed(1)} 轮`} good={s.done > 0 && s.avgRounds <= 2} note="目标 ≤ 2" />
            <Stat label="2 轮以内完成" value={`${Math.round(s.within2 * 100)}%`} note={`共改成 ${s.done} 次`} />
            <Stat label="放弃率" value={`${abandonRate}%`} note={`${s.abandoned} / ${s.total} 次`} />
            <Stat label="平均耗时" value={`${Math.round(s.avgSeconds)} 秒`} note={`撤销 ${s.undos} 次`} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Breakdown title="按改动类型" rows={s.byKind.map((k) => ({ name: k.kind, count: k.count, avgRounds: k.avgRounds }))} />
            <Breakdown title="按入口" rows={s.bySource.map((k) => ({ name: SOURCE_LABEL[k.source] ?? k.source, count: k.count, avgRounds: k.avgRounds }))} />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink">最近的变更</div>
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              {episodes.map((e) => (
                <div key={e.start} className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs last:border-b-0">
                  <span className="tabular-nums text-muted">{new Date(e.start).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {SOURCE_LABEL[e.source] ?? e.source}
                    {e.kind ? ` · ${e.kind}` : ''}
                  </span>
                  <span className="tabular-nums text-ink">{e.rounds} 轮</span>
                  <span className="w-12 text-right tabular-nums text-muted">{Math.round((e.end - e.start) / 1000)} 秒</span>
                  <Badge tone={e.outcome === 'done' ? 'green' : 'warn'}>{e.outcome === 'done' ? '改成' : '放弃'}</Badge>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={!events.length} onClick={async () => onToast((await copyText(summaryText(events))) ? '统计已复制，可以直接贴进测试记录' : '复制失败')}>
          <Copy size={13} /> 复制统计
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!events.length}
          onClick={() => {
            if (!confirm('清空这台设备上的改动记录？换下一组测试对象之前清一次。')) return
            clearEvents()
            setEvents([])
          }}
        >
          <Trash2 size={13} /> 清空，开始下一组
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, note, good }: { label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${good ? 'border-emerald-300' : 'border-line'}`}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-extrabold tabular-nums ${good ? 'text-emerald-700' : 'text-ink'}`}>{value}</div>
      {note && <div className="text-[11px] text-muted">{note}</div>}
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; count: number; avgRounds: number }[] }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-xs font-semibold text-ink">{title}</div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.length === 0 && <div className="text-xs text-muted">—</div>}
        {rows.map((r) => (
          <div key={r.name} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink">{r.name}</span>
            <span className="tabular-nums text-muted">
              {r.count} 次 · 平均 {r.avgRounds.toFixed(1)} 轮
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
