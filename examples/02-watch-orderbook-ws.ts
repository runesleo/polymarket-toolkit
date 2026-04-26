// 场景：订阅 CLOB market WebSocket，打印前几帧盘口/ best bid ask（适合实时监控）。
// Problem: REST midpoint刷新有间隔；WebSocket 推送订单簿与价格变化更及时。
// Run: npx tsx examples/02-watch-orderbook-ws.ts
// API: createClobMarketWebSocket + sendClobMarketSubscribe + parseGammaMarketTokenIds。
// Notes: 8s 后自动关闭；生产环境需处理重连与 PING。

import {
  createClobMarketWebSocket,
  fetchGammaMarkets,
  parseGammaMarketTokenIds,
  sendClobMarketSubscribe,
} from "../src/index.ts";

const markets = (await fetchGammaMarkets({ limit: 1, active: true })) as Array<{ clobTokenIds?: string }>;
const tokenIds = parseGammaMarketTokenIds(markets[0] ?? {});
if (!tokenIds[0]) throw new Error("No token id from Gamma");

let n = 0;
const ws = createClobMarketWebSocket({
  onOpen: () => sendClobMarketSubscribe(ws, [tokenIds[0]]),
  onMessage: (data) => {
    const batch = Array.isArray(data) ? data : [data];
    for (const raw of batch) {
      const d = raw as { event_type?: string; bids?: unknown[]; asks?: unknown[]; best_bid?: string };
      const et = d.event_type;
      const bookLike = et === "book" || (Array.isArray(d.bids) && Array.isArray(d.asks));
      if (bookLike || et === "best_bid_ask" || et === "price_change") {
        console.log(et ?? "book_snapshot", "b0", d.bids?.[0], "a0", d.asks?.[0], "bb", d.best_bid);
        if (++n >= 4) ws.close();
      }
    }
  },
});

setTimeout(() => {
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}, 8_000);
