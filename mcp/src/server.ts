/**
 * MCP server for polymarket-toolkit — read-only data tools for AI agents.
 * Wraps the `pm` CLI via subprocess: the CLI is the contract, so this server is
 * exactly as read-only as the CLI. No keys, no orders, no state.
 *
 * Run: cd mcp && npm start   (stdio transport)
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PM_TOOLS } from "./tools.ts";
import { handleToolCall } from "./handler.ts";

// Both src/server.ts and the bundled dist/server.js live one level below package.json.
// Report the installed package version instead of a separately maintained literal.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const server = new McpServer({
  name: "polymarket-toolkit",
  version,
});

for (const tool of PM_TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.schema },
    (args: Record<string, unknown>) => handleToolCall(tool, args),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[polymarket-toolkit mcp] ready — ${PM_TOOLS.length} read-only tools`);
