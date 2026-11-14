/**
 * 重排合理率：27 份默认行程的每个景点位次模拟一次「去不了」，取预案给的第一个方案，
 * 用引擎自己没有当作过滤条件的外部数据判断它合不合理。
 *
 * 替代点方案（alt）合理 = 同时满足
 *   1. 携程评分不低于原点 0.2 以上（两边都有携程评分时才比；data/ctrip/tuji_pois_with_ctrip.tsv）
 *   2. 点评数不少于原点的三分之一；原点点评 ≥1 万而替代点携程未收录，算不合理
 *   3. 攻略档位最多比原点低一档（核心 ≥30% / 次核心 15–30% / 低频 <15%；只有写了 guideShare 的城市才比）
 *   4. 换上去之后没有新的时间冲突（开放时间 / 收工过晚等 warning）
 *   5. 距离在替代半径内（市区 6 km，远郊 35 km）
 * 换天方案（move）合理 = 没有新的时间冲突，且目标那天路上多花的时间 ≤ 30 分钟；整天对调（swap）合理 = 没有新的时间冲突。
 * 第一个方案就是「砍掉」= 不合理（没有重排可言）。
 *
 * 两版判据同时算：
 *   v1 = 上面的字面规则（口径文档里最初提的）。
 *   v2 = 看过 v1 的失败清单后修正三处数据口径，规则本身不变：
 *     - 点评数：替代点点评数 ≥ min(原点/3, 九城对齐景点中位数 3222)。否则故宫（20.5 万条）换国博（1.4 万条）也判失败，量的是原点多有名，不是替代点合不合适。
 *     - 「携程未收录」记中性：198 个景点有 31 个没对齐到携程条目（含人工判定不对齐的），未收录是对齐缺口，不是冷门证据。
 *     - 人工指定（数据里的 alternatives）的替代点不比半径：那是作者判断过的，如八达岭 → 慕田峪。
 *
 * v0.9.7 起「攻略档位最多低一档」也是 findAlternatives 的过滤规则，在有攻略数据的三城里这一条必过，
 * 不再是独立判据；仍独立于引擎的是携程评分、点评数、新冲突、半径。改前的报告见 blocked-sanity-before-v0.9.7.md。
 *
 * 用法: npx tsx scripts/eval-blocked-sanity.ts [out_dir]   （默认 data/eval）
 */
import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_CITIES } from '../src/data'
import { DEFAULT_FOOD_PREFS, type Attraction, type City, type Pace, type TripPlan } from '../src/types'
import { planTrip, attractionIdsOfDay, isSuburb } from '../src/lib/planner'
import { blockedPlan, type PlanOption } from '../src/lib/contingency'
import { diffPlans } from '../src/lib/change'
import { haversine } from '../src/lib/geo'

const outDir = process.argv[2] ?? 'data/eval'
fs.mkdirSync(outDir, { recursive: true })

/* 携程评分 */
const ctripRating = new Map<string, number>()
for (const line of fs.readFileSync('data/ctrip/tuji_pois_with_ctrip.tsv', 'utf8').split('\n').slice(1)) {
  const f = line.split('\t')
  if (f.length < 17) continue
  const r = parseFloat(f[16])
  if (f[10] !== 'none' && Number.isFinite(r) && r > 0) ctripRating.set(`${f[0]}/${f[1]}`, r)
}

const RATING_TOL = 0.2
const POP_RATIO = 1 / 3
/** 九城对齐景点的携程点评数中位数（data/ctrip/README.md） */
const POP_MEDIAN = 3222
const MOVE_EXTRA_TRAVEL = 30
const RADIUS = { city: 6, suburb: 35 }

type Check = { name: string; pass: boolean | null; detail: string }
type Row = {
  city: string; days: number; day: number; id: string; name: string; must: boolean
  kind: 'alt' | 'move' | 'swap' | 'cut' | 'none'; title: string
  reasonable: boolean; checks: Check[]; secondOk: boolean | null
  reasonableV1: boolean; checksV1: Check[]; secondOkV1: boolean | null
}

const tierOf = (s: number | undefined) => (s === undefined ? null : s >= 0.3 ? 2 : s >= 0.15 ? 1 : 0)
const tierName = ['低频', '次核心', '核心']

function judge(city: City, plan: TripPlan, o: Attraction, opt: PlanOption, v2: boolean): { kind: Row['kind']; checks: Check[]; reasonable: boolean } {
  const kind = (opt.key.split(':')[0] as Row['kind']) || 'none'
  const checks: Check[] = []
  const diff = opt.next ? diffPlans(city, plan, opt.next) : null
  const newWarnings = diff ? diff.days.flatMap((d) => d.newWarnings) : ['无 diff']
  if (kind === 'alt') {
    const c = city.attractions.find((a) => a.id === opt.key.split(':')[2])!
    const ro = ctripRating.get(`${city.id}/${o.id}`), rc = ctripRating.get(`${city.id}/${c.id}`)
    checks.push({ name: '携程评分', pass: ro !== undefined && rc !== undefined ? rc >= ro - RATING_TOL : null, detail: `${rc ?? '—'} vs ${ro ?? '—'}` })
    const po = o.popularity, pc = c.popularity
    checks.push({
      name: '点评数',
      pass: po && pc ? pc >= (v2 ? Math.min(po * POP_RATIO, POP_MEDIAN) : po * POP_RATIO) : !v2 && po && po >= 10000 && !pc ? false : null,
      detail: `${pc ?? '未收录'} vs ${po ?? '未收录'}`,
    })
    const to = tierOf(o.guideShare), tc = tierOf(c.guideShare)
    checks.push({ name: '攻略档位', pass: to === null ? null : (tc ?? 0) >= to - 1, detail: to === null ? '该城无攻略数据' : `${tierName[tc ?? 0]} ${Math.round((c.guideShare ?? 0) * 100)}% vs ${tierName[to]} ${Math.round((o.guideShare ?? 0) * 100)}%` })
    checks.push({ name: '无新冲突', pass: newWarnings.length === 0, detail: newWarnings.join('；') || '无' })
    const km = haversine(o, c), radius = isSuburb(o, city) ? RADIUS.suburb : RADIUS.city
    const curated = (o.alternatives ?? []).includes(c.id)
    checks.push({ name: '半径内', pass: v2 && curated ? null : km <= radius, detail: `${km.toFixed(1)} km / ${radius} km${curated ? '，人工指定' : ''}` })
  } else if (kind === 'move') {
    const j = Number(opt.key.split(':')[2])
    const d = diff?.days.find((x) => x.day === plan.days[j].day)
    checks.push({ name: '无新冲突', pass: newWarnings.length === 0, detail: newWarnings.join('；') || '无' })
    checks.push({ name: '目标天多走 ≤30 分钟', pass: d ? d.travelDelta <= MOVE_EXTRA_TRAVEL : true, detail: d ? `+${Math.round(d.travelDelta)} 分钟` : '目标天无变化记录' })
  } else if (kind === 'swap') {
    checks.push({ name: '无新冲突', pass: newWarnings.length === 0, detail: newWarnings.join('；') || '无' })
  } else {
    checks.push({ name: '有重排方案', pass: false, detail: kind === 'cut' ? '第一个方案就是砍掉' : '没有任何方案' })
  }
  return { kind, checks, reasonable: checks.every((c) => c.pass !== false) }
}

const rows: Row[] = []
for (const c of BUILTIN_CITIES) {
  for (const days of [2, 3, 4]) {
    const plan = planTrip(c, { cityId: c.id, days, pace: 'moderate' as Pace, interests: [], startTime: '09:00', mustInclude: [], exclude: [], includeSuburb: days >= 2, transport: 'balanced', food: { ...DEFAULT_FOOD_PREFS } })
    plan.days.forEach((d, di) => {
      for (const id of attractionIdsOfDay(d)) {
        const o = c.attractions.find((a) => a.id === id)!
        const r = blockedPlan(c, plan, di, id)
        const top = r.options[0]
        if (!top) { const ck = [{ name: '有重排方案', pass: false, detail: '没有任何方案' }]; rows.push({ city: c.id, days, day: d.day, id, name: o.name, must: !!o.mustSee, kind: 'none', title: '—', reasonable: false, checks: ck, secondOk: null, reasonableV1: false, checksV1: ck, secondOkV1: null }); continue }
        const j = judge(c, plan, o, top, true), j1 = judge(c, plan, o, top, false)
        const hasSecond = r.options[1] && !r.options[1].key.startsWith('cut:')
        const second = hasSecond ? judge(c, plan, o, r.options[1], true) : null, second1 = hasSecond ? judge(c, plan, o, r.options[1], false) : null
        rows.push({ city: c.id, days, day: d.day, id, name: o.name, must: !!o.mustSee, kind: j.kind, title: top.title, reasonable: j.reasonable, checks: j.checks, secondOk: second ? second.reasonable : null, reasonableV1: j1.reasonable, checksV1: j1.checks, secondOkV1: second1 ? second1.reasonable : null })
      }
    })
  }
}

/* ---------- 汇总 ---------- */
const n = rows.length, ok = rows.filter((r) => r.reasonable).length
const byKind = (k: Row['kind']) => { const s = rows.filter((r) => r.kind === k); return { n: s.length, ok: s.filter((r) => r.reasonable).length } }
const kinds: Row['kind'][] = ['alt', 'move', 'swap', 'cut', 'none']
const kindLabel: Record<Row['kind'], string> = { alt: '换替代点', move: '改到另一天', swap: '两天对调', cut: '只能砍掉', none: '无方案' }
const failHist = new Map<string, number>()
for (const r of rows) for (const c of r.checks) if (c.pass === false) failHist.set(c.name, (failHist.get(c.name) ?? 0) + 1)
const naHist = new Map<string, number>()
for (const r of rows.filter((x) => x.kind === 'alt')) for (const c of r.checks) if (c.pass === null) naHist.set(c.name, (naHist.get(c.name) ?? 0) + 1)
const eitherOk = rows.filter((r) => r.reasonable || r.secondOk).length
const okV1 = rows.filter((r) => r.reasonableV1).length, eitherOkV1 = rows.filter((r) => r.reasonableV1 || r.secondOkV1).length
const failHistV1 = new Map<string, number>()
for (const r of rows) for (const c of r.checksV1) if (c.pass === false) failHistV1.set(c.name, (failHistV1.get(c.name) ?? 0) + 1)
const cityName = (id: string) => BUILTIN_CITIES.find((c) => c.id === id)!.name

const md: string[] = []
md.push(`# 重排合理率（默认行程 × 「去不了」预案，${new Date().toLocaleDateString('sv-SE')}）\n`)
md.push(`判法见 \`scripts/eval-blocked-sanity.ts\` 文件头。对象：九城 27 份默认行程的全部 ${n} 个景点位次，每个位次模拟一次「去不了」，只看预案给出的**第一个**方案。\n`)
md.push(`## 结果\n`)
md.push(`- **v2（修正数据口径后）第一个方案合理：${ok}/${n} = ${(ok / n * 100).toFixed(1)}%**；前两个方案至少一个合理：${eitherOk}/${n} = ${(eitherOk / n * 100).toFixed(1)}%。`)
md.push(`- v1（字面规则）第一个方案合理：${okV1}/${n} = ${(okV1 / n * 100).toFixed(1)}%；前两个至少一个合理：${eitherOkV1}/${n} = ${(eitherOkV1 / n * 100).toFixed(1)}%。v1 不合理的原因：` + [...failHistV1.entries()].map(([k, v]) => `${k} ${v}`).join('，') + '。两版差别全部来自「点评数」和「半径」两条口径，见文件头。')
md.push(`- 按方案类型：` + kinds.map((k) => { const s = byKind(k); return s.n ? `${kindLabel[k]} ${s.ok}/${s.n}` : '' }).filter(Boolean).join('，') + '。')
md.push(`- v2 不合理的原因（一个位次可能多条）：` + ([...failHist.entries()].map(([k, v]) => `${k} ${v}`).join('，') || '无') + '。')
md.push(`- 替代点方案里判据缺数据（记中性，不算失败）：` + ([...naHist.entries()].map(([k, v]) => `${k} ${v}`).join('，') || '无') + '。\n')
md.push(`| 城市 | 位次 | v2 合理 | v2 合理率 | v1 合理率 | 换替代点 | 改天 / 对调 | 只能砍 |\n|---|---|---|---|---|---|---|---|`)
for (const c of BUILTIN_CITIES) {
  const s = rows.filter((r) => r.city === c.id)
  const a = s.filter((r) => r.kind === 'alt'), m = s.filter((r) => r.kind === 'move' || r.kind === 'swap'), cut = s.filter((r) => r.kind === 'cut' || r.kind === 'none')
  md.push(`| ${c.name} | ${s.length} | ${s.filter((r) => r.reasonable).length} | ${(s.filter((r) => r.reasonable).length / s.length * 100).toFixed(0)}% | ${(s.filter((r) => r.reasonableV1).length / s.length * 100).toFixed(0)}% | ${a.filter((r) => r.reasonable).length}/${a.length} | ${m.filter((r) => r.reasonable).length}/${m.length} | ${cut.length} |`)
}
md.push(`\n## v2 不合理的位次（${n - ok} 个）\n`)
md.push(`| 城市 | 行程 | 位次 | 第一个方案 | 没过的判据 |\n|---|---|---|---|---|`)
for (const r of rows.filter((x) => !x.reasonable)) md.push(`| ${cityName(r.city)} | ${r.days} 日 D${r.day} | ${r.name}${r.must ? '（必去）' : ''} | ${r.title} | ${r.checks.filter((c) => c.pass === false).map((c) => `${c.name}：${c.detail}`).join('；')} |`)
md.push(`\n## 合理但值得看一眼的（替代点判据有缺数据）\n`)
const soft = rows.filter((r) => r.reasonable && r.kind === 'alt' && r.checks.some((c) => c.pass === null && c.name !== '攻略档位'))
md.push(soft.length ? `| 城市 | 行程 | 位次 | 方案 | 缺的数据 |\n|---|---|---|---|---|` : '无')
for (const r of soft) md.push(`| ${cityName(r.city)} | ${r.days} 日 D${r.day} | ${r.name} | ${r.title} | ${r.checks.filter((c) => c.pass === null && c.name !== '攻略档位').map((c) => `${c.name}（${c.detail}）`).join('；')} |`)
fs.writeFileSync(path.join(outDir, 'blocked-sanity.md'), md.join('\n') + '\n')

const tsv = ['city\tdays\tday\tid\tname\tmust\tkind\ttop_option\treasonable_v2\tsecond_ok_v2\tfailed_v2\treasonable_v1\tfailed_v1\tchecks_v2']
for (const r of rows) tsv.push([r.city, r.days, r.day, r.id, r.name, r.must ? 1 : 0, r.kind, r.title, r.reasonable ? 1 : 0, r.secondOk === null ? '' : r.secondOk ? 1 : 0, r.checks.filter((c) => c.pass === false).map((c) => c.name).join('|'), r.reasonableV1 ? 1 : 0, r.checksV1.filter((c) => c.pass === false).map((c) => c.name).join('|'), r.checks.map((c) => `${c.name}=${c.pass === null ? 'na' : c.pass ? 'ok' : 'FAIL'}(${c.detail})`).join(' | ')].join('\t'))
fs.writeFileSync(path.join(outDir, 'blocked-sanity.tsv'), tsv.join('\n') + '\n')
console.log(md.slice(0, 20).join('\n'))
console.log(`\n写出 ${outDir}/blocked-sanity.md 与 .tsv`)
