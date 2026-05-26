import { fetchGammaMarkets } from "../../index.ts";
import { rankMarketsForScan, type GammaMarketLike } from "../../scanner.ts";
import { printJson } from "../util.ts";

export async function runScan(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1] ?? 20) : 20;
  const minVolIdx = argv.indexOf("--min-volume");
  const minVolume = minVolIdx >= 0 ? Number(argv[minVolIdx + 1] ?? 0) : 1000;

  const raw = (await fetchGammaMarkets({
    limit: 150,
    active: true,
    closed: false,
  })) as GammaMarketLike[];

  const ranked = rankMarketsForScan(raw, { minVolume24hr: minVolume, limit });

  const payload = {
    count: ranked.length,
    minVolume24hr: minVolume,
    markets: ranked,
    note: "Sorted by 24h volume · read-only Gamma snapshot",
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`Market scan · top ${ranked.length} by 24h volume (min $${minVolume})\n`);
  for (const m of ranked) {
    const spread = m.spread != null ? `${(m.spread * 100).toFixed(2)}%` : "n/a";
    console.log(
      `  $${m.volume24hr.toLocaleString()} vol · spread ${spread} · ${m.question.slice(0, 55)}`,
    );
    console.log(`    slug: ${m.slug}`);
  }
}
