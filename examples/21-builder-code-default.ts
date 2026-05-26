// Scenario: default builder attribution for future CLOB order helpers.
// This repo is read-only today — no orders are sent. Import when you wire an executor.

import { maskBuilderCode, resolveBuilderCode, withBuilderCode } from "../src/builder.ts";

const code = resolveBuilderCode();
console.log("default builder code:", code ? maskBuilderCode(code) : "(disabled)");

const sample = withBuilderCode({ tokenID: "demo", price: 0.5, size: 1 });
console.log("order args sample:", { ...sample, builderCode: sample.builderCode ? maskBuilderCode(sample.builderCode) : undefined });

console.log("\nOpt out: POLYMARKET_DISABLE_BUILDER_ATTRIBUTION=1 or POLY_BUILDER_CODE=none");
