/** Polymarket builder attribution helpers (public bytes32 — not a secret). */

export const DEFAULT_BUILDER_CODE =
  "0x6de189602628ae918a4d784164fc185d2604424b7aaf01ec4ddd8e30807e4fcb";

const BUILDER_CODE_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const BUILDER_ENV_KEYS = ["POLY_BUILDER_CODE", "POLYMARKET_BUILDER_CODE", "BUILDER_CODE"] as const;

/**
 * Resolve builder code for CLOB order attribution.
 * Default: author's public code. Override via env. Opt out: POLYMARKET_DISABLE_BUILDER_ATTRIBUTION=1
 * or POLY_BUILDER_CODE=none
 */
export function resolveBuilderCode(options: { disable?: boolean } = {}): string | undefined {
  if (options.disable || process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION === "1") {
    return undefined;
  }

  for (const key of BUILDER_ENV_KEYS) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;
    if (raw === "none" || raw === "off") return undefined;
    if (BUILDER_CODE_PATTERN.test(raw)) return raw;
  }

  return DEFAULT_BUILDER_CODE;
}

/** Attach builderCode to order args when not already set. */
export function withBuilderCode<T extends Record<string, unknown>>(
  args: T & { builderCode?: string },
  options: { disable?: boolean } = {},
): T & { builderCode?: string } {
  if (args.builderCode) return args;
  const code = resolveBuilderCode(options);
  return code ? ({ ...args, builderCode: code } as T & { builderCode: string }) : args;
}

export function maskBuilderCode(code: string): string {
  return `${code.slice(0, 8)}...${code.slice(-6)}`;
}
