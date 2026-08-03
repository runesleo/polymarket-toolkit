/**
 * Tool definitions: each maps validated inputs to a `pm` CLI argv. Pure and
 * unit-tested — no process spawning here. The CLI is the contract; this layer
 * never bypasses it, so MCP stays exactly as read-only as the CLI.
 */

import { z } from "zod";

/** Reject anything that could smuggle extra CLI flags. */
const SAFE_VALUE = /^[A-Za-z0-9_.@-]+$/;
const safeString = (label: string) =>
  z
    .string()
    .min(1)
    .max(120)
    .refine((v) => !v.startsWith("-") && SAFE_VALUE.test(v), {
      message: `${label} contains unsupported characters`,
    });

const addressOrUsername = safeString("address/username").describe(
  "0x proxy wallet address or a leaderboard username",
);

export interface PmTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  buildArgv(args: Record<string, unknown>): string[];
}

export const PM_TOOLS: PmTool[] = [
  {
    name: "pm_profile",
    description:
      "Address snapshot: leaderboard PnL (all/7d/30d), open positions, redeemable count for a Polymarket address or username.",
    schema: { input: addressOrUsername },
    buildArgv: (a) => ["profile", String(a.input), "--json"],
  },
  {
    name: "pm_activity",
    description: "Recent on-chain activity (trades etc.) for an address or username.",
    schema: {
      input: addressOrUsername,
      limit: z.number().int().min(1).max(500).optional().describe("max rows (default 20)"),
    },
    // Always pin limit + single page: the CLI's own default is 500 rows × 10 pages,
    // which would blow the subprocess timeout and buffer for a chat tool call.
    buildArgv: (a) => [
      "activity",
      String(a.input),
      "--limit",
      String(a.limit ?? 20),
      "--max-pages",
      "1",
      "--json",
    ],
  },
  {
    name: "pm_brier",
    description:
      "Prediction-quality rating: Brier score computed from an address's settled positions.",
    schema: { input: addressOrUsername },
    buildArgv: (a) => ["brier", String(a.input), "--json"],
  },
  {
    name: "pm_markout",
    description:
      "Execution quality: markout at several horizons against a baseline of every other wallet trading the same tokens. Negative excess means the address's fills are adversely selected. Measures execution, not PnL — rebates and holding to resolution sit outside it.",
    schema: {
      input: addressOrUsername,
      fills: z
        .number()
        .int()
        .min(20)
        .max(300)
        .optional()
        .describe("how many recent fills to score (default 100)"),
    },
    // Each distinct market in the sample costs one more book fetch, so keep the default
    // fill count well under the CLI's: a wide sample spans more markets and would run
    // past the subprocess timeout.
    buildArgv: (a) => ["markout", String(a.input), "--fills", String(a.fills ?? 100), "--json"],
  },
  {
    name: "pm_pnl_check",
    description:
      "Fee-inclusive PnL cross-check for a 0x address (cashflow-reconstructed vs leaderboard).",
    schema: { address: safeString("address").describe("0x proxy wallet address") },
    buildArgv: (a) => ["pnl-check", String(a.address), "--json"],
  },
  {
    name: "pm_scan",
    description: "Market scanner: rank active markets by 24h volume and spread.",
    schema: {},
    buildArgv: () => ["scan"],
  },
  {
    name: "pm_updown",
    description:
      "Crypto up/down market fields for an event slug (e.g. btc-updown-15m-1779796800).",
    schema: { slug: safeString("event slug").describe("Gamma event slug") },
    buildArgv: (a) => ["updown", String(a.slug), "--json"],
  },
  {
    name: "pm_leaderboard",
    description: "Profit leaderboard snapshot (read-only, no local snapshot writes).",
    schema: {},
    buildArgv: () => ["lb"],
  },
  {
    name: "pm_redeem_watchdog",
    description: "Redeemable-position status for a 0x address — no signing, read-only.",
    schema: { address: safeString("address").describe("0x proxy wallet address") },
    buildArgv: (a) => ["redeem", String(a.address)],
  },
  {
    name: "pm_v2_check",
    description: "V2 CTF readiness diagnostics (contract/infra alignment FAQ checks).",
    schema: {},
    buildArgv: () => ["v2-check"],
  },
  {
    name: "pm_rate_limits",
    description: "Known Polymarket API rate limits registry (local, no network).",
    schema: {},
    buildArgv: () => ["limits"],
  },
];
