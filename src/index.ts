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

/** Data API: one page of positions filtered to `redeemable=true`. Public, no wallet key required. */
export async function fetchRedeemablePositionsPage(
  user: string,
  options: { limit?: number; offset?: number } = {},
): Promise<unknown[]> {
  const u = new URL(`${DATA_API_BASE}/positions`);
  u.searchParams.set("user", user);
  u.searchParams.set("redeemable", "true");
  u.searchParams.set("sizeThreshold", "0");
  u.searchParams.set("limit", String(options.limit ?? 100));
  u.searchParams.set("offset", String(options.offset ?? 0));
  return pmGetJson<unknown[]>(u);
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

/** Community-reported effective row cap for Data API `/activity` offset/cursor pagination. */
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

type ActivityRow = { timestamp?: number };

/** Stable fingerprint to detect duplicate JSON pages (issue #1). */
export function fingerprintActivityPage(rows: unknown[]): string {
  return JSON.stringify(rows);
}

/** Build warnings from pagination probe results (pure · testable). */
export function analyzeActivityPaginationWarnings(options: {
  totalRows: number;
  sawDuplicatePage: boolean;
  sawStaleCursor: boolean;
}): ActivityPaginationWarning[] {
  const warnings: ActivityPaginationWarning[] = [];
  if (options.sawDuplicatePage) {
    warnings.push({
      code: "DUPLICATE_PAGE",
      message:
        `Activity API returned an identical page twice (reported ~${ACTIVITY_API_ROW_CAP_HINT} row cap). Treat results as INCOMPLETE — shard by time window or use skills/polymarket-pnl \`pagination_incomplete\` flags.`,
    });
  }
  if (options.sawStaleCursor) {
    warnings.push({
      code: "STALE_CURSOR",
      message: "Activity cursor (`end`) did not advance between pages. Pagination may have stalled.",
    });
  }
  if (options.sawDuplicatePage || options.sawStaleCursor) {
    warnings.push({
      code: "INCOMPLETE",
      message: "Activity pagination did not produce a complete scan. Shard by time window before relying on totals.",
    });
  }
  if (options.totalRows >= ACTIVITY_API_ROW_CAP_HINT - 500) {
    warnings.push({
      code: "APPROACHING_CAP",
      message: `Fetched ${options.totalRows} activity rows (approaching ~${ACTIVITY_API_ROW_CAP_HINT} cap). Next pages may repeat JSON.`,
    });
  }
  return warnings;
}

export function activityWarningsLikelyIncomplete(warnings: ActivityPaginationWarning[]): boolean {
  return warnings.some((w) => w.code === "APPROACHING_CAP" || w.code === "INCOMPLETE");
}

/**
 * Paginate `/activity` with duplicate-page and stale-cursor detection.
 * Does not mutate wallets or bypass API limits — surfaces INCOMPLETE honestly.
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
  const limit = options.limit ?? 500;
  const maxPages = options.maxPages ?? 20;
  const collected: unknown[] = [];
  let end: number | undefined;
  let lastFingerprint = "";
  let sawDuplicatePage = false;
  let sawStaleCursor = false;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const batch = (await fetchActivityPage(user, { limit, end, type: options.type })) as ActivityRow[];
    pagesFetched += 1;
    if (!batch.length) break;

    const fp = fingerprintActivityPage(batch);
    if (lastFingerprint && fp === lastFingerprint) {
      sawDuplicatePage = true;
      break;
    }
    lastFingerprint = fp;
    collected.push(...batch);

    if (batch.length < limit) break;

    const lastTs = batch[batch.length - 1]?.timestamp;
    if (lastTs == null) break;
    if (end !== undefined && end === lastTs) {
      sawStaleCursor = true;
      break;
    }
    end = lastTs;
  }

  const warnings = analyzeActivityPaginationWarnings({
    totalRows: collected.length,
    sawDuplicatePage,
    sawStaleCursor,
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
}

/**
 * Data API: a wallet's own fills.
 *
 * `takerOnly` defaults to FALSE here, unlike the upstream endpoint, whose default
 * behaves like `takerOnly=true`. With the upstream default a market maker sees only
 * the legs where it crossed the spread — the entire passive side silently disappears.
 * Markout on taker-only fills measures the wrong population.
 */
export async function fetchUserTrades(
  address: string,
  options: { limit?: number; takerOnly?: boolean; offset?: number } = {},
): Promise<TradeRow[]> {
  const u = new URL(`${DATA_API_BASE}/trades`);
  u.searchParams.set("user", address);
  u.searchParams.set("takerOnly", String(options.takerOnly ?? false));
  u.searchParams.set("limit", String(options.limit ?? 500));
  if (options.offset) u.searchParams.set("offset", String(options.offset));
  return await pmGetJson<TradeRow[]>(u);
}

/**
 * Data API: every print in one market.
 *
 * Filter by `market=<conditionId>`, never `asset=<tokenId>` — the `asset` parameter is
 * accepted and ignored, so it returns the whole book while looking like it filtered.
 * Split by token client-side instead.
 */
export async function fetchMarketTrades(
  conditionId: string,
  options: { limit?: number } = {},
): Promise<TradeRow[]> {
  const u = new URL(`${DATA_API_BASE}/trades`);
  u.searchParams.set("market", conditionId);
  u.searchParams.set("limit", String(options.limit ?? 1000));
  return await pmGetJson<TradeRow[]>(u);
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

export {
  DEFAULT_BUILDER_CODE,
  maskBuilderCode,
  resolveBuilderCode,
  withBuilderCode,
} from "./builder.ts";
