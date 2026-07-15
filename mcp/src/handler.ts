/**
 * Tool-call handling, extracted from the server for testability.
 * Re-validates inputs with the tool's own zod schema even though the MCP SDK
 * already validates — buildArgv must never see unvalidated values, regardless
 * of how this module is wired in the future.
 */

import { z } from "zod";

import { runPmCli } from "./runner.ts";
import type { PmTool } from "./tools.ts";

export interface ToolTextResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const MAX_CONCURRENT_CLI = 4;
let active = 0;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_CLI) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiters.shift()?.();
}

export async function handleToolCall(
  tool: PmTool,
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  const parsed = z.object(tool.schema).strict().safeParse(args ?? {});
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }
  await acquire();
  try {
    const result = await runPmCli(tool.buildArgv(parsed.data));
    if (result.code !== 0) {
      return {
        content: [
          {
            type: "text",
            text: `pm exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: result.stdout.trim() }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `executor error: ${(err as Error).message}` }],
      isError: true,
    };
  } finally {
    release();
  }
}
