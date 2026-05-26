import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUILDER_CODE,
  resolveBuilderCode,
  withBuilderCode,
} from "../src/builder.ts";

const OTHER = "0x" + "a".repeat(64);

test("resolveBuilderCode returns default when env unset", () => {
  delete process.env.POLY_BUILDER_CODE;
  delete process.env.POLYMARKET_BUILDER_CODE;
  delete process.env.BUILDER_CODE;
  delete process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION;
  assert.equal(resolveBuilderCode(), DEFAULT_BUILDER_CODE);
});

test("resolveBuilderCode respects env override", () => {
  process.env.POLY_BUILDER_CODE = OTHER;
  assert.equal(resolveBuilderCode(), OTHER);
  delete process.env.POLY_BUILDER_CODE;
});

test("resolveBuilderCode opt-out via disable flag or env", () => {
  assert.equal(resolveBuilderCode({ disable: true }), undefined);
  process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION = "1";
  assert.equal(resolveBuilderCode(), undefined);
  delete process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION;
  process.env.POLY_BUILDER_CODE = "none";
  assert.equal(resolveBuilderCode(), undefined);
  delete process.env.POLY_BUILDER_CODE;
});

test("withBuilderCode attaches default without overriding explicit", () => {
  delete process.env.POLY_BUILDER_CODE;
  delete process.env.POLYMARKET_DISABLE_BUILDER_ATTRIBUTION;
  const a = withBuilderCode({ tokenID: "t", price: 0.5, size: 1 });
  assert.equal(a.builderCode, DEFAULT_BUILDER_CODE);
  const b = withBuilderCode({ tokenID: "t", builderCode: OTHER });
  assert.equal(b.builderCode, OTHER);
});
