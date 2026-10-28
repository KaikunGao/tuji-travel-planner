import { Loader2, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { City } from '../types'
import { AI_PROXY_URL, aiAvailable, describeAiError, generateCity, type GenerateProgress } from '../lib/ai'
import type { Settings } from '../lib/storage'
import { Button, Modal } from './ui'

const PHASE_TEXT: Record<GenerateProgress['phase'], string> = {
  attractions: '第 1/2 步：生成城市信息与景点…',
  restaurants: '第 2/2 步：按景点位置挑选餐厅并写笔记…',
  parsing: '整理数据中…',
}

function progressPercent(p: GenerateProgress): number {
  if (p.phase === 'parsing') return 98
  const within = Math.min(1, p.chars / 14000)
  return p.phase === 'attractions' ? within * 48 : 50 + within * 46
}

export function AiCityDialog({
  open,
  initialName,
  settings,
  onClose,
  onGenerated,
  onOpenSettings,
}: {
  open: boolean
  initialName: string
  settings: Settings
  onClose: () => void
  onGenerated: (city: City) => void
  onOpenSettings: () => void
}) {
  const [name, setName] = useState(initialName)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<GenerateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setError(null)
      setProgress(null)
    }
  }, [open, initialName])

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }

  const run = async () => {
    if (!name.trim()) return
    if (!aiAvailable(settings.apiKey)) {
      setError('还没有填写 API Key，请先去设置')
      return
    }
    setError(null)
    setRunning(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const city = await generateCity(name.trim(), {
        apiKey: settings.apiKey,
        model: settings.model,
        accessCode: settings.accessCode,
        signal: ac.signal,
        onProgress: setProgress,
      })
      onGenerated(city)
    } catch (e) {
      if (!ac.signal.aborted) setError(describeAiError(e))
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const close = () => {
    if (running) stop()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title={<span className="inline-flex items-center gap-1.5"><Sparkles size={16} className="text-brand" /> 用 AI 生成城市数据</span>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Claude 会分两步为这座城市生成 14-18 个真实景点（含坐标、门票、开放时间）和 12-15 家知名餐厅（含综合整理的评价参考）。生成约需 1-3 分钟，结果保存在本机，可反复使用。
        </p>
        <label className="block">
          <span className="text-xs font-medium text-muted">城市名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={running}
            placeholder="例如：南京、苏州、东京、巴黎"
            className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-brand"
          />
        </label>
        {!settings.apiKey.trim() && !AI_PROXY_URL && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <span>需要先填写 Anthropic API Key。</span>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              <Settings2 size={14} /> 去设置
            </Button>
          </div>
        )}
        {!settings.apiKey.trim() && AI_PROXY_URL && (
          <div className="rounded-xl bg-teal-soft p-3 text-xs text-teal">
            使用站长提供的 AI 额度：每位访客每天可生成数座城市，全站也有每日上限。想不受限制，可在设置里填自己的 API Key。
          </div>
        )}
        {running && progress && (
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <Loader2 size={16} className="animate-spin text-brand" /> {PHASE_TEXT[progress.phase]}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progressPercent(progress)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted">
              <span>已生成 {progress.chars.toLocaleString()} 字</span>
              <span>{Math.round(progress.elapsedMs / 1000)} 秒</span>
            </div>
          </div>
        )}
        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">{settings.apiKey.trim() ? `模型：${settings.model}` : AI_PROXY_URL ? '站长额度 · 模型由代理决定' : `模型：${settings.model}`}</span>
          <div className="flex gap-2">
            {running ? (
              <Button variant="secondary" onClick={stop}>取消</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={close}>关闭</Button>
                <Button onClick={run} disabled={!name.trim()}>
                  <Sparkles size={16} /> 开始生成
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
