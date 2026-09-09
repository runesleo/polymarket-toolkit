/**
 * Executor façade. The raw SDK client is intentionally NOT exposed: every network
 * mutation must pass through the EXECUTOR_LIVE gate, the recomputed notional cap,
 * builder-attribution resolution, and console redaction.
 *
 * Unified SDK migration notes:
 * - Uses @polymarket/client instead of @polymarket/clob-client-v2.
 * - Builder attribution is attached per order via builderCode.
 * - Existing Ethers v5 wallet material is adapted with @polymarket/client/ethers-v5.
 * - Dry-run remains the default; no SDK network mutation occurs unless EXECUTOR_LIVE=1.
 * - The injected RawOrderClient seam intentionally keeps its legacy method names so
 *   the pre-migration safety tests keep exercising the same mutation boundary.
 */

import { createSecureClient, OrderSide } from "@polymarket/client";
import { signerFrom } from "@polymarket/client/ethers-v5";
import { ethers } from "ethers-v5";

import { maskBuilderCode, resolveBuilderCode } from "../../src/builder.ts";
import { assertPrivateKeyShape, loadCredentials, type ExecutorCredentials } from "./env.ts";
import {
  assertNotionalGuard,
  buildLimitOrder,
  isLiveEnabled,
  makeDryRunPayload,
  type BuiltLimitOrder,
  type DryRunPayload,
  type ExecutorSide,
} from "./orders.ts";
import { withRedactedConsole } from "./redact.ts";

export interface UnifiedLimitOrderRequest {
  assetId: string;
  price: number;
  side: ExecutorSide;
  size: number;
  expiration?: number;
  builderCode?: string;
}

/**
 * Stable test seam. These legacy-shaped method names are internal only; the real
 * implementation adapts them to @polymarket/client below.
 */
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

  if (options.rawClient) {
    raw = options.rawClient;
  } else {
    const creds = options.credentials ?? loadCredentials();
    assertPrivateKeyShape(creds.privateKey);

    const wallet = new ethers.Wallet(creds.privateKey);
    const secureClient = await createSecureClient({
      wallet: creds.funderAddress ?? wallet.address,
      signer: signerFrom(wallet),
      // The unified SDK validates these at runtime. Existing executor env names are
      // preserved so migration does not force operators to rotate credentials.
      credentials: {
        key: creds.apiKey as never,
        secret: creds.apiSecret,
        passphrase: creds.apiPassphrase,
      },
    });

    secrets = [creds.privateKey, creds.apiKey, creds.apiSecret, creds.apiPassphrase];
    raw = {
      async createAndPostOrder(args: unknown): Promise<unknown> {
        const request = args as UnifiedLimitOrderRequest;
        return secureClient.placeLimitOrder({
          assetId: request.assetId,
          price: request.price,
          side: request.side === "BUY" ? OrderSide.BUY : OrderSide.SELL,
          size: request.size,
          ...(request.expiration !== undefined ? { expiration: request.expiration } : {}),
          ...(request.builderCode ? { builderCode: request.builderCode } : {}),
        });
      },
      async cancelOrder(payload: { orderID: string }): Promise<unknown> {
        return secureClient.cancelOrder({ orderId: payload.orderID });
      },
    };

    if (!options.quiet) {
      console.log(
        `[executor] unified client ready legacySigType=${creds.signatureType} builder=${
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

      const request: UnifiedLimitOrderRequest = {
        assetId: validated.tokenID,
        price: validated.price,
        side: validated.side,
        size: validated.size,
        ...(validated.orderType === "GTD" && validated.expiration
          ? { expiration: validated.expiration }
          : {}),
        ...(builderCode ? { builderCode } : {}),
      };

      // orderType is retained at this seam for test compatibility; the unified SDK
      // derives GTC/GTD from the optional expiration on the adapted request.
      const response = await withRedactedConsole(secrets, () =>
        raw.createAndPostOrder(request, undefined, validated.orderType),
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
