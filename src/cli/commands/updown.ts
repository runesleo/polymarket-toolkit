import { fetchGammaEventsBySlug } from "../../index.ts";
import { printJson } from "../util.ts";

type GammaMarket = {
  question?: string;
  slug?: string;
  conditionId?: string;
  outcomePrices?: string;
  resolutionSource?: string;
  groupItemTitle?: string;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  endDate?: string;
};

type GammaEvent = {
  title?: string;
  slug?: string;
  endDate?: string;
  resolutionSource?: string;
  markets?: GammaMarket[];
};

export async function runUpdown(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const slug = argv.find((a) => !a.startsWith("--"));
  if (!slug) {
    throw new Error("usage: pm updown <event-slug> [--json]\n  example: pm updown btc-updown-15m-1779796800");
  }

  const events = (await fetchGammaEventsBySlug(slug)) as GammaEvent[];
  const event = events[0];
  if (!event) {
    throw new Error(`No Gamma event for slug: ${slug}`);
  }

  const markets = (event.markets ?? []).map((m) => ({
    question: m.question,
    slug: m.slug,
    conditionId: m.conditionId,
    groupItemTitle: m.groupItemTitle,
    outcomePrices: m.outcomePrices,
    bestBid: m.bestBid,
    bestAsk: m.bestAsk,
    spread: m.spread,
    resolutionSource: m.resolutionSource ?? event.resolutionSource,
    endDate: m.endDate ?? event.endDate,
  }));

  const payload = {
    slug,
    title: event.title,
    endDate: event.endDate,
    resolutionSource: event.resolutionSource,
    marketCount: markets.length,
    markets,
    pitfalls: [
      "No universal priceToBeat field — verify resolutionSource + official rules",
      "Do not use CLOB mid as oracle target without recording your own window open",
      "See docs/crypto-updown-price-source.md",
    ],
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`${event.title ?? slug}`);
  console.log(`  end: ${event.endDate ?? "n/a"}`);
  console.log(`  resolutionSource: ${(event.resolutionSource ?? "see market page").slice(0, 120)}`);
  console.log(`  markets: ${markets.length}\n`);
  for (const m of markets.slice(0, 8)) {
    console.log(`  · ${m.groupItemTitle ?? m.question?.slice(0, 50)}`);
    console.log(`    prices: ${m.outcomePrices} · bid/ask: ${m.bestBid}/${m.bestAsk} · spread: ${m.spread}`);
  }
  if (markets.length > 8) console.log(`  … +${markets.length - 8} more`);
  console.log("\n⚠️  Read docs/crypto-updown-price-source.md before trading on derived target price.");
}
