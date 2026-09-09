import { createPublicClient } from "@polymarket/client";
import { fetchBuilderFeeRates, listBuilderTrades } from "@polymarket/client/actions";

import { DEFAULT_BUILDER_CODE } from "../../src/builder.ts";

const client = createPublicClient();
const builderCode = process.env.POLY_BUILDER_CODE?.trim() || DEFAULT_BUILDER_CODE;

const feeRates = await fetchBuilderFeeRates(client, { builderCode });
const firstTradesPage = await listBuilderTrades(client, { builderCode }).firstPage();

console.log(
  JSON.stringify(
    {
      builderCode,
      feeRates,
      attributedTradesFirstPage: firstTradesPage.items,
      nextCursor: firstTradesPage.nextCursor ?? null,
    },
    null,
    2,
  ),
);
