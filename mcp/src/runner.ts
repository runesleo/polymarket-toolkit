/** Spawn the repo's `pm` CLI (no shell — argv array only). */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "src", "cli", "main.ts");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Hard cap on captured output — a runaway upstream response gets killed, not buffered. */
export const MAX_OUTPUT_BYTES = 2_000_000;

export function runPmCli(argv: string[], timeoutMs = 60_000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", CLI_ENTRY, ...argv],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    let stdout = "";
    let stderr = "";
    let captured = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`pm ${argv[0]}: timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const capGuard = (chunk: string): boolean => {
      captured += Buffer.byteLength(chunk);
      if (captured > MAX_OUTPUT_BYTES) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error(`pm ${argv[0]}: output exceeded ${MAX_OUTPUT_BYTES} bytes, killed`));
        return false;
      }
      return true;
    };
    child.stdout.on("data", (chunk: string) => {
      if (capGuard(chunk)) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (capGuard(chunk)) stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
