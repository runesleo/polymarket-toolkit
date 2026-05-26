// Scenario: probe Data API /activity pagination for duplicate JSON (issue #1 ~4000 cap).
// Problem: continuing to paginate after the cap returns the same page — looks like success, data is wrong.
// Run: npx tsx examples/16-activity-cap-probe.ts <proxy_wallet> [max_pages]
// API: fetchActivityPages — cursor pagination + DUPLICATE_PAGE / STALE_CURSOR warnings.

import { fetchActivityPages } from "../src/index.ts";

const user = process.argv[2];
if (!user) throw new Error("usage: npx tsx examples/16-activity-cap-probe.ts <proxy_wallet> [max_pages]");

const maxPages = process.argv[3] ? Number(process.argv[3]) : 12;
const result = await fetchActivityPages(user, { limit: 500, maxPages });

console.log(
  JSON.stringify(
    {
      user,
      rowCount: result.rows.length,
      pagesFetched: result.pagesFetched,
      likelyIncomplete: result.likelyIncomplete,
      warnings: result.warnings,
    },
    null,
    2,
  ),
);
