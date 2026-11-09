#!/usr/bin/env python3
"""小红书高赞攻略 → 每城核心 POI 库。

用法: python3 -I analyze.py <xhs_dir> <tuji-pois.json> [out_dir] [plans.json]
  plans.json 可选：用另一份默认行程快照（如 compare-default-plans.ts 写出的 after.json）替换 tuji-pois.json 里的 plans。
  xhs_dir 里需有 poi_dict.json 与 results_<city>.tsv（或 raw/results_<city>.tsv）（列: note_id likes text_len video blocked title hits）。
口径:
  * 攻略型笔记 = 正文命中 ≥2 个词典 POI（其余为 0/1 命中的感受帖、纯图攻略、视频）。
  * 提及率 = 命中该 POI 的攻略型笔记数 / 攻略型笔记数；赞权重提及率按笔记点赞加权。
  * 核心 POI = 提及率 ≥ 30%；次核心 = 15–30%。
  * 词典里的库外条目若与库内条目同名/别名重叠（如「西安博物院」对「小雁塔 · 西安博物院」），并入库内条目。
"""
import csv, json, sys, os, itertools, re
from collections import defaultdict

xhs_dir, tuji_path = sys.argv[1], sys.argv[2]
out_dir = sys.argv[3] if len(sys.argv) > 3 else xhs_dir
os.makedirs(out_dir, exist_ok=True)
CITY_CN = {'beijing': '北京', 'chengdu': '成都', 'xian': '西安'}
CORE, SUB = 0.30, 0.15

pdict = json.load(open(os.path.join(xhs_dir, 'poi_dict.json')))
tuji = json.load(open(tuji_path))
cities = {c['id']: c for c in tuji['cities']}
plans = defaultdict(dict)
plan_src = json.load(open(sys.argv[4]))['plans'] if len(sys.argv) > 4 else tuji['plans']
for p in plan_src:
    plans[p['city']][p['days']] = [s['id'] for s in p['stops']]

def norm(s):
    return re.sub(r'[\s·•()（）\-－·]', '', s)

def build_merge(entries):
    """non-tuji entry name -> tuji entry name, when they denote the same place.
    Ranked: name containment > shared alias > alias contained in the other's name."""
    tj = [e for e in entries if e['in_tuji']]
    merge = {}
    for n in entries:
        if n['in_tuji']:
            continue
        nn, nforms = norm(n['name']), {norm(f) for f in n['forms']}
        best = None
        for t in tj:
            tn, tforms = norm(t['name']), {norm(f) for f in t['forms']}
            if (nn and nn in tn) or (tn and tn in nn): rank = 0
            elif nforms & tforms: rank = 1
            elif any(f and len(f) >= 3 and f in tn for f in nforms) or any(f and len(f) >= 3 and f in nn for f in tforms): rank = 2
            else: continue
            if best is None or rank < best[0]:
                best = (rank, t['name'])
        if best:
            merge[n['name']] = best[1]
    return merge

report = ['# 小红书高赞攻略 → 核心 POI 库（%s 三城）\n' % '、'.join(CITY_CN[c] for c in pdict)]
summary_rows = []
for city, entries in pdict.items():
    byname = {e['name']: e for e in entries}
    merge = build_merge(entries)
    attrs = {a['id']: a for a in cities[city]['attractions']}
    name2attr = {a['name']: a for a in cities[city]['attractions']}
    raw = os.path.join(xhs_dir, f'results_{city}.tsv')
    if not os.path.exists(raw): raw = os.path.join(xhs_dir, 'raw', f'results_{city}.tsv')
    rows = list(csv.DictReader(open(raw), delimiter='\t'))
    assert len(rows) == 30, (city, len(rows))
    notes = []
    for r in rows:
        hits = [h for h in r['hits'].split('|') if h]
        hits = {merge.get(h, h) for h in hits}
        notes.append({'id': r['note_id'], 'likes': int(r['likes']), 'len': int(r['text_len']),
                      'video': r['video'] == '1', 'title': r['title'], 'hits': hits})
    guides = [n for n in notes if len(n['hits']) >= 2]
    zero = [n for n in notes if len(n['hits']) == 0]
    one = [n for n in notes if len(n['hits']) == 1]
    G = len(guides); L = sum(n['likes'] for n in guides)
    cnt, lk = defaultdict(int), defaultdict(int)
    for n in guides:
        for h in n['hits']:
            cnt[h] += 1; lk[h] += n['likes']
    stats = []
    for name, c in cnt.items():
        e = byname.get(name)
        a = attrs.get(e['id']) if (e and e['in_tuji']) else name2attr.get(name)
        in_tuji = a is not None
        stats.append({
            'poi': name, 'in_tuji': in_tuji, 'tuji_id': a['id'] if a else '',
            'must_see': bool(a and a.get('mustSee')),
            'in_plan2': bool(a and a['id'] in plans[city].get(2, [])),
            'in_plan3': bool(a and a['id'] in plans[city].get(3, [])),
            'in_plan4': bool(a and a['id'] in plans[city].get(4, [])),
            'mentions': c, 'share': c / G, 'likes_share': lk[name] / L,
        })
    stats.sort(key=lambda s: (-s['mentions'], -s['likes_share']))
    for s in stats:
        s['tier'] = 'core' if s['share'] >= CORE else ('sub' if s['share'] >= SUB else '')
    with open(os.path.join(out_dir, f'poi_stats_{city}.tsv'), 'w') as f:
        w = csv.writer(f, delimiter='\t')
        w.writerow(['poi', 'tier', 'in_tuji', 'tuji_id', 'must_see', 'in_plan2', 'in_plan3', 'in_plan4', 'mentions', 'share', 'likes_share'])
        for s in stats:
            w.writerow([s['poi'], s['tier'], int(s['in_tuji']), s['tuji_id'], int(s['must_see']), int(s['in_plan2']), int(s['in_plan3']), int(s['in_plan4']), s['mentions'], f"{s['share']:.3f}", f"{s['likes_share']:.3f}"])
    # pairs among core+sub
    cand = [s['poi'] for s in stats if s['tier']]
    pairs = []
    for a, b in itertools.combinations(cand, 2):
        k = sum(1 for n in guides if a in n['hits'] and b in n['hits'])
        if k: pairs.append((a, b, k))
    pairs.sort(key=lambda x: -x[2])
    with open(os.path.join(out_dir, f'pairs_{city}.tsv'), 'w') as f:
        w = csv.writer(f, delimiter='\t'); w.writerow(['poi_a', 'poi_b', 'co_mentions', 'share'])
        for a, b, k in pairs: w.writerow([a, b, k, f'{k/G:.3f}'])
    # merged notes file (what was actually counted)
    with open(os.path.join(out_dir, f'notes_{city}.tsv'), 'w') as f:
        w = csv.writer(f, delimiter='\t'); w.writerow(['note_id', 'likes', 'text_len', 'video', 'type', 'title', 'pois'])
        for n in notes:
            typ = '攻略型' if len(n['hits']) >= 2 else ('单点/感受' if n['hits'] else '无文字命中')
            w.writerow([n['id'], n['likes'], n['len'], int(n['video']), typ, n['title'], '|'.join(sorted(n['hits']))])

    core = [s for s in stats if s['tier'] == 'core']; sub = [s for s in stats if s['tier'] == 'sub']
    core_in = [s for s in core if s['in_tuji']]; core_must = [s for s in core if s['must_see']]
    core_p3 = [s for s in core if s['in_plan3']]; core_p4 = [s for s in core if s['in_plan4']]
    p3 = plans[city].get(3, []); p3_core = [attrs[i]['name'] for i in p3 if any(s['tuji_id'] == i for s in core)]
    p3_sub = [attrs[i]['name'] for i in p3 if any(s['tuji_id'] == i for s in sub)]
    p3_cold = [attrs[i]['name'] for i in p3 if not any(s['tuji_id'] == i and s['tier'] for s in stats)]
    cold_detail = []
    for i in p3:
        s = next((s for s in stats if s['tuji_id'] == i), None)
        cold_detail.append((attrs[i]['name'], s['mentions'] if s else 0))
    outside = [s for s in stats if not s['in_tuji'] and s['share'] >= 0.10]
    # 替代点: for each plan-3 stop, alternatives' mention share
    alt_lines = []
    for i in p3:
        alts = attrs[i].get('alternatives') or []
        if not alts: continue
        parts = []
        for aid in alts:
            if aid not in attrs: continue
            s = next((s for s in stats if s['tuji_id'] == aid), None)
            parts.append(f"{attrs[aid]['name']} {s['mentions'] if s else 0}/{G}")
        alt_lines.append(f"  - {attrs[i]['name']} → " + '；'.join(parts))
    # 库内 POI 零提及
    tuji_zero = [a['name'] for a in cities[city]['attractions'] if not any(s['tuji_id'] == a['id'] for s in stats)]
    must_zero = [a['name'] for a in cities[city]['attractions'] if a.get('mustSee') and not any(s['tuji_id'] == a['id'] for s in stats)]

    report.append(f"\n## {CITY_CN[city]}\n")
    report.append(f"- 样本: 30 篇（多个「X 日游/攻略」查询的综合排序结果池按点赞取前 30）；攻略型 {G} 篇、单点/感受 {len(one)} 篇、无文字命中 {len(zero)} 篇（其中视频 {sum(n['video'] for n in notes)} 篇）。攻略型点赞中位数 {sorted(n['likes'] for n in guides)[G//2]}，最低 {min(n['likes'] for n in guides)}。")
    report.append(f"- 攻略型平均提及 {sum(len(n['hits']) for n in guides)/G:.1f} 个 POI；出现过的 POI {len(stats)} 个（库内 {sum(s['in_tuji'] for s in stats)}，库外 {sum(not s['in_tuji'] for s in stats)}）。")
    report.append(f"- 词典合并: " + ('；'.join(f'{k}→{v}' for k, v in merge.items() if k in {h for r in rows for h in r['hits'].split('|')}) or '无'))
    report.append(f"\n### 核心 POI（提及率 ≥30%，{len(core)} 个）\n")
    report.append('| POI | 提及 | 提及率 | 赞权重 | 库内 | 必去 | 3日默认 |\n|---|---|---|---|---|---|---|')
    for s in core:
        report.append(f"| {s['poi']} | {s['mentions']}/{G} | {s['share']:.0%} | {s['likes_share']:.0%} | {'✓' if s['in_tuji'] else '✗'} | {'✓' if s['must_see'] else ''} | {'✓' if s['in_plan3'] else ''} |")
    report.append(f"\n核心 POI 覆盖: 库内 {len(core_in)}/{len(core)}，标 必去 {len(core_must)}/{len(core)}，进 3 日默认路线 {len(core_p3)}/{len(core)}，进 4 日 {len(core_p4)}/{len(core)}。")
    report.append(f"\n### 次核心（15–30%，{len(sub)} 个）\n")
    report.append('、'.join(f"{s['poi']} {s['mentions']}{'' if s['in_tuji'] else '（库外）'}" for s in sub) or '无')
    core_not_p3 = [s for s in core if not s['in_plan3']]
    report.append(f"\n### 判据\n")
    report.append('- 核心 POI 未进 3 日默认路线: ' + ('、'.join(f"{s['poi']} {s['share']:.0%}{'（库外）' if not s['in_tuji'] else ''}" for s in core_not_p3) or '无'))
    report.append('- 3 日默认路线中提及率 <15% 的站: ' + ('、'.join(f'{n} {m}/{G}' for n, m in cold_detail if m / G < SUB) or '无'))
    report.append(f"\n### 3 日默认路线反查（{len(p3)} 站）\n")
    report.append('核心 ' + str(len(p3_core)) + ' 站，次核心 ' + str(len(p3_sub)) + ' 站，低频 ' + str(len(p3_cold)) + ' 站：' + '；'.join(f'{n} {m}/{G}' for n, m in cold_detail))
    if alt_lines:
        report.append('\n替代点提及（3 日路线各站 alternatives）:\n' + '\n'.join(alt_lines))
    report.append(f"\n### 库外高频（≥10%，候选补库）\n")
    report.append('、'.join(f"{s['poi']} {s['mentions']}/{G}" for s in outside) or '无')
    report.append(f"\n### 库内零提及（{len(tuji_zero)}/{len(cities[city]['attractions'])}）\n")
    report.append('、'.join(tuji_zero) or '无')
    if must_zero: report.append(f"\n其中标「必去」却零提及: {'、'.join(must_zero)}")
    report.append(f"\n### 共现 Top10（核心+次核心两两同篇）\n")
    report.append('、'.join(f"{a}×{b} {k}" for a, b, k in pairs[:10]))
    summary_rows.append((CITY_CN[city], G, len(core), len(core_in), len(core_must), len(core_p3), len(p3), len(p3_core), len(p3_sub), len(p3_cold), len(outside)))

report.append('\n## 三城汇总\n')
report.append('| 城市 | 攻略型篇数 | 核心 POI | 库内 | 必去 | 进3日路线 | 3日路线站数 | 其中核心 | 次核心 | 低频 | 库外高频 |\n|---|---|---|---|---|---|---|---|---|---|---|')
for r in summary_rows:
    report.append('| ' + ' | '.join(str(x) for x in r) + ' |')
tg = sum(r[1] for r in summary_rows); tc = sum(r[2] for r in summary_rows); ti = sum(r[3] for r in summary_rows); tp = sum(r[5] for r in summary_rows)
report.append(f"\n合计: 90 篇样本中攻略型 {tg} 篇；核心 POI {tc} 个，途迹库内 {ti} 个（{ti/tc:.0%}），3 日默认路线覆盖 {tp} 个（{tp/tc:.0%}）。")
open(os.path.join(out_dir, 'summary.md'), 'w').write('\n'.join(report) + '\n')
print('\n'.join(report))
