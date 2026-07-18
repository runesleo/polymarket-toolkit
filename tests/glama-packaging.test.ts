import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Glama Dockerfile installs the official pinned MCP package", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /^FROM node:20-slim$/m);
  assert.match(dockerfile, /^RUN npm install -g polymarket-toolkit-mcp@0\.7\.2$/m);
  assert.match(dockerfile, /^ENTRYPOINT \["polymarket-toolkit-mcp"\]$/m);
  assert.doesNotMatch(dockerfile, /npm install -g polymarket-toolkit(?:@|\s|$)/m);
});

test("Glama metadata assigns the listing to runesleo", async () => {
  const raw = await readFile(new URL("../glama.json", import.meta.url), "utf8");
  const metadata = JSON.parse(raw) as { $schema?: string; maintainers?: string[] };

  assert.equal(metadata.$schema, "https://glama.ai/mcp/schemas/server.json");
  assert.deepEqual(metadata.maintainers, ["runesleo"]);
});
