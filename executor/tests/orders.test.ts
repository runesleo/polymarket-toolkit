import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_BUILDER_CODE } from "../../src/builder.ts";
import {
  DEFAULT_MAX_NOTIONAL_USD,
  assertNotionalGuard,
  buildLimitOrder,
  describeDryRun,
  isLiveEnabled,
  resolveMaxNotionalUsd,
} from "../src/orders.ts";

const BUILDER_ENV_KEYS = [
  "POLY_BUILDER_CODE",
  "POLYMARKET_BUILDER_CODE",
  "BUILDER_CODE",
  "POLYMARKET_DISABLE_BUILDER_ATTRIBUTION",
  "EXECUTOR_MAX_USD",
  "EXECUTOR_LIVE",
];
const saved: Record<string, string | undefined> = {};
for (const key of BUILDER_ENV_KEYS) saved[key] = process.env[key];

function clearEnv(): void {
  for (const key of BUILDER_ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of BUILDER_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("buildLimitOrder", () => {
  it("builds a GTC order with notional", () => {
    const order = buildLimitOrder({ tokenID: "t1", price: 0.4, side: "BUY", size: 10 });
    assert.equal(order.orderType, "GTC");
    assert.equal(order.notionalUsd, 4);
  });

  it("rejects out-of-range price", () => {
    assert.throws(() => buildLimitOrder({ tokenID: "t1", price: 1.2, side: "BUY", size: 1 }));
    assert.throws(() => buildLimitOrder({ tokenID: "t1", price: 0, side: "BUY", size: 1 }));
  });

  it("rejects missing tokenID, bad size, bad side", () => {
    assert.throws(() => buildLimitOrder({ tokenID: "", price: 0.5, side: "BUY", size: 1 }));
    assert.throws(() => buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 0 }));
    assert.throws(() =>
      buildLimitOrder({ tokenID: "t1", price: 0.5, side: "HOLD" as never, size: 1 }),
    );
  });

  it("requires expiration for GTD", () => {
    assert.throws(() =>
      buildLimitOrder({ tokenID: "t1", price: 0.5, side: "SELL", size: 1 }, "GTD"),
    );
    const order = buildLimitOrder(
      { tokenID: "t1", price: 0.5, side: "SELL", size: 1, expiration: 1900000000 },
      "GTD",
    );
    assert.equal(order.orderType, "GTD");
  });
});

describe("notional guard", () => {
  it("defaults to $10 and rejects above cap", () => {
    clearEnv();
    assert.equal(resolveMaxNotionalUsd(), DEFAULT_MAX_NOTIONAL_USD);
    const big = buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 100 });
    assert.throws(() => assertNotionalGuard(big));
    const small = buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 10 });
    assertNotionalGuard(small);
  });

  it("honors EXECUTOR_MAX_USD and rejects garbage values", () => {
    clearEnv();
    process.env.EXECUTOR_MAX_USD = "100";
    const order = buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 100 });
    assertNotionalGuard(order);
    process.env.EXECUTOR_MAX_USD = "-5";
    assert.throws(() => resolveMaxNotionalUsd());
    process.env.EXECUTOR_MAX_USD = "lots";
    assert.throws(() => resolveMaxNotionalUsd());
  });
});

describe("live flag", () => {
  it("is off by default, on only for exactly '1'", () => {
    clearEnv();
    assert.equal(isLiveEnabled(), false);
    process.env.EXECUTOR_LIVE = "true";
    assert.equal(isLiveEnabled(), false);
    process.env.EXECUTOR_LIVE = "1";
    assert.equal(isLiveEnabled(), true);
  });
});

describe("describeDryRun builder attribution", () => {
  const order = buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 2 });

  it("uses the default builder code when env is clean", () => {
    clearEnv();
    const payload = describeDryRun(order);
    assert.equal(payload.mode, "dry-run");
    assert.equal(payload.builderAttribution.enabled, true);
    assert.equal(payload.builderAttribution.builderCode, DEFAULT_BUILDER_CODE);
  });

  it("honors env override", () => {
    clearEnv();
    const custom = `0x${"ab".repeat(32)}`;
    process.env.POLY_BUILDER_CODE = custom;
    const payload = describeDryRun(order);
    assert.equal(payload.builderAttribution.builderCode, custom);
  });

  it("honors opt-out", () => {
    clearEnv();
    process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION = "1";
    const payload = describeDryRun(order);
    assert.equal(payload.builderAttribution.enabled, false);
    assert.equal(payload.builderAttribution.builderCode, undefined);
  });

  it("disables attribution on malformed override (fail safe, never the author's default)", () => {
    clearEnv();
    process.env.POLY_BUILDER_CODE = "0xnothex";
    const payload = describeDryRun(order);
    assert.equal(payload.builderAttribution.enabled, false);
    assert.equal(payload.builderAttribution.builderCode, undefined);
  });
});
