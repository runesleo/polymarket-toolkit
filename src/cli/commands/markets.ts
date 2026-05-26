import { fetchGammaMarkets } from "../../index.ts";
import { printJson } from "../util.ts";

export async function runMarkets(argv: string[]): Promise<void> {
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1] ?? 10) : 10;
  const active = argv.includes("--active");

  const rows = (await fetchGammaMarkets({
    limit,
    ...(active ? { active: true, closed: false } : {}),
  })) as Array<{ question?: string; slug?: string; volume?: number | string; liquidity?: number | string }>;

  const mapped = rows.map((m) => ({
    question: m.question,
    slug: m.slug,
    volume: m.volume != null ? Number(m.volume) : null,
    liquidity: m.liquidity != null ? Number(m.liquidity) : null,
  }));

  printJson({ count: mapped.length, markets: mapped });
}
