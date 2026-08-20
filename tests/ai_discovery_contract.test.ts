import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ACTIVITY_API_ROW_CAP_HINT, ACTIVITY_OFFSET_CAP } from "../src/index.ts";

/**
 * asset-version: v1.0
 * updated: 2026-08-20
 * owner_surface: Polymarket Toolkit AI identity, MCP catalogue, versions, and generated discovery files
 * rollback: revert with content/ai-identity.json, generate-ai-discovery.mjs, README/MCP doc edits, and server manifest version
 */

const root = resolve(import.meta.dirname, "..");
const identity = JSON.parse(readFileSync(resolve(root, "content/ai-identity.json"), "utf8"));
const aiInfo = JSON.parse(readFileSync(resolve(root, "ai-info.json"), "utf8"));
const llms = readFileSync(resolve(root, "llms.txt"), "utf8");
const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const mcpPackage = JSON.parse(readFileSync(resolve(root, "mcp/package.json"), "utf8"));
const server = JSON.parse(readFileSync(resolve(root, "mcp/server.json"), "utf8"));
const toolsSource = readFileSync(resolve(root, "mcp/src/tools.ts"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const mcpReadme = readFileSync(resolve(root, "mcp/README.md"), "utf8");
const mcpDocs = readFileSync(resolve(root, "docs/mcp.md"), "utf8");

function sourceToolNames() {
  const block = toolsSource.slice(toolsSource.indexOf("export const PM_TOOLS"));
  return [...block.matchAll(/\bname:\s*"(pm_[a-z0-9_]+)"/g)].map((match) => match[1]);
}

test("canonical identity is explicit and generated JSON preserves it", () => {
  assert.equal(identity.schema_version, "1.0");
  assert.equal(identity.last_verified_at, "2026-08-20");
  assert.equal(aiInfo.generated_from, "content/ai-identity.json");
  for (const [key, value] of Object.entries(identity)) assert.deepEqual(aiInfo[key], value, key);
  assert.equal(identity.is_accessible_for_free, true);
  assert.match(identity.boundaries.trading, /No MCP tool places orders/);
  assert.match(identity.boundaries.local_write, /pm lb --save/);

  const limitations = identity.limitations.join(" ");
  assert.equal(ACTIVITY_API_ROW_CAP_HINT, 4000);
  assert.equal(ACTIVITY_OFFSET_CAP, 5000);
  assert.match(limitations, /4,000 effective rows/);
  assert.match(limitations, /5,000 hard limit/);
  assert.match(limitations, /repeat or stall/);
  assert.match(limitations, /offsets above/);
});

test("MCP catalogue and all package manifests stay aligned", () => {
  const declared = identity.capabilities.mcp.tools;
  const implemented = sourceToolNames();
  assert.equal(declared.length, 12);
  assert.deepEqual([...declared].sort(), [...implemented].sort());
  assert.equal(new Set(implemented).size, implemented.length);
  assert.equal(identity.capabilities.mcp.package_version, mcpPackage.version);
  assert.equal(server.version, mcpPackage.version);
  assert.equal(server.packages[0].version, mcpPackage.version);
  assert.equal(server.packages[0].identifier, identity.capabilities.mcp.npm_package);
  assert.equal(server.name, identity.capabilities.mcp.registry_name);
});

test("human and machine docs expose every implemented tool without trading overclaim", () => {
  assert.match(readme, /12 read-only tools/);
  assert.match(mcpReadme, /Tools \(12, all read-only\)/);
  assert.match(mcpDocs, /Tools \(12, all read-only\)/);
  for (const tool of identity.capabilities.mcp.tools) {
    assert.match(llms, new RegExp(`\\\`${tool}\\\``));
    assert.match(mcpDocs, new RegExp(`\\\`${tool}\\\``));
    assert.match(mcpReadme, new RegExp(`\\\`${tool}\\\``));
  }
  assert.match(llms, /separate opt-in executor/);
  assert.match(llms, /No MCP tool places orders/);
  assert.doesNotMatch(llms, /the entire repository has no execution code/i);
});

test("generation and verification commands are wired into the root package", () => {
  assert.match(rootPackage.scripts["generate:ai-discovery"], /generate-ai-discovery\.mjs/);
  assert.match(rootPackage.scripts["check:ai-discovery"], /--check/);
  assert.match(rootPackage.scripts["check:ai-discovery"], /ai_discovery_contract\.test\.ts/);
  assert.match(readme, /ai-info\.json/);
  assert.match(readme, /llms\.txt/);
});
