# Polymarket Toolkit Cookbook

Runnable snippets use the same helpers as [`examples/`](../examples/) (`src/index.ts`). **Requires Node 18+** and:

```bash
npx tsx script.ts
# Or, with no extra packages (Node 22+):
node --experimental-strip-types script.ts
```

No `dependencies` entries are required in this repo for these snippets; `npx tsx` pulls a runner on demand when your toolchain supports it.

---

## 1) Get a live midpoint price (REST)

**English**

You already know *which outcome token* you care about (from Gamma `clobTokenIds`). Polymarket’s CLOB exposes a compact midpoint read — ideal for dashboards where polling every few seconds is enough.

```ts
import { fetchClobMidpoint } from "./src/index.ts";

const tokenId = process.argv[2];
if (!tokenId) throw new Error("usage: node script <token_id>");
console.log(await fetchClobMidpoint(tokenId));
```

**Example output**

```text
{ mid: '0.525' }
```

**中文（本地化）**

手里已经有 Gamma 返回的某个 `token_id`（某条 outcome 的 CLOB 资产 id）时，最快看到「中间价」的方式就是打 midpoint。适合做轻量轮询：别一上来就挂 WebSocket，先确认这个字段是不是你要的口径。

```ts
import { fetchClobMidpoint } from "./src/index.ts";

const tokenId = process.argv[2];
if (!tokenId) throw new Error("用法：传入 token_id");
console.log(await fetchClobMidpoint(tokenId));
```

---

## 2) Stream order book updates (WebSocket)

**English**

Subscribe to the **market** channel with one or more asset ids. Below: print a few `book` / `best_bid_ask` frames, then exit. Production code should add reconnect, backoff, and periodic `PING` as described in Polymarket’s CLOB websocket docs.

```ts
import {
  createClobMarketWebSocket,
  sendClobMarketSubscribe,
} from "./src/index.ts";

const tokenId = process.argv[2];
if (!tokenId) throw new Error("usage: node script <token_id>");

let seen = 0;
const ws = createClobMarketWebSocket({
  onOpen: () => sendClobMarketSubscribe(ws, [tokenId], { customFeatureEnabled: true }),
  onMessage: (msg) => {
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const raw of batch) {
      const m = raw as { event_type?: string; bids?: unknown[]; asks?: unknown[] };
      const et = m.event_type;
      const bookLike = et === "book" || (Array.isArray(m.bids) && Array.isArray(m.asks));
      if (bookLike || et === "best_bid_ask" || et === "price_change") {
        console.log(et ?? "book_snapshot", m.bids?.[0], m.asks?.[0]);
        if (++seen >= 3) ws.close();
      }
    }
  },
});

setTimeout(() => ws.close(), 12_000);
```

**Example output (truncated)**

```text
book_snapshot { price: '0.01', size: '1041555.39' } { price: '0.99', size: '530334.25' }
price_change ...
```

**中文（本地化）**

要看盘口「推着走」，用 CLOB 的 market 通道最省事：把 `token_id` 丢进订阅消息，监听 `book` / `best_bid_ask` 即可。下面这段是教学用的最短路径——真实上线记得加重连、退避和心跳，不然 Wi‑Fi 抖一下你就断在半路。

```ts
import {
  createClobMarketWebSocket,
  sendClobMarketSubscribe,
} from "./src/index.ts";

const tokenId = process.argv[2];
if (!tokenId) throw new Error("用法：传入 token_id");

let seen = 0;
const ws = createClobMarketWebSocket({
  onOpen: () => sendClobMarketSubscribe(ws, [tokenId], { customFeatureEnabled: true }),
  onMessage: (msg) => {
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const raw of batch) {
      const m = raw as { event_type?: string; bids?: unknown[]; asks?: unknown[] };
      const et = m.event_type;
      const bookLike = et === "book" || (Array.isArray(m.bids) && Array.isArray(m.asks));
      if (bookLike || et === "best_bid_ask" || et === "price_change") {
        console.log(et ?? "book_snapshot", m.bids?.[0], m.asks?.[0]);
        if (++seen >= 3) ws.close();
      }
    }
  },
});

setTimeout(() => ws.close(), 12_000);
```

---

## 3) Scan active markets from Gamma

**English**

Discovery starts at Gamma: filter `active=true`, sort client-side if needed, then drill into `clobTokenIds` for pricing.

```ts
import { fetchGammaMarkets } from "./src/index.ts";

const markets = await fetchGammaMarkets({ limit: 5, active: true });
console.log(markets.map((m: { question?: string }) => m.question));
```

**Example output**

```text
[
  'Russia-Ukraine Ceasefire before GTA VI?',
  'Will GPT-6 be released by December 31, 2025?',
  ...
]
```

**中文（本地化）**

做「扫市场」通常从 Gamma 开始：`active=true` 先兜一圈活跃盘，再挑你关心的 `slug` / `conditionId`，最后才落到 CLOB 的 token 维度。别反着做——没有 Gamma 元数据，你很难解释某个 token 到底代表哪条问题。

```ts
import { fetchGammaMarkets } from "./src/index.ts";

const markets = await fetchGammaMarkets({ limit: 5, active: true });
console.log(markets.map((m: { question?: string }) => m.question));
```

---

## 4) Pull the Data API PnL leaderboard

**English**

This endpoint returns `rank`, `userName`, `pnl`, and `proxyWallet` — handy when you want a typed ranking object distinct from the LB `/profit` array shape.

```ts
import { fetchDataLeaderboardPnL } from "./src/index.ts";

const rows = await fetchDataLeaderboardPnL({ limit: 10, offset: 0 });
console.log(rows[0]);
```

**Example output**

```text
{
  rank: '1',
  userName: 'SomeTrader',
  pnl: 1234567.89,
  proxyWallet: '0xabc...',
  vol: 9876543.21,
  ...
}
```

**中文（本地化）**

Data API 的 leaderboard 行结构更「报表向」：带 `rank`、`vol`、`userName`。如果你在做内部排行榜或想把链上地址和展示名对齐，这个端点往往比纯 LB 数组少写几层适配。

```ts
import { fetchDataLeaderboardPnL } from "./src/index.ts";

const rows = await fetchDataLeaderboardPnL({ limit: 10, offset: 0 });
console.log(rows[0]);
```

---

## 5) Resolve a username to a proxy wallet (ranked users)

**English**

`resolveLbUsernameToProxyWallet` scans LB `/profit` pages and matches `name` / `pseudonym`. Unranked accounts will not resolve — that is expected.

```ts
import { resolveLbUsernameToProxyWallet } from "./src/index.ts";

console.log(await resolveLbUsernameToProxyWallet("Theo4", 4));
```

**Example output**

```text
0x56687bf447db6ffa42ffe2204a05edaa20f55839
```

**中文（本地化）**

把「显示名 → 0x」这件事不要想得太神奇：实现就是翻利润榜分页做大小写不敏感匹配。没在榜上出现的号，脚本诚实返回 `null` 才是对的——这时让用户自己从页面复制地址，比瞎猜一个链上身份安全得多。

```ts
import { resolveLbUsernameToProxyWallet } from "./src/index.ts";

console.log(await resolveLbUsernameToProxyWallet("Theo4", 4));
```

---

## 6) Fetch one page of positions

**English**

Positions power both profile views and Brier inputs. Start with `offset=0`, then increase by `limit` while a full page is returned.

```ts
import { fetchPositionsPage } from "./src/index.ts";

const user = process.argv[2];
if (!user) throw new Error("usage: node script <0xaddress>");
console.log(await fetchPositionsPage(user, { limit: 5, offset: 0 }));
```

**Example output (shape)**

```text
[
  {
    title: 'Some market title',
    outcome: 'Yes',
    size: 123.45,
    avgPrice: 0.42,
    curPrice: 0.55,
    redeemable: false,
    ...
  }
]
```

**中文（本地化）**

仓位接口是典型「满页再翻」：`limit` 张满 `100` 就 `offset += 100` 继续拉。第一页就能验证地址是否写对、字段是不是你期望的版本——别等全量拉完才发现 `user` 传错。

```ts
import { fetchPositionsPage } from "./src/index.ts";

const user = process.argv[2];
if (!user) throw new Error("用法：传入 0x 地址");
console.log(await fetchPositionsPage(user, { limit: 5, offset: 0 }));
```

---

## 7) Fetch a slice of on-chain activity

**English**

Use `type` to focus on `TRADE`, `REDEEM`, etc. Cursor with `end` follows Polymarket’s Data API semantics used in the skills — see `skills/polymarket-profile/SKILL.md` for full pagination.

```ts
import { fetchActivityPage } from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
console.log(await fetchActivityPage(user, { limit: 20, type: "TRADE" }));
```

**Example output**

```text
[
  { type: 'TRADE', side: 'BUY', usdcSize: 12.34, title: '...', timestamp: 1710000000 },
  ...
]
```

**中文（本地化）**

做流水分析时先用 `type=TRADE` 把噪声砍掉一半。真要审计级回放，去看 profile / pnl 两个 SKILL 里写的分页细节：同一秒挤满一页时的边界条件，处理不好会漏单。

```ts
import { fetchActivityPage } from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
console.log(await fetchActivityPage(user, { limit: 20, type: "TRADE" }));
```

---

## 8) Load event metadata (`events?slug=`)

**English**

Markets embed their parent event. Use that slug to fetch richer metadata (tags, copy, timing).

```ts
import { fetchGammaEventsBySlug } from "./src/index.ts";

const slug = process.argv[2];
if (!slug) throw new Error("usage: node script <event_slug>");
console.log(await fetchGammaEventsBySlug(slug));
```

**Example output**

```text
[ { title: 'What will happen before GTA VI?', category: 'Pop-Culture', tags: [ ... ] } ]
```

**中文（本地化）**

如果你要画「事件级」信息架构，别只盯着单条 market：父级 `event` 才有更完整的叙事字段和标签。Gamma 的 `events?slug=` 就是干这个的。

```ts
import { fetchGammaEventsBySlug } from "./src/index.ts";

const slug = process.argv[2];
if (!slug) throw new Error("用法：传入 event slug");
console.log(await fetchGammaEventsBySlug(slug));
```

---

## 9) Compare LB PnL windows for one address

**English**

`fetchLbProfitForAddress` accepts `all | 7d | 30d`. Empty arrays simply mean “no row for that window” — common for inactive wallets.

```ts
import { fetchLbProfitForAddress } from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
for (const w of ["all", "7d", "30d"] as const) {
  const rows = await fetchLbProfitForAddress(user, w);
  console.log(w, rows[0] ?? "(empty)");
}
```

**Example output**

```text
all { amount: 12345.67, name: 'SomeTrader', ... }
7d (empty)
30d (empty)
```

**中文（本地化）**

短期窗口为空不代表程序坏了，很多时候就是这段时间没产生可统计的 leaderboard 行。做展示时把「空数组」解释给用户，比硬显示 0 更诚实。

```ts
import { fetchLbProfitForAddress } from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
for (const w of ["all", "7d", "30d"] as const) {
  const rows = await fetchLbProfitForAddress(user, w);
  console.log(w, rows[0] ?? "(empty)");
}
```

---

## 10) Compute a Brier score from settled positions

**English**

`computeBrierScoreFromSettledPositions` filters `redeemable=true`, treats `avgPrice` as the forecast, and maps wins to `actual=1`. It is the same simplified model described in `skills/polymarket-brier/SKILL.md`.

```ts
import {
  computeBrierScoreFromSettledPositions,
  fetchPositionsPage,
} from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const positions = await fetchPositionsPage(user, { limit: 500, offset: 0 });
console.log(computeBrierScoreFromSettledPositions(positions as never[]));
```

**Example output**

```text
{ brier: 0.1823, n: 36, wins: 29 }
```

**中文（本地化）**

Brier 看的是「预测概率 vs 真实结果」，跟仓位大小无关。这里用 `avgPrice` 当初概率是刻意简化：真要做论文级严谨，再去读 brier SKILL 里关于 DCA、SPLIT 仓位的注意项。

```ts
import {
  computeBrierScoreFromSettledPositions,
  fetchPositionsPage,
} from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const positions = await fetchPositionsPage(user, { limit: 500, offset: 0 });
console.log(computeBrierScoreFromSettledPositions(positions as never[]));
```

---

## 11) Watch redeemable positions without private keys

**English**

`fetchRedeemablePositionsPage` reads the public Data API with `redeemable=true`. After Polymarket's pUSD-era redemption shipped, normal user redemption happens inside the official app. This helper is the read-only status lane for agents: it surfaces every row the Data API still flags as `redeemable=true`, including losing tokens whose `currentValue` is `0` (correct — they redeem to $0). `summarizeRedeemablePositions` groups by `conditionId` and sums `currentValue`, so losing rows contribute `0` rather than being inflated to their `size`. The helper does not sign transactions or redeem funds.

```ts
import {
  fetchRedeemablePositionsPage,
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const rows = await fetchRedeemablePositionsPage(user, { limit: 100 });
console.log({
  mode: resolveRedeemMode({ lowWatermark: 25 }),
  ...summarizeRedeemablePositions(rows as never[]),
});
```

**Example output (losing rows surfaced honestly as $0)**

```text
{
  mode: 'low_watermark',
  redeemableCount: 3,
  conditionCount: 3,
  estimatedRedeemableValue: 0,
  topConditions: [
    { conditionId: '0x...', slug: 'btc-updown-5m-...', count: 1, estimatedCurrentValue: 0 },
    ...
  ]
}
```

**中文（本地化）**

官方 pUSD redeem 流程负责正常领取，agent 侧需要的是只读「看板口径」：这个钱包当下还有哪些行被 Data API 标成 `redeemable=true`、payable 价值（`currentValue`）多少、是否低于策略资金水位。注意 losing token redeem 拿 $0，所以 `currentValue=0` 是正确口径，helper 不会把 `size` 误当作 payable 拉高数字。只读公开 API，可直接接 dashboard、日报、agent 工作流。

```ts
import {
  fetchRedeemablePositionsPage,
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "./src/index.ts";

const user = process.argv[2] ?? "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const rows = await fetchRedeemablePositionsPage(user, { limit: 100 });
console.log({
  mode: resolveRedeemMode({ lowWatermark: 25 }),
  ...summarizeRedeemablePositions(rows as never[]),
});
```

---

## See also

- [`examples/`](../examples/) — numbered demos (`npx tsx examples/01-fetch-gamma-markets.ts`, or `node --experimental-strip-types …` on Node 22+)
- [`src/index.ts`](../src/index.ts) — exported helpers this cookbook calls
