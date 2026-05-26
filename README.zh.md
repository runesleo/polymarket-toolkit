# Polymarket Toolkit

**面向会写代码的 builder** — 基于 Polymarket 公开 API 的 CLI、TypeScript 工具库与 AI Skills。无需 API Key，无需签名。

[English README](./README.md)

---

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
| `pm activity` | Activity 分页 + **~4000 行上限警告** |
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

安装：`cp -R skills/polymarket-profile ~/.claude/skills/`（OpenClaw 同理）  
`polymarket-pnl` 另需：`pip install httpx`

详细说明：[`skills/*/SKILL.md`](./skills/) · 长文档见 [English README](./README.md#skills-ai-agents) 各 Skill 章节。

---

## 本仓库范围

| 包含 | 不包含 |
|------|--------|
| 只读 API、CLI、Skills、文档、模板 | 私钥、签名、代发交易 |
| V2 FAQ + `pm v2-check` 诊断清单 | merge/split/redeem **执行**模块 |
| `polymarket-pnl` 审计脚本 | 托管钱包或一键下单 |

本仓库**不**持有私钥、**不**代发交易。正常 redeem 请用 Polymarket 官方 App。

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

若你在**自建下单 bot** 里想支持作者，见 [builder 归因说明](./docs/builder-attribution.md)（仅对会发单的 executor 有效；本仓库只读工具本身不会附带 builder code）。

---

## 已知限制

- Activity API 约 **4000 行上限**：继续翻页可能返回重复 JSON — 用 `pm activity` / `fetchActivityPages` 或 `polymarket-pnl` 的 `pagination_incomplete` 标记
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

## 关于作者

*Leo ([@runes_leo](https://x.com/runes_leo)) — AI × Crypto 独立 builder。在 [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit) 交易，用 Claude Code 与 Codex 做数据与交易系统。*

*[leolabs.me](https://leolabs.me) — 写作 · 社群 · 开源工具 · 独立项目 · 全平台。*

*[X 订阅](https://x.com/runes_leo/creator-subscriptions/subscribe) — 付费内容每周更新，或请我喝杯咖啡 😁*

*Learn in public, Build in public.*

*Affiliate：上文 Polymarket 注册链可能产生 referral 奖励；与本 MIT 工具箱功能无关。*
