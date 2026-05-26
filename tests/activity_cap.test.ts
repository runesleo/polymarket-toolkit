import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_API_ROW_CAP_HINT,
  analyzeActivityPaginationWarnings,
  activityWarningsLikelyIncomplete,
  fingerprintActivityPage,
} from "../src/index.ts";

test("fingerprintActivityPage detects identical pages", () => {
  const a = [{ type: "TRADE", timestamp: 1 }];
  const b = [{ type: "TRADE", timestamp: 1 }];
  const c = [{ type: "TRADE", timestamp: 2 }];
  assert.equal(fingerprintActivityPage(a), fingerprintActivityPage(b));
  assert.notEqual(fingerprintActivityPage(a), fingerprintActivityPage(c));
});

test("analyzeActivityPaginationWarnings flags duplicate page", () => {
  const warnings = analyzeActivityPaginationWarnings({
    totalRows: 100,
    sawDuplicatePage: true,
    sawStaleCursor: false,
  });
  assert.ok(warnings.some((w) => w.code === "DUPLICATE_PAGE"));
});

test("analyzeActivityPaginationWarnings flags approaching cap", () => {
  const warnings = analyzeActivityPaginationWarnings({
    totalRows: ACTIVITY_API_ROW_CAP_HINT - 100,
    sawDuplicatePage: false,
    sawStaleCursor: false,
  });
  assert.ok(warnings.some((w) => w.code === "APPROACHING_CAP"));
});

test("analyzeActivityPaginationWarnings flags stale cursor", () => {
  const warnings = analyzeActivityPaginationWarnings({
    totalRows: 500,
    sawDuplicatePage: false,
    sawStaleCursor: true,
  });
  assert.ok(warnings.some((w) => w.code === "STALE_CURSOR"));
});

test("approaching cap implies likely incomplete pagination", () => {
  const warnings = analyzeActivityPaginationWarnings({
    totalRows: ACTIVITY_API_ROW_CAP_HINT - 100,
    sawDuplicatePage: false,
    sawStaleCursor: false,
  });
  const likelyIncomplete = warnings.some(
    (w) => w.code === "APPROACHING_CAP" || w.code === "DUPLICATE_PAGE",
  );
  assert.ok(likelyIncomplete);
});

test("incomplete warning implies likely incomplete pagination", () => {
  const warnings = analyzeActivityPaginationWarnings({
    totalRows: 500,
    sawDuplicatePage: true,
    sawStaleCursor: false,
  });
  assert.ok(warnings.some((w) => w.code === "INCOMPLETE"));
  assert.ok(activityWarningsLikelyIncomplete(warnings));
});
