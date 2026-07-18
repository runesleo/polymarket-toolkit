# Glama Installability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Glama build an installable official `polymarket-toolkit-mcp@0.7.2` server instead of inferring the unrelated root package.

**Terminal State:** A local `fix/glama-installability` commit contains the npm executable-mode fix, root Dockerfile, maintainer-owned `glama.json`, and regression tests; the normal suite, typecheck, packed-tarball install, and MCP `tools/list` introspection pass. Docker runs if an existing daemon is available. Push, npm publish, and Glama release remain gated.

**Phase Path:** Capture live failure evidence → reproduce the non-executable npm bin → add failing tests → fix and bump the package → add minimal Glama configuration → run packed-tarball introspection → local commit → request approval for publication.

**Current Batch:** Complete test-first local implementation, release verification, and handoff.

**Stop Conditions:** Stop on baseline/test failure, Docker unavailability after one diagnostic retry, writer conflict, credential/account request, push/public-release boundary, or try cap 3.

**Architecture:** Preserve the existing MCP surface. The build now marks its declared npm bin executable, `publishConfig` pins releases to the official npm registry, a three-line root Dockerfile pins the repaired package, and `glama.json` establishes `runesleo` as maintainer. Tests cover the executable artifact, registry target, and distinction from the unrelated `polymarket-toolkit` npm package.

**Tech Stack:** Node.js test runner, Docker, MCP stdio, Glama registry metadata.

---

### Task 1: Lock the packaging contract

**Files:**
- Create: `tests/glama-packaging.test.ts`

**Step 1: Write the failing test**

Assert that the root Dockerfile installs exactly `polymarket-toolkit-mcp@0.7.2`, uses `polymarket-toolkit-mcp` as its entrypoint, never installs `polymarket-toolkit`, and that `glama.json` declares the official schema plus `runesleo` maintainer.

**Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/glama-packaging.test.ts`

Expected: FAIL because `Dockerfile` and `glama.json` do not exist.

### Task 2: Add the minimal Glama build surface

**Files:**
- Create: `Dockerfile`
- Create: `glama.json`

**Step 1: Implement the Dockerfile**

```dockerfile
FROM node:20-slim
RUN npm install -g polymarket-toolkit-mcp@0.7.2
ENTRYPOINT ["polymarket-toolkit-mcp"]
```

**Step 2: Implement maintainer metadata**

```json
{
  "$schema": "https://glama.ai/mcp/schemas/server.json",
  "maintainers": ["runesleo"]
}
```

**Step 3: Verify GREEN**

Run the focused test, then `npm test` and `npm run typecheck`.

### Task 3: Repair and prove the npm executable

**Files:**
- Modify: `mcp/package.json`
- Modify: `mcp/package-lock.json`
- Create: `mcp/tests/package-bin.test.ts`

Build the MCP package in a test and assert that `dist/server.js` has a Node shebang and executable bits. Pin `publishConfig.registry` to `https://registry.npmjs.org/` so local mirror configuration cannot redirect a release. Bump the release candidate to `0.7.2`, pack it, install the tarball into a temporary prefix, and issue MCP `initialize` plus `tools/list` through the installed bin.

### Task 4: Prove the container configuration

**Step 1: Build**

Run: `docker build -t polymarket-toolkit-glama:0.7.2 .`

Expected after `0.7.2` is published: image builds from the pinned npm package. Before publication, the static Docker contract and local packed-tarball handshake are the authoritative checks.

**Step 2: Introspect**

If an existing Docker daemon is available, start the image over stdio and issue MCP `initialize` followed by `tools/list` using a local client. Do not start Docker Desktop as part of this batch.

Expected: protocol handshake succeeds and exactly 10 tools are returned.

**Step 3: Review and commit**

Run `git diff --check`, inspect the exact seven-file diff, and create a local commit. Do not push, publish npm, start services, or touch the Glama account.
