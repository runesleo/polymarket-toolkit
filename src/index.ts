/**
 * Thin, dependency-free helpers around Polymarket public HTTP APIs (Gamma, Data, LB)
 * and the CLOB HTTP + market WebSocket channel. No API keys required.
 */

export const LB_API_BASE = "https://lb-api.polymarket.com";
export const DATA_API_BASE = "https://data-api.polymarket.com";
export const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
export const CLOB_API_BASE = "https://clob.polymarket.com";
export const CLOB_WS_MARKET_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const DEFAULT_TIMEOUT_MS = 20_000;

/** GET JSON with timeout; throws on non-2xx. */
export async function pmGetJson<T = unknown>(url: string | URL): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** LB API: PnL row(s) for a single proxy wallet (array, often one element). */
export async function fetchLbProfitForAddress(
  address: string,
  window: "all" | "7d" | "30d" = "all",
): Promise<unknown[]> {
  const u = new URL(`${LB_API_BASE}/profit`);
  u.searchParams.set("address", address);
  u.searchParams.set("window", window);
  return pmGetJson<unknown[]>(u);
}

/** LB API: one page of the profit leaderboard (for username search or scanning). */
export async function fetchLbProfitLeaderboardPage(options: {
  window?: string;
  limit?: number;
  offset?: number;
}): Promise<unknown[]> {
  const u = new URL(`${LB_API_BASE}/profit`);
  u.searchParams.set("window", options.window ?? "all");
  u.searchParams.set("limit", String(options.limit ?? 500));
  u.searchParams.set("offset", String(options.offset ?? 0));
  return pmGetJson<unknown[]>(u);
}

type LbUserRow = { name?: string; pseudonym?: string; proxyWallet?: string };

/** Resolve a display name via LB profit leaderboard pagination (ranked users only). */
export async function resolveLbUsernameToProxyWallet(
  username: string,
  maxPages = 4,
): Promise<string | null> {
  const needle = username.trim().toLowerCase();
  if (!needle) return null;
  for (let page = 0; page < maxPages; page++) {
    const rows = (await fetchLbProfitLeaderboardPage({
      limit: 500,
      offset: page * 500,
    })) as LbUserRow[];
    if (!rows.length) break;
    for (const row of rows) {
      const n = (row.name ?? "").toLowerCase();
      const p = (row.pseudonym ?? "").toLowerCase();
      if (n === needle || p === needle) {
        return row.proxyWallet ?? null;
      }
    }
    if (rows.length < 500) break;
  }
  return null;
}

/** Data API: PnL leaderboard (includes rank, vol, userName). */
export async function fetchDataLeaderboardPnL(options: {
  limit?: number;
  offset?: number;
  timePeriod?: string;
  orderBy?: string;
  category?: string;
}): Promise<unknown[]> {
  const u = new URL(`${DATA_API_BASE}/v1/leaderboard`);
  u.searchParams.set("timePeriod", options.timePeriod ?? "all");
  u.searchParams.set("orderBy", options.orderBy ?? "PNL");
  u.searchParams.set("category", options.category ?? "overall");
  u.searchParams.set("limit", String(options.limit ?? 50));
  u.searchParams.set("offset", String(options.offset ?? 0));
  return pmGetJson<unknown[]>(u);
}

/** Data API: one page of positions for a user. */
export async function fetchPositionsPage(
  user: string,
  options: { limit?: number; offset?: number; sizeThreshold?: number } = {},
): Promise<unknown[]> {
  const u = new URL(`${DATA_API_BASE}/positions`);
  u.searchParams.set("user", user);
  u.searchParams.set("sizeThreshold", String(options.sizeThreshold ?? 0));
  u.searchParams.set("limit", String(options.limit ?? 100));
  u.searchParams.set("offset", String(options.offset ?? 0));
  return pmGetJson<unknown[]>(u);
}

/** Data API: one page of activity (optionally filtered by type / cursor `end`). */
export async function fetchActivityPage(
  user: string,
  options: { limit?: number; end?: number; type?: string } = {},
): Promise<unknown[]> {
  const u = new URL(`${DATA_API_BASE}/activity`);
  u.searchParams.set("user", user);
  u.searchParams.set("limit", String(options.limit ?? 500));
  if (options.end != null) u.searchParams.set("end", String(options.end));
  if (options.type) u.searchParams.set("type", options.type);
  return pmGetJson<unknown[]>(u);
}

/** Gamma: events for a slug (array). */
export async function fetchGammaEventsBySlug(slug: string): Promise<unknown[]> {
  const u = new URL(`${GAMMA_API_BASE}/events`);
  u.searchParams.set("slug", slug);
  return pmGetJson<unknown[]>(u);
}

/** Gamma: markets list (pass any query Gamma supports, e.g. limit, active, tag_id). */
export async function fetchGammaMarkets(
  query: Record<string, string | number | boolean> = {},
): Promise<unknown[]> {
  const u = new URL(`${GAMMA_API_BASE}/markets`);
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, String(v));
  }
  return pmGetJson<unknown[]>(u);
}

/** Parse `clobTokenIds` from a Gamma market object (JSON string of token id array). */
export function parseGammaMarketTokenIds(market: { clobTokenIds?: string }): string[] {
  const raw = market.clobTokenIds;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String);
  } catch {
    return [];
  }
}

/** CLOB REST: full order book snapshot for an outcome token id. */
export async function fetchClobBook(tokenId: string): Promise<unknown> {
  const u = new URL(`${CLOB_API_BASE}/book`);
  u.searchParams.set("token_id", tokenId);
  return pmGetJson(u);
}

/** CLOB REST: midpoint price string for a token id. */
export async function fetchClobMidpoint(tokenId: string): Promise<{ mid?: string }> {
  const u = new URL(`${CLOB_API_BASE}/midpoint`);
  u.searchParams.set("token_id", tokenId);
  return pmGetJson(u);
}

/** Open the public CLOB market WebSocket (caller should send subscribe payload on `open`). */
export function createClobMarketWebSocket(handlers: {
  onOpen?: (ws: WebSocket) => void;
  onMessage?: (data: unknown, raw: string) => void;
  onError?: (err: unknown) => void;
  onClose?: (code: number, reason: string) => void;
}): WebSocket {
  const ws = new WebSocket(CLOB_WS_MARKET_URL);
  ws.addEventListener("open", () => handlers.onOpen?.(ws));
  ws.addEventListener("message", (ev) => {
    const raw = String(ev.data);
    if (raw === "PONG" || raw === "PING") return;
    try {
      handlers.onMessage?.(JSON.parse(raw) as unknown, raw);
    } catch {
      handlers.onMessage?.(null, raw);
    }
  });
  ws.addEventListener("error", (e) => handlers.onError?.(e));
  ws.addEventListener("close", (ev) => handlers.onClose?.(ev.code, ev.reason));
  return ws;
}

/** Send initial or dynamic subscribe for asset (token) ids on the market channel. */
export function sendClobMarketSubscribe(
  ws: WebSocket,
  tokenIds: string[],
  options: { customFeatureEnabled?: boolean } = {},
): void {
  ws.send(
    JSON.stringify({
      assets_ids: tokenIds,
      type: "market",
      custom_feature_enabled: options.customFeatureEnabled ?? true,
    }),
  );
}

type PositionLike = {
  redeemable?: boolean;
  avgPrice?: number | string;
  currentValue?: number | string;
};

/** Brier score from settled positions only (avgPrice as forecast vs win/loss). */
export function computeBrierScoreFromSettledPositions(positions: PositionLike[]): {
  brier: number;
  n: number;
  wins: number;
} {
  const settled = positions.filter((p) => p.redeemable === true);
  if (!settled.length) return { brier: Number.NaN, n: 0, wins: 0 };
  let sumSq = 0;
  let wins = 0;
  for (const p of settled) {
    const f = Number(p.avgPrice);
    const won = Number(p.currentValue) > 0;
    if (won) wins++;
    const actual = won ? 1 : 0;
    sumSq += (f - actual) ** 2;
  }
  return { brier: sumSq / settled.length, n: settled.length, wins };
}
