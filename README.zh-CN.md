# Polymarket Toolkit

[English](./README.md)

面向 **Polymarket** 预测市场的 AI 工具集：为 Claude Code、OpenClaw、Cursor 等「能跑命令行」的 Agent 设计，通过 **公开 HTTPS** 读取数据（示例均为只读场景）。

## 示例与文档

- 仓库 [`examples/`](./examples/) 含 **10+** 独立可跑的 shell/Python 片段：多市场 Gamma 对比、CLOB 深度轮询、排行榜与持仓对照、以及调用 `polymarket-pnl` 做可审计级 PnL 等。  
- **v0.3** 起新增 Skill **`polymarket-pnl`**：用 Data API 现金流回放重建 PnL，与官方 `/profit` 公开数据对照约 **MAPE ~0.2%**。  
- 更完整的参数说明、安装方式、各 Skill 的输入输出约定，以英文 [README.md](./README.md) 为准（篇幅较长，避免双份漂移）。

## Skills 一览

| Skill | 用途 |
|-------|------|
| `polymarket-profile` | 地址级画像：PnL、胜率、持仓、品类、策略线索 |
| `polymarket-brier` | 预测校准 / Brier 类评分 |
| `polymarket-pnl` | 审计级 PnL（现金流重建，相对官方利润接口低误差） |

## 使用方式（概念）

1. 将本仓库克隆到本地，按英文 README 中各 Skill 目录说明配置（通常需 API 可达与可选 API Key，视具体工具而定）。  
2. 在 Agent 对话中引用对应命令或脚本路径执行；优先从 `examples/` 复制再改。  

## 许可与作者

以仓库根目录 **LICENSE** 为准。作者信息见英文 README **Author** 小节。
