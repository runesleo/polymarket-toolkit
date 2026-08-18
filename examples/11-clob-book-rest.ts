// 场景：用 REST 拉某 outcome token 的完整订单簿快照（bids/asks 档位）。
// Problem: 不想接 WebSocket 时，用 book 端点做一次性深度检查或回测采样。
// Run: npx tsx examples/11-clob-book-rest.ts
// API: fetchClobBook — GET clob /book?token_id=
// Notes: 返回体量可能较大；示例只打印最优买卖档摘要。
//
// ⚠️ 最重要的一条：**二元市场两个 token 的 book 是同一本共享订单簿的镜像呈现。**
//    token B 的 asks 就是 token A 的 bids 在 (1−p) 上的另一种显示，逐档数量完全相同。
//    所以「另一侧有个 0.99 的大卖墙」很可能只是「这一侧有个 0.01 的大买单」，
//    **不是一个可以吃掉的卖单**。本示例会把这件事直接打出来给你看。
//    判据：价格 p ↔ 1−p 对齐、且逐档 size 相同 ⇒ 镜像，不是独立挂单。
//    要确认某价位真的存在可成交的对手方，必须用同市场 trades prints 交叉验证。

import { fetchClobBook, fetchGammaMarkets, parseGammaMarketTokenIds } from "../src/index.ts";

type Level = { price: string; size: string };
type Book = { bids?: Level[]; asks?: Level[] };

const markets = (await fetchGammaMarkets({
  limit: 1,
  active: true,
  closed: false,
  order: "volume24hr",
  ascending: false,
})) as Array<{ clobTokenIds?: string; slug?: string }>;

const market = markets[0] ?? {};
const tids = parseGammaMarketTokenIds(market);
const [tidA, tidB] = tids;
if (!tidA) throw new Error("no token");

const bookA = (await fetchClobBook(tidA)) as Book;
console.log(`market: ${market.slug ?? "(unknown)"}`);
console.log("best bid", bookA.bids?.[0], "best ask", bookA.asks?.[0]);

if (!tidB) {
  console.log("\n(single-token market — no complementary book to compare)");
} else {
  const bookB = (await fetchClobBook(tidB)) as Book;

  // A 的 asks 应当等于 B 的 bids 在 (1−p) 上的镜像，size 逐档相同。
  const asksA = (bookA.asks ?? []).map((l) => [Number(l.price), Number(l.size)] as const);
  const bidsB = new Map(
    (bookB.bids ?? []).map((l) => [Number((1 - Number(l.price)).toFixed(4)), Number(l.size)]),
  );

  let matched = 0;
  const rows: string[] = [];
  for (const [price, size] of asksA.slice(0, 8)) {
    const mirrored = bidsB.get(Number(price.toFixed(4)));
    const same = mirrored != null && Math.abs(mirrored - size) < 1e-6;
    if (same) matched += 1;
    rows.push(
      `    A ask ${price.toFixed(4)} x ${size}` +
        `   ↔  B bid ${(1 - price).toFixed(4)} x ${mirrored ?? "—"}` +
        `   ${same ? "MIRROR" : "differs"}`,
    );
  }

  console.log("\n  Mirror check — A's asks vs B's bids at (1-p):");
  rows.forEach((r) => console.log(r));
  console.log(
    `\n  ${matched}/${Math.min(asksA.length, 8)} top levels match exactly in price and size.`,
  );
  console.log(
    "  A high match rate means these are one shared book shown twice — do not count" +
      "\n  the same liquidity on both sides, and do not read the far side as a wall you can hit.",
  );
}
