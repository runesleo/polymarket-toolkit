/**
 * Executor façade. The raw ClobClient is intentionally NOT exposed: every network
 * mutation must pass through the EXECUTOR_LIVE gate, the recomputed notional cap,
 * and console redaction (the underlying client logs auth headers on HTTP errors).
 *
 * Builder code resolution (default / env override / opt-out) lives in the core:
 * ../../src/builder.ts. It is resolved once at construction and reported verbatim
 * in dry-run payloads, so what you preview is what a live order would carry.
 */

import { maskBuilderCode, resolveBuilderCode } from "../../src/builder.ts";
import { assertPrivateKeyShape, loadCredentials, type ExecutorCredentials } from "./env.ts";
import {
  assertNotionalGuard,
  buildLimitOrder,
  isLiveEnabled,
  makeDryRunPayload,
  type BuiltLimitOrder,
  type DryRunPayload,
} from "./orders.ts";
import { withRedactedConsole } from "./redact.ts";

/** Minimal surface the executor needs from @polymarket/clob-client-v2. */
export interface RawOrderClient {
  createAndPostOrder(args: unknown, options: unknown, orderType: unknown): Promise<unknown>;
  cancelOrder(payload: { orderID: string }): Promise<unknown>;
}

export type PostLimitOrderResult =
  | DryRunPayload
  | { mode: "live"; order: BuiltLimitOrder; response: unknown };

export type CancelOrderResult =
  | { mode: "dry-run"; orderID: string; note: string }
  | { mode: "live"; orderID: string; response: unknown };

export interface Executor {
  /** Resolved attribution for this executor instance (undefined = disabled). */
  readonly builderCode: string | undefined;
  postLimitOrder(order: BuiltLimitOrder): Promise<PostLimitOrderResult>;
  cancelOrder(orderID: string): Promise<CancelOrderResult>;
  /** Preview using this instance's resolved builder code — matches live behavior. */
  dryRun(order: BuiltLimitOrder): DryRunPayload;
}

export interface CreateExecutorOptions {
  credentials?: ExecutorCredentials;
  /** Disable builder attribution for this executor (same effect as the env opt-out). */
  disableBuilderAttribution?: boolean;
  quiet?: boolean;
  /** Test seam: inject a fake raw client. When set, credentials are not required. */
  rawClient?: RawOrderClient;
}

export async function createExecutor(options: CreateExecutorOptions = {}): Promise<Executor> {
  const builderCode = resolveBuilderCode({ disable: options.disableBuilderAttribution });

  let raw: RawOrderClient;
  let secrets: string[] = [];
  let side: typeof import("@polymarket/clob-client-v2").Side | undefined;
  let orderTypeEnum: typeof import("@polymarket/clob-client-v2").OrderType | undefined;

  if (options.rawClient) {
    raw = options.rawClient;
  } else {
    const creds = options.credentials ?? loadCredentials();
    assertPrivateKeyShape(creds.privateKey);
    const [{ Wallet }, clob] = await Promise.all([
      import("@ethersproject/wallet"),
      import("@polymarket/clob-client-v2"),
    ]);
    const signer = new Wallet(creds.privateKey);
    side = clob.Side;
    orderTypeEnum = clob.OrderType;
    secrets = [creds.privateKey, creds.apiKey, creds.apiSecret, creds.apiPassphrase];
    raw = new clob.ClobClient({
      host: creds.host,
      chain: clob.Chain.POLYGON,
      signer: signer as any,
      creds: { key: creds.apiKey, secret: creds.apiSecret, passphrase: creds.apiPassphrase },
      signatureType: creds.signatureType as any,
      funderAddress: creds.funderAddress ?? signer.address,
      builderConfig: builderCode ? { builderCode } : undefined,
    }) as unknown as RawOrderClient;

    if (!options.quiet) {
      console.log(
        `[executor] ready sigType=${creds.signatureType} builder=${
          builderCode ? `on (${maskBuilderCode(builderCode)})` : "off"
        }`,
      );
    }
  }

  // Same preflight for dry-run and live: re-validate every canonical field
  // (side/price/size/tokenID and GTD freshness) and re-check the notional cap.
  // A tampered order object fails identically in both modes.
  const preflight = (order: BuiltLimitOrder): BuiltLimitOrder => {
    const validated = buildLimitOrder(
      {
        tokenID: order.tokenID,
        price: order.price,
        side: order.side,
        size: order.size,
        expiration: order.expiration,
      },
      order.orderType,
    );
    assertNotionalGuard(validated);
    return validated;
  };

  return {
    builderCode,

    dryRun(order: BuiltLimitOrder): DryRunPayload {
      return makeDryRunPayload(preflight(order), builderCode);
    },

    async postLimitOrder(order: BuiltLimitOrder): Promise<PostLimitOrderResult> {
      const validated = preflight(order);
      if (!isLiveEnabled()) {
        return makeDryRunPayload(validated, builderCode);
      }
      const args = {
        tokenID: validated.tokenID,
        price: validated.price,
        side: validated.side === "BUY" ? (side?.BUY ?? "BUY") : (side?.SELL ?? "SELL"),
        size: validated.size,
        ...(validated.orderType === "GTD" && validated.expiration
          ? { expiration: validated.expiration }
          : {}),
      };
      const type =
        validated.orderType === "GTD"
          ? (orderTypeEnum?.GTD ?? "GTD")
          : (orderTypeEnum?.GTC ?? "GTC");
      const response = await withRedactedConsole(secrets, () =>
        raw.createAndPostOrder(args, undefined, type),
      );
      return { mode: "live", order: validated, response };
    },

    async cancelOrder(orderID: string): Promise<CancelOrderResult> {
      if (!isLiveEnabled()) {
        return { mode: "dry-run", orderID, note: "Set EXECUTOR_LIVE=1 to cancel for real." };
      }
      const response = await withRedactedConsole(secrets, () => raw.cancelOrder({ orderID }));
      return { mode: "live", orderID, response };
    },
  };
}
