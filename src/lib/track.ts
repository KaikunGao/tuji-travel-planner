/**
 * 途迹 · 改动轮次埋点
 *
 * 北极星指标：一次变更，从「想改」到「改完」，用户操作了几轮（目标 ≤ 2）。
 *
 * 口径：
 *  - 一轮 = 一次和改动有关的操作：打开一个入口（砍点预览、先砍谁、出状况了、预案、换一家…）、
 *    确认一次改动、取消、撤销，各算一轮。纯浏览（切换天、看地图）不算。
 *  - 一次变更 = 从第一个入口操作开始，到一次改动落定为止。看了几个方案都取消、最后才确认，算同一次；
 *    确认后又撤销，这次变更还没完，接着算；停手超过 3 分钟就算这次变更结束。
 *  - 护栏指标：放弃率（操作了但最后没改成）和撤销次数。只看轮次的话，把改动做难了轮次也会下降。
 *  - 行中打卡（走完了 / 改现在的时间）不是改行程，单独计数，不进轮次统计。
 *
 * 数据只存在本机浏览器里，不上传。
 */
import type { PlanDiff } from './change'

export type ChangeKind = '删点' | '换点' | '换天' | '整天对调' | '加点' | '换序' | '换餐' | '进度' | '其他'
export type TrackType = 'intent' | 'commit' | 'undo' | 'cancel'

export interface TrackEvent {
  /** 时间戳（毫秒） */
  t: number
  type: TrackType
  /** 从哪个入口来的：cut / ease / trouble / backup / backup-row / meal / add / direct / banner */
  source: string
  kind?: ChangeKind
  day?: number
}

export const SOURCE_LABEL: Record<string, string> = {
  cut: '✕ 砍点',
  ease: '先砍谁',
  trouble: '出状况了',
  backup: '预案页',
  'backup-row': '预案页',
  meal: '换一家',
  add: '添加景点',
  direct: '直接操作',
  banner: '撤销',
}

/** 这次改动属于哪一类 */
export function changeKindOf(diff: PlanDiff): ChangeKind {
  if (diff.swaps.length) return '整天对调'
  if (diff.moved.length) return '换天'
  if (diff.removed.length && diff.added.length) return '换点'
  if (diff.removed.length) return '删点'
  if (diff.added.length) return '加点'
  if (diff.days.some((d) => d.reordered)) return '换序'
  const progress = Boolean(diff.progress || diff.progressCleared)
  if (diff.days.some((d) => d.meals.length)) return progress ? '进度' : '换餐'
  if (progress) return '进度'
  return '其他'
}

/* ------------------------------------------------------------------ */
/* 存取                                                                 */
/* ------------------------------------------------------------------ */

const KEY = 'tuji:track'
const MAX_EVENTS = 2000

export function loadEvents(): TrackEvent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? (v as TrackEvent[]) : []
  } catch {
    return []
  }
}

export function clearEvents() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

/** 记一轮操作。commit 不带入口时，沿用刚才打开的那个入口；没有就算「直接操作」（拖拽、上移下移等） */
export function track(type: TrackType, source?: string, extra: { kind?: ChangeKind; day?: number } = {}) {
  try {
    const events = loadEvents()
    const last = events[events.length - 1]
    const inherited = last && Date.now() - last.t <= IDLE_MS && last.type !== 'commit' ? last.source : 'direct'
    events.push({ t: Date.now(), type, source: source ?? inherited, ...extra })
    localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX_EVENTS)))
  } catch {
    /* 存不了就算了，不影响使用 */
  }
}

/* ------------------------------------------------------------------ */
/* 统计                                                                 */
/* ------------------------------------------------------------------ */

/** 停手超过这么久，就算这次变更结束了 */
const IDLE_MS = 3 * 60 * 1000

export interface Episode {
  start: number
  end: number
  rounds: number
  /** done = 改成了；abandoned = 操作了但最后没改（都取消了，或者改完又撤销） */
  outcome: 'done' | 'abandoned'
  kind?: ChangeKind
  /** 第一步是从哪个入口进来的 */
  source: string
  undos: number
}

/** 把事件流切成一次次「变更」 */
export function toEpisodes(events: TrackEvent[]): Episode[] {
  const out: Episode[] = []
  let cur: Episode | null = null
  let settled = false // 当前这次变更已经有一个没被撤销的改动
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const isUndo = e.type === 'undo'
    const fresh = !cur || (!isUndo && (settled || e.t - cur.end > IDLE_MS))
    if (fresh) {
      if (cur) out.push(cur)
      cur = { start: e.t, end: e.t, rounds: 0, outcome: 'abandoned', source: e.source, undos: 0 }
      settled = false
    }
    const ep = cur as Episode
    ep.rounds++
    ep.end = e.t
    if (e.type === 'commit') {
      settled = true
      ep.outcome = 'done'
      ep.kind = e.kind
    } else if (isUndo) {
      settled = false
      ep.outcome = 'abandoned'
      ep.undos++
    }
  }
  if (cur) out.push(cur)
  return out
}

export interface TrackSummary {
  /** 改行程的变更（不含行中打卡） */
  total: number
  done: number
  abandoned: number
  /** 以下只统计改成了的变更 */
  avgRounds: number
  medianRounds: number
  /** 2 轮以内完成的占比（0–1） */
  within2: number
  avgSeconds: number
  undos: number
  byKind: { kind: ChangeKind; count: number; avgRounds: number }[]
  bySource: { source: string; count: number; avgRounds: number }[]
  /** 行中打卡次数 */
  checkins: number
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function groupBy<K extends string>(eps: Episode[], key: (e: Episode) => K): { key: K; count: number; avgRounds: number }[] {
  const m = new Map<K, number[]>()
  eps.forEach((e) => m.set(key(e), [...(m.get(key(e)) ?? []), e.rounds]))
  return [...m.entries()].map(([k, rounds]) => ({ key: k, count: rounds.length, avgRounds: avg(rounds) })).sort((a, b) => b.count - a.count)
}

export function summarize(events: TrackEvent[]): TrackSummary {
  const all = toEpisodes(events)
  const checkins = all.filter((e) => e.kind === '进度')
  const changes = all.filter((e) => e.kind !== '进度')
  const done = changes.filter((e) => e.outcome === 'done')
  const rounds = done.map((e) => e.rounds)
  return {
    total: changes.length,
    done: done.length,
    abandoned: changes.length - done.length,
    avgRounds: avg(rounds),
    medianRounds: median(rounds),
    within2: done.length ? done.filter((e) => e.rounds <= 2).length / done.length : 0,
    avgSeconds: avg(done.map((e) => (e.end - e.start) / 1000)),
    undos: changes.reduce((s, e) => s + e.undos, 0),
    byKind: groupBy(done, (e) => e.kind ?? '其他').map((g) => ({ kind: g.key, count: g.count, avgRounds: g.avgRounds })),
    bySource: groupBy(done, (e) => e.source).map((g) => ({ source: g.key, count: g.count, avgRounds: g.avgRounds })),
    checkins: checkins.length,
  }
}

/** 导出成一段可以直接贴进测试记录的文字 */
export function summaryText(events: TrackEvent[]): string {
  const s = summarize(events)
  const eps = toEpisodes(events).filter((e) => e.kind !== '进度')
  const time = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false })
  const lines = [
    '途迹 · 改动轮次统计',
    `变更 ${s.total} 次：改成 ${s.done} 次，放弃 ${s.abandoned} 次（放弃率 ${s.total ? Math.round((s.abandoned / s.total) * 100) : 0}%），撤销 ${s.undos} 次`,
    `改成的变更：平均 ${s.avgRounds.toFixed(1)} 轮，中位数 ${s.medianRounds}，2 轮以内 ${Math.round(s.within2 * 100)}%，平均耗时 ${Math.round(s.avgSeconds)} 秒`,
    `按类型：${s.byKind.map((k) => `${k.kind} ${k.count} 次（${k.avgRounds.toFixed(1)} 轮）`).join('，') || '—'}`,
    `按入口：${s.bySource.map((k) => `${SOURCE_LABEL[k.source] ?? k.source} ${k.count} 次（${k.avgRounds.toFixed(1)} 轮）`).join('，') || '—'}`,
    '',
    '逐次记录（开始时间 | 入口 | 类型 | 轮次 | 耗时 | 结果）',
    ...eps.map((e) => `${time(e.start)} | ${SOURCE_LABEL[e.source] ?? e.source} | ${e.kind ?? '—'} | ${e.rounds} 轮 | ${Math.round((e.end - e.start) / 1000)} 秒 | ${e.outcome === 'done' ? '改成' : '放弃'}${e.undos ? `（撤销 ${e.undos} 次）` : ''}`),
  ]
  return lines.join('\n')
}
