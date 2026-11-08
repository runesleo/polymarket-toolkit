import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_API_V2_BASE,
  DATA_API_V2_MAX_PAGE,
  computeExecutionMix,
  fetchActivityPage,
  fetchDataLeaderboardPnL,
  fetchLbProfitForAddress,
  fetchMarketTrades,
  fetchPositionsPage,
  fetchUserPnlSeries,
  fetchUserTrades,
  resolveLbUsernameToProxyWallet,
} from "../src/index.ts";

/**
 * The Data API v1 → v2 move (v1 answers 410 since 2026-11-03) as seen by the
 * exported fetchers: v2 URLs and parameter names go out, v1-named rows come
 * back, and `offset` / `limit` keep their v1 meaning on top of cursor paging.
 */

type Seen = { url: URL };

/** Serves `total` generated rows per request shape, `pageCap` at a time, cursor = next index. */
function fakeV2(
  makeRow: (i: number, url: URL) => Record<string, unknown>,
  total: number,
  pageCap = DATA_API_V2_MAX_PAGE,
): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    seen.push({ url });
    if (url.searchParams.has("offset")) return new Response('{"error":"offset"}', { status: 400 });
    if (url.searchParams.has("market")) return new Response('{"error":"market"}', { status: 400 });
    const limit = Number(url.searchParams.get("limit") ?? 100);
    if (limit > DATA_API_V2_MAX_PAGE) return new Response('{"error":"limit"}', { status: 400 });
    const from = Number(url.searchParams.get("cursor") ?? 0);
    const count = Math.max(0, Math.min(limit, pageCap, total - from));
    const data = Array.from({ length: count }, (_, i) => makeRow(from + i, url));
    const next = from + count < total ? String(from + count) : null;
    return new Response(JSON.stringify({ data, pagination: { next_cursor: next } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const v2Trade = (i: number, url: URL) => ({
  proxy_wallet: url.searchParams.get("user") ?? `0xother${i % 3}`,
  side: i % 2 ? "SELL" : "BUY",
  token_id: `tok${i % 2}`,
  condition_id: "0xcond",
  size: 10 + i,
  price: 0.5,
  timestamp: 2_000_000 - i,
  title: "Some market",
  outcome: "Yes",
  transaction_hash: `0xtx${i}`,
});

test("fetchUserTrades reads /v2/trades with taker_only=false and returns v1 TradeRows", async () => {
  const fake = fakeV2(v2Trade, 3);
  try {
    const rows = await fetchUserTrades("0xme", { limit: 3 });
    const u = fake.seen[0]!.url;
    assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/trades`);
    assert.equal(u.searchParams.get("user"), "0xme");
    assert.equal(u.searchParams.get("taker_only"), "false");
    assert.equal(u.searchParams.get("takerOnly"), null);
    assert.deepEqual(rows[0], {
      proxyWallet: "0xme",
      side: "BUY",
      asset: "tok0",
      conditionId: "0xcond",
      size: 10,
      price: 0.5,
      timestamp: 2_000_000,
      title: "Some market",
      outcome: "Yes",
      transactionHash: "0xtx0",
    });
  } finally {
    fake.restore();
  }
});

test("fetchUserTrades honours a v1 offset by reading past it, never by sending it", async () => {
  const fake = fakeV2(v2Trade, 10, 4);
  try {
    const rows = await fetchUserTrades("0xme", { limit: 3, offset: 2 });
    assert.deepEqual(rows.map((r) => r.transactionHash), ["0xtx2", "0xtx3", "0xtx4"]);
    assert.ok(fake.seen.every((s) => !s.url.searchParams.has("offset")));
  } finally {
    fake.restore();
  }
});

test("a limit above the 1000-row page cap is served by following the cursor", async () => {
  const fake = fakeV2(v2Trade, 5000);
  try {
    const rows = await fetchUserTrades("0xme", { limit: 2500 });
    assert.equal(rows.length, 2500);
    assert.equal(fake.seen.length, 3);
    assert.ok(fake.seen.every((s) => Number(s.url.searchParams.get("limit")) <= DATA_API_V2_MAX_PAGE));
    assert.equal(new Set(rows.map((r) => r.transactionHash)).size, 2500, "no row read twice");
  } finally {
    fake.restore();
  }
});

test("fetchMarketTrades filters by condition=, not v1's market=", async () => {
  const fake = fakeV2(v2Trade, 2);
  try {
    const rows = await fetchMarketTrades("0xcond", { limit: 2 });
    const u = fake.seen[0]!.url;
    assert.equal(u.searchParams.get("condition"), "0xcond");
    assert.equal(u.searchParams.get("market"), null);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.asset, "tok0");
  } finally {
    fake.restore();
  }
});

test("execution mix still works on converted v2 rows", async () => {
  // All fills: rows 0..5; taker-only: the odd rows, so both pages reach back to
  // row 5 and the comparable window covers all six. Converted rows must key identically.
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = new URL(String(input));
    const takerOnly = url.searchParams.get("taker_only") === "true";
    const idx = takerOnly ? [1, 3, 5] : [0, 1, 2, 3, 4, 5];
    const data = idx.map((i) => v2Trade(i, url));
    return new Response(JSON.stringify({ data, pagination: { next_cursor: null } }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const [all, taker] = await Promise.all([
      fetchUserTrades("0xme", { limit: 500, takerOnly: false }),
      fetchUserTrades("0xme", { limit: 500, takerOnly: true }),
    ]);
    const mix = computeExecutionMix(all, taker, { rowLimit: 500 });
    assert.equal(mix.total, 6);
    assert.equal(mix.taker, 3);
    assert.equal(mix.maker, 3);
    assert.equal(mix.orphanTakerFills, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchDataLeaderboardPnL sends v2 names (VOL→VOLUME) and returns v1-named rows", async () => {
  const fake = fakeV2(
    (i) => ({ rank: i + 1, user_id: `0xw${i}`, user_name: `u${i}`, pnl: 100 - i, volume: 1000 + i, verified: false }),
    5,
  );
  try {
    const rows = (await fetchDataLeaderboardPnL({
      limit: 2,
      offset: 0,
      timePeriod: "ALL",
      orderBy: "VOL",
      category: "sports",
    })) as Array<Record<string, unknown>>;
    const u = fake.seen[0]!.url;
    assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/leaderboard`);
    assert.equal(u.searchParams.get("time_period"), "all");
    assert.equal(u.searchParams.get("sort_by"), "VOLUME");
    assert.equal(u.searchParams.get("category"), "sports");
    assert.equal(u.searchParams.get("offset"), null);
    assert.deepEqual(rows[0], {
      rank: 1,
      proxyWallet: "0xw0",
      userName: "u0",
      xUsername: undefined,
      verifiedBadge: false,
      vol: 1000,
      pnl: 100,
      profileImage: undefined,
    });
  } finally {
    fake.restore();
  }
});

test("fetchPositionsPage maps sizeThreshold to filter_amount and v2 fields back to v1", async () => {
  const fake = fakeV2(
    (i) => ({
      proxy_wallet: "0xme",
      token_id: `tok${i}`,
      condition_id: `0xc${i}`,
      current_size: 5,
      avg_price: 0.25,
      entry_cost_usdc: 1.25,
      current_value: 5,
      unrealized_pnl: 3.75,
      current_price: 1,
      redeemable: true,
      status: "REDEEMABLE",
      slug: "m",
    }),
    1,
  );
  try {
    const rows = (await fetchPositionsPage("0xme", { limit: 200, sizeThreshold: 1 })) as Array<
      Record<string, unknown>
    >;
    const u = fake.seen[0]!.url;
    assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/positions`);
    assert.equal(u.searchParams.get("filter_type"), "TOKENS");
    assert.equal(u.searchParams.get("filter_amount"), "1");
    assert.equal(u.searchParams.get("sizeThreshold"), null);
    assert.equal(u.searchParams.get("status"), null, "default status (OPEN) carries unredeemed settled rows");
    const r = rows[0]!;
    assert.equal(r.size, 5);
    assert.equal(r.avgPrice, 0.25);
    assert.equal(r.initialValue, 1.25);
    assert.equal(r.currentValue, 5);
    assert.equal(r.cashPnl, 3.75);
    assert.equal(r.curPrice, 1);
    assert.equal(r.redeemable, true);
    assert.equal(r.conditionId, "0xc0");
  } finally {
    fake.restore();
  }
});

test("fetchActivityPage returns v1-named rows with usdcSize for the fee basis", async () => {
  const fake = fakeV2(
    (i) => ({ type: "TRADE", side: "BUY", size: 10, price: 0.5, usdc_size: 5.1, timestamp: 100 - i, token_id: "t" }),
    2,
  );
  try {
    const rows = (await fetchActivityPage("0xme", { limit: 2, type: "TRADE", end: 99 })) as Array<
      Record<string, unknown>
    >;
    const u = fake.seen[0]!.url;
    assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/activity`);
    assert.equal(u.searchParams.get("type"), "TRADE");
    assert.equal(u.searchParams.get("end"), "99");
    assert.equal(u.searchParams.get("start"), "1");
    assert.equal(rows[0]!.usdcSize, 5.1);
    assert.equal(rows[0]!.asset, "t");
  } finally {
    fake.restore();
  }
});

test("a body that is not the v2 envelope is an error, not an empty history", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof globalThis.fetch;
  try {
    await assert.rejects(fetchUserTrades("0xme"), /expected \{ data: \[\.\.\.\] \}/);
  } finally {
    globalThis.fetch = original;
  }
});

test("lb-api helpers read /v2/leaderboard and keep the lb-api row shape", async () => {
  const original = globalThis.fetch;
  const seen: URL[] = [];
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = new URL(String(input));
    seen.push(url);
    const user = url.searchParams.get("user");
    if (user === "0xnobody") return new Response('{"data":null}', { status: 200 });
    if (user) {
      const pnl = user === "0xuncomputed" ? 0 : 1234.5;
      return new Response(
        JSON.stringify({ data: { user_id: user, pnl, volume: 9000, rank_pnl: 7, user_name: "alice" } }),
        { status: 200 },
      );
    }
    // Board read for username resolution: two pages, the match on the second.
    const second = url.searchParams.get("cursor") === "p2";
    const data = second
      ? [{ rank: 501, user_id: "0xbob", user_name: "Bob", pnl: 1, volume: 1 }]
      : [{ rank: 1, user_id: "0xalice", user_name: "alice", pnl: 2, volume: 2 }];
    return new Response(JSON.stringify({ data, pagination: { next_cursor: second ? null : "p2" } }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const rows = (await fetchLbProfitForAddress("0xme", "7d")) as Array<Record<string, unknown>>;
    assert.equal(`${seen[0]!.origin}${seen[0]!.pathname}`, `${DATA_API_V2_BASE}/leaderboard`);
    assert.equal(seen[0]!.searchParams.get("time_period"), "week");
    assert.deepEqual(rows, [
      { proxyWallet: "0xme", amount: 1234.5, name: "alice", profileImage: undefined, rank: 7, volume: 9000 },
    ]);
    assert.deepEqual(await fetchLbProfitForAddress("0xnobody"), [], "unknown wallet: empty, as lb-api did");
    const [uncomputed] = (await fetchLbProfitForAddress("0xuncomputed")) as Array<Record<string, unknown>>;
    assert.equal(uncomputed!.amount, null, "pnl 0 against real volume is not a reading");

    assert.equal(await resolveLbUsernameToProxyWallet("BOB"), "0xbob");
    const boardCalls = seen.filter((u) => !u.searchParams.has("user"));
    assert.ok(boardCalls.every((u) => u.searchParams.get("sort_by") === "PNL" && !u.searchParams.has("offset")));
    assert.equal(boardCalls[1]!.searchParams.get("cursor"), "p2");
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchUserPnlSeries reads /v2/user-pnl and maps position_pnl to p", async () => {
  const original = globalThis.fetch;
  let seen: URL | null = null;
  globalThis.fetch = (async (input: Request | URL | string) => {
    seen = new URL(String(input));
    const points = [
      { timestamp: 100, position_pnl: 10, economic_pnl: 11 },
      { timestamp: 200, position_pnl: -5, economic_pnl: -4 },
    ];
    return new Response(JSON.stringify({ data: { proxy_wallet: "0xme", points } }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const series = await fetchUserPnlSeries("0xme", { interval: "1w", fidelity: "1d" });
    const u = seen as unknown as URL;
    assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/user-pnl`);
    assert.equal(u.searchParams.get("user"), "0xme");
    assert.equal(u.searchParams.get("interval"), "1w");
    assert.deepEqual(series, [{ t: 100, p: 10 }, { t: 200, p: -5 }]);
  } finally {
    globalThis.fetch = original;
  }
});
