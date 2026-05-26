import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, "../docs/data/polymarket-api-rate-limits.json");

export type RateLimitEntry = {
  scope: string;
  requests: number;
  window_seconds: number;
};

export type RateLimitFamily = {
  base_url: string;
  auth: string;
  limits: RateLimitEntry[];
};

export type RateLimitRegistry = {
  schema_version: number;
  updated_at: string;
  source: { title: string; url: string; notes?: string };
  families: Record<string, RateLimitFamily>;
};

let cached: RateLimitRegistry | null = null;

export function loadRateLimitRegistry(): RateLimitRegistry {
  if (!cached) {
    cached = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RateLimitRegistry;
  }
  return cached;
}

/** Conservative delay between sequential requests to a family scope (seconds). */
export function suggestedDelaySeconds(
  family: string,
  scope = "general",
  safetyFactor = 0.85,
): number {
  const registry = loadRateLimitRegistry();
  const fam = registry.families[family];
  if (!fam) throw new Error(`Unknown API family: ${family}`);
  const match = fam.limits.find((l) => l.scope === scope) ?? fam.limits.find((l) => l.scope === "general");
  if (!match) throw new Error(`No limit for ${family}/${scope}`);
  return Math.round((match.window_seconds / match.requests / safetyFactor) * 10000) / 10000;
}
