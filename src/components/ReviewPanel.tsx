import { ExternalLink, ThumbsUp, TriangleAlert } from 'lucide-react'
import type { Restaurant, RestaurantReview } from '../types'
import { Stars } from './ui'

/** 小红书网页版搜索链接（去掉分店括号，搜索结果更准） */
export function xhsSearchUrl(name: string): string {
  const keyword = name.replace(/[（(].*?[）)]/g, '').trim()
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed`
}

/** 旧数据兜底：没有 review 时从旧笔记里粗略提炼 */
export function reviewOf(r: Restaurant): RestaurantReview | null {
  if (r.review) return r.review
  if (!r.notes?.length) return null
  const strip = (t: string) => t.replace(/#[^\s#]+/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim()
  const good = r.notes.filter((n) => n.rating >= 4).map((n) => strip(n.title))
  const bad = r.notes.filter((n) => n.rating <= 3).map((n) => strip(n.title))
  return { summary: strip(r.notes[0].content).slice(0, 90), pros: good.slice(0, 3), cons: bad.slice(0, 2) }
}

export function ReviewPanel({ r }: { r: Restaurant }) {
  const review = reviewOf(r)
  return (
    <div className="rounded-2xl border border-line bg-paper/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink">综合评价</span>
          <Stars rating={r.rating} size="xs" />
        </div>
        <a
          href={xhsSearchUrl(r.name)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-xhs hover:underline"
          title="在小红书搜索这家店的真实笔记"
        >
          <ExternalLink size={12} /> 去小红书看真实笔记
        </a>
      </div>
      {review ? (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink/90">{review.summary}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {review.pros.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><ThumbsUp size={13} /> 大家喜欢</div>
                <ul className="mt-1 space-y-1 text-[13px] text-ink/85">
                  {review.pros.map((t) => (
                    <li key={t} className="flex gap-1.5"><span className="text-emerald-600">•</span><span>{t}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {review.cons.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs font-semibold text-amber-700"><TriangleAlert size={13} /> 注意与吐槽</div>
                <ul className="mt-1 space-y-1 text-[13px] text-ink/85">
                  {review.cons.map((t) => (
                    <li key={t} className="flex gap-1.5"><span className="text-amber-600">•</span><span>{t}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {review.bestFor && <div className="mt-3 text-xs text-muted">适合：{review.bestFor}</div>}
        </>
      ) : (
        <p className="mt-2 text-[13px] text-muted">暂无综合评价。</p>
      )}
      <p className="mt-3 text-[11px] text-muted">* 根据公开评价综合整理，非逐条引用；出行前请以最新评价为准。</p>
    </div>
  )
}
