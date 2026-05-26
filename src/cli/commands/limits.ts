import { loadRateLimitRegistry, suggestedDelaySeconds } from "../../rate-limits.ts";
import { printJson } from "../util.ts";

export async function runLimits(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const family = argv.find((a) => !a.startsWith("--")) ?? "all";
  const registry = loadRateLimitRegistry();

  if (family === "all") {
    const summary = Object.entries(registry.families).map(([key, fam]) => ({
      family: key,
      base_url: fam.base_url,
      scopes: fam.limits.map((l) => ({
        ...l,
        suggested_delay_s: suggestedDelaySeconds(key, l.scope),
      })),
    }));
    if (json) {
      printJson({ updated_at: registry.updated_at, source: registry.source.url, families: summary });
      return;
    }
    console.log(`Rate limits · updated ${registry.updated_at}`);
    console.log(`Source: ${registry.source.url}\n`);
    for (const fam of summary) {
      console.log(`${fam.family} · ${fam.base_url}`);
      for (const s of fam.scopes.slice(0, 4)) {
        console.log(`  ${s.scope}: ${s.requests}/${s.window_seconds}s · sleep ~${s.suggested_delay_s}s`);
      }
    }
    return;
  }

  const fam = registry.families[family];
  if (!fam) throw new Error(`Unknown family. Try: ${Object.keys(registry.families).join(", ")}`);
  if (json) {
    printJson(fam);
    return;
  }
  console.log(`${family} · ${fam.base_url}\n`);
  for (const l of fam.limits) {
    console.log(`  ${l.scope}: ${l.requests} req / ${l.window_seconds}s · delay ~${suggestedDelaySeconds(family, l.scope)}s`);
  }
}
