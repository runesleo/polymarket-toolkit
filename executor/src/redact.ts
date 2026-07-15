/**
 * @polymarket/clob-client-v2 logs full Axios error configs (including L2 auth
 * headers: POLY_API_KEY / POLY_PASSPHRASE / POLY_SIGNATURE) via console.error on
 * HTTP failures. Wrap live network calls so those values never reach stderr.
 *
 * The wrapper is installed once and reference-counted, so overlapping concurrent
 * calls never restore the bare console early; secrets are the union of all
 * active contexts. Non-string args are serialized and scrubbed too.
 */

const SENSITIVE_HEADER_PATTERN =
  /("(?:POLY_API_KEY|POLY_PASSPHRASE|POLY_SIGNATURE|POLY_ADDRESS|Authorization)"\s*:\s*")[^"]*(")/g;

export function redactString(text: string, secrets: string[]): string {
  let out = text.replace(SENSITIVE_HEADER_PATTERN, "$1[redacted]$2");
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

const activeSecretSets = new Set<string[]>();
let installed: { error: typeof console.error; warn: typeof console.warn } | undefined;

function activeSecrets(): string[] {
  const union: string[] = [];
  for (const set of activeSecretSets) union.push(...set);
  return union;
}

function scrubArg(arg: unknown, secrets: string[]): unknown {
  if (typeof arg === "string") return redactString(arg, secrets);
  if (arg && typeof arg === "object") {
    try {
      return redactString(JSON.stringify(arg), secrets);
    } catch {
      return "[unserializable object redacted]";
    }
  }
  return arg;
}

function install(): void {
  if (installed) return;
  installed = { error: console.error, warn: console.warn };
  const wrap =
    (base: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const secrets = activeSecrets();
      base(...args.map((arg) => scrubArg(arg, secrets)));
    };
  console.error = wrap(installed.error);
  console.warn = wrap(installed.warn);
}

function uninstallIfIdle(): void {
  if (installed && activeSecretSets.size === 0) {
    console.error = installed.error;
    console.warn = installed.warn;
    installed = undefined;
  }
}

/** Run fn with console.error/console.warn scrubbed of the given secrets. Concurrency-safe. */
export async function withRedactedConsole<T>(
  secrets: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const set = secrets.filter(Boolean);
  activeSecretSets.add(set);
  install();
  try {
    return await fn();
  } finally {
    activeSecretSets.delete(set);
    uninstallIfIdle();
  }
}
