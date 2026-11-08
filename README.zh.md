# Polymarket Toolkit

**面向想自己查 Polymarket 数据的人** — 会写代码直接跑 CLI；不会写代码，把 Skills 装进 Claude / Cursor / OpenClaw，让 AI 帮你跑。基于公开 API，只读，无需 API Key，无需签名。

> **什么都不想装？** [**probpocket.com/lookup**](https://probpocket.com/lookup/?utm_source=toolkit&utm_content=readme-top-zh) 在浏览器里回答同一个问题：贴一个地址，看它的全时段盈亏、这个钱包到底靠什么赚钱、以及它上榜那些天的数字和真实结算差多少。免费，不用注册，用的是和本 CLI 相同的公开 API。

[English README](./README.md)

机器可读产品事实：[ai-info.json](./ai-info.json) · [llms.txt](./llms.txt)。两者都由 `content/ai-identity.json` 生成；`npm run check:ai-discovery` 会拦截工具清单、包版本和生成文件漂移。

---

## 作为插件安装

- **Claude Code**（2.1.275 及以上）：`/plugin install polymarket-toolkit --marketplace runesleo/x-reader`
- **Codex**：先 `codex plugin marketplace add runesleo/x-reader`，再 `codex plugin add polymarket-toolkit@runesleo`

`runesleo` 插件市场里还有 Leo 的其他工具，见 [runesleo/x-reader](https://github.com/runesleo/x-reader)。

## 工具箱 · 按抽屉选

| 我想… | 从这里开始 |
|--------|------------|
| **研究某个地址** | `pm profile <addr>` · Skills：`polymarket-profile` / `polymarket-pnl` / `polymarket-brier` |
| **扫市场与价格** | `pm markets` · [`examples/01,09,11`](./examples/) · [`docs/cookbook.md`](./docs/cookbook.md) |
| **接自己的数据管道** | [`src/index.ts`](./src/index.ts) · cookbook · `examples/14` |
| **策略验证清单** | [`docs/templates/`](./docs/templates/) — handoff · 回测 · paper · live-gate · runbook |
| **PnL 交叉核对（LB 快照）** | `pm pnl-check` · [`docs/fee-inclusive-pnl.md`](./docs/fee-inclusive-pnl.md) |
| **排行榜 / redeem / activity** | `pm lb` · `pm redeem` · `pm activity` · [`examples/05–08,15–20`](./examples/) |
| **给 AI Agent 装工具** | [`skills/`](./skills/) — 复制到 Claude / OpenClaw / Cursor |

完整索引：[**docs/toolbox.md**](./docs/toolbox.md)

### 30 秒上手

```bash
git clone https://github.com/runesleo/polymarket-toolkit.git && cd polymarket-toolkit
./bin/pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
```

**你会得到：** LB PnL 快照 + 首页持仓样本。需要审计级 PnL 请用 `polymarket-pnl` skill。

**V2 升级后 merge/split 挂了？** → [`docs/v2-ctf-ops-faq.md`](./docs/v2-ctf-ops-faq.md) + `./bin/pm v2-check 0x…`

---

## CLI（`pm`）

需要 Node **22+**（使用 `--experimental-strip-types`）。在仓库根目录：

```bash
./bin/pm help
./bin/pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
./bin/pm profile Theo4 --json
./bin/pm brier 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
./bin/pm redeem 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
./bin/pm markets --limit 5 --active
./bin/pm activity 0x63ce342161250d705dc0b16df89036c8e5f9ba9a --type TRADE --max-pages 5
```

推荐直接用 `./bin/pm`（无需 install）。也可：`npm run pm -- profile …` · 可选 `npm link` 装全局 `pm`。

| 命令 | 作用 |
|------|------|
| `pm profile` | LB PnL + 持仓样本 + Brier 提示 |
| `pm activity` | Activity 分页（v2 游标）+ 未读完警告 |
| `pm scan` | 按 24h 成交量 + spread 扫市场 |
| `pm updown` | Crypto updown 事件字段 / resolution 来源 |
| `pm v2-check` | V2 CTF split/merge 清单 + activity 样本 |
| `pm lb` | 排行榜快照 + 日环比 diff |
| `pm pnl-check` | LB 快照 + 提示 — 非审计级 PnL |
| `pm limits` | 官方 API 限速表 |
| `pm brier` | 已结算持仓的 Brier 分数（样本） |
| `pm redeem` | 只读 redeem watchdog JSON |
| `pm markets` | Gamma 市场快扫 |

审计级 PnL（Python）：`python3 skills/polymarket-pnl/compute_precise_pnl.py --address …`

---

## TypeScript 库

零依赖 helper 在 [`src/index.ts`](./src/index.ts)（需 Node **22+**）：

```bash
npx tsx examples/01-fetch-gamma-markets.ts
node --experimental-strip-types examples/01-fetch-gamma-markets.ts
```

- **Examples：** [`examples/`](./examples/) — 每个 API 模式一个编号脚本
- **Cookbook：** [`docs/cookbook.md`](./docs/cookbook.md) — 中英双语配方

---

## Skills（AI Agent）

| Skill | 作用 |
|-------|------|
| `polymarket-profile` | 深度画像 — PnL、胜率、持仓、品类、策略识别 |
| `polymarket-brier` | 预测准确度（Brier Score）与校准分析 |
| `polymarket-pnl` | 现金流重建审计级 PnL（相对官方 ~0.2% MAPE） |

安装：将所需 skill 复制到你的 Agent 客户端所配置的 skills 目录。
`polymarket-pnl` 另需：`pip install httpx`

详细说明：[`skills/*/SKILL.md`](./skills/) · 长文档见 [English README](./README.md#skills-ai-agents) 各 Skill 章节。

---

## 本仓库范围

| 包含 | 不包含 |
|------|--------|
| 只读 API、CLI、Skills、文档、模板 | 私钥、签名、代发交易 |
| V2 FAQ + `pm v2-check` 诊断清单 | merge/split/redeem **执行**模块 |
| `polymarket-pnl` 审计脚本 | 托管钱包或一键下单 |
| 可选 [`executor/`](./executor) 子包（依赖隔离、默认 dry-run） | 托管、策略逻辑、代客交易 |
| [`mcp/`](./mcp) MCP server — 给 AI agent 的只读工具（[docs/mcp.md](./docs/mcp.md)） | 通过 MCP 下单 |

核心（`src/`、CLI、Skills）**不**持有私钥、**不**代发交易。下单能力只存在于可选的 [`executor/`](./executor) 子包：用**你自己**通过 env 提供的私钥签名，默认 dry-run，核心代码永远不 import 它。正常 redeem 请用 Polymarket 官方 App。

---

## Redeem Watchdog（只读）

检查某地址在 Data API 中标记为 `redeemable=true` 的持仓 — **不签名、不代 redeem**。

```bash
./bin/pm redeem 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
npx tsx examples/15-redeem-watchdog.ts 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
```

输出：`redeemableCount`、按 condition 汇总、`estimatedRedeemableValue`（输出行 `currentValue=0`，不计入可领金额）。完整说明见 [English README · Redeem Watchdog](./README.md#redeem-watchdog-helpers)。

---

## 更新日志（摘要）

### v0.5 — Toolbox CLI

- `pm` CLI：profile · activity · scan · updown · v2-check · brier · redeem · markets · lb · pnl-check · limits
- Activity ~4000 行上限警告 · V2 CTF FAQ · 市场扫描 · 验证模板

### v0.4 — Redeem watchdog

- 只读 redeem 状态：`fetchRedeemablePositionsPage` · `summarizeRedeemablePositions` · `resolveRedeemMode`

### v0.3 — polymarket-pnl skill

- 现金流重建审计级 PnL（相对官方 leaderboard ~0.2% MAPE）

完整 release notes：[README.md](./README.md#release-notes)

还没 [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit) 账号？上方链接注册（作者 affiliate 链接，无额外费用）。

想自建下单 bot？可以直接从 [`executor/`](./executor) 子包起步（[docs/executor.md](./docs/executor.md)）：CLOB V2 限价单、默认 dry-run（`EXECUTOR_LIVE=1` 才真发单）、单笔名义额上限 `EXECUTOR_MAX_USD`（默认 $10）。经它发出的订单默认带作者 builder code，可 env 覆盖为你自己的、也可一键关闭 — 见 [`src/builder.ts`](./src/builder.ts) · [builder 归因说明](./docs/builder-attribution.md)。

---

## 已知限制

- Activity 翻页：Data API v1 约 4000 行就会卡住，v2 游标没有这个上限；`pm activity` / `fetchActivityPages` 在页数上限前没读完时仍会标记为不完整
- 用户名 → 地址自动解析仅适用于排行榜用户
- `pm pnl-check` = LB 快照，**不是** 审计级 PnL

---

## 路线图（摘要）

- [x] PnL / Brier / `pm profile` CLI
- [x] 市场扫描 `pm scan` · Crypto updown `pm updown`
- [x] V2 CTF FAQ + `pm v2-check`
- [x] Activity cap 警告 · 排行榜快照 `pm lb`
- [x] Redeem watchdog · 验证模板套件
- [ ] 交易风格标签 · 流动性深度 · Whale Alert · REST API

完整路线图见 [README.md](./README.md#roadmap)。

---

## 验证模板

策略从假设到 tiny-live 的文档骨架（MIT 公开模板）：

| 模板 | 用途 | 路径 |
|------|------|------|
| AI handoff | 跨 session 任务交接（7 字段） | [handoff-template.md](./docs/templates/handoff-template.md) |
| 回测报告 | 回测结论与 abandon line | [backtest-report-template.md](./docs/templates/backtest-report-template.md) |
| Paper checklist | 防假 paper · 成交规则与日志 | [paper-checklist.md](./docs/templates/paper-checklist.md) |
| Live gate 12 步 | tiny-live 技术 + 运维门禁 | [live-gate-checklist.md](./docs/templates/live-gate-checklist.md) |
| 平台变更 runbook | V2 / API 迁移应对 | [platform-change-runbook.md](./docs/templates/platform-change-runbook.md) |

另见 PnL 口径说明：[fee-inclusive-pnl.md](./docs/fee-inclusive-pnl.md) · 完整索引：[toolbox.md](./docs/toolbox.md)

> 模板是文档骨架；可跑的 paper/live 执行代码需在你自己的仓库里实现。

---

## 数据与网络访问

CLI、MCP server 和 skills 都在你自己的电脑上运行，只读取公开数据。没有遥测，不会把任何数据发给作者的服务器。不需要 API key，也不读取任何凭证。

查询地址或市场时，请求只会发往下面这些地方：

| 内容 | 发往哪里 |
|---|---|
| 盈亏、成交量、排行榜排名 | `data-api.polymarket.com`（`/v2/leaderboard`） |
| 持仓、活动记录、成交 | `data-api.polymarket.com` |
| 市场和事件信息 | `gamma-api.polymarket.com` |
| 订单簿和价格 | `clob.polymarket.com` |
| 官方 PnL 曲线（TypeScript 库） | `data-api.polymarket.com`（`/v2/user-pnl`） |
| 实时订单簿推送（TypeScript 库和示例） | `wss://ws-subscriptions-clob.polymarket.com` |
| 链上 pUSD 余额和区块时间（`pm cashflow`） | 公共 Polygon RPC，默认 `polygon.gateway.tenderly.co`，也可以用 `--rpc` 换成你自己的 |

安装插件时，MCP server 通过 `npx` 启动，会从 npm registry 下载固定版本的 `polymarket-toolkit-mcp` 及其依赖。`polymarket-pnl` skill 需要 `httpx`，由 `pip` 从 PyPI 下载。

只有可选的 [`executor/`](./executor) 子包会用到密钥，插件、skills 和 MCP server 都不会加载它。如果你自己运行它，它从 `EXECUTOR_*` 环境变量读取你的密钥，并且只在 `EXECUTOR_LIVE=1` 时把订单发到 `clob.polymarket.com`。这些订单默认带作者公开的 builder code，可以覆盖成你自己的，也可以关闭（见 [builder 归因说明](./docs/builder-attribution.md)）。

只保存在你本机的内容：用 `pm lb --save` 保存的排行榜快照（当前目录下的 `.pm-toolkit/lb-snapshots/`，MCP server 不会保存），以及 `polymarket-pnl` 的输出文件（默认是当前目录下的 `precise_pnl.jsonl`，可用 `--output` 指定路径）。

---

## 关于作者

*Leo ([@runes_leo](https://x.com/runes_leo)) — AI × Crypto 独立 builder。在 [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit) 交易，用 Claude Code 与 Codex 做数据与交易系统。*

*[leolabs.me](https://leolabs.me) — 写作 · 社群 · 开源工具 · 独立项目 · 全平台。*

*[X 订阅](https://x.com/runes_leo/creator-subscriptions/subscribe) — 付费内容每周更新，或请我喝杯咖啡 😁*

*Learn in public, Build in public.*

*Affiliate：上文 Polymarket 注册链可能产生 referral 奖励；与本 MIT 工具箱功能无关。*
