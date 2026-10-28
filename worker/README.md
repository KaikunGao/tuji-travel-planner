# 途迹 AI 代理（Cloudflare Worker）

让网页访客不用自己的 API Key 也能用「AI 生成任意城市」，Key 只存在 Cloudflare 的机密里。

## 首次部署

```bash
cd worker
npm install
npx wrangler login                              # 浏览器里登录 Cloudflare（免费账号即可）
npx wrangler kv namespace create QUOTA          # 把输出的 id 填进 wrangler.toml 的 [[kv_namespaces]]
npx wrangler secret put ANTHROPIC_API_KEY       # 粘贴你的 Anthropic Key（不会回显）
npx wrangler deploy                             # 输出形如 https://tuji-ai-proxy.<账号>.workers.dev
```

然后把 Worker 地址设成网页仓库的变量 `AI_PROXY_URL`（GitHub → Settings → Secrets and variables → Actions → Variables），推送后网页就会默认走代理。

## 调额度

改 `wrangler.toml` 里的 `DAILY_IP_LIMIT`（每人每天）、`DAILY_GLOBAL_LIMIT`（全站每天）、`ALLOWED_MODELS`，再 `npx wrangler deploy`。

想只给熟人用：`npx wrangler secret put ACCESS_CODE` 设一个邀请码，访客在网页设置里填同样的邀请码才能用。

## 费用参考

一座城市约 2.5 万输出 token：Haiku 5.5 约 ¥0.1，Sonnet 5.5 约 ¥1.8，Opus 5.5 约 ¥3.6。默认允许 Sonnet / Haiku，全站每天 40 次封顶，最坏情况每天约 ¥70。
