/**
 * 校验城市数据文件
 * 用法: npx tsx scripts/validate-city.ts src/data/cities/beijing.ts [更多文件...]
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { INTERESTS, type City, type Attraction, type Restaurant } from '../src/types'
import { haversine } from '../src/lib/geo'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('用法: npx tsx scripts/validate-city.ts src/data/cities/xxx.ts')
  process.exit(1)
}

const BEST_TIMES = ['morning', 'afternoon', 'evening', 'night', 'any']
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'night']
const HOURS_RE = /^(\d{1,2}:\d{2}-\d{1,2}:\d{2}|全天)$/

let totalErrors = 0

for (const file of files) {
  const errors: string[] = []
  const warnings: string[] = []
  const err = (m: string) => errors.push(m)
  const warn = (m: string) => warnings.push(m)

  const mod = await import(pathToFileURL(path.resolve(file)).href)
  const city = Object.values(mod).find((v) => v && typeof v === 'object' && 'attractions' in (v as object)) as City | undefined
  if (!city) {
    console.error(`❌ ${file}: 没有找到导出的 City 对象`)
    totalErrors++
    continue
  }

  const inBbox = (p: { lat: number; lng: number }) =>
    p.lat >= city.bbox.minLat && p.lat <= city.bbox.maxLat && p.lng >= city.bbox.minLng && p.lng <= city.bbox.maxLng

  /* ---- 城市级 ---- */
  if (!/^[a-z][a-z0-9-]*$/.test(city.id)) err(`city.id "${city.id}" 必须是小写英文/数字/连字符`)
  if (!city.name || !city.nameEn || !city.tagline || !city.emoji) err('name / nameEn / tagline / emoji 不能为空')
  if (!Array.isArray(city.gradient) || city.gradient.length !== 2 || !city.gradient.every((g) => /^#[0-9a-fA-F]{6}$/.test(g)))
    err('gradient 必须是两个 #RRGGBB 颜色')
  if (!inBbox(city.center)) err('center 不在 bbox 内')
  if (city.bbox.maxLat - city.bbox.minLat < 0.2 || city.bbox.maxLng - city.bbox.minLng < 0.2) warn('bbox 偏小，确认是否包含远郊景点')
  if (!(city.defaultZoom >= 9 && city.defaultZoom <= 14)) err('defaultZoom 应在 9-14')
  if (!city.bestSeason || !city.suggestedDays) err('bestSeason / suggestedDays 不能为空')
  if ((city.transportTips ?? []).length < 2) err('transportTips 至少 2 条')
  if ((city.tips ?? []).length < 3) err('tips 至少 3 条')
  if ((city.avoid ?? []).length < 2) err('avoid 至少 2 条')

  /* ---- 景点 ---- */
  const atts: Attraction[] = city.attractions ?? []
  if (atts.length < 14) err(`景点只有 ${atts.length} 个，至少 14 个`)
  const ids = new Set<string>()
  for (const a of atts) {
    const tag = `景点 "${a.name}"(${a.id})`
    if (!/^[a-z][a-z0-9-]*$/.test(a.id)) err(`${tag}: id 必须是小写英文/数字/连字符`)
    if (ids.has(a.id)) err(`${tag}: id 重复`)
    ids.add(a.id)
    if (!a.area || !a.area.trim()) err(`${tag}: area 不能为空`)
    if (!(INTERESTS as readonly string[]).includes(a.category)) err(`${tag}: category "${a.category}" 不在 INTERESTS 中`)
    if (!Array.isArray(a.tags) || a.tags.length < 1) err(`${tag}: tags 至少 1 个`)
    if (typeof a.lat !== 'number' || typeof a.lng !== 'number' || !inBbox(a)) err(`${tag}: 坐标 (${a.lat}, ${a.lng}) 不在 bbox 内`)
    if (!(a.duration >= 20 && a.duration <= 600)) err(`${tag}: duration ${a.duration} 应在 20-600 分钟`)
    if (!(a.rating >= 3.5 && a.rating <= 5)) err(`${tag}: rating ${a.rating} 应在 3.5-5`)
    if (!(a.price >= 0 && a.price <= 2000)) err(`${tag}: price ${a.price} 不合理`)
    if (!HOURS_RE.test(a.openHours)) err(`${tag}: openHours "${a.openHours}" 格式应为 "HH:MM-HH:MM" 或 "全天"`)
    if (a.closedOn && !a.closedOn.every((d) => d >= 0 && d <= 6)) err(`${tag}: closedOn 必须是 0-6`)
    if (!a.description || a.description.length < 40 || a.description.length > 240) err(`${tag}: description 长度 ${a.description?.length ?? 0}，应在 40-240 字`)
    if (!Array.isArray(a.tips) || a.tips.length < 2 || a.tips.length > 4) err(`${tag}: tips 应为 2-4 条`)
    if (!BEST_TIMES.includes(a.bestTime)) err(`${tag}: bestTime "${a.bestTime}" 无效`)
    const dist = haversine(a, city.center)
    if (dist > 22 && !a.suburb) warn(`${tag}: 距市中心 ${dist.toFixed(1)}km，建议标记 suburb: true`)
    if (a.suburb && dist < 15) warn(`${tag}: 距市中心仅 ${dist.toFixed(1)}km，不像远郊`)
  }
  const mustSeeCount = atts.filter((a) => a.mustSee).length
  if (mustSeeCount < 3) warn(`mustSee 景点只有 ${mustSeeCount} 个，建议 4-7 个`)
  if (mustSeeCount > 9) warn(`mustSee 景点有 ${mustSeeCount} 个，太多了会失去意义`)
  const core = atts.filter((a) => !a.suburb && haversine(a, city.center) <= 22)
  if (core.length < 12) warn(`核心区（非远郊）景点只有 ${core.length} 个，建议 ≥ 12`)
  const cats = new Set(atts.map((a) => a.category))
  if (cats.size < 4) warn(`景点 category 只覆盖了 ${cats.size} 种兴趣，建议 ≥ 5 种`)
  const nightCount = atts.filter((a) => a.bestTime === 'night' || a.bestTime === 'evening').length
  if (nightCount < 2) warn(`傍晚/夜间景点只有 ${nightCount} 个，建议至少 2 个（夜景、夜市、商圈等）`)

  /* ---- 餐厅 ---- */
  const rests: Restaurant[] = city.restaurants ?? []
  if (rests.length < 12) err(`餐厅只有 ${rests.length} 家，至少 12 家`)
  const rids = new Set<string>()
  for (const r of rests) {
    const tag = `餐厅 "${r.name}"(${r.id})`
    if (!/^[a-z][a-z0-9-]*$/.test(r.id)) err(`${tag}: id 必须是小写英文/数字/连字符`)
    if (rids.has(r.id) || ids.has(r.id)) err(`${tag}: id 重复`)
    rids.add(r.id)
    if (!r.cuisine || !r.area) err(`${tag}: cuisine / area 不能为空`)
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number' || !inBbox(r)) err(`${tag}: 坐标不在 bbox 内`)
    if (!(r.avgPrice >= 8 && r.avgPrice <= 3000)) err(`${tag}: avgPrice ${r.avgPrice} 不合理`)
    if (!(r.rating >= 3.5 && r.rating <= 5)) err(`${tag}: rating ${r.rating} 应在 3.5-5`)
    if (!Array.isArray(r.mustOrder) || r.mustOrder.length < 2) err(`${tag}: mustOrder 至少 2 个`)
    if (!HOURS_RE.test(r.openHours)) err(`${tag}: openHours "${r.openHours}" 格式错误`)
    if (!Array.isArray(r.tags) || r.tags.length < 1) err(`${tag}: tags 至少 1 个`)
    if (!Array.isArray(r.mealTypes) || r.mealTypes.length < 1 || !r.mealTypes.every((m) => MEAL_TYPES.includes(m))) err(`${tag}: mealTypes 无效`)
    if (r.notes) warn(`${tag}: 仍有旧的 notes 字段，请转换为 review 后删除`)
    const rv = r.review
    if (!rv) err(`${tag}: 缺少 review（综合评价）`)
    else {
      const fake = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|#\S+|姐妹们|绝绝子|家人们|宝子|yyds|救命|冲鸭/u
      if (!rv.summary || rv.summary.length < 30 || rv.summary.length > 120) err(`${tag}: review.summary 长度 ${rv.summary?.length ?? 0}，应在 30-120 字`)
      if (rv.summary && fake.test(rv.summary)) err(`${tag}: review.summary 含 emoji / 话题标签 / 网络用语`)
      if (!Array.isArray(rv.pros) || rv.pros.length < 2 || rv.pros.length > 4) err(`${tag}: review.pros 应为 2-4 条`)
      if (!Array.isArray(rv.cons) || rv.cons.length < 1 || rv.cons.length > 3) err(`${tag}: review.cons 应为 1-3 条`)
      for (const t of [...(rv.pros ?? []), ...(rv.cons ?? [])]) {
        if (t.length < 4 || t.length > 30) err(`${tag}: 评价要点「${t}」长度应在 4-30 字`)
        if (fake.test(t)) err(`${tag}: 评价要点「${t}」含 emoji / 话题标签 / 网络用语`)
      }
      if (rv.bestFor && rv.bestFor.length > 24) err(`${tag}: review.bestFor 太长`)
    }
    const nearest = Math.min(...atts.map((a) => haversine(a, r)))
    if (nearest > 3 && !r.tags.includes('值得专程')) warn(`${tag}: 距最近景点 ${nearest.toFixed(1)}km，规划时可能排不上（可加 tag "值得专程"）`)
  }
  const mealCount = (m: string) => rests.filter((r) => r.mealTypes.includes(m as never)).length
  if (mealCount('lunch') < 7) warn(`提供午餐的餐厅只有 ${mealCount('lunch')} 家，建议 ≥ 7`)
  if (mealCount('dinner') < 7) warn(`提供晚餐的餐厅只有 ${mealCount('dinner')} 家，建议 ≥ 7`)
  if (mealCount('breakfast') < 2) warn(`提供早餐的餐厅只有 ${mealCount('breakfast')} 家，建议 ≥ 2`)
  if (mealCount('snack') < 3) warn(`提供小吃/下午茶的餐厅只有 ${mealCount('snack')} 家，建议 ≥ 3`)
  const uncovered = core.filter((a) => !rests.some((r) => haversine(a, r) <= 2))
  if (uncovered.length) warn(`以下核心景点 2km 内没有餐厅：${uncovered.map((a) => a.name).join('、')}`)

  /* ---- 输出 ---- */
  console.log(`\n📍 ${city.name} (${file})：${atts.length} 个景点，${rests.length} 家餐厅，${rests.filter((r) => r.review).length} 家有综合评价`)
  warnings.forEach((w) => console.log(`  ⚠️  ${w}`))
  errors.forEach((e) => console.log(`  ❌ ${e}`))
  if (!errors.length) console.log(`  ✅ 通过（${warnings.length} 条提醒）`)
  totalErrors += errors.length
}

process.exit(totalErrors ? 1 : 0)
