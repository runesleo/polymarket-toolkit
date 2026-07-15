# Executor (v0.6) — opt-in order execution

The core of this repo stays **zero-dependency, read-only, and key-free**. The
[`executor/`](../executor) directory is a separate, opt-in sub-package for people who want to
send CLOB V2 orders from their own code. It has its own `package.json` and dependencies
(`@polymarket/clob-client-v2`, `@ethersproject/wallet`) and is never imported by the core.

## Security model

| | Core (`src/`, `bin/pm`) | Executor (`executor/`) |
|---|---|---|
| Needs private key | No | Yes (your own, via env) |
| Sends orders | Never | Only with `EXECUTOR_LIVE=1` |
| Dependencies | None | Isolated in `executor/package.json` |
| Default mode | read-only | **dry-run** (prints payload, no network) |

Four independent guards before anything hits the network:

1. **Narrow façade** — `createExecutor()` never exposes the raw CLOB client; the only mutations
   reachable are `postLimitOrder()` and `cancelOrder()`, both gated below.
2. **Dry-run default** — `postLimitOrder()` returns the exact payload without sending unless
   `EXECUTOR_LIVE=1`.
3. **Notional cap** — live orders are re-priced from `price × size` at post time (a tampered
   order object cannot lie) and refused above `EXECUTOR_MAX_USD` (default **$10**).
4. **Credential validation + log redaction** — missing/malformed env credentials fail closed
   with the variable name only (values are never echoed), and live network calls scrub
   API-key/passphrase/signature headers from the underlying client's error logs.

## Quickstart (no keys needed)

```bash
cd executor
npm install
npm test          # unit tests, network-free
npm run dry-run   # prints a full order payload incl. builder attribution
```

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `EXECUTOR_PRIVATE_KEY` | live only | Signer key. Never committed, never defaulted. |
| `EXECUTOR_API_KEY` / `EXECUTOR_API_SECRET` / `EXECUTOR_API_PASSPHRASE` | live only | CLOB L2 API credentials. |
| `EXECUTOR_SIGNATURE_TYPE` | no (default `0`) | `0` EOA · `1` proxy · `2` Gnosis Safe · `3` deposit wallet (ERC-7739). |
| `EXECUTOR_FUNDER_ADDRESS` | for types 1–3 | Funding address; defaults to signer for EOA. |
| `EXECUTOR_LIVE` | no | Must be exactly `1` for any network mutation. |
| `EXECUTOR_MAX_USD` | no (default `10`) | Live notional cap per order. |
| `EXECUTOR_HOST` | no | CLOB host override. |

## Builder attribution (disclosure)

Orders sent through the executor carry the author's public builder code **by default**,
resolved by the core helper [`src/builder.ts`](../src/builder.ts):

- **Override**: `POLY_BUILDER_CODE=0x<64hex>` to attribute to your own builder profile.
- **Opt out**: `POLYMARKET_DISABLE_BUILDER_ATTRIBUTION=1` (or `POLY_BUILDER_CODE=none`), or pass
  `disableBuilderAttribution: true` to `createExecutor()`.
- **Fail safe**: a malformed override disables attribution entirely — it never silently falls
  back to the author's code.
- `executor.dryRun(order)` previews with the instance's actual resolved code, so what you see is
  what a live order would carry.

The builder code is a public bytes32 identifier, not a secret. The author may earn Polymarket
Builder Program rewards from attributed volume. The protocol also allows builders to configure
maker/taker fees server-side; **this author's builder fee is 0** and any change would be a
disclosed, versioned event — verify independently via the CLOB builder fee-rate endpoint if you
care. Full FAQ: [builder-attribution.md](./builder-attribution.md).

## Minimal usage

```ts
import { buildLimitOrder, createExecutor } from "./src/index.ts";

const executor = await createExecutor();             // reads EXECUTOR_* env
const order = buildLimitOrder({ tokenID: "…", price: 0.42, side: "BUY", size: 5 });
const result = await executor.postLimitOrder(order); // dry-run unless EXECUTOR_LIVE=1
console.log(result);
```

## Non-goals

- No strategy logic, no custody, no one-click trading, no market-order convenience wrappers.
- No deposit-wallet deployment / relayer flows (see roadmap Phase 2).
- The read-only CLI and skills will not grow order-sending features.
