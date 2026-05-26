/**
 * Market Scanner Lite — rank active Gamma markets by volume / spread (read-only).
 */

export type GammaMarketLike = {
  slug?: string;
  question?: string;
  volume24hr?: number | string | null;
  volume24hrClob?: number | string | null;
  volumeNum?: number | string | null;
  spread?: number | string | null;
  liquidity?: number | string | null;
  liquidityNum?: number | string | null;
  bestBid?: number | string | null;
  bestAsk?: number | string | null;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
};

export type MarketScanRow = {
  slug: string;
  question: string;
  volume24hr: number;
  spread: number | null;
  liquidity: number;
  bestBid: number | null;
  bestAsk: number | null;
  acceptingOrders: boolean;
};

function num(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rank markets for scanner output (pure · testable). */
export function rankMarketsForScan(
  markets: GammaMarketLike[],
  options: { minVolume24hr?: number; limit?: number } = {},
): MarketScanRow[] {
  const minVol = options.minVolume24hr ?? 0;
  const limit = options.limit ?? 20;

  const rows: MarketScanRow[] = [];
  for (const m of markets) {
    if (m.closed === true || m.active === false) continue;
    const volume24hr = num(m.volume24hrClob ?? m.volume24hr ?? m.volumeNum);
    if (volume24hr < minVol) continue;
    rows.push({
      slug: m.slug ?? "unknown",
      question: (m.question ?? m.slug ?? "unknown").slice(0, 120),
      volume24hr,
      spread: numOrNull(m.spread),
      liquidity: num(m.liquidityNum ?? m.liquidity),
      bestBid: numOrNull(m.bestBid),
      bestAsk: numOrNull(m.bestAsk),
      acceptingOrders: m.acceptingOrders !== false,
    });
  }

  rows.sort((a, b) => b.volume24hr - a.volume24hr || (a.spread ?? 999) - (b.spread ?? 999));
  return rows.slice(0, limit);
}
