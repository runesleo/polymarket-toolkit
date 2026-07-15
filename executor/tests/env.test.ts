import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CLOB_HOST, getMissingCredentials, loadCredentials } from "../src/env.ts";

const FULL_ENV = {
  EXECUTOR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  EXECUTOR_API_KEY: "key",
  EXECUTOR_API_SECRET: "secret",
  EXECUTOR_API_PASSPHRASE: "pass",
} as NodeJS.ProcessEnv;

describe("credentials", () => {
  it("reports every missing secret by env var name", () => {
    const missing = getMissingCredentials({} as NodeJS.ProcessEnv);
    assert.equal(missing.length, 4);
    assert.ok(missing.includes("EXECUTOR_PRIVATE_KEY"));
  });

  it("loads a full EOA credential set with defaults", () => {
    const creds = loadCredentials(FULL_ENV);
    assert.equal(creds.signatureType, 0);
    assert.equal(creds.funderAddress, undefined);
    assert.equal(creds.host, DEFAULT_CLOB_HOST);
  });

  it("requires funder address for non-EOA signature types", () => {
    const env = { ...FULL_ENV, EXECUTOR_SIGNATURE_TYPE: "2" } as NodeJS.ProcessEnv;
    assert.throws(() => loadCredentials(env), /FUNDER_ADDRESS/);
    const ok = loadCredentials({
      ...env,
      EXECUTOR_FUNDER_ADDRESS: "0x0000000000000000000000000000000000000001",
    } as NodeJS.ProcessEnv);
    assert.equal(ok.signatureType, 2);
  });

  it("rejects malformed private keys without echoing the value", () => {
    const env = { ...FULL_ENV, EXECUTOR_PRIVATE_KEY: "hunter2-not-a-key" } as NodeJS.ProcessEnv;
    try {
      loadCredentials(env);
      assert.fail("expected loadCredentials to throw");
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /malformed/);
      assert.ok(!message.includes("hunter2-not-a-key"));
    }
  });

  it("rejects unknown signature types", () => {
    const env = {
      ...FULL_ENV,
      EXECUTOR_SIGNATURE_TYPE: "7",
      EXECUTOR_FUNDER_ADDRESS: "0x0000000000000000000000000000000000000001",
    } as NodeJS.ProcessEnv;
    assert.throws(() => loadCredentials(env), /must be 0-3/);
  });
});
