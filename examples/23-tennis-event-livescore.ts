// Scenario: cross-check a Polymarket tennis event's resolution inputs against an independent live score.
// Problem: a tennis market can lag what already happened on court (a set won, a break point), so a "settled"
//          read of the Gamma fields alone can be stale — a second, independent score source exposes the gap.
// Run: npx tsx examples/23-tennis-event-livescore.ts <event-slug>
// Docs: docs/tennis-livescore-source.md
// Vendor: live scores come from the Live Tennis API (https://livetennisapi.com), which I run — this example is
//         vendor-authored, read-only, and makes no venue/oracle claim; judge accordingly.
//
// The overlay is optional (LIVETENNIS_API_KEY) and fails on its own: an unreachable API, a non-2xx status,
// invalid JSON, or a body without a `data` array prints ONE "[live-tennis] overlay unavailable" line and leaves
// the Gamma output above it intact. The process still exits 0.

import { fetchGammaEventsBySlug } from "../src/index.ts";
import { deriveBreakPoint, overlayFromPayload, type TennisOverlay } from "../src/tennis-livescore.ts";

const LIVE_TENNIS_BASE = "https://api.livetennisapi.com/api/public/v1";
const LIVE_TENNIS_TIMEOUT_MS = 10_000;

const slug = process.argv[2];
if (!slug) {
  throw new Error("usage: npx tsx examples/23-tennis-event-livescore.ts <event-slug>");
}

// ---- 1) Polymarket side: resolution inputs from Gamma (read-only, same as example 18). ----
type GammaMarket = {
  question?: string;
  resolutionSource?: string;
  outcomePrices?: string;
  bestBid?: string | number;
  bestAsk?: string | number;
};
type GammaEvent = { title?: string; endDate?: string; markets?: GammaMarket[] };

const events = (await fetchGammaEventsBySlug(slug)) as GammaEvent[];
const event = events[0];
if (!event) {
  throw new Error(`no Gamma event for slug: ${slug}`);
}

console.log("== Polymarket (Gamma) resolution inputs ==");
console.log("title:      ", event.title ?? "(none)");
console.log("endDate:    ", event.endDate ?? "(none)");
for (const m of event.markets ?? []) {
  console.log("  -", m.question ?? "(market)");
  console.log("    resolutionSource:", m.resolutionSource ?? "(none) — read the market page before trading");
  console.log("    outcomePrices:   ", m.outcomePrices ?? "(none)");
  console.log("    bestBid/bestAsk: ", `${m.bestBid ?? "?"} / ${m.bestAsk ?? "?"}`);
}

// ---- 2) Independent live-score overlay (optional; needs a free Live Tennis API key). ----
// Only the FREE endpoint is used: GET /matches?status=live. History, market prices and win-probability are paid.
// LIVETENNIS_API_BASE overrides the API origin (a local stub, or an unreachable host to see the failure path).

/** Fetch + parse the live list. Never throws: every failure becomes `{ ok: false, reason }`. */
async function loadOverlay(apiKey: string, base: string, title: string): Promise<TennisOverlay> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVE_TENNIS_TIMEOUT_MS);
  let payload: unknown;
  try {
    const url = new URL(`${base}/matches`);
    url.searchParams.set("status", "live");
    url.searchParams.set("limit", "50");
    const resp = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: ctrl.signal });
    if (!resp.ok) return { ok: false, reason: `HTTP ${resp.status}` };
    payload = await resp.json();
  } catch (err) {
    // Node reports connection failures as `fetch failed` with the real code on `cause` (or, for a host
    // with several addresses, on `cause.errors[0]`).
    const c = (err as { cause?: { code?: string; errors?: Array<{ code?: string }> } })?.cause;
    const cause = c?.code ?? c?.errors?.[0]?.code;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: cause ? `${message} (${cause})` : message };
  } finally {
    clearTimeout(timer);
  }
  return overlayFromPayload(payload, title);
}

const apiKey = process.env.LIVETENNIS_API_KEY?.trim();
if (!apiKey) {
  console.log(
    "\n[live-tennis] set LIVETENNIS_API_KEY to overlay an independent live score.",
    "\n[live-tennis] free key (30 req/min, 100 req/day): https://livetennisapi.com/subscribe/free",
  );
} else {
  const base = (process.env.LIVETENNIS_API_BASE?.trim() || LIVE_TENNIS_BASE).replace(/\/+$/, "");
  const overlay = await loadOverlay(apiKey, base, event.title ?? "");

  if (!overlay.ok) {
    console.log(`\n[live-tennis] overlay unavailable: ${overlay.reason}`);
  } else {
    const { live, matched } = overlay;
    console.log("\n== Independent live score (Live Tennis API) ==");
    if (!matched) {
      console.log(`no in-progress match matched "${event.title ?? slug}" by both player surnames (of ${live.length} live)`);
    } else {
      const sc = matched.score ?? null;
      console.log("sets:   ", (sc?.sets ?? []).join("-") || "(none)");
      console.log("points: ", (sc?.points ?? []).map((p) => p ?? "?").join("-") || "(none)");
      const server = sc?.server;
      if (server === 1 || server === 2) {
        const name = server === 1 ? matched.players?.p1?.name : matched.players?.p2?.name;
        console.log("serving:", name ?? `P${server}`);
      }
      const bp = deriveBreakPoint(sc);
      if (bp) {
        const name = bp === 1 ? matched.players?.p1?.name : matched.players?.p2?.name;
        console.log("BREAK POINT for", name ?? `P${bp}`);
      }
      if (matched.event_status) console.log("match note:", matched.event_status);
      console.log("\nThe live score is an INDEPENDENT reference — always confirm official resolution on the market page.");
    }
  }
}
