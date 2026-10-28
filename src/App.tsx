import { Compass, Settings as SettingsIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AiCityDialog } from './components/AiCityDialog'
import { CityPage } from './components/CityPage'
import { Home } from './components/Home'
import { PlanPage } from './components/PlanPage'
import { SettingsDialog } from './components/SettingsDialog'
import { BUILTIN_CITIES } from './data'
import { planFromShare, planTrip } from './lib/planner'
import { decodeShare, readShareFromHash } from './lib/share'
import { loadAiCities, loadPlans, loadSettings, saveAiCities, savePlans, saveSettings, type Settings } from './lib/storage'
import type { City, PlanParams, SavedPlan, TripPlan } from './types'
import { DEFAULT_FOOD_PREFS } from './types'

/** 旧数据可能缺少新字段，补默认值 */
function normalizeParams(p: PlanParams): PlanParams {
  return { ...p, transport: p.transport ?? 'balanced', food: { ...DEFAULT_FOOD_PREFS, ...(p.food ?? {}) } }
}

type View = { name: 'home' } | { name: 'city'; cityId: string } | { name: 'plan' }

function defaultParams(city: City): PlanParams {
  const m = city.suggestedDays.match(/\d+/)
  const days = Math.min(7, Math.max(1, m ? Number(m[0]) : 2))
  return {
    cityId: city.id,
    days,
    pace: 'moderate',
    interests: [],
    startTime: '09:00',
    mustInclude: [],
    exclude: [],
    includeSuburb: days >= 2,
    transport: 'balanced',
    food: { ...DEFAULT_FOOD_PREFS },
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [aiCities, setAiCities] = useState<City[]>(loadAiCities)
  const [saved, setSaved] = useState<SavedPlan[]>(loadPlans)
  const [view, setView] = useState<View>({ name: 'home' })
  const [paramsByCity, setParamsByCity] = useState<Record<string, PlanParams>>({})
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [aiDialog, setAiDialog] = useState<string | null>(null)

  const cities = useMemo(() => [...BUILTIN_CITIES, ...aiCities], [aiCities])
  const findCity = useCallback((id: string) => cities.find((c) => c.id === id), [cities])

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveAiCities(aiCities), [aiCities])
  useEffect(() => savePlans(saved), [saved])
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [view])

  // 打开分享链接（首次加载或地址栏 hash 变化时）
  useEffect(() => {
    const applyShare = () => {
      const code = readShareFromHash()
      if (!code) return
      const d = decodeShare(code)
      if (!d) {
        alert('分享链接无效或已损坏')
        return
      }
      let city = [...BUILTIN_CITIES, ...loadAiCities()].find((c) => c.id === d.cityId)
      if (!city && d.city) {
        city = d.city
        const shared = d.city
        setAiCities((cs) => (cs.some((c) => c.id === shared.id) ? cs : [...cs, shared]))
      }
      if (!city) {
        alert('这个链接对应的城市数据不在本机（可能是对方用 AI 生成的城市）')
        return
      }
      const params = normalizeParams(d.params)
      const restored = planFromShare(city, params, d.days, d.variant)
      setParamsByCity((m) => ({ ...m, [city.id]: params }))
      setPlan(restored)
      setView({ name: 'plan' })
      history.replaceState(null, '', location.pathname)
    }
    applyShare()
    window.addEventListener('hashchange', applyShare)
    return () => window.removeEventListener('hashchange', applyShare)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentCity = view.name === 'city' ? findCity(view.cityId) : view.name === 'plan' && plan ? findCity(plan.params.cityId) : undefined

  const openCity = (city: City) => {
    setParamsByCity((m) => (m[city.id] ? m : { ...m, [city.id]: defaultParams(city) }))
    setView({ name: 'city', cityId: city.id })
  }

  const generate = (city: City) => {
    const params = paramsByCity[city.id] ?? defaultParams(city)
    setPlan(planTrip(city, params))
    setView({ name: 'plan' })
  }

  const openSaved = (p: SavedPlan) => {
    const city = findCity(p.cityId)
    if (!city) {
      alert('这份行程对应的城市数据已被删除（AI 生成的城市被清除了）。')
      return
    }
    setParamsByCity((m) => ({ ...m, [city.id]: normalizeParams(p.plan.params) }))
    setPlan({ ...p.plan, params: normalizeParams(p.plan.params) })
    setView({ name: 'plan' })
  }

  const savePlan = (name: string) => {
    if (!plan || !currentCity) return
    const entry: SavedPlan = { id: `saved-${Date.now().toString(36)}`, name, cityId: currentCity.id, cityName: currentCity.name, createdAt: Date.now(), plan }
    setSaved((s) => [entry, ...s])
  }

  return (
    <div className="min-h-full">
      {/* 顶栏 */}
      <nav className="no-print sticky top-0 z-[800] border-b border-line/80 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button type="button" onClick={() => setView({ name: 'home' })} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white shadow-sm shadow-brand/40">
              <Compass size={18} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">途迹</span>
            <span className="hidden text-xs text-muted sm:inline">· 不走回头路的旅行规划</span>
          </button>
          <div className="flex items-center gap-1">
            {view.name !== 'home' && (
              <button type="button" onClick={() => setView({ name: 'home' })} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-ink/5 hover:text-ink">
                首页
              </button>
            )}
            <button type="button" onClick={() => setShowSettings(true)} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label="设置">
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </nav>

      {view.name === 'home' && (
        <Home
          cities={cities}
          savedPlans={saved}
          hasApiKey={Boolean(settings.apiKey.trim())}
          onSelectCity={openCity}
          onOpenPlan={openSaved}
          onDeletePlan={(id) => setSaved((s) => s.filter((p) => p.id !== id))}
          onAiCity={(name) => setAiDialog(name)}
          onDeleteAiCity={(id) => setAiCities((cs) => cs.filter((c) => c.id !== id))}
        />
      )}

      {view.name === 'city' && currentCity && (
        <CityPage
          city={currentCity}
          params={normalizeParams(paramsByCity[currentCity.id] ?? defaultParams(currentCity))}
          onChangeParams={(p) => setParamsByCity((m) => ({ ...m, [currentCity.id]: p }))}
          onGenerate={() => generate(currentCity)}
          onBack={() => setView({ name: 'home' })}
          tileSource={settings.tileSource}
          amapKey={settings.amapKey}
        />
      )}

      {view.name === 'plan' && plan && currentCity && (
        <PlanPage
          city={currentCity}
          plan={plan}
          settings={settings}
          onPlanChange={setPlan}
          onSettingsChange={setSettings}
          onBack={() => setView({ name: 'city', cityId: currentCity.id })}
          onSave={savePlan}
        />
      )}

      {(view.name === 'plan' || view.name === 'city') && !currentCity && (
        <div className="p-10 text-center text-muted">城市数据不存在。<button type="button" className="text-brand underline" onClick={() => setView({ name: 'home' })}>回首页</button></div>
      )}

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onChange={setSettings}
        aiCityCount={aiCities.length}
        onClearAiCities={() => {
          if (confirm('确定清除所有 AI 生成的城市吗？相关的已保存行程将无法打开。')) setAiCities([])
        }}
      />

      <AiCityDialog
        open={aiDialog !== null}
        initialName={aiDialog ?? ''}
        settings={settings}
        onClose={() => setAiDialog(null)}
        onOpenSettings={() => setShowSettings(true)}
        onGenerated={(city) => {
          setAiCities((cs) => [...cs.filter((c) => c.name !== city.name), city])
          setAiDialog(null)
          openCity(city)
        }}
      />
    </div>
  )
}
