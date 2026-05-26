import {
  fetchRedeemablePositionsPage,
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "../../index.ts";
import { normalizeAddress, printJson } from "../util.ts";

export async function runRedeem(argv: string[]): Promise<void> {
  const address = argv[0];
  if (!address) throw new Error("usage: pm redeem <address> [low_watermark]");

  const lowWatermark = argv[1] ? Number(argv[1]) : undefined;
  const user = normalizeAddress(address);
  const rows = await fetchRedeemablePositionsPage(user, { limit: 100, offset: 0 });
  const summary = summarizeRedeemablePositions(
    rows as Parameters<typeof summarizeRedeemablePositions>[0],
  );
  const mode = resolveRedeemMode({ lowWatermark });

  printJson({
    user,
    mode,
    lowWatermark: lowWatermark ?? null,
    ...summary,
    topConditions: summary.topConditions.slice(0, 5),
  });
}
