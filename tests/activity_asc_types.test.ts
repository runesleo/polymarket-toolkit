import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_FULL_HISTORY_START,
  ACTIVITY_TYPES_NEEDING_ASC,
  DATA_API_V2_BASE,
  fetchActivityPages,
} from "../src/index.ts";

/**
 * `fetchActivityPages` against a stand-in for Data API v2 `/v2/activity`.
 *
 * v1 returned MERGE and SPLIT empty under its default DESC ordering (measured
 * 2026-08-18: MERGE DESC 0 rows vs ASC 2562), which is why those two types are
 * still requested in ASC. v1 also capped `offset` at 5000; v2 rejects `offset`
 * outright and pages by an opaque cursor that has no such cap.
 *
 * The fake enforces the parts of the v2 contract the pager depends on:
 *   - any `offset` is a 400 (v2 rejects even offset=0)
 *   - a cursor without `user` is a 400 (the original params must be restated)
 *   - responses are { data, pagination: { next_cursor } }
 */

type Query = Record<string, string | null>;

const BASE_TS = 1_600_000_000;

function installFakeApi(rowsByType: Record<string, number>): { queries: Query[]; restore: () => void } {
  const queries: Query[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const q: Query = {
      path: `${url.origin}${url.pathname}`,
      user: url.searchParams.get("user"),
      type: url.searchParams.get("type"),
      sortDirection: url.searchParams.get("sort_direction"),
      offset: url.searchParams.get("offset"),
      cursor: url.searchParams.get("cursor"),
      start: url.searchParams.get("start"),
      limit: url.searchParams.get("limit"),
    };
    queries.push(q);

    if (q.offset != null) return new Response('{"error":"offset is not supported"}', { status: 400 });
    if (q.cursor != null && q.user == null) {
      return new Response('{"error":"required query param \'user\' not provided"}', { status: 400 });
    }

    const type = q.type ?? "";
    const total = rowsByType[type] ?? 0;
    const limit = Number(q.limit ?? 100);
    const asc = q.sortDirection === "ASC";
    // The cursor is the index of the next row to serve (opaque to the caller).
    const from = q.cursor == null ? 0 : Number(q.cursor);
    const count = Math.max(0, Math.min(limit, total - from));
    // Timestamps are BASE_TS + index, index 0 the oldest.
    const data = Array.from({ length: count }, (_, i) => {
      const n = from + i;
      return { type, timestamp: asc ? BASE_TS + n : BASE_TS + total - 1 - n };
    });
    const next = from + count < total ? String(from + count) : null;

    return new Response(JSON.stringify({ data, pagination: { has_more: next != null, next_cursor: next } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { queries, restore: () => { globalThis.fetch = original; } };
}

test("MERGE is requested with sort_direction=ASC and returns every row", async () => {
  assert.ok(ACTIVITY_TYPES_NEEDING_ASC.has("MERGE"));
  const fake = installFakeApi({ MERGE: 2562 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 10, type: "MERGE" });
    assert.equal(res.rows.length, 2562);
    assert.equal(res.likelyIncomplete, false);
    assert.ok(fake.queries.every((q) => q.sortDirection === "ASC"), "every MERGE request must carry ASC");
    assert.ok(fake.queries.every((q) => q.path === `${DATA_API_V2_BASE}/activity`));
  } finally {
    fake.restore();
  }
});

test("SPLIT is requested with sort_direction=ASC and returns every row", async () => {
  const fake = installFakeApi({ SPLIT: 132 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 10, type: "SPLIT" });
    assert.equal(res.rows.length, 132);
    assert.ok(fake.queries.every((q) => q.sortDirection === "ASC"));
  } finally {
    fake.restore();
  }
});

test("never sends offset, restates user with every cursor, and walks past v1's 5000-row cap", async () => {
  const fake = installFakeApi({ MERGE: 20_000 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 50, type: "MERGE" });
    assert.equal(res.rows.length, 20_000);
    assert.ok(fake.queries.every((q) => q.offset === null), "v2 rejects offset, even offset=0");
    assert.ok(fake.queries.every((q) => q.user === "0xabc"), "cursor-only requests are a 400 on v2");
    assert.ok(fake.queries.slice(1).every((q) => q.cursor != null), "pages after the first follow next_cursor");
  } finally {
    fake.restore();
  }
});

test("asks for the full history, not v2's three-year default window", async () => {
  const fake = installFakeApi({ TRADE: 10 });
  try {
    await fetchActivityPages("0xabc", { type: "TRADE" });
    assert.ok(fake.queries.length > 0);
    assert.ok(fake.queries.every((q) => q.start === String(ACTIVITY_FULL_HISTORY_START)));
  } finally {
    fake.restore();
  }
});

test("types that page fine under DESC keep the default ordering and read each row once", async () => {
  const fake = installFakeApi({ REDEEM: 900 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 5, type: "REDEEM" });
    // The v1 `end` cursor was inclusive and counted the boundary row twice; a v2
    // cursor does not.
    assert.equal(res.rows.length, 900);
    assert.ok(fake.queries.every((q) => q.sortDirection === null), "REDEEM must not be switched to ASC");
    const rows = res.rows as Array<{ timestamp: number }>;
    assert.ok(rows[0]!.timestamp > rows[rows.length - 1]!.timestamp, "DESC: newest first");
  } finally {
    fake.restore();
  }
});

test("stopping at maxPages with rows left upstream is reported as incomplete", async () => {
  const fake = installFakeApi({ TRADE: 5000 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 500, maxPages: 2, type: "TRADE" });
    assert.equal(res.rows.length, 1000);
    assert.equal(res.pagesFetched, 2);
    assert.equal(res.likelyIncomplete, true);
    assert.ok(res.warnings.some((w) => w.code === "INCOMPLETE"));
    assert.ok(!res.warnings.some((w) => w.code === "APPROACHING_CAP"), "v2 has no row cap to approach");
  } finally {
    fake.restore();
  }
});

test("a complete large scan is not flagged as approaching a cap", async () => {
  const fake = installFakeApi({ TRADE: 4200 });
  try {
    const res = await fetchActivityPages("0xabc", { limit: 1000, maxPages: 10, type: "TRADE" });
    assert.equal(res.rows.length, 4200);
    assert.equal(res.likelyIncomplete, false);
    assert.deepEqual(res.warnings, []);
  } finally {
    fake.restore();
  }
});
