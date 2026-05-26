# Referral & builder attribution (optional)

This repo is **read-only** — it does not place CLOB orders or attach builder codes by itself.  
If you build your own executor on top, two separate Polymarket programs may apply:

## 1. Referral link (signup)

For new accounts, you can use the author's referral link:

```
https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit
```

**Disclosure:** This is an affiliate link. The author may receive referral rewards if you sign up and trade. No extra cost to you beyond normal Polymarket fees.

## 2. Builder code (order routing)

Polymarket's [Builder Program](https://docs.polymarket.com/builders/overview) attributes **matched orders** to a public `builderCode` (bytes32, from [Settings → Builder](https://polymarket.com/settings?tab=builder)).

- Builder codes and fee rates are **public by design** (Polymarket docs).
- Rebates/fees only accrue when **your app submits orders with that code attached** — not from using this toolkit's read-only CLI/skills alone.
- You must **disclose** any builder fee you charge end users (Polymarket Builder Code of Conduct).

**Optional — support the author when you wire your own bot:**

```bash
# In YOUR trading repo .env (not required for this toolkit)
POLY_BUILDER_CODE=0x<64-hex-from-pm-builder-settings>
```

Get the author's public builder code from their Polymarket builder profile or [open a GitHub issue](https://github.com/runesleo/polymarket-toolkit/issues) — do **not** commit private keys or Builder API secrets here.

## What this repo does NOT include

- No `createClobClient` / order signing
- No default injection of builder code into API calls
- No hidden fees in read-only tools

Execution modules belong in your own wallet stack or a separate trading repo.
