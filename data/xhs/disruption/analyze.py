#!/usr/bin/env python3
"""小红书「行程变更」帖采样 → 变更原因分布。
用法: python3 -I data/xhs/disruption/analyze.py data/xhs/disruption/notes.tsv data/xhs/disruption/summary.md
口径见 README。原因代码: W 天气, C 闭馆/约不上/停运/封路, Q 排队/人多, B 体力/生病, T 交通(航班/车/延误/取消/误机),
S 时间安排(起晚/太满/来不及), P 同伴/家人/工作等个人事务, M 兴致变化/踩雷/不想去, X 安全/政策/罢工/第三方取消, O 其他或未说明。"""
import csv, sys
from collections import Counter, defaultdict
src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else None
R = {'W':'天气','C':'闭馆/约不上/停运','Q':'排队/人多','B':'体力/生病','T':'交通延误取消','S':'时间安排','P':'同伴/个人事务','M':'兴致变化/踩雷','X':'安全/政策/第三方','O':'其他/未说明'}
TUJI = {'W':'下雨预案','Q':'排队太久预案','B':'走不动了预案','C':'某个点去不了预案'}
rows = list(csv.DictReader(open(src, encoding='utf-8'), delimiter='\t'))
def reasons(r): return [x for x in r['reasons'].split('|') if x and x != '-']
def table(sub, title):
    n = len(sub); L = sum(int(r['likes']) for r in sub) or 1
    cnt, lk = Counter(), Counter()
    for r in sub:
        for c in set(reasons(r)): cnt[c] += 1; lk[c] += int(r['likes'])
    lines = [f'\n### {title}（{n} 篇）\n', '| 原因 | 篇数 | 占比 | 赞权重 | 途迹现有预案 |', '|---|---|---|---|---|']
    for c, k in cnt.most_common():
        lines.append(f'| {R[c]} | {k} | {k/n:.0%} | {lk[c]/L:.0%} | {TUJI.get(c, "—")} |')
    return lines, cnt
md = ['# 小红书「行程被打乱」帖采样：变更原因分布（2026-11-09）\n']
types = Counter(r['type'] for r in rows)
md.append(f"读了 {len(rows)} 篇（六个查询综合排序结果轮流交错、按序读到变更帖满 100 为止）：行中变更 {types['行中']}、行前取消或改期 {types['行前']}、应对指南 {types['指南']}、非变更 {types['非变更']}。变更帖合计 {types['行中']+types['行前']}。\n")
inc = [r for r in rows if r['type'] == '行中']; pre = [r for r in rows if r['type'] == '行前']; guide = [r for r in rows if r['type'] == '指南']
l1, c_inc = table(inc, '行中变更：旅途中改了行程'); md += l1
l2, c_pre = table(pre, '行前取消或改期：出发前就没去成或改了'); md += l2
l3, c_g = table(guide, '应对指南帖：教人怎么应对'); md += l3
l4, c_all = table(inc + pre, '行中 + 行前合计（变更帖）'); md += l4
# 去掉带原因的查询 q5
noq5 = [r for r in inc if 'q5' not in r['queries'].split('|')]
l5, _ = table(noq5, '行中变更，剔除来自「下雨 行程 怎么办」查询的帖子（去查询偏置）'); md += l5
# 途迹四类预案覆盖
n = len(inc)
covered = sum(1 for r in inc if set(reasons(r)) & set(TUJI))
only_un = sum(1 for r in inc if reasons(r) and not (set(reasons(r)) & set(TUJI)))
md.append(f"\n### 对照途迹现有四类预案（下雨 / 排队 / 走不动 / 去不了）\n")
md.append(f"- 行中变更 {n} 篇里，原因至少有一条落在四类预案内的 {covered} 篇（{covered/n:.0%}）；一条都不在的 {only_un} 篇（{only_un/n:.0%}），其中交通延误取消 {c_inc['T']} 篇、同伴/个人事务 {c_inc['P']} 篇、时间安排 {c_inc['S']} 篇。")
md.append(f"- 四类预案各自在行中变更里的出现率：天气 {c_inc['W']/n:.0%}、体力/生病 {c_inc['B']/n:.0%}、闭馆/约不上/停运 {c_inc['C']/n:.0%}、排队/人多 {c_inc['Q']/n:.0%}。")
# 共现
pair = Counter()
for r in inc:
    rs = sorted(set(reasons(r)))
    for i in range(len(rs)):
        for j in range(i+1, len(rs)): pair[(rs[i], rs[j])] += 1
md.append('\n### 行中变更里的原因共现 Top5\n')
md.append('、'.join(f'{R[a]}×{R[b]} {k}' for (a, b), k in pair.most_common(5)) or '无')
# 自动关键词 vs 人工
MAP = {'weather':'W','closed':'C','queue':'Q','body':'B','transport':'T','timing':'S','companion':'P','mood':'M'}
agree = total = 0; fp = Counter(); fn = Counter()
for r in inc + pre:
    auto = {MAP[h.split(':')[0]] for h in r['regex_hits'].split('|') if h}
    man = set(reasons(r)) - {'O', 'X'}
    for c in man | auto:
        total += 1
        if c in man and c in auto: agree += 1
        elif c in auto: fp[c] += 1
        else: fn[c] += 1
md.append(f"\n### 关键词自动标注 vs 人工\n\n变更帖上逐原因比对：命中一致 {agree}/{total}（{agree/total:.0%}）。关键词多标最多的是 {R[fp.most_common(1)[0][0]]}（{fp.most_common(1)[0][1]} 次，多为提到「朋友」「取消」但不是原因），漏标最多的是 {R[fn.most_common(1)[0][0]]}（{fn.most_common(1)[0][1]} 次）。关键词只能做初筛，归因必须读正文。")
# 按查询
md.append('\n### 各查询贡献\n\n| 查询 | 读到的帖 | 行中 | 行前 | 指南 | 非变更 |\n|---|---|---|---|---|---|')
QN = {'q1':'旅游 行程被打乱','q2':'旅行 计划赶不上变化','q3':'旅游 攻略白做了','q4':'旅游 突发状况 行程','q5':'下雨 行程 怎么办','q6':'旅游 临时改行程'}
for q in sorted(QN):
    sub = [r for r in rows if r['queries'].split('|')[0] == q]
    t = Counter(r['type'] for r in sub)
    md.append(f"| {QN[q]} | {len(sub)} | {t['行中']} | {t['行前']} | {t['指南']} | {t['非变更']} |")
# 行中 examples per reason (notes only)
md.append('\n### 每类原因的典型帖（行中，取点赞最高两篇的概括）\n')
for c, _ in c_inc.most_common():
    ex = sorted([r for r in inc if c in reasons(r)], key=lambda r: -int(r['likes']))[:2]
    md.append(f"- **{R[c]}**：" + '；'.join(f"{r['note']}（{r['likes']} 赞）" for r in ex))
text = '\n'.join(md) + '\n'
print(text)
if out: open(out, 'w', encoding='utf-8').write(text)
