/**
 * Order building + safety guards. Pure functions here are network-free and unit-tested.
 * Any network mutation requires EXECUTOR_LIVE=1 — dry-run is the default.
 */

import { maskBuilderCode, resolveBuilderCode } from "../../src/builder.ts";

export type ExecutorSide = "BUY" | "SELL";
export type ExecutorOrderType = "GTC" | "GTD";

export interface LimitOrderInput {
  tokenID: string;
  price: number;
  side: ExecutorSide;
  size: number;
  /** Required for GTD: unix seconds expiration. */
  expiration?: number;
}

export interface BuiltLimitOrder extends LimitOrderInput {
  orderType: ExecutorOrderType;
  notionalUsd: number;
}

export const DEFAULT_MAX_NOTIONAL_USD = 10;

/**
 * Unified @polymarket/client requires GTD expiry to be at least 3 minutes out.
 * Keep the local guard aligned so dry-run and live reject the same stale orders.
 */
export const GTD_MIN_BUFFER_SECONDS = 180;

export function buildLimitOrder(
  input: LimitOrderInput,
  orderType: ExecutorOrderType = "GTC",
): BuiltLimitOrder {
  if (!input.tokenID) throw new Error("executor: tokenID is required");
  if (!Number.isFinite(input.price) || input.price <= 0 || input.price >= 1) {
    throw new Error(`executor: price must be in (0, 1), got ${input.price}`);
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new Error(`executor: size must be > 0, got ${input.size}`);
  }
  if (input.side !== "BUY" && input.side !== "SELL") {
    throw new Error(`executor: side must be BUY or SELL, got ${String(input.side)}`);
  }
  if (orderType !== "GTC" && orderType !== "GTD") {
    throw new Error(`executor: orderType must be GTC or GTD, got ${String(orderType)}`);
  }
  if (orderType === "GTD") {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !input.expiration ||
      !Number.isInteger(input.expiration) ||
      input.expiration < nowSeconds + GTD_MIN_BUFFER_SECONDS
    ) {
      throw new Error(
        "executor: GTD orders require an integer unix-seconds expiration at least " +
          `${GTD_MIN_BUFFER_SECONDS}s in the future`,
      );
    }
  }
  return { ...input, orderType, notionalUsd: input.price * input.size };
}

export function resolveMaxNotionalUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EXECUTOR_MAX_USD?.trim();
  if (!raw) return DEFAULT_MAX_NOTIONAL_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`executor: EXECUTOR_MAX_USD must be a positive number, got "${raw}"`);
  }
  return parsed;
}

export function assertNotionalGuard(
  order: BuiltLimitOrder,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const maxUsd = resolveMaxNotionalUsd(env);
  // Recompute from canonical fields — never trust a stored/derived notional.
  const notionalUsd = order.price * order.size;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    throw new Error(`executor: refusing order with invalid notional (${notionalUsd})`);
  }
  if (notionalUsd > maxUsd) {
    throw new Error(
      `executor: notional $${notionalUsd.toFixed(2)} exceeds EXECUTOR_MAX_USD=$${maxUsd}. ` +
        "Raise the cap explicitly if you mean it.",
    );
  }
}

export function isLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXECUTOR_LIVE === "1";
}

export interface DryRunPayload {
  mode: "dry-run";
  order: BuiltLimitOrder;
  builderAttribution: {
    enabled: boolean;
    builderCode?: string;
    builderCodeMasked?: string;
  };
  note: string;
}

/** Build the payload for a given, already-resolved builder code (or undefined = disabled). */
export function makeDryRunPayload(
  order: BuiltLimitOrder,
  builderCode: string | undefined,
): DryRunPayload {
  return {
    mode: "dry-run",
    order,
    builderAttribution: {
      enabled: Boolean(builderCode),
      builderCode,
      builderCodeMasked: builderCode ? maskBuilderCode(builderCode) : undefined,
    },
    note: "No network call was made. Set EXECUTOR_LIVE=1 to post for real.",
  };
}

/** What would be sent, without sending it. builderCode shown in full — it is public, not a secret. */
export function describeDryRun(order: BuiltLimitOrder): DryRunPayload {
  return makeDryRunPayload(order, resolveBuilderCode());
}
