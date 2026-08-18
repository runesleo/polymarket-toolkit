import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_OFFSET_CAP,
  ACTIVITY_TYPES_NEEDING_ASC,
  fetchActivityPages,
} from "../src/index.ts";

/**
 * MERGE and SPLIT come back empty under the API's default DESC ordering.
 * Measured 2026-08-18, one wallet, ordering the only thing changed:
 *
 *   MERGE   DESC 0 rows   ASC 2562 rows
 *   SPLIT   DESC 0 rows   ASC  132 rows
 *   REDEEM  DESC 10697    ASC 10697
 *   TRADE   DESC 69161    ASC 69161
 *
 * `pm v2-check` read those two types without ASC and printed "MERGE: 0 rows"
 * for a wallet with 2562 of them — then invited the reader to call it infra
 * drift. An empty array is indistinguishable from "never merged", so this has
 * to stay pinned.
 */

type Query = Record<string, string | null>;

/** Stands in for the live endpoint: empty under DESC for the ASC-only types. */
function installFakeApi(rowsByType: Record<string, number>): { queries: Query[]; restore: () => void } {
  const queries: Query[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const q: Query = {
      type: url.searchParams.get("type"),
      sortDirection: url.searchParams.get("sortDirection"),
      offset: url.searchParams.get("offset"),
      end: url.searchParams.get("end"),
    };
    queries.push(q);

    const type = q.type ?? "";
    const total = rowsByType[type] ?? 0;
    const limit = Number(url.searchParams.get("limit") ?? 500);

    if (ACTIVITY_TYPES_NEEDING_ASC.has(type) && q.sortDirection !== "ASC") {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }

    // Timestamps are 1_600_000_000 + index, index 0 the oldest.
    const BASE = 1_600_000_000;
    let rows: Array<{ type: string; timestamp: number }>;

    if (q.sortDirection === "ASC") {
      const offset = Number(q.offset ?? 0);
      if (offset > ACTIVITY_OFFSET_CAP) {
        return new Response("bad offset", { status: 400 });
      }
      const count = Math.max(0, Math.min(limit, total - offset));
      rows = Array.from({ length: count }, (_, i) => ({ type, timestamp: BASE + offset + i }));
    } else {
      // DESC: newest first, `end` is an inclusive upper bound on timestamp.
      const end = q.end == null ? BASE + total - 1 : Number(q.end);
      const newestIdx = Math.min(total - 1, end - BASE);
      const count = Math.max(0, Math.min(limit, newestIdx + 1));
      rows = Array.from({ length: count }, (_, i) => ({ type, timestamp: BASE + newestIdx - i }));
    }

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { queries, restore: () => { globalThis.fetch = original; } };
}

test("MERGE is requested with sortDirection=ASC and returns rows", async () => {
  const fake = installFakeApi({ MERGE: 2562 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 10, type: "MERGE" });
    assert.equal(res.rows.length, 2562, "DESC would have returned 0 here");
    assert.ok(
      fake.queries.every((q) => q.sortDirection === "ASC"),
      "every MERGE request must carry sortDirection=ASC",
    );
  } finally {
    fake.restore();
  }
});

test("SPLIT is requested with sortDirection=ASC and returns rows", async () => {
  const fake = installFakeApi({ SPLIT: 132 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 10, type: "SPLIT" });
    assert.equal(res.rows.length, 132);
    assert.ok(fake.queries.every((q) => q.sortDirection === "ASC"));
  } finally {
    fake.restore();
  }
});

test("ASC paging never asks for an offset past the API cap", async () => {
  const fake = installFakeApi({ MERGE: 20_000 });
  try {
    await fetchActivityPages("0xabc", { limit: 500, maxPages: 50, type: "MERGE" });
    const offsets = fake.queries.map((q) => Number(q.offset ?? 0));
    assert.ok(
      Math.max(...offsets) <= ACTIVITY_OFFSET_CAP,
      `sent offset ${Math.max(...offsets)} past the cap of ${ACTIVITY_OFFSET_CAP}`,
    );
  } finally {
    fake.restore();
  }
});

test("types that page fine under DESC keep the cursor path", async () => {
  const fake = installFakeApi({ REDEEM: 900 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 5, type: "REDEEM" });
    // >= rather than ==: `end` is an inclusive bound, so the row on a page
    // boundary is returned by both pages and the cursor path counts it twice.
    // That is pre-existing behaviour and not what this test is about.
    assert.ok(res.rows.length >= 900, `expected the full history, got ${res.rows.length}`);
    assert.ok(
      fake.queries.every((q) => q.sortDirection === null && q.offset === null),
      "REDEEM must not be switched to offset/ASC paging",
    );
  } finally {
    fake.restore();
  }
});
