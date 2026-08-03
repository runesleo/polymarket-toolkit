import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { PM_TOOLS } from "../src/tools.ts";
import { runPmCli } from "../src/runner.ts";
import { handleToolCall } from "../src/handler.ts";

const byName = Object.fromEntries(PM_TOOLS.map((t) => [t.name, t]));

describe("tool argv building", () => {
  it("pm_profile builds json argv", () => {
    const argv = byName.pm_profile.buildArgv({ input: "0xabc123" });
    assert.deepEqual(argv, ["profile", "0xabc123", "--json"]);
  });

  it("pm_activity always pins limit and single page (CLI default is 500×10 pages)", () => {
    assert.deepEqual(byName.pm_activity.buildArgv({ input: "someuser", limit: 50 }), [
      "activity",
      "someuser",
      "--limit",
      "50",
      "--max-pages",
      "1",
      "--json",
    ]);
    assert.deepEqual(byName.pm_activity.buildArgv({ input: "someuser" }), [
      "activity",
      "someuser",
      "--limit",
      "20",
      "--max-pages",
      "1",
      "--json",
    ]);
  });

  it("pm_markout pins a fill count below the CLI default (each market costs a book fetch)", () => {
    assert.deepEqual(byName.pm_markout.buildArgv({ input: "0xabc123" }), [
      "markout",
      "0xabc123",
      "--fills",
      "100",
      "--json",
    ]);
    assert.deepEqual(byName.pm_markout.buildArgv({ input: "0xabc123", fills: 250 }), [
      "markout",
      "0xabc123",
      "--fills",
      "250",
      "--json",
    ]);
  });

  it("pm_mix defaults to the full row limit (the overlap needs both pages deep)", () => {
    assert.deepEqual(byName.pm_mix.buildArgv({ input: "0xabc123" }), [
      "mix",
      "0xabc123",
      "--limit",
      "500",
      "--json",
    ]);
  });

  it("every tool only emits read-only pm subcommands", () => {
    const allowed = new Set([
      "profile",
      "activity",
      "brier",
      "markout",
      "mix",
      "pnl-check",
      "scan",
      "updown",
      "lb",
      "redeem",
      "v2-check",
      "limits",
    ]);
    for (const tool of PM_TOOLS) {
      const argv = tool.buildArgv({ input: "x0", address: "0xabc", slug: "s1", limit: 5 });
      assert.ok(allowed.has(argv[0]), `${tool.name} maps to unexpected command ${argv[0]}`);
      assert.ok(!argv.includes("--save"), `${tool.name} must not write snapshots`);
    }
  });
});

describe("input validation blocks argv injection", () => {
  it("rejects leading-dash and shell-ish values", () => {
    const schema = z.object(byName.pm_profile.schema);
    assert.equal(schema.safeParse({ input: "--save" }).success, false);
    assert.equal(schema.safeParse({ input: "a; rm -rf" }).success, false);
    assert.equal(schema.safeParse({ input: "$(whoami)" }).success, false);
    assert.equal(schema.safeParse({ input: "0xAbC_ok-1.2" }).success, true);
  });

  it("bounds activity limit", () => {
    const schema = z.object(byName.pm_activity.schema);
    assert.equal(schema.safeParse({ input: "u", limit: 0 }).success, false);
    assert.equal(schema.safeParse({ input: "u", limit: 501 }).success, false);
    assert.equal(schema.safeParse({ input: "u", limit: 100 }).success, true);
  });
});

describe("handler double-validation", () => {
  it("rejects invalid args before buildArgv even without SDK validation", async () => {
    const result = await handleToolCall(byName.pm_profile, { input: "--save" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /invalid arguments/);
  });

  it("rejects unknown extra keys (strict)", async () => {
    const result = await handleToolCall(byName.pm_rate_limits, { save: true });
    assert.equal(result.isError, true);
  });

  it("passes validated args through to the real CLI", async () => {
    const result = await handleToolCall(byName.pm_rate_limits, {});
    assert.notEqual(result.isError, true);
    assert.ok(result.content[0].text.length > 0);
  });
});

describe("runner", () => {
  it("executes the real CLI offline (limits registry, no network)", async () => {
    const result = await runPmCli(["limits"], 30_000);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.length > 0);
  });

  it("surfaces non-zero exit as error result", async () => {
    const result = await runPmCli(["definitely-not-a-command"], 30_000);
    assert.notEqual(result.code, 0);
  });
});
