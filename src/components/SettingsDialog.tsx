import { Eye, EyeOff, KeyRound, Map as MapIcon, MapPin, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AI_MODELS } from '../lib/ai'
import type { Settings, TileSource } from '../lib/storage'
import { Button, Modal } from './ui'

const TILES: { id: TileSource; name: string; desc: string }[] = [
  { id: 'amap', name: '高德地图', desc: '中文标注全、国内加载快（默认）；坐标已自动转换' },
  { id: 'osm', name: 'OpenStreetMap', desc: '国际标准底图，海外城市更详细' },
  { id: 'esri', name: 'Esri 街道图', desc: '备用底图，OSM 加载慢时可切换' },
]

export function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
  aiCityCount,
  onClearAiCities,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (s: Settings) => void
  aiCityCount: number
  onClearAiCities: () => void
}) {
  const [showKey, setShowKey] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="设置">
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink"><MapIcon size={15} /> 地图底图</h3>
          <div className="mt-2 grid gap-2">
            {TILES.map((t) => (
              <label key={t.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${settings.tileSource === t.id ? 'border-brand bg-brand-soft' : 'border-line bg-white'}`}>
                <input type="radio" name="tile" checked={settings.tileSource === t.id} onChange={() => onChange({ ...settings, tileSource: t.id })} className="accent-brand" />
                <div>
                  <div className="text-sm font-medium text-ink">{t.name}</div>
                  <div className="text-xs text-muted">{t.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink"><Sparkles size={15} /> AI 生成任意城市</h3>
          <p className="mt-1 text-xs text-muted">
            填入你自己的 Anthropic API Key 后，可以为内置列表之外的城市即时生成景点与美食数据。Key 只保存在这台电脑的浏览器里，直接从浏览器请求 Anthropic，不经过任何第三方服务器。
          </p>
          <label className="mt-3 block text-xs font-medium text-muted">API Key</label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-white px-3">
            <KeyRound size={15} className="text-muted" />
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => onChange({ ...settings, apiKey: e.target.value })}
              placeholder="sk-ant-..."
              autoComplete="off"
              className="h-10 w-full bg-transparent text-sm outline-none"
            />
            <button type="button" onClick={() => setShowKey((s) => !s)} className="text-muted hover:text-ink" aria-label="显示/隐藏">
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <label className="mt-3 block text-xs font-medium text-muted">模型</label>
          <select value={settings.model} onChange={(e) => onChange({ ...settings, model: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none">
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">Opus / Sonnet 5.5 会自动启用服务端安全回退（遇到误判拒绝时自动改用备用模型完成请求）。</p>
          {aiCityCount > 0 && (
            <Button variant="danger" size="sm" className="mt-3" onClick={onClearAiCities}>
              <Trash2 size={14} /> 清除 {aiCityCount} 座 AI 生成的城市
            </Button>
          )}
        </section>

        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink"><MapPin size={15} /> 酒店 / 地址搜索</h3>
          <p className="mt-1 text-xs text-muted">
            默认用 OpenStreetMap 搜索（免费，国内酒店覆盖一般）。填入高德「Web 服务」Key 后改用高德 POI 搜索，国内结果更全；Key 同样只存在本机。
          </p>
          <label className="mt-3 block text-xs font-medium text-muted">高德 Web 服务 Key（可选）</label>
          <input
            type="password"
            value={settings.amapKey}
            onChange={(e) => onChange({ ...settings, amapKey: e.target.value })}
            placeholder="在 lbs.amap.com 创建「Web 服务」类型的 Key"
            autoComplete="off"
            className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none"
          />
        </section>

        <div className="flex justify-end">
          <Button onClick={onClose}>完成</Button>
        </div>
      </div>
    </Modal>
  )
}
