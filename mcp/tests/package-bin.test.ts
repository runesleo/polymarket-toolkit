import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

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
      files?: Array<{ mode?: number; path?: string }>;
    }>;
    const packedServer = packed?.files?.find((entry) => entry.path === "dist/server.js");

    assert.equal(packedServer?.mode, 0o755);
  } finally {
    await rm(packDir, { force: true, recursive: true });
  }
});
