# Referral & builder attribution

## Disclosure

- **Referral link** below may earn the author signup rewards (Polymarket affiliate program).
- **Builder code** below is the author's public Polymarket builder ID. When **you** submit CLOB orders through a future executor (or your own fork), orders may include this code for volume attribution. The author may earn builder program rewards. This read-only toolkit does **not** place orders by itself.
- Opt out anytime (see below). No hidden fees in read-only CLI/skills.

## 1. Referral link (signup)

```
https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit
```

## 2. Builder code (order routing)

Public bytes32 (from [Settings → Builder](https://polymarket.com/settings?tab=builder)):

```
0x6de189602628ae918a4d784164fc185d2604424b7aaf01ec4ddd8e30807e4fcb
```

**Default in code:** [`src/builder.ts`](../src/builder.ts) exports `DEFAULT_BUILDER_CODE` and `resolveBuilderCode()`. When you add order placement, call `withBuilderCode(orderArgs)` — same pattern as Polymarket's [Builder Program](https://docs.polymarket.com/builders/overview) docs.

```ts
import { withBuilderCode } from "./src/builder.ts";

const order = withBuilderCode({ tokenID, price, size });
// → builderCode attached unless you opt out
```

**Override or disable:**

```bash
POLY_BUILDER_CODE=0x<your-own-64-hex>   # use your builder code instead
POLY_BUILDER_CODE=none                    # disable attribution
POLYMARKET_DISABLE_BUILDER_ATTRIBUTION=1 # disable attribution
```

Demo: `npx tsx examples/21-builder-code-default.ts`

## What this repo does NOT include today

- No `createClobClient` / signing / live order submission in MIT CLI
- No Builder API HMAC secrets (never commit those)
- Read-only tools (`pm profile`, skills, examples 01–20) do not attach builder codes

Execution belongs in your wallet stack or a future executor module that imports `src/builder.ts`.
