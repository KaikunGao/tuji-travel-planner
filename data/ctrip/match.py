import json, csv, re, sys, glob, os
D = os.path.dirname(os.path.abspath(__file__))
tuji = json.load(open(os.path.join(D, 'tuji-pois.json'), encoding='utf-8'))
SKIP = re.compile(r'演唱会|音乐剧|话剧|巡演|音乐会|脱口秀|喜剧|舞剧|见面会|马拉松|音乐节|Livehouse|大展|特展|主题展|艺术展|沉浸|XR|VR|生日会|专场|市集|博览会|嘉年华|管理猿|Dinner Show')
ctrip = {}
for f in glob.glob(os.path.join(D, 'list_*.tsv')):
    city = os.path.basename(f)[5:-4]
    rows = list(csv.DictReader(open(f, encoding='utf-8'), delimiter='\t'))
    rows = [r for r in rows if not SKIP.search(r['name'])]
    ctrip[city] = rows
CITY = re.compile(r'^(北京|上海|成都|重庆|西安|杭州|长沙|广州|厦门)市?|^(湖南|四川|陕西|浙江|广东|福建)省')
def parens(s):
    return [x for x in re.findall(r'[（(]([^)）]+)[)）]', s) if len(x) >= 2]
def norm(s):
    s0 = re.sub(r'[（(][^)）]*[)）]', '', s)
    s = CITY.sub('', s0)
    if len(s) < 2: s = s0
    s = re.sub(r'[\s·•・\-—–_,，、。!！?？:：;；"“”\'‘’《》【】\[\]「」/|]', '', s)
    return s.replace('博物院', '博物馆')
GENERIC = ['国家考古遗址公园','考古遗址公园','遗址公园','古文化街','文化街','商业街','风景名胜区','国家遗址公园','国家森林公园','国家湿地公园','旅游度假区','风景区','景区','旅游区','公园','博物馆','纪念馆','步行街','古镇','广场','大厦','寺','塔','山']
def stems(s):
    out = {s}
    for g in GENERIC:
        if s.endswith(g) and len(s) - len(g) >= 2:
            out.add(s[:-len(g)])
    return out
def bigrams(s): return {s[i:i+2] for i in range(len(s)-1)}
def score(a, b):
    A, B = bigrams(a), bigrams(b)
    return len(A & B) / max(1, min(len(A), len(B)))
GENERIC_WORDS = set(['美术馆','博物馆','植物园','动物园','科技馆','大学','纪念馆','电影小镇','滨江','码头','老街','夜市','海滩','沙滩','步道','索道','游船','游轮','大剧院','剧院','剧场','公园','广场','步行街','古镇','景区','风景区','寺','塔','山','街','路','湖','岛','桥'])
ALIAS = {'北外滩滨江': None, '万石植物园': '厦门园林植物园', '铜官窑古镇': '铜官窑国风乐园', '玉林路 · 小酒馆': '玉林西路', '李子坝轻轨穿楼': '李子坝单轨穿楼观景平台', '湖南博物院（马王堆汉墓陈列）': '湖南省博物馆', '坡子街 · 火宫殿': '坡子街牌坊'}
def best(name, rows):
    if name in ALIAS:
        if ALIAS[name] is None: return None
        for r in rows:
            if r['name'] == ALIAS[name]: return (3.0, 'alias', r)
    cands = []
    parts = [p.strip() for p in re.split(r'\s*[·•]\s*', re.sub(r'[（(][^)）]*[)）]', '', name)) if p.strip()] or [name]
    pparts = parens(name)
    for r in rows:
        cn0 = norm(r['name']); alts = [cn0] + [norm(x) for x in parens(r['name'])]
        for ai, cn in enumerate(alts):
          if len(cn) < 2: continue
          cns = stems(cn)
          for pi, p in enumerate(parts + pparts):
            pen = (0.1 if pi >= len(parts) else 0) + (0.1 if ai > 0 else 0)
            tn = norm(p); tns = stems(tn)
            raw = score(re.sub(r'\s', '', name), re.sub(r'\s', '', r['name']))
            if cn == tn: cands.append((3.0 - pen, 'exact', r, raw)); continue
            if cns & tns: cands.append((2.5 - pen, 'stem', r, raw)); continue
            short = tn if len(tn) <= len(cn) else cn
            if len(short) >= 2 and short not in GENERIC_WORDS and (tn in cn or cn in tn):
                cands.append((2.0 + min(len(tn), len(cn)) / 20 - pen, 'contain', r, raw)); continue
            sc = score(tn, cn)
            if sc >= 0.75 and min(len(tn), len(cn)) >= 4:
                cands.append((1.0 + sc - pen, 'fuzzy', r, raw))
    if not cands: return None
    cands.sort(key=lambda x: (-x[0], -x[3], int(x[2]['rank'])))
    return cands[0]
visits = {}
for p in tuji['plans']:
    for s in p['stops']: visits[(p['city'], s['id'])] = visits.get((p['city'], s['id']), 0) + 1
out = []; summary = {}
for c in tuji['cities']:
    rows = ctrip.get(c['id'], []); m = 0
    for a in c['attractions']:
        b = best(a['name'], rows)
        v = visits.get((c['id'], a['id']), 0)
        rec = {'city': c['id'], 'tuji_id': a['id'], 'tuji_name': a['name'], 'mustSee': int(a['mustSee']), 'suburb': int(a['suburb']), 'visits_in_default_plans': v,
               'tuji_rating': a['rating'], 'tuji_open': a['openHours'], 'tuji_duration': a['duration'], 'tuji_price': a['price']}
        if b:
            m += 1; sc, how, r = b[0], b[1], b[2]
            rec.update({'match': how, 'ctrip_id': r['ctrip_id'], 'ctrip_slug': r['slug'], 'ctrip_name': r['name'], 'ctrip_rank': r['rank'], 'ctrip_hot': r['hot'], 'ctrip_rating': r['rating'], 'ctrip_comments': r['comments'], 'ctrip_level': r['level'], 'ctrip_dist_km': r['dist_km'], 'ctrip_open': r['open'], 'ctrip_price': r['price'], 'ctrip_biz': r['biz_area'], 'ctrip_booking': r['booking']})
        else:
            rec.update({'match': 'none', 'ctrip_id': '', 'ctrip_slug': '', 'ctrip_name': '', 'ctrip_rank': '', 'ctrip_hot': '', 'ctrip_rating': '', 'ctrip_comments': '', 'ctrip_level': '', 'ctrip_dist_km': '', 'ctrip_open': '', 'ctrip_price': '', 'ctrip_biz': '', 'ctrip_booking': ''})
        out.append(rec)
    summary[c['id']] = (m, len(c['attractions']), len(rows))
with open(os.path.join(D, 'match.tsv'), 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()), delimiter='\t'); w.writeheader(); w.writerows(out)
tm = sum(v[0] for v in summary.values()); tt = sum(v[1] for v in summary.values())
print('city        matched/total  ctrip_rows')
for k, v in summary.items(): print(f'{k:11s} {v[0]:3d}/{v[1]:<3d}        {v[2]}')
print(f'TOTAL       {tm}/{tt} = {tm/tt:.1%}')
vm = sum(r['visits_in_default_plans'] for r in out if r['match'] != 'none'); vt = sum(r['visits_in_default_plans'] for r in out)
print(f'default-plan visits matched: {vm}/{vt} = {vm/vt:.1%}')
print('\n--- UNMATCHED ---')
for r in out:
    if r['match'] == 'none': print(f"{r['city']:10s} {r['tuji_name']}  (visits={r['visits_in_default_plans']}, mustSee={r['mustSee']})")
print('\n--- fuzzy / contain matches to eyeball ---')
for r in out:
    if r['match'] in ('fuzzy', 'contain', 'stem'): print(f"{r['city']:10s} {r['tuji_name']:22s} -> {r['ctrip_name']}  [{r['match']}]")
