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

## FAQ

### Do I need builder attribution if I only trade my own account?

Usually no. If you are only routing your own strategy account, builder attribution is mostly a bookkeeping check, not a meaningful revenue source. The helper exists so executor authors do not silently ship all-zero `builderCode` defaults when their tools are later used by other people.

### Is `builderCode` the same as Builder API credentials?

No. `builderCode` is a public bytes32 attribution value attached to order arguments. It is not a private key, HMAC secret, API token, relayer credential, wallet, or permission to trade. Keep Builder API credentials and wallet signing code out of this repo.

### Does receiving builder fees mean every order path is configured correctly?

Not by itself. Fees or rewards can prove one path is working, but you should still inspect the order arguments your executor sends and confirm which order types are eligible under the current Polymarket program rules. This helper only attaches or resolves the `builderCode`; it does not verify reward eligibility.

### What should public tools expose?

Public tools should make attribution explicit: document the default, allow users to override it with their own code, provide an opt-out path, and disclose that the author may receive builder program rewards. Hidden attribution is bad product behavior even when the value is public.

## What this repo does NOT include today

- No `createClobClient` / signing / live order submission in MIT CLI
- No Builder API HMAC secrets (never commit those)
- Read-only tools (`pm profile`, skills, examples 01–20) do not attach builder codes

Execution belongs in your wallet stack or a future executor module that imports `src/builder.ts`.
