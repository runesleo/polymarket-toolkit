# V2 · CTF split / merge / convert · Builder FAQ

**Audience:** developers running their own bots (this repo).  
**Not included here:** signing, private keys, or on-chain execution — bring your own wallet stack.

---

## What are SPLIT / MERGE / CONVERT?

| Op | On-chain meaning | Typical use |
|----|------------------|-------------|
| **SPLIT** | USDC → YES + NO token pair for a condition | Inventory entry |
| **MERGE** | YES + NO → USDC back | Recycle capital, exit paired inventory |
| **CONVERT** | Neg-risk event: convert a subset of NO legs | Multi-outcome / neg-risk books only |

These are **CTF contract calls** (often via Gnosis Safe / proxy wallet), **not** CLOB REST “place order”.

Activity feed types you can audit read-only: `SPLIT`, `MERGE`, `CONVERSION` on `data-api.polymarket.com/activity`.

---

## “Upgraded to V2 and merge stopped working” — usual causes

1. **SDK / endpoint mismatch** — still on `@polymarket/clob-client` + old exchange addresses while chain expects V2 exchange + `clob-v2` / relayer-v2 paths for trading collateral (pUSD era).
2. **Wrong contract path** — regular vs **negRisk** markets use different adapters (`NegRiskAdapter.mergePositions` vs CTF `mergePositions` with collateral token + partition).
3. **Safe / proxy not approved** — CTF `setApprovalForAll` for adapter + exchange not set after wallet migration.
4. **Collateral** — V2 trading path may require **pUSD** balance / wrap from USDC.e; merge returns collateral token your code must recognize.
5. **Auth on CLOB vs on-chain** — “invalid authorization” on orders is separate from on-chain merge failures; check `signature_type`, funder, builder headers for CLOB only.
6. **Dry-run / env** — script still points at pre-V2 RPC calldata or old exchange address in local config.

**Read-only first step:**

```bash
./bin/pm activity 0xYourProxy --type MERGE --max-pages 3
./bin/pm activity 0xYourProxy --type SPLIT --max-pages 3
./bin/pm v2-check
```

If MERGE activity **stopped at cutover date** but SPLIT still happens → infra drift, not “merge disabled globally”.

---

## V2 infra alignment checklist (free layer)

Run: `./bin/pm v2-check` or `npx tsx examples/17-v2-ctf-readiness-checklist.ts`

| # | Item | Notes |
|---|------|--------|
| 1 | CTF address unchanged | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| 2 | Exchange contract | V2 exchange ≠ V1 — verify against Polymarket builder docs |
| 3 | CLOB client package | `@polymarket/clob-client-v2` for V2 order path |
| 4 | Relayer | `relayer-v2.polymarket.com` for gasless paths |
| 5 | Collateral env | `POLYMARKET_TRADING_COLLATERAL` / pUSD wrap path documented in your app |
| 6 | negRisk flag | Per-market: wrong adapter = revert on merge/split |
| 7 | Approvals | CTF → adapter + exchange after Safe deploy / key rotation |
| 8 | Order struct | V2 removes `nonce` field — stale code fails before you reach merge |

See Polymarket builder announcements and your own migration checklist for full cutover planning.

---

## What this repo covers

| In this repo | Out of scope |
|--------------|--------------|
| This FAQ + read-only activity probes | Runnable merge/split/convert modules |
| `pm v2-check` checklist | Your own signing / relayer integration |
| Cookbook + examples | Live execution without your infra |

---

## 中文摘要

- **merge 失败**多数是 **V2 基础设施没对齐**（合约地址、SDK、negRisk 路径、授权、pUSD），不是 Polymarket 关掉了 merge。
- **split / merge / convert** 是 **链上 CTF 操作**，和 CLOB 下单是两条线。
- 工具箱：**FAQ + 只读 activity + checklist**；真要跑 merge 需自己对齐 infra 后写执行层。
