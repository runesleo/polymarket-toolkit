/**
 * Executor credential loading. All secrets come from env — no defaults, no files.
 * The read-only core never imports this module.
 */

export interface ExecutorCredentials {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  /** 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE, 3 = POLY_1271 (deposit wallet). */
  signatureType: number;
  /** Funding address; for EOA (type 0) this may be omitted and defaults to the signer. */
  funderAddress?: string;
  host: string;
}

const ENV_PREFIX = "EXECUTOR_";
const REQUIRED_SECRETS = ["PRIVATE_KEY", "API_KEY", "API_SECRET", "API_PASSPHRASE"] as const;

export const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

function readEnv(name: string, env: NodeJS.ProcessEnv): string {
  return env[`${ENV_PREFIX}${name}`]?.trim() ?? "";
}

export function getMissingCredentials(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing = REQUIRED_SECRETS.filter((name) => !readEnv(name, env)).map(
    (name) => `${ENV_PREFIX}${name}`,
  );
  const signatureType = Number(readEnv("SIGNATURE_TYPE", env) || "0");
  if (signatureType !== 0 && !readEnv("FUNDER_ADDRESS", env)) {
    missing.push(`${ENV_PREFIX}FUNDER_ADDRESS (required when signature type != 0)`);
  }
  return missing;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Fail closed with a redacted message — never echo the supplied value
 * (ethers Wallet errors would otherwise include it verbatim). Applies to both
 * env-loaded and caller-provided credentials.
 */
export function assertPrivateKeyShape(privateKey: string): void {
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error(
      "executor: private key is malformed (expected 0x + 64 hex chars). Value withheld.",
    );
  }
}

export function loadCredentials(env: NodeJS.ProcessEnv = process.env): ExecutorCredentials {
  const missing = getMissingCredentials(env);
  if (missing.length > 0) {
    throw new Error(`executor: missing credentials: ${missing.join(", ")}`);
  }
  assertPrivateKeyShape(readEnv("PRIVATE_KEY", env));
  const signatureType = Number(readEnv("SIGNATURE_TYPE", env) || "0");
  if (![0, 1, 2, 3].includes(signatureType)) {
    throw new Error(`executor: EXECUTOR_SIGNATURE_TYPE must be 0-3, got ${signatureType}`);
  }
  return {
    privateKey: readEnv("PRIVATE_KEY", env),
    apiKey: readEnv("API_KEY", env),
    apiSecret: readEnv("API_SECRET", env),
    apiPassphrase: readEnv("API_PASSPHRASE", env),
    signatureType,
    funderAddress: readEnv("FUNDER_ADDRESS", env) || undefined,
    host: readEnv("HOST", env) || DEFAULT_CLOB_HOST,
  };
}
