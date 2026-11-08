/**
 * Thin, dependency-free helpers around Polymarket public HTTP APIs (Gamma, Data, LB)
 * and the CLOB HTTP + market WebSocket channel. No API keys required.
 */

/**
 * Retired host (HTTP 410 since 2026-11-06, "use /v2/leaderboard"); the `Lb`
 * helpers below read Data API v2 instead.
 * @deprecated
 */
export const LB_API_BASE = "https://lb-api.polymarket.com";
export const DATA_API_BASE = "https://data-api.polymarket.com";
/**
 * Data API v2. The v1 routes (bare `/activity`, `/positions`, `/trades`,
 * `/v1/leaderboard`, ...) answer HTTP 410 since 2026-11-03.
 * Guide: https://docs.polymarket.com/migrate/data-api-v1-to-v2.md
 */
export const DATA_API_V2_BASE = `${DATA_API_BASE}/v2`;
/** v2 rejects `limit` above 1000 on every list route. */
export const DATA_API_V2_MAX_PAGE = 1000;
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

/* ------------------------------------------------------------------ *
 * Data API v2 plumbing
 *
 * What changed from v1, as far as these helpers are concerned:
 *   - every list response is wrapped: { data: [...], pagination: { next_cursor } }
 *   - pages are cursor-only; `offset` (even offset=0) is a 400
 *   - rows are snake_case (proxy_wallet, usdc_size, token_id, ...)
 *
 * The exported fetchers below still return v1-named rows (`toV1*Row`), so the
 * maths written against v1 — fee basis, execution mix, markout, Brier — is
 * untouched by the migration.
 * ------------------------------------------------------------------ */

type DataV2Params = Record<string, string | number | boolean | null | undefined>;
type V2Row = Record<string, unknown>;

export interface DataV2Page {
  rows: V2Row[];
  /** null once the upstream history is exhausted. */
  nextCursor: string | null;
}

/** One Data API v2 list page. Throws on non-2xx or on a body that is not the v2 list envelope. */
export async function fetchDataV2Page(
  path: string,
  params: DataV2Params,
  cursor?: string | null,
): Promise<DataV2Page> {
  const u = new URL(`${DATA_API_V2_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  // Restate the original params alongside the cursor: /v2/activity and
  // /v2/positions answer a cursor-only call with 400 ("user not provided").
  if (cursor) u.searchParams.set("cursor", cursor);
  const body = await pmGetJson<{ data?: unknown; pagination?: { next_cursor?: unknown } }>(u);
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    throw new Error(
      `Data API v2 ${path}: expected { data: [...] }, got ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  const c = body.pagination?.next_cursor;
  return {
    rows: body.data.filter((r): r is V2Row => !!r && typeof r === "object"),
    nextCursor: typeof c === "string" && c ? c : null,
  };
}

/**
 * Read rows `[skip, skip + take)` of a v2 list by following `next_cursor`.
 *
 * v2 has no offset, so a v1-style `offset` is honoured by reading past it, and
 * a `limit` above the 1000-row page cap is honoured by reading more pages.
 */
async function collectDataV2(
  path: string,
  params: DataV2Params,
  opts: { take: number; skip?: number },
): Promise<V2Row[]> {
  const skip = Math.max(0, Math.floor(opts.skip ?? 0));
  const want = skip + Math.max(0, Math.floor(opts.take));
  const out: V2Row[] = [];
  let cursor: string | null = null;
  while (out.length < want) {
    const page = await fetchDataV2Page(
      path,
      { ...params, limit: Math.min(DATA_API_V2_MAX_PAGE, want - out.length) },
      cursor,
    );
    out.push(...page.rows);
    if (!page.nextCursor || page.rows.length === 0) break;
    cursor = page.nextCursor;
  }
  return out.slice(skip, want);
}

/** v2 `/v2/activity` row → v1 `/activity` field names. */
export function toV1ActivityRow(r: V2Row): Record<string, unknown> {
  return {
    proxyWallet: r.proxy_wallet,
    timestamp: r.timestamp,
    conditionId: r.condition_id,
    type: r.type,
    size: r.size,
    usdcSize: r.usdc_size,
    transactionHash: r.transaction_hash,
    price: r.price,
    asset: r.token_id,
    side: r.side,
    outcomeIndex: r.outcome_index,
    outcome: r.outcome,
    title: r.title,
    slug: r.slug,
    icon: r.icon,
    eventSlug: r.event_slug,
    name: r.name,
    pseudonym: r.pseudonym,
  };
}

/**
 * v2 `/v2/positions` row → v1 `/positions` field names.
 * v1 `initialValue` ↔ fee-exclusive `entry_cost_usdc`, `cashPnl` ↔ `unrealized_pnl`,
 * `totalBought` (lifetime bought shares) ↔ `total_size`.
 */
export function toV1PositionRow(r: V2Row): Record<string, unknown> {
  return {
    proxyWallet: r.proxy_wallet,
    asset: r.token_id,
    conditionId: r.condition_id,
    size: r.current_size,
    avgPrice: r.avg_price,
    initialValue: r.entry_cost_usdc,
    currentValue: r.current_value,
    cashPnl: r.unrealized_pnl,
    percentPnl: r.percent_pnl,
    totalBought: r.total_size,
    realizedPnl: r.realized_pnl,
    percentRealizedPnl: r.percent_realized_pnl,
    curPrice: r.current_price,
    redeemable: r.redeemable,
    mergeable: r.mergeable,
    negativeRisk: r.negative_risk,
    title: r.title,
    slug: r.slug,
    icon: r.icon,
    eventId: r.event_id,
    eventSlug: r.event_slug,
    outcome: r.outcome,
    outcomeIndex: r.outcome_index,
    oppositeOutcome: r.opposite_outcome,
    oppositeAsset: r.opposite_token_id,
    endDate: r.end_date,
    status: r.status,
  };
}

/** v2 `/v2/leaderboard` row → v1 `/v1/leaderboard` field names. */
export function toV1LeaderboardRow(r: V2Row): Record<string, unknown> {
  return {
    rank: r.rank ?? r.rank_pnl,
    proxyWallet: r.user_id,
    userName: r.user_name,
    xUsername: r.x_username,
    verifiedBadge: r.verified,
    vol: r.volume,
    pnl: r.pnl,
    profileImage: r.profile_image,
  };
}

/** v2 `/v2/trades` row → v1 `/trades` field names (`TradeRow`). */
export function toV1TradeRow(r: V2Row): TradeRow {
  return {
    proxyWallet: r.proxy_wallet as string,
    side: r.side as "BUY" | "SELL",
    asset: r.token_id as string,
    conditionId: r.condition_id as string,
    size: r.size as number,
    price: r.price as number,
    timestamp: r.timestamp as number,
    title: r.title as string | undefined,
    outcome: r.outcome as string | undefined,
    transactionHash: r.transaction_hash as string | undefined,
  };
}

/*
 * lb-api.polymarket.com answers HTTP 410 ("retired, use /v2/leaderboard") as
 * of 2026-11-06. The three `Lb` helpers keep their names and their lb-api row
 * shape (`amount`, `name`, `proxyWallet`) but read Data API v2 `/v2/leaderboard`.
 */

/** lb-api window → v2 leaderboard `time_period` (v2 names these `week` / `month`; it has no "7d" / "30d"). */
const LB_WINDOW_TO_V2_PERIOD: Record<string, string> = { all: "all", "7d": "week", "30d": "month" };

function lbTimePeriod(window: string | undefined): string {
  const w = (window ?? "all").toLowerCase();
  return LB_WINDOW_TO_V2_PERIOD[w] ?? w;
}

/**
 * v2 leaderboard row → lb-api `/profit` row.
 *
 * `amount` is null — not 0 — when v2 reports `pnl: 0` against a non-zero
 * volume. Measured 2026-11-06: `/v2/leaderboard?time_period=all&user=` gives
 * exactly 0.0 for some wallets with real volume (not computed yet), and a later
 * re-read returned a real figure for several of them. A traded wallet landing
 * on exactly $0.00 is not a reading worth trusting.
 */
export function toLbProfitRow(r: V2Row): Record<string, unknown> {
  const pnl = typeof r.pnl === "number" ? r.pnl : r.pnl == null ? null : Number(r.pnl);
  const volume = Number(r.volume ?? 0);
  const uncomputed = pnl === 0 && Number.isFinite(volume) && volume > 0;
  return {
    proxyWallet: r.user_id,
    amount: uncomputed || pnl == null || !Number.isFinite(pnl) ? null : pnl,
    name: r.user_name,
    profileImage: r.profile_image,
    rank: r.rank ?? r.rank_pnl,
    volume: r.volume,
  };
}

/** PnL row for a single proxy wallet (array of zero or one lb-api-shaped rows), from `/v2/leaderboard?user=`. */
export async function fetchLbProfitForAddress(
  address: string,
  window: "all" | "7d" | "30d" = "all",
): Promise<unknown[]> {
  const u = new URL(`${DATA_API_V2_BASE}/leaderboard`);
  u.searchParams.set("user", address);
  u.searchParams.set("time_period", lbTimePeriod(window));
  const body = await pmGetJson<{ data?: unknown }>(u);
  const row = body && typeof body === "object" ? body.data : undefined;
  // Unknown wallets are `{ "data": null }`, which lb-api expressed as [].
  return row && typeof row === "object" && !Array.isArray(row) ? [toLbProfitRow(row as V2Row)] : [];
}

/** One page of the all-category PnL leaderboard as lb-api-shaped rows (for username search or scanning). */
export async function fetchLbProfitLeaderboardPage(options: {
  window?: string;
  limit?: number;
  offset?: number;
}): Promise<unknown[]> {
  const rows = await collectDataV2(
    "/leaderboard",
    { time_period: lbTimePeriod(options.window), sort_by: "PNL", category: "overall" },
    { take: options.limit ?? 500, skip: options.offset },
  );
  return rows.map(toLbProfitRow);
}

/**
 * Resolve a display name by scanning the all-time PnL leaderboard (ranked users
 * only), `maxPages` pages of 500. v2 board rows carry `user_name` only, so a
 * pseudonym no longer matches.
 */
export async function resolveLbUsernameToProxyWallet(
  username: string,
  maxPages = 4,
): Promise<string | null> {
  const needle = username.trim().toLowerCase();
  if (!needle) return null;
  const params: DataV2Params = { time_period: "all", sort_by: "PNL", category: "overall", limit: 500 };
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const { rows, nextCursor } = await fetchDataV2Page("/leaderboard", params, cursor);
    for (const row of rows) {
      if (String(row.user_name ?? "").toLowerCase() === needle) {
        return typeof row.user_id === "string" ? row.user_id : null;
      }
    }
    if (!nextCursor || rows.length === 0) break;
    cursor = nextCursor;
  }
  return null;
}

/**
 * Data API v2: PnL leaderboard (includes rank, vol, userName), as v1-named rows.
 * `orderBy` keeps the v1 spelling: `VOL` is sent as v2's `VOLUME`.
 */
export async function fetchDataLeaderboardPnL(options: {
  limit?: number;
  offset?: number;
  timePeriod?: string;
  orderBy?: string;
  category?: string;
}): Promise<unknown[]> {
  const orderBy = (options.orderBy ?? "PNL").toUpperCase();
  const rows = await collectDataV2(
    "/leaderboard",
    {
      time_period: (options.timePeriod ?? "all").toLowerCase(),
      sort_by: orderBy === "VOL" ? "VOLUME" : orderBy,
      category: options.category ?? "overall",
    },
    { take: options.limit ?? 50, skip: options.offset },
  );
  return rows.map(toV1LeaderboardRow);
}

/**
 * Data API v2: positions a user currently holds (v2 `status=OPEN`, which also
 * carries settled-but-unredeemed rows, as v1 `/positions` did), as v1-named rows.
 * `sizeThreshold` maps to v2's `filter_type=TOKENS&filter_amount`; v2 keeps a
 * 0.1-share dust floor below which it will not go.
 */
export async function fetchPositionsPage(
  user: string,
  options: { limit?: number; offset?: number; sizeThreshold?: number } = {},
): Promise<unknown[]> {
  const rows = await collectDataV2(
    "/positions",
    { user, filter_type: "TOKENS", filter_amount: options.sizeThreshold ?? 0 },
    { take: options.limit ?? 100, skip: options.offset },
  );
  return rows.map(toV1PositionRow);
}

/**
 * Policy label for an upstream agent/dashboard. This toolkit never executes
 * an active redeem; the label is a status hint for the caller's own wallet
 * system. Intentionally only two values — anything else is collapsed by
 * `resolveRedeemMode`.
 */
export type RedeemMode = "watchdog" | "low_watermark";

export type RedeemablePositionLike = {
  redeemable?: boolean;
  conditionId?: string;
  slug?: string;
  eventSlug?: string;
  title?: string;
  currentValue?: number | string | null;
  size?: number | string | null;
};

export type RedeemableConditionSummary = {
  conditionId: string;
  slug: string;
  count: number;
  /**
   * Sum of Data API `currentValue` for this condition. For losing redeemable
   * rows this is 0 — that is the correct payable amount, not a missing value.
   * Falls back to `size` only when `currentValue` is null/undefined.
   */
  estimatedCurrentValue: number;
};

export type RedeemablePositionsSummary = {
  redeemableCount: number;
  conditionCount: number;
  /** Sum of `estimatedCurrentValue` across all redeemable rows. Losing rows contribute 0. */
  estimatedRedeemableValue: number;
  topConditions: RedeemableConditionSummary[];
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function numeric(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Data API v2: redeemable positions (`status=REDEEMABLE`, winning and losing
 * rows alike), as v1-named rows. Public, no wallet key required.
 */
export async function fetchRedeemablePositionsPage(
  user: string,
  options: { limit?: number; offset?: number } = {},
): Promise<unknown[]> {
  const rows = await collectDataV2(
    "/positions",
    { user, status: "REDEEMABLE", filter_type: "TOKENS", filter_amount: 0 },
    { take: options.limit ?? 100, skip: options.offset },
  );
  return rows.map(toV1PositionRow);
}

/** Summarize redeemable Data API positions by condition, without signing or sending transactions. */
export function summarizeRedeemablePositions(
  positions: RedeemablePositionLike[],
): RedeemablePositionsSummary {
  const byCondition = new Map<string, RedeemableConditionSummary>();

  for (const position of positions) {
    if (position.redeemable !== true) continue;
    const conditionId = position.conditionId || "unknown";
    const slug = position.slug || position.eventSlug || position.title || conditionId;
    // currentValue is the Data API's payable amount (0 for losing redeemable
    // rows). Only fall back to size when the field is missing entirely.
    // Clamp at 0 — payable value cannot be negative even if the API ever
    // returns one (e.g. transient mark-to-market quirks).
    const raw =
      position.currentValue == null ? numeric(position.size) : numeric(position.currentValue);
    const estimatedCurrentValue = raw > 0 ? raw : 0;
    const row = byCondition.get(conditionId) ?? {
      conditionId,
      slug,
      count: 0,
      estimatedCurrentValue: 0,
    };
    row.count += 1;
    row.estimatedCurrentValue += estimatedCurrentValue;
    byCondition.set(conditionId, row);
  }

  const topConditions = [...byCondition.values()]
    .map((row) => ({ ...row, estimatedCurrentValue: round6(row.estimatedCurrentValue) }))
    .sort((a, b) => b.estimatedCurrentValue - a.estimatedCurrentValue);

  return {
    redeemableCount: topConditions.reduce((total, row) => total + row.count, 0),
    conditionCount: topConditions.length,
    estimatedRedeemableValue: round6(
      topConditions.reduce((total, row) => total + row.estimatedCurrentValue, 0),
    ),
    topConditions,
  };
}

/**
 * Resolve a policy label for upstream agents. Returns only `"watchdog"` or
 * `"low_watermark"` — this toolkit never executes redeems, so an `"active"`
 * label is intentionally not exposed. If the caller's own wallet system runs
 * an active redeem path, that label belongs in their layer, not here.
 */
export function resolveRedeemMode(options: {
  mode?: string;
  lowWatermark?: number;
} = {}): RedeemMode {
  const mode = (options.mode ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (mode === "low_watermark" || mode === "watermark" || mode === "on_demand") return "low_watermark";
  if (mode === "watchdog" || mode === "watch" || mode === "status" || mode === "dry_run") return "watchdog";
  return typeof options.lowWatermark === "number" && Number.isFinite(options.lowWatermark) && options.lowWatermark > 0
    ? "low_watermark"
    : "watchdog";
}

/**
 * v2 `/v2/activity` only reaches three years back unless told otherwise;
 * `start=1` is the documented way to ask for the whole history, which is what
 * v1 `/activity` returned.
 */
export const ACTIVITY_FULL_HISTORY_START = 1;

function activityParams(
  user: string,
  options: { end?: number; type?: string; sortDirection?: "ASC" | "DESC" },
): DataV2Params {
  return {
    user,
    start: ACTIVITY_FULL_HISTORY_START,
    end: options.end,
    type: options.type,
    sort_direction: options.sortDirection,
  };
}

/**
 * Data API v2: one read of activity (optionally filtered by type / upper bound
 * `end`), as v1-named rows. `offset` is honoured by reading past it — v2 itself
 * rejects the parameter.
 */
export async function fetchActivityPage(
  user: string,
  options: {
    limit?: number;
    end?: number;
    type?: string;
    offset?: number;
    sortDirection?: "ASC" | "DESC";
  } = {},
): Promise<unknown[]> {
  const rows = await collectDataV2("/activity", activityParams(user, options), {
    take: options.limit ?? 500,
    skip: options.offset,
  });
  return rows.map(toV1ActivityRow);
}

/**
 * Activity types read in ASC order.
 *
 * v1 returned MERGE and SPLIT empty under its default DESC ordering (measured
 * 2026-08-18: MERGE DESC 0 rows vs ASC 2562 on one wallet). v2 no longer does —
 * measured 2026-11-06 on two wallets, MERGE DESC and ASC returned the same
 * rows — but the cursor carries its direction, so asking in ASC costs nothing
 * and keeps the oldest-first order these readers have always printed.
 */
export const ACTIVITY_TYPES_NEEDING_ASC = new Set(["MERGE", "SPLIT"]);

/**
 * v1 `/activity` rejected offset > 5000 (measured 2026-08-18). v2 has no
 * offset at all and its cursor walks past 5000 rows (measured 2026-11-06,
 * 8000 TRADE rows on one wallet). Kept for callers that still import it.
 * @deprecated nothing in this package pages by offset any more.
 */
export const ACTIVITY_OFFSET_CAP = 5000;

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

/**
 * Community-reported effective row cap for Data API v1 `/activity` pagination.
 * v2's cursor has no such cap, so `fetchActivityPages` no longer warns on it.
 */
export const ACTIVITY_API_ROW_CAP_HINT = 4000;

export type ActivityPaginationWarningCode =
  | "DUPLICATE_PAGE"
  | "STALE_CURSOR"
  | "APPROACHING_CAP"
  | "INCOMPLETE";

export type ActivityPaginationWarning = {
  code: ActivityPaginationWarningCode;
  message: string;
};

/** Stable fingerprint to detect duplicate JSON pages (issue #1). */
export function fingerprintActivityPage(rows: unknown[]): string {
  return JSON.stringify(rows);
}

/** Build warnings from pagination probe results (pure · testable). */
export function analyzeActivityPaginationWarnings(options: {
  totalRows: number;
  sawDuplicatePage: boolean;
  sawStaleCursor: boolean;
  /** Stopped at `maxPages` while upstream still offered a `next_cursor`. */
  truncated?: boolean;
  /**
   * Row count that triggers APPROACHING_CAP; `null` turns it off. Defaults to
   * the v1 hint. v2's cursor has no such cap, so `fetchActivityPages` passes null.
   */
  rowCap?: number | null;
}): ActivityPaginationWarning[] {
  const warnings: ActivityPaginationWarning[] = [];
  const rowCap = options.rowCap === undefined ? ACTIVITY_API_ROW_CAP_HINT : options.rowCap;
  if (options.sawDuplicatePage) {
    warnings.push({
      code: "DUPLICATE_PAGE",
      message:
        `Activity API returned an identical page twice. Treat results as INCOMPLETE — shard by time window or use skills/polymarket-pnl \`pagination_incomplete\` flags.`,
    });
  }
  if (options.sawStaleCursor) {
    warnings.push({
      code: "STALE_CURSOR",
      message: "Activity cursor did not advance between pages. Pagination may have stalled.",
    });
  }
  if (options.sawDuplicatePage || options.sawStaleCursor) {
    warnings.push({
      code: "INCOMPLETE",
      message: "Activity pagination did not produce a complete scan. Shard by time window before relying on totals.",
    });
  } else if (options.truncated) {
    warnings.push({
      code: "INCOMPLETE",
      message: `Stopped at the page limit with more activity upstream (${options.totalRows} rows read). Raise maxPages before relying on totals.`,
    });
  }
  if (rowCap != null && options.totalRows >= rowCap - 500) {
    warnings.push({
      code: "APPROACHING_CAP",
      message: `Fetched ${options.totalRows} activity rows (approaching ~${rowCap} cap). Next pages may repeat JSON.`,
    });
  }
  return warnings;
}

export function activityWarningsLikelyIncomplete(warnings: ActivityPaginationWarning[]): boolean {
  return warnings.some((w) => w.code === "APPROACHING_CAP" || w.code === "INCOMPLETE");
}

/**
 * Paginate `/v2/activity` by cursor, with duplicate-page and stale-cursor detection.
 * Rows come back v1-named. Does not mutate wallets or bypass API limits —
 * surfaces INCOMPLETE honestly, including when `maxPages` stops it early.
 */
export async function fetchActivityPages(
  user: string,
  options: { limit?: number; maxPages?: number; type?: string } = {},
): Promise<{
  rows: unknown[];
  pagesFetched: number;
  warnings: ActivityPaginationWarning[];
  likelyIncomplete: boolean;
}> {
  const limit = Math.min(options.limit ?? 500, DATA_API_V2_MAX_PAGE);
  const maxPages = options.maxPages ?? 20;
  const needsAsc = options.type != null && ACTIVITY_TYPES_NEEDING_ASC.has(options.type);
  const params: DataV2Params = {
    ...activityParams(user, { type: options.type, sortDirection: needsAsc ? "ASC" : undefined }),
    limit,
  };
  const collected: unknown[] = [];
  let cursor: string | null = null;
  let lastFingerprint = "";
  let sawDuplicatePage = false;
  let sawStaleCursor = false;
  let truncated = false;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const { rows, nextCursor } = await fetchDataV2Page("/activity", params, cursor);
    pagesFetched += 1;
    if (!rows.length) break;

    const fp = fingerprintActivityPage(rows);
    if (lastFingerprint && fp === lastFingerprint) {
      sawDuplicatePage = true;
      break;
    }
    lastFingerprint = fp;
    collected.push(...rows.map(toV1ActivityRow));

    if (!nextCursor) break;
    if (nextCursor === cursor) {
      sawStaleCursor = true;
      break;
    }
    cursor = nextCursor;
    if (page === maxPages - 1) truncated = true;
  }

  const warnings = analyzeActivityPaginationWarnings({
    totalRows: collected.length,
    sawDuplicatePage,
    sawStaleCursor,
    truncated,
    rowCap: null,
  });

  const likelyIncomplete = activityWarningsLikelyIncomplete(warnings);

  return {
    rows: collected,
    pagesFetched,
    warnings,
    likelyIncomplete,
  };
}

/* ------------------------------------------------------------------ *
 * Markout — execution quality / adverse selection
 * ------------------------------------------------------------------ */

export interface TradeRow {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  outcome?: string;
  transactionHash?: string;
}

/**
 * Data API v2: a wallet's own fills, as v1-named `TradeRow`s.
 *
 * `takerOnly` defaults to FALSE here, unlike the upstream endpoint, whose
 * `taker_only` defaults to true. With the upstream default a market maker sees only
 * the legs where it crossed the spread — the entire passive side silently disappears.
 * Markout on taker-only fills measures the wrong population.
 */
export async function fetchUserTrades(
  address: string,
  options: { limit?: number; takerOnly?: boolean; offset?: number } = {},
): Promise<TradeRow[]> {
  const rows = await collectDataV2(
    "/trades",
    { user: address, taker_only: options.takerOnly ?? false },
    { take: options.limit ?? 500, skip: options.offset },
  );
  return rows.map(toV1TradeRow);
}

/**
 * Data API v2: every print in one market (each fill once, on its taker side).
 *
 * Filter by condition id (`condition=`; v1's `market=` is a 400 on v2). Split by
 * token client-side — v1 accepted and silently ignored `asset=<tokenId>`, returning
 * the whole book while looking like it filtered.
 */
export async function fetchMarketTrades(
  conditionId: string,
  options: { limit?: number } = {},
): Promise<TradeRow[]> {
  const rows = await collectDataV2(
    "/trades",
    { condition: conditionId },
    { take: options.limit ?? 1000 },
  );
  return rows.map(toV1TradeRow);
}

export interface MarkoutBucket {
  tau: number;
  n: number;
  /** null when n === 0 — never 0, which would read as "flat" rather than "not measured". */
  meanCents: number | null;
  medianCents: number | null;
  weightedUsd: number | null;
}

export interface MarkoutTauResult {
  tau: number;
  mine: MarkoutBucket;
  baseline: MarkoutBucket | null;
  /** mine.meanCents - baseline.meanCents; null when no baseline. */
  excessCents: number | null;
  /** mine.n / totalFills — always report it; low coverage invalidates the mean. */
  coverage: number;
  byDirection: Record<"BUY" | "SELL", { mine: number | null; baseline: number | null }>;
}

type PriceSeries = Map<string, Array<[number, number, number]>>;

function buildPriceSeries(prints: TradeRow[]): PriceSeries {
  const series: PriceSeries = new Map();
  for (const p of prints) {
    let arr = series.get(p.asset);
    if (!arr) series.set(p.asset, (arr = []));
    arr.push([p.timestamp, p.price, p.size]);
  }
  for (const arr of series.values()) arr.sort((a, b) => a[0] - b[0]);
  return series;
}

/**
 * Size-weighted average price inside [lo, hi].
 *
 * A single "next print after t+tau" is the intuitive reference but a biased one: prints
 * alternate between the bid and the ask, so a SELL tends to be followed by a buy print
 * and a BUY by a sell print. That bounce alone makes SELL markout look positive and BUY
 * negative with no information involved. Averaging over a window cancels it.
 */
function windowVwap(
  arr: Array<[number, number, number]>,
  lo: number,
  hi: number,
): number | null {
  let num = 0;
  let den = 0;
  for (const [ts, price, size] of arr) {
    if (ts < lo) continue;
    if (ts > hi) break;
    num += price * size;
    den += size;
  }
  return den > 0 ? num / den : null;
}

function bucket(values: Array<{ mo: number; size: number }>, tau: number): MarkoutBucket {
  if (values.length === 0) {
    return { tau, n: 0, meanCents: null, medianCents: null, weightedUsd: null };
  }
  const mos = values.map((v) => v.mo).sort((a, b) => a - b);
  const mean = mos.reduce((a, b) => a + b, 0) / mos.length;
  const median = mos[Math.floor(mos.length / 2)] ?? 0;
  return {
    tau,
    n: values.length,
    meanCents: mean * 100,
    medianCents: median * 100,
    weightedUsd: values.reduce((a, v) => a + v.mo * v.size, 0),
  };
}

/**
 * Markout(tau) = (referencePrice(t + tau) - fillPrice) * direction, in cents per share.
 * Negative means price moved against the fill afterwards — the classic adverse-selection
 * signature. Passive market makers run negative markout by construction (they earn the
 * spread and pay it back in markout), so the number that carries information is the
 * excess over the market baseline, not the level.
 *
 * The baseline is every other participant's markout on the same tokens over the same
 * span. It absorbs whatever drift is common to the market — which matters a lot in
 * binary markets, where price converges to 0 or 1 and would otherwise be booked as skill.
 */
export function computeMarkout(
  fills: TradeRow[],
  prints: TradeRow[],
  options: {
    taus?: number[];
    vwapHalfWindowSec?: number;
    excludeAddress?: string;
  } = {},
): MarkoutTauResult[] {
  const taus = options.taus ?? [10, 30, 60];
  const halfWindow = options.vwapHalfWindowSec ?? 5;
  const exclude = options.excludeAddress?.toLowerCase();
  const series = buildPriceSeries(prints);

  const markoutOf = (t: TradeRow, tau: number): number | null => {
    const arr = series.get(t.asset);
    if (!arr) return null;
    const ref = windowVwap(arr, t.timestamp + tau - halfWindow, t.timestamp + tau + halfWindow);
    if (ref === null) return null;
    return (ref - t.price) * (t.side === "BUY" ? 1 : -1);
  };

  const others = exclude ? prints.filter((p) => p.proxyWallet.toLowerCase() !== exclude) : prints;

  return taus.map((tau) => {
    const mine: Array<{ mo: number; size: number }> = [];
    const base: Array<{ mo: number; size: number }> = [];
    const dir: Record<"BUY" | "SELL", { mine: number[]; base: number[] }> = {
      BUY: { mine: [], base: [] },
      SELL: { mine: [], base: [] },
    };

    for (const f of fills) {
      const mo = markoutOf(f, tau);
      if (mo === null) continue;
      mine.push({ mo, size: f.size });
      dir[f.side].mine.push(mo);
    }
    for (const p of others) {
      const mo = markoutOf(p, tau);
      if (mo === null) continue;
      base.push({ mo, size: p.size });
      dir[p.side].base.push(mo);
    }

    const mineBucket = bucket(mine, tau);
    const baseBucket = base.length > 0 ? bucket(base, tau) : null;
    // An excess needs both sides measured. Subtracting a baseline from an unmeasured
    // wallet yields a number that looks like a verdict and is really just the baseline
    // negated — the shape that survives every `!= null` check downstream.
    const excessCents =
      mineBucket.meanCents !== null && baseBucket?.meanCents != null
        ? mineBucket.meanCents - baseBucket.meanCents
        : null;
    const avg = (xs: number[]): number | null =>
      xs.length > 0 ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 100 : null;

    return {
      tau,
      mine: mineBucket,
      baseline: baseBucket,
      excessCents,
      coverage: fills.length > 0 ? mineBucket.n / fills.length : 0,
      byDirection: {
        BUY: { mine: avg(dir.BUY.mine), baseline: avg(dir.BUY.base) },
        SELL: { mine: avg(dir.SELL.mine), baseline: avg(dir.SELL.base) },
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Execution mix — how much of a wallet's flow is passive
 * ------------------------------------------------------------------ */

export interface ExecutionMix {
  /** Fills inside the overlap window, from the unfiltered call. */
  total: number;
  maker: number;
  taker: number;
  /** maker / total, or null when the overlap holds nothing. */
  makerRatio: number | null;
  window: { from: number; to: number; seconds: number } | null;
  /**
   * The taker set must be contained in the unfiltered set. Anything outside it means
   * the two calls disagree about the same span, and the ratio cannot be trusted.
   */
  orphanTakerFills: number;
  /** Overlap sits flush against the row limit, so it reflects only the recent tail. */
  truncated: boolean;
}

function tradeKey(t: TradeRow): string {
  return `${t.transactionHash ?? ""}|${t.asset}|${t.side}|${t.size}|${t.timestamp}`;
}

/**
 * Share of a wallet's fills that were passive.
 *
 * Counting the two endpoints against each other directly is wrong: each returns its own
 * most-recent N rows, and the taker-only call reaches much further back because a maker
 * has fewer taker fills to fill the page with — 45h against 22h on a live wallet. That
 * comparison divides two different time windows. Only the overlap is comparable, so
 * that is all this counts.
 */
export function computeExecutionMix(
  allFills: TradeRow[],
  takerFills: TradeRow[],
  options: { rowLimit?: number } = {},
): ExecutionMix {
  const empty: ExecutionMix = {
    total: 0,
    maker: 0,
    taker: 0,
    makerRatio: null,
    window: null,
    orphanTakerFills: 0,
    truncated: false,
  };
  if (allFills.length === 0) return empty;

  const allTs = allFills.map((t) => t.timestamp);
  const takerTs = takerFills.map((t) => t.timestamp);
  // Each page holds its own most-recent N rows, so each is complete from its own oldest
  // row forward. The window has to start after both of those, or one side is missing
  // rows the other has.
  const from = Math.max(Math.min(...allTs), takerTs.length > 0 ? Math.min(...takerTs) : -Infinity);
  // The end is the unfiltered page's newest row, NOT the earlier of the two newest.
  //
  // Closing at the taker page's last row treats "no taker fills after this point" as
  // missing data. It is the opposite: it is the finding. A wallet that stopped crossing
  // the spread in January and has rested orders ever since has a taker page ending in
  // January and an unfiltered page ending today — and clipping to January throws away
  // every fill in between, which is all of the passive ones.
  //
  // The bias ran exactly backwards: the purer the market maker, the older and thinner
  // its measured window. One profile came out at 82% passive off 11 fills in a window
  // ending 2025-02-02, while the address was still on the leaderboard that same week.
  const to = Math.max(...allTs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return empty;

  const inWindow = (t: TradeRow): boolean => t.timestamp >= from && t.timestamp <= to;
  const all = new Set(allFills.filter(inWindow).map(tradeKey));
  const taker = new Set(takerFills.filter(inWindow).map(tradeKey));

  let orphans = 0;
  let takerInAll = 0;
  for (const k of taker) {
    if (all.has(k)) takerInAll += 1;
    else orphans += 1;
  }

  const total = all.size;
  const rowLimit = options.rowLimit ?? 500;
  return {
    total,
    maker: total - takerInAll,
    taker: takerInAll,
    makerRatio: total > 0 ? (total - takerInAll) / total : null,
    window: { from, to, seconds: to - from },
    orphanTakerFills: orphans,
    truncated: total >= rowLimit * 0.98,
  };
}

/** Coarse label for the mix. Deliberately blunt — the ratio itself carries the detail. */
export function labelExecutionMix(ratio: number | null): string {
  if (ratio === null) return "unknown";
  if (ratio >= 0.9) return "passive (market maker)";
  if (ratio >= 0.6) return "mostly passive";
  if (ratio > 0.4) return "mixed";
  if (ratio > 0.1) return "mostly aggressive";
  return "aggressive (taker)";
}

export {
  DEFAULT_BUILDER_CODE,
  maskBuilderCode,
  resolveBuilderCode,
  withBuilderCode,
} from "./builder.ts";

/* ------------------------------------------------------------------ *
 * Fee basis — the fee is already in `/activity`, no chain reads needed
 * ------------------------------------------------------------------ */

/**
 * One `/activity` TRADE row. `usdcSize` is *not* `size * price`.
 *
 * Measured 2026-08-18: the residual is the trading fee, and it fits the
 * documented `rate x shares x p x (1-p)` to four decimals —
 *
 *   size 78.3784 @ 0.3700 -> usdcSize 29.9135 vs 29.0000, residual 0.9135
 *   78.3784 x 0.37 x 0.63 = 18.269, and 0.9135 / 18.269 = 0.0500
 *
 * The fee is added to `usdcSize` on BUY and subtracted on SELL, which is why a
 * cashflow replay comes out net of fees while Polymarket's own PnL does not.
 */
export interface ActivityTradeRow {
  side?: string;
  size?: number | string;
  price?: number | string;
  usdcSize?: number | string;
  timestamp?: number;
}

export interface Quantiles {
  median: number | null;
  p10: number | null;
  p90: number | null;
  samples: number;
}

export interface FeeBasis {
  fills: number;
  /** Fee strictly above tolerance. A charged fill is a taker fill — makers are never charged. */
  chargedFills: number;
  /**
   * Fee at zero. Maker OR a fee-exempt category — the API cannot tell those
   * apart, so this deliberately is not called "maker".
   */
  zeroFeeFills: number;
  /** Share of fills that were charged. `null` when there are no fills. */
  chargedRatio: number | null;
  buyFees: number;
  sellFees: number;
  totalFees: number;
  /** `sum(size * price)` — fee-free notional. */
  notional: number;
  /** `totalFees / notional`. The cheapest single number for "how much of a taker is this wallet". */
  feeRatio: number | null;
  /** Directly measured, always meaningful: `fee / shares` over charged fills. */
  feePerShare: Quantiles;
  /**
   * `fee / (shares * p * (1-p))`, over charged fills whose quotient lands in a
   * plausible fee-rate band. Rows outside it are counted in `unmodeledFills`
   * rather than averaged in — see the note there.
   */
  impliedRate: Quantiles;
  /**
   * Charged fills the `rate x shares x p x (1-p)` model does not explain.
   *
   * Measured 2026-08-18: one wallet fits the model at rate 0.0500 across the
   * whole price range including p=0.0056 and p=0.9990. Another, trading the
   * same period, pays about 1 cent per share at p=0.9990 — roughly 200x what
   * the model predicts there, which looks like a per-share floor rather than a
   * rate. That is unresolved, so it is surfaced as a count instead of being
   * averaged into a single rate that would read as the platform's fee.
   *
   * `totalFees` is unaffected: it is measured, not modelled, and reconciles
   * against Polymarket's own PnL within $0.02 on a 152-fill wallet.
   */
  unmodeledFills: number;
  /**
   * Fills whose residual has the wrong sign for a fee (BUY paying less than
   * quoted, SELL receiving more). Zero across every wallet measured so far;
   * a non-zero count means the residual is not purely fee and the totals
   * should not be read as one.
   */
  wrongSignFills: number;
  window: { from: number; to: number } | null;
}

/** Plausible band for the fee-rate model. Observed rates: 0.03, 0.04, 0.045, 0.05, 0.07. */
const RATE_BAND_LO = 0.005;
const RATE_BAND_HI = 0.2;

const FEE_EPSILON = 1e-6;

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return lo === hi ? a : a + (b - a) * (i - lo);
}

/**
 * Signed fee implied by one `/activity` TRADE row.
 *
 * A fee makes a BUY cost more and a SELL pay less, so the sign is not free
 * information: a negative result means the residual is not a fee at all.
 * Returns `null` when `side` is missing or unrecognised.
 */
export function impliedFeeForFill(row: ActivityTradeRow): number | null {
  const side = String(row.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") return null;
  const raw = toNum(row.usdcSize) - toNum(row.size) * toNum(row.price);
  return side === "BUY" ? raw : -raw;
}

/**
 * Reverse the fee out of `/activity` TRADE rows.
 *
 * This is the cheap version of the on-chain method: no RPC, no receipt
 * decoding, no credentials — one REST call gives per-fill fees.
 *
 * ⚠️ The test is one-directional. `fee > 0` proves the wallet was the taker on
 * that fill, because makers are never charged. `fee == 0` proves only "maker
 * leg OR fee-exempt category", so `zeroFeeFills` must not be reported as a
 * maker count.
 */
export function computeFeeBasis(rows: ActivityTradeRow[]): FeeBasis {
  const emptyQ: Quantiles = { median: null, p10: null, p90: null, samples: 0 };
  const empty: FeeBasis = {
    fills: 0,
    chargedFills: 0,
    zeroFeeFills: 0,
    chargedRatio: null,
    buyFees: 0,
    sellFees: 0,
    totalFees: 0,
    notional: 0,
    feeRatio: null,
    feePerShare: emptyQ,
    impliedRate: emptyQ,
    unmodeledFills: 0,
    wrongSignFills: 0,
    window: null,
  };
  if (rows.length === 0) return empty;

  let buyFees = 0;
  let sellFees = 0;
  let notional = 0;
  let charged = 0;
  let unmodeled = 0;
  let wrongSign = 0;
  const rates: number[] = [];
  const perShare: number[] = [];
  const stamps: number[] = [];

  for (const r of rows) {
    const size = toNum(r.size);
    const price = toNum(r.price);
    notional += size * price;
    if (typeof r.timestamp === "number") stamps.push(r.timestamp);

    const fee = impliedFeeForFill(r);
    if (fee == null) continue;
    if (fee < -FEE_EPSILON) {
      wrongSign += 1;
      continue;
    }
    if (fee <= FEE_EPSILON) continue;

    charged += 1;
    if (String(r.side).toUpperCase() === "SELL") sellFees += fee;
    else buyFees += fee;
    if (size > 0) perShare.push(fee / size);

    // The denominator collapses at the extremes, where a wallet that pays a
    // per-share floor produces an "implied rate" two orders of magnitude off.
    // Those rows are counted, not averaged.
    const denom = size * price * (1 - price);
    const rate = denom > 1e-9 ? fee / denom : null;
    if (rate != null && rate >= RATE_BAND_LO && rate <= RATE_BAND_HI) rates.push(rate);
    else unmodeled += 1;
  }

  rates.sort((a, b) => a - b);
  perShare.sort((a, b) => a - b);
  const totalFees = buyFees + sellFees;
  const quant = (v: number[]): Quantiles => ({
    median: quantile(v, 0.5),
    p10: quantile(v, 0.1),
    p90: quantile(v, 0.9),
    samples: v.length,
  });

  return {
    fills: rows.length,
    chargedFills: charged,
    zeroFeeFills: rows.length - charged - wrongSign,
    chargedRatio: charged / rows.length,
    buyFees,
    sellFees,
    totalFees,
    notional,
    feeRatio: notional > 0 ? totalFees / notional : null,
    feePerShare: quant(perShare),
    impliedRate: quant(rates),
    unmodeledFills: unmodeled,
    wrongSignFills: wrongSign,
    window: stamps.length ? { from: Math.min(...stamps), to: Math.max(...stamps) } : null,
  };
}

/**
 * Polymarket's own PnL is pre-fee and pre-rebate; a cashflow replay is neither.
 *
 *   official = replay + lifetime taker fees - maker rebates
 *
 * so the wallet's actual post-fee position is the inverse. Verified on four
 * wallets 2026-08-18, predicting the gap before comparing: a heavy-taker wallet
 * came in at a $0.84 residual against a $1,308.87 prediction.
 *
 * ⚠️ Only valid when the gap is fee-shaped. A wallet whose replay is far from
 * this line is telling you something else is going on — neg-risk `CONVERSION`
 * or `MERGE`/`SPLIT` accounting — not that the arithmetic is wrong.
 */
export function netAfterFees(
  officialPnl: number,
  totalFees: number,
  makerRebates: number,
): number {
  return officialPnl - totalFees + makerRebates;
}

/* ------------------------------------------------------------------ *
 * user-pnl — the official equity curve
 * ------------------------------------------------------------------ */

/** `interval` values `/v2/user-pnl` accepts. There is no `1y`. */
export type UserPnlInterval = "max" | "all" | "1m" | "1w" | "1d" | "12h" | "6h";
/**
 * `fidelity` is an enum, not a number of minutes. Passing `60` is a 400 on v2
 * ("fidelity must be one of 1d, 18h, 12h, 3h, 1h").
 */
export type UserPnlFidelity = "1d" | "18h" | "12h" | "3h" | "1h";

export interface UserPnlPoint {
  t: number;
  p: number;
}

/**
 * Retired host (HTTP 410 since 2026-11-06); `fetchUserPnlSeries` reads
 * `/v2/user-pnl` instead.
 * @deprecated
 */
export const USER_PNL_API_BASE = "https://user-pnl-api.polymarket.com";

/**
 * The time series behind Polymarket's own equity curve, from `/v2/user-pnl`.
 *
 * The leaderboard returns a single number per window, so it cannot draw a
 * trend; this is the endpoint that can.
 *
 * v2 returns each point as a set of PnL components. `p` is `position_pnl`,
 * the component that lands on `/v2/leaderboard` all-time `pnl` (measured
 * 2026-11-06: equal on one wallet, $0.45 apart on another — combo PnL).
 *
 * ⚠️ Two things to know before comparing it to anything:
 *  - It is the same **pre-fee, pre-rebate** basis as the leaderboard. A cashflow
 *    replay will drift below it by the cumulative taker fees, and that drift
 *    grows monotonically — which is how you tell it apart from open-position
 *    mark drift, which oscillates.
 *  - It is bucketed by `fidelity` while the leaderboard is realtime, so the two
 *    official sources differ by a few hundred dollars at any instant.
 *
 * Throws if the body is not `{ data: { points: [...] } }`. An unknown wallet
 * is an empty series.
 */
export async function fetchUserPnlSeries(
  address: string,
  options: { interval?: UserPnlInterval; fidelity?: UserPnlFidelity } = {},
): Promise<UserPnlPoint[]> {
  const u = new URL(`${DATA_API_V2_BASE}/user-pnl`);
  u.searchParams.set("user", address);
  u.searchParams.set("interval", options.interval ?? "all");
  u.searchParams.set("fidelity", options.fidelity ?? "1d");
  const body = await pmGetJson<{ data?: { points?: unknown } | null }>(u);
  const points = body?.data?.points;
  if (!Array.isArray(points)) {
    throw new Error(
      `user-pnl returned no points array. Body: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  const out: UserPnlPoint[] = [];
  for (const pt of points as Array<{ timestamp?: unknown; position_pnl?: unknown }>) {
    const t = Number(pt?.timestamp);
    const p = Number(pt?.position_pnl);
    if (Number.isFinite(t) && Number.isFinite(p)) out.push({ t, p });
  }
  return out;
}
