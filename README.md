# 途迹 · 不走回头路的城市旅行规划

**在线地址：https://kaikungao.github.io/tuji-travel-planner/**（推送到 main 分支后自动更新）

输入一座城市，途迹会按地理位置把景点聚成每一天，再用精确最短路径算法排出游览顺序（夜景压轴、上午景点在前），沿途自动安排午餐晚餐，并附上综合整理的美食评价、预算估算、预约清单与避雷提示。

## 功能

- **智能路线**：k-means 按位置分天 → 簇间平衡（必去优先）→ Held-Karp 精确求最短开放路径 + 时段偏好惩罚 → 按开放时间排程；闭馆日自动避开，接近闭园会提醒并尝试调整顺序
- **远郊一日游**：长城、三星堆这类离市区 20 公里以上的景点单独成天（2 天以上行程可开启）
- **美食推荐**：午餐 / 晚餐 /（选了「美食探店」时的）下午茶就近挑选，考虑顺路程度、评分、价格与菜系多样性；每家餐厅附「综合评价」（一句话总评 + 大家喜欢 / 注意与吐槽 + 适合场景）、必点菜、排队提示和避雷，并可一键跳转小红书搜索真实笔记
- **可调整**：拖拽或上移 / 下移景点，移除 / 添加景点，一键换餐厅，重新优化顺序，所有时间自动重算
- **偏好**：出行方式（均衡 / 多步行 / 公共交通 / 打车优先）、饮食偏好（不吃辣 / 素食 / 清真 / 忌口 / 人均上限）、出发点（搜索酒店地址或在地图上点选）
- **多方案对比**：推荐 / 省时省力 / 省钱 / 打卡多，并排比较后一键切换
- **地图**：Leaflet 地图按天着色显示路线与编号站点；默认高德底图（已做 WGS-84 → GCJ-02 转换），可切换 OpenStreetMap / Esri
- **预算**：门票、餐饮、市内交通按人估算，可设人数与住宿
- **贴士**：最佳季节、预约清单、交通、避雷、自动生成的打包清单
- **保存 / 导出 / 分享**：行程保存在本机浏览器；复制 / 下载 Markdown、打印、导出 .ics 日历；生成分享链接和二维码，打开即还原
- **AI 生成任意城市（可选）**：填入自己的 Anthropic API Key 后，用 Claude 为内置列表之外的城市生成景点与美食数据（结构化输出 + 流式进度，默认模型 `claude-opus-5-5`）

## 内置城市

北京、上海、成都、重庆、西安、杭州、长沙、广州、厦门（共 9 座，约 200 个景点、170 家餐厅）。更多城市数据见 `src/data/cities/`，加入后在 `src/data/index.ts` 注册即可。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
```

其他命令：

```bash
npm run typecheck                                        # TypeScript 检查
npm run build                                            # 生产构建到 dist/
npm run validate -- src/data/cities/beijing.ts           # 校验某个城市数据
npx tsx scripts/try-plan.ts src/data/cities/beijing.ts 3 moderate 历史文化,美食探店 2026-11-02   # 命令行试跑规划
```

## 部署到公网（GitHub Pages）

仓库里已带 `.github/workflows/deploy.yml`：推送到 `main` 分支后会自动构建并发布到 GitHub Pages，地址为 `https://<你的用户名>.github.io/<仓库名>/`。首次需要在仓库 Settings → Pages 里把 Source 设为 **GitHub Actions**。

本地预览生产构建：

```bash
npx vite build --base=/<仓库名>/ && npx vite preview
```

## 添加一座城市

1. 复制 `src/data/cities/beijing.ts` 作为模板，按 `src/types.ts` 里的注释填写（坐标用 WGS-84）
2. `npm run validate -- src/data/cities/<id>.ts` 做到 0 个错误
3. 在 `src/data/index.ts` 的 `BUILTIN_CITIES` 里注册

## 目录结构

```
src/
  types.ts                 数据类型
  lib/
    planner.ts             规划核心：打分、聚类、平衡、TSP、排程、手动调整
    geo.ts                 距离 / 出行估算 / 坐标转换
    ai.ts                  Claude 生成城市数据
    export.ts storage.ts format.ts
  data/
    index.ts               城市注册表
    cities/*.ts            城市数据
  components/              页面与组件（Home、CityPage、PlanPage、DayTimeline、MapView、FoodTab…）
scripts/
  validate-city.ts         数据校验
  try-plan.ts              命令行试跑
```

## 开发日志

每一步改进、已知问题和拓展功能路线图见 [PROGRESS.md](PROGRESS.md)。

## 说明

- 门票、营业时间、价格为编写时的参考值，出行前请以官方最新信息为准。
- 餐厅的「综合评价」是根据公开评价**综合整理的中立陈述**（不是逐条引用的帖子，不含虚构作者或点赞数），用于说明推荐理由与注意事项；每家店都有「去小红书看真实笔记」链接。
- AI 生成功能直接从浏览器请求 Anthropic API，Key 只保存在本机 localStorage。
