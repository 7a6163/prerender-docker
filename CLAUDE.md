# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Docker packaging of the upstream `prerender` service (headless Chromium renderer for crawlers) with Redis/Valkey caching plus a custom request-deduplication layer. All application code lives in a single file: `server.js`.

## Commands

```bash
docker compose up -d --build       # run service (prerender + valkey) on :3000
docker compose logs -f prerender   # logs; "Started Chrome" = ready
curl http://localhost:3000/render?url=http://example.com
curl -X DELETE http://localhost:3000/render?url=http://example.com   # invalidate cache (supports /* wildcard)

npm test                  # all mocha tests
npm run test:unit         # needs Redis reachable at REDIS_URL
npm run test:integration  # needs the service running on PRERENDER_URL (default localhost:3000)
npx mocha test/unit/redis-lock.test.js   # single file
npx mocha test/**/*.test.js -g "429"     # single test by name
```

Tests are Mocha + Chai, no build step, no linter. Integration tests hit the live service and public `httpbin.org`, so they fail offline.

`PRERENDER_URL` and `REDIS_URL` steer the tests; runtime config is in `.env.example` / `compose.yml` (`REDIS_URL`, `PAGE_TTL`, `MAX_CONCURRENT_RENDERS`, `LOCK_TTL`, `DISABLE_IMAGES`).

## Architecture

Request flow through `server.js` middleware, in registration order (order is load-bearing):

1. **Dedup middleware** (`requestReceived`): if the cache key exists in Redis → `next()` immediately, no lock. Else if `currentRenders >= MAX_CONCURRENT_RENDERS` → `503`. Else `SET lockKey NX EX LOCK_TTL`; the winner stores `req.prerender.lockKey` and renders. Losers poll the cache every 200ms and `next()` into the cache middleware once the winner fills it, so they return 200 rather than 429 (crawlers cut their crawl rate on 429s); they give up early if the lock disappears with the cache still empty, and after `LOCK_TTL` return `429` + `Retry-After: 5`. Any Redis error falls through to `next()` (fail-open).
2. `prerender-redis-cache-ng` — serves/stores the rendered HTML.
3. `blacklist` → `httpHeaders` → `removeScriptTags`.

The lock is released in the same middleware's `beforeSend`, which decrements `currentRenders` *before* the Redis `DEL` — a throw there must not leak the render slot. The cache write happens in the cache plugin's `pageLoaded`, i.e. before `beforeSend`, which is why "lock gone but cache empty" reliably means the render failed.

Things that bite:

- **Cache key duplication.** The dedup middleware computes the key as `url.replace(/^https?:\/\//, '')` to match `prerender-redis-cache-ng`'s protocol-agnostic scheme, and derives the lock key from it so both have the same granularity. If that library changes its key format, the cache-hit shortcut and the waiting path silently stop working.
- **`currentRenders` is per-process.** The per-URL lock is in Redis (cluster-wide), but the concurrency limit is a local counter — with multiple replicas the real limit is `MAX_CONCURRENT_RENDERS × replicas`.
- **Locks only release in `beforeSend`.** A request that dies before that leaves the lock until `LOCK_TTL` expires, during which the URL 429s. Keep `LOCK_TTL` above worst-case page load time.
- **The Dockerfile copies only `package.json` and `server.js`.** Adding a source file or a `require` of a local module means editing the `COPY` lines, or it breaks only inside the container. `npm install --no-package-lock` also means the committed `package-lock.json` does not pin the image's deps.

## Versioning / release

`package.json` version tracks the pinned upstream `prerender` version (currently 5.21.6) — bump both together. Pushing a `v*.*.*` tag triggers `.github/workflows/docker-build-and-push.yml`, which builds linux/amd64+arm64 and pushes to GHCR and Docker Hub.
