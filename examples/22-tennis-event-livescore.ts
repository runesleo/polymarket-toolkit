// Scenario: cross-check a Polymarket tennis event's resolution inputs against an independent live score.
// Problem: a tennis market can lag what already happened on court (a set won, a break point), so a "settled"
//          read of the Gamma fields alone can be stale — a second, independent score source exposes the gap.
// Run: npx tsx examples/22-tennis-event-livescore.ts <event-slug>
// Docs: docs/tennis-livescore-source.md
// Vendor: live scores come from the Live Tennis API (https://livetennisapi.com), which I run — this example is
//         vendor-authored, read-only, and makes no venue/oracle claim; judge accordingly.

import { fetchGammaEventsBySlug } from "../src/index.ts";

const LIVE_TENNIS_BASE = "https://api.livetennisapi.com/api/public/v1";

const slug = process.argv[2];
if (!slug) {
  throw new Error("usage: npx tsx examples/22-tennis-event-livescore.ts <event-slug>");
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

type LivePlayer = { name?: string };
type LiveScore = {
  sets?: number[];
  points?: Array<string | null>;
  server?: 1 | 2 | null;
  is_tiebreak?: boolean;
};
type LiveMatch = {
  players?: { p1?: LivePlayer; p2?: LivePlayer };
  score?: LiveScore | null;
  event_status?: string | null;
};

/** Which player (1|2) holds a break point, or null. Receiver at AD, or receiver at 40 vs server 0/15/30;
 *  never in a tiebreak, and never when server or points are null. */
function deriveBreakPoint(score: LiveScore | null | undefined): 1 | 2 | null {
  if (!score || score.is_tiebreak) return null;
  const server = score.server;
  if (server !== 1 && server !== 2) return null;
  const points = score.points ?? [];
  if (points.length < 2) return null;
  const receiver: 1 | 2 = server === 1 ? 2 : 1;
  const serverPoint = points[server - 1];
  const receiverPoint = points[receiver - 1];
  if (serverPoint == null || receiverPoint == null) return null;
  if (receiverPoint === "AD") return receiver;
  if (receiverPoint === "40" && ["0", "15", "30"].includes(serverPoint)) return receiver;
  return null;
}

function surnames(match: LiveMatch): string[] {
  const out: string[] = [];
  for (const p of [match.players?.p1, match.players?.p2]) {
    const name = p?.name;
    if (name) out.push(name.split(" ").pop()!.toLowerCase());
  }
  return out;
}

const apiKey = process.env.LIVETENNIS_API_KEY?.trim();
if (!apiKey) {
  console.log(
    "\n[live-tennis] set LIVETENNIS_API_KEY to overlay an independent live score.",
    "\n[live-tennis] free key (30 req/min, 100 req/day): https://livetennisapi.com/subscribe/free",
  );
} else {
  const url = new URL(`${LIVE_TENNIS_BASE}/matches`);
  url.searchParams.set("status", "live");
  url.searchParams.set("limit", "50");
  const resp = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!resp.ok) {
    console.log(`\n[live-tennis] overlay unavailable: HTTP ${resp.status}`);
  } else {
    const payload = (await resp.json()) as { data?: LiveMatch[] };
    const live = payload.data ?? [];
    const q = (event.title ?? "").toLowerCase();
    const matched = live.find((m) => {
      const s = surnames(m);
      return s.length === 2 && s.every((name) => q.includes(name));
    });

    console.log("\n== Independent live score (Live Tennis API) ==");
    if (!matched) {
      console.log(`no in-progress match matched "${event.title ?? slug}" by player name (of ${live.length} live)`);
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
