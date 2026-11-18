import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { PM_TOOLS } from "../src/tools.ts";

const execFileAsync = promisify(execFile);
const mcpRoot = fileURLToPath(new URL("../", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));

test("npm publishing is pinned to the official registry", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    publishConfig?: { registry?: string };
  };

  assert.equal(packageJson.publishConfig?.registry, "https://registry.npmjs.org/");
});

test("the built and packed MCP bin is executable and has a Node shebang", async () => {
  await execFileAsync("npm", ["run", "build", "--silent"], { cwd: mcpRoot });

  const file = await stat(serverPath);
  assert.notEqual(
    file.mode & 0o111,
    0,
    `dist/server.js must be executable, received mode ${(file.mode & 0o777).toString(8)}`,
  );

  const source = await readFile(serverPath, "utf8");
  assert.equal(source.split("\n", 1)[0], "#!/usr/bin/env node");

  const packDir = await mkdtemp(join(tmpdir(), "polymarket-toolkit-mcp-pack-"));
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir],
      { cwd: mcpRoot },
    );
    const [packed] = JSON.parse(stdout) as Array<{
      filename: string;
      files?: Array<{ mode?: number; path?: string }>;
    }>;
    const packedServer = packed?.files?.find((entry) => entry.path === "dist/server.js");

    assert.equal(packedServer?.mode, 0o755);
    assert.ok(packed.files?.some((entry) => entry.path === "dist/cli.js"));
    assert.ok(packed.files?.some((entry) => entry.path === "docs/data/polymarket-api-rate-limits.json"));

    // Validate the actual tarball, not the checked-out source directory.
    await execFileAsync("tar", ["-xzf", join(packDir, packed.filename), "-C", packDir]);
    const unpackedRoot = join(packDir, "package");
    const packageJson = JSON.parse(
      await readFile(join(unpackedRoot, "package.json"), "utf8"),
    ) as { name: string; version: string };
    const serverJson = JSON.parse(
      await readFile(fileURLToPath(new URL("../server.json", import.meta.url)), "utf8"),
    ) as { version: string; packages: Array<{ version: string }> };
    assert.equal(packageJson.name, "polymarket-toolkit-mcp");
    assert.equal(serverJson.version, packageJson.version);
    assert.equal(serverJson.packages[0]?.version, packageJson.version);

    const cliSource = await readFile(join(unpackedRoot, "dist", "cli.js"), "utf8");
    assert.ok(cliSource.includes("DATA_API_V2_BASE"), "packed CLI must declare the v2 base URL");
    assert.ok(cliSource.includes("fetchDataV2Page(\"/activity\""), "packed CLI must route activity through the v2 fetcher");
    assert.ok(!cliSource.includes("lb-api.polymarket.com"), "retired leaderboard API must be absent");

    const client = new Client({ name: "packed-mcp-smoke", version: "0.0.1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(unpackedRoot, "dist", "server.js")],
      cwd: unpackedRoot,
    });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.version, packageJson.version);
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        PM_TOOLS.map((tool) => tool.name).sort(),
      );
      assert.equal(tools.length, 12);
      const offlineResult = await client.callTool({ name: "pm_rate_limits", arguments: {} });
      assert.notEqual(offlineResult.isError, true);
      const offlineContent = offlineResult.content;
      assert.ok(Array.isArray(offlineContent));
      assert.ok(offlineContent.length > 0);
      const rateLimitText = offlineContent
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      for (const scope of ["/v2/positions/combos", "/v2/activity/combos", "/v2/prices-history", "/v2/status"]) {
        assert.ok(rateLimitText.includes(scope), `packed MCP rate limits must show ${scope}`);
      }
      const packedRegistry = JSON.parse(await readFile(join(unpackedRoot, "docs/data/polymarket-api-rate-limits.json"), "utf8")) as { families: { data: { limits: Array<{ scope: string; requests: number }> } } };
      assert.equal(packedRegistry.families.data.limits.find((item) => item.scope === "/v2/status")?.requests, 100);
    } finally {
      await client.close();
    }
  } finally {
    await rm(packDir, { force: true, recursive: true });
  }
});
