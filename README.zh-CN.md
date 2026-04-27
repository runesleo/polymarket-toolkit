# Polymarket Toolkit

[English](./README.md)

面向 **Polymarket** 预测市场的 AI 工具集：为 Claude Code、OpenClaw、Cursor 等能执行 shell 命令的 Agent 设计，通过公开 HTTPS 读取数据（示例以只读场景为主）。

## v0.3 更新

**新 Skill：`polymarket-pnl`** — 基于 Data API 的现金流回放，得到可审计级 PnL。多数画像工具使用的持仓级 `cashPnL` 是近似值；本 Skill 回放每笔 BUY / SELL / REDEEM / MERGE / SPLIT / REBATE，并与当前未实现盈亏对齐。与公开排行榜官方 `/profit` 对照约 **MAPE ~0.2%**，头部账户误差多在 1% 以内。

## TypeScript 快速上手（公开 API）

零额外依赖的小型封装，覆盖 **Gamma**、**Data**、**LB**、**CLOB** 等公开端点，入口见 [`src/index.ts`](./src/index.ts)。需 **Node 18+**：

```bash
npx tsx examples/01-fetch-gamma-markets.ts
# Node 22+ 可直接：
node --experimental-strip-types examples/01-fetch-gamma-markets.ts
```

- **示例索引：** [`examples/`](./examples/) — 每个导出函数对应一个短脚本。  
- **双语菜谱：** [`docs/cookbook.md`](./docs/cookbook.md) — 十个常见任务（英文主文 + 中文改写），可复制片段与示例输出。

## Skills

| Skill | 用途 |
|-------|------|
| `polymarket-profile` | 地址级画像：PnL、胜率、持仓、品类、策略线索 |
| `polymarket-brier` | 预测校准与 Brier 类评分 |
| `polymarket-pnl` | 审计级 PnL（现金流重建，相对官方利润接口低误差） |

## 示例目录

[`examples/`](./examples/) 含多个独立可跑的 shell / Python / TypeScript 片段：多市场 Gamma 对比、CLOB 深度轮询、排行榜与持仓对照、调用 `polymarket-pnl` 做可审计级 PnL 等。详细命令、参数与输出格式以英文 [README.md](./README.md) 为准，避免双份文档长期漂移。

## 使用方式（概念）

1. 克隆仓库后，按英文 README 中各 Skill 目录说明安装（`polymarket-pnl` 需 `httpx` 等，见该 Skill 文档）。  
2. 在 Agent 对话中引用对应命令或脚本；优先从 `examples/` 复制再改。

## 许可与作者

以仓库根目录 **LICENSE** 为准。作者与外链见英文 README **About the author** 小节。
