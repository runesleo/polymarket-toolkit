import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULT_BUILDER_CODE } from "../../src/builder.ts";
import { createExecutor, type RawOrderClient } from "../src/client.ts";
import { buildLimitOrder } from "../src/orders.ts";
import { redactString, withRedactedConsole } from "../src/redact.ts";

const ENV_KEYS = [
  "EXECUTOR_LIVE",
  "EXECUTOR_MAX_USD",
  "POLY_BUILDER_CODE",
  "POLYMARKET_BUILDER_CODE",
  "BUILDER_CODE",
  "POLYMARKET_DISABLE_BUILDER_ATTRIBUTION",
];
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function fakeRawClient() {
  const calls: { post: unknown[][]; cancel: unknown[][] } = { post: [], cancel: [] };
  const client: RawOrderClient = {
    async createAndPostOrder(...args: unknown[]) {
      calls.post.push(args);
      return { ok: true };
    },
    async cancelOrder(...args: unknown[]) {
      calls.cancel.push(args as unknown[]);
      return { ok: true };
    },
  };
  return { client, calls };
}

const smallOrder = () => buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 4 });

describe("executor mutation boundaries", () => {
  it("postLimitOrder is dry-run by default and never touches the network", async () => {
    clearEnv();
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const result = await executor.postLimitOrder(smallOrder());
    assert.equal(result.mode, "dry-run");
    assert.equal(calls.post.length, 0);
  });

  it("EXECUTOR_LIVE must be exactly '1' to post", async () => {
    clearEnv();
    process.env.EXECUTOR_LIVE = "true";
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const result = await executor.postLimitOrder(smallOrder());
    assert.equal(result.mode, "dry-run");
    assert.equal(calls.post.length, 0);

    process.env.EXECUTOR_LIVE = "1";
    const live = await executor.postLimitOrder(smallOrder());
    assert.equal(live.mode, "live");
    assert.equal(calls.post.length, 1);
  });

  it("live posts recompute notional from price*size — tampered orders are refused", async () => {
    clearEnv();
    process.env.EXECUTOR_LIVE = "1";
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const tampered = { ...buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 100 }) };
    tampered.notionalUsd = 1; // lies below the $10 cap
    await assert.rejects(() => executor.postLimitOrder(tampered), /exceeds EXECUTOR_MAX_USD/);
    assert.equal(calls.post.length, 0);
  });

  it("dry-run runs the same preflight — a tampered order fails before live mode ever flips", async () => {
    clearEnv();
    const { client } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const oversize = { ...buildLimitOrder({ tokenID: "t1", price: 0.5, side: "BUY", size: 100 }) };
    oversize.notionalUsd = 1;
    await assert.rejects(() => executor.postLimitOrder(oversize), /exceeds EXECUTOR_MAX_USD/);
    assert.throws(() => executor.dryRun(oversize), /exceeds EXECUTOR_MAX_USD/);
  });

  it("re-validates every canonical field at the boundary — bad side is rejected, not remapped", async () => {
    clearEnv();
    process.env.EXECUTOR_LIVE = "1";
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });

    const badSide = { ...smallOrder(), side: "HOLD" as never };
    await assert.rejects(() => executor.postLimitOrder(badSide), /side must be BUY or SELL/);

    const staleGtd = {
      ...smallOrder(),
      orderType: "GTD" as const,
      expiration: 1, // long past
    };
    await assert.rejects(() => executor.postLimitOrder(staleGtd), /GTD orders require/);
    assert.equal(calls.post.length, 0);
  });

  it("rejects unknown orderType in both modes — never silently remapped to GTC", async () => {
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const fok = { ...smallOrder(), orderType: "FOK" as never };

    clearEnv();
    assert.throws(() => executor.dryRun(fok), /orderType must be GTC or GTD/);
    await assert.rejects(() => executor.postLimitOrder(fok), /orderType must be GTC or GTD/);

    process.env.EXECUTOR_LIVE = "1";
    await assert.rejects(() => executor.postLimitOrder(fok), /orderType must be GTC or GTD/);
    assert.equal(calls.post.length, 0);
  });

  it("cancelOrder is dry-run by default", async () => {
    clearEnv();
    const { client, calls } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    const result = await executor.cancelOrder("order-1");
    assert.equal(result.mode, "dry-run");
    assert.equal(calls.cancel.length, 0);

    process.env.EXECUTOR_LIVE = "1";
    const live = await executor.cancelOrder("order-1");
    assert.equal(live.mode, "live");
    assert.equal(calls.cancel.length, 1);
  });

  it("does not expose the raw client surface", async () => {
    clearEnv();
    const { client } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    assert.equal((executor as unknown as Record<string, unknown>).createAndPostOrder, undefined);
    assert.equal((executor as unknown as Record<string, unknown>).createAndPostMarketOrder, undefined);
    assert.equal((executor as unknown as Record<string, unknown>).cancelAll, undefined);
  });
});

describe("executor builder attribution consistency", () => {
  it("dryRun reports the instance's resolved code, matching live behavior", async () => {
    clearEnv();
    const { client } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client });
    assert.equal(executor.builderCode, DEFAULT_BUILDER_CODE);
    assert.equal(executor.dryRun(smallOrder()).builderAttribution.enabled, true);
  });

  it("disableBuilderAttribution option is reflected in dryRun", async () => {
    clearEnv();
    const { client } = fakeRawClient();
    const executor = await createExecutor({ rawClient: client, disableBuilderAttribution: true });
    assert.equal(executor.builderCode, undefined);
    assert.equal(executor.dryRun(smallOrder()).builderAttribution.enabled, false);
  });
});

describe("redaction", () => {
  it("scrubs sensitive headers and known secrets from log strings", () => {
    const leaked = JSON.stringify({
      status: 400,
      config: { headers: { POLY_API_KEY: "key-123456", POLY_PASSPHRASE: "pass-abcdef" } },
    });
    const out = redactString(leaked, ["key-123456", "pass-abcdef"]);
    assert.ok(!out.includes("key-123456"));
    assert.ok(!out.includes("pass-abcdef"));
    assert.ok(out.includes("[redacted]"));
  });

  it("scrubs object args and survives overlapping concurrent contexts", async () => {
    const captured: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      captured.push(args);
    };
    try {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = withRedactedConsole(["secret-one-111111"], async () => {
        await firstGate;
      });
      const second = withRedactedConsole(["secret-two-222222"], async () => {
        console.error({ POLY_API_KEY: "secret-two-222222" });
        console.error("inline secret-one-111111 leak attempt");
      });
      await second;
      // first context still active — wrapper must still be installed and scrubbing
      console.error("post-overlap secret-one-111111");
      releaseFirst();
      await first;
    } finally {
      console.error = original;
    }
    const flat = captured.map((args) => args.map(String).join(" ")).join("\n");
    assert.ok(!flat.includes("secret-two-222222"), "object arg leaked");
    assert.ok(!flat.includes("secret-one-111111"), "concurrent context leaked");
    assert.ok(flat.includes("[redacted]"));
  });
});
